import { Category, Reminder } from '../types';
import { Confidence } from '../types/smartEngine';
import { computeDashboardMetrics } from '../utils/dashboard';

/**
 * Deterministic, local-only completed-history context.
 *
 * Completed reminders already on the device are used to improve matching,
 * category suggestions and historical statistics. Nothing is recreated, and no
 * completed reminder is ever modified.
 */

/** Minimum similarity for a completed reminder to be used as context. */
export const HISTORY_MATCH_THRESHOLD = 0.75;
/**
 * Minimum similarity for a completed reminder to drive a category suggestion.
 * Lower than exact matching so near-identical past titles count, but high enough
 * that a vague or unrelated title never produces a suggestion.
 */
export const HISTORY_CATEGORY_EVIDENCE_THRESHOLD = 0.8;

const UNKNOWN: Confidence = { score: 0, reason: 'unknown' };

export type HistoryMatchReason = 'exact-match' | 'derived' | 'fuzzy-match';

export interface SimilarCompletedReminder {
  reminderId: string;
  title: string;
  categoryId: string;
  completedAt?: string;
  score: number;
  reason: HistoryMatchReason;
}

export interface HistoryCategorySuggestion {
  categoryId: string;
  categoryName: string;
  evidenceCount: number;
  alternatives: string[];
  confidence: Confidence;
  reason: string;
}

export interface RepeatedTaskPattern {
  title: string;
  occurrenceCount: number;
  intervalDays: number;
  unit: 'day' | 'week';
  confidence: Confidence;
}

export interface HistoryCategorySummary {
  categoryId: string;
  categoryName: string;
  completedCount: number;
  averageCompletionHours: number;
  formatted: string;
}

export interface CompletedHistorySummary {
  completedCount: number;
  withTimestampsCount: number;
  averageCompletionHours?: number;
  averageCompletionFormatted?: string;
  averageAvailable: boolean;
  byCategory: HistoryCategorySummary[];
}

/** Lower-cases, strips accents and punctuation, and collapses whitespace. */
export function normalizeHistoryTitle(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function titleTokens(value: string): string[] {
  return normalizeHistoryTitle(value).split(' ').filter(Boolean);
}

function bigramSimilarity(a: string, b: string): number {
  const left = normalizeHistoryTitle(a).replace(/ /g, '');
  const right = normalizeHistoryTitle(b).replace(/ /g, '');
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return 0;

  const bigrams = new Map<string, number>();
  for (let index = 0; index < left.length - 1; index += 1) {
    const bigram = left.slice(index, index + 2);
    bigrams.set(bigram, (bigrams.get(bigram) ?? 0) + 1);
  }

  let overlap = 0;
  for (let index = 0; index < right.length - 1; index += 1) {
    const bigram = right.slice(index, index + 2);
    const remaining = bigrams.get(bigram) ?? 0;
    if (remaining > 0) {
      bigrams.set(bigram, remaining - 1);
      overlap += 1;
    }
  }

  return (2 * overlap) / (left.length - 1 + (right.length - 1));
}

interface ScoredTitle {
  score: number;
  reason: HistoryMatchReason;
}

/** Conservative title scoring: exact, then token overlap, then conservative fuzzy. */
export function scoreTitleSimilarity(query: string, candidate: string): ScoredTitle | undefined {
  const normalizedQuery = normalizeHistoryTitle(query);
  const normalizedCandidate = normalizeHistoryTitle(candidate);
  if (!normalizedQuery || !normalizedCandidate) return undefined;
  if (normalizedQuery === normalizedCandidate) return { score: 0.98, reason: 'exact-match' };

  const queryTokens = titleTokens(query);
  const candidateTokens = titleTokens(candidate);
  const querySet = new Set(queryTokens);
  const candidateSet = new Set(candidateTokens);
  const shared = [...querySet].filter((token) => candidateSet.has(token) && token.length > 2).length;
  const union = new Set([...queryTokens, ...candidateTokens]).size;
  const jaccard = union > 0 ? shared / union : 0;
  if (shared > 0 && jaccard >= 0.6) {
    return { score: Math.round(Math.min(0.92, 0.72 + jaccard * 0.2) * 100) / 100, reason: 'derived' };
  }

  const similarity = bigramSimilarity(query, candidate);
  if (similarity >= 0.82) {
    return { score: Math.round(Math.min(0.88, 0.6 + similarity * 0.3) * 100) / 100, reason: 'fuzzy-match' };
  }

  return undefined;
}

/** Narrows stored reminders to completed ones only. */
function completedOnly(reminders: readonly Reminder[]): Reminder[] {
  return reminders.filter((reminder) => reminder.completed);
}

/**
 * Finds completed reminders with a similar title. Used purely as context, so a
 * completed task is never re-created or altered.
 */
export function findSimilarCompletedReminders(
  title: string,
  reminders: readonly Reminder[] = [],
  options: { minimumScore?: number; maxResults?: number } = {}
): SimilarCompletedReminder[] {
  const minimumScore = options.minimumScore ?? HISTORY_MATCH_THRESHOLD;
  const maxResults = options.maxResults ?? 5;
  if (!normalizeHistoryTitle(title)) return [];

  const matches: SimilarCompletedReminder[] = [];
  for (const reminder of completedOnly(reminders)) {
    const scored = scoreTitleSimilarity(title, reminder.title);
    if (!scored || scored.score < minimumScore) continue;
    matches.push({
      reminderId: reminder.id,
      title: reminder.title,
      categoryId: reminder.categoryId,
      completedAt: reminder.completedAt,
      score: scored.score,
      reason: scored.reason,
    });
  }
  return matches.sort((a, b) => b.score - a.score).slice(0, maxResults);
}

/**
 * Suggests a category from previously completed reminders with a similar title.
 * This is a fallback used only when no existing category matched directly.
 */
export function suggestCategoryFromHistory(
  title: string,
  reminders: readonly Reminder[] = [],
  categories: readonly Category[] = []
): HistoryCategorySuggestion | undefined {
  const similar = findSimilarCompletedReminders(title, reminders, {
    minimumScore: HISTORY_CATEGORY_EVIDENCE_THRESHOLD,
    maxResults: 25,
  });
  if (similar.length === 0) return undefined;

  const tally = new Map<string, number>();
  for (const entry of similar) tally.set(entry.categoryId, (tally.get(entry.categoryId) ?? 0) + 1);

  const ranked = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  const [topCategoryId, evidenceCount] = ranked[0];
  const category = categories.find((item) => item.id === topCategoryId);
  if (!category) return undefined;

  const tied = ranked.filter(([, count]) => count === evidenceCount);
  if (tied.length > 1) {
    return {
      categoryId: category.id,
      categoryName: category.name,
      evidenceCount,
      alternatives: tied
        .map(([id]) => categories.find((item) => item.id === id)?.name)
        .filter((name): name is string => Boolean(name)),
      confidence: { score: 0.55, reason: 'ambiguous' },
      reason: 'Completed reminders with a similar title were stored in more than one category.',
    };
  }

  return {
    categoryId: category.id,
    categoryName: category.name,
    evidenceCount,
    alternatives: ranked.slice(1, 3)
      .map(([id]) => categories.find((item) => item.id === id)?.name)
      .filter((name): name is string => Boolean(name)),
    confidence: { score: evidenceCount >= 2 ? 0.86 : 0.74, reason: 'derived' },
    reason: `Based on ${evidenceCount} completed reminder${evidenceCount === 1 ? '' : 's'} with a similar title.`,
  };
}

/**
 * Detects a clearly repeated task: only reported when near-identical completed
 * reminders exist with evenly spaced completion dates.
 */
export function detectRepeatedTaskPattern(
  title: string,
  reminders: readonly Reminder[] = []
): RepeatedTaskPattern | undefined {
  const similar = findSimilarCompletedReminders(title, reminders, { minimumScore: 0.9, maxResults: 25 })
    .filter((entry) => {
      const reminder = reminders.find((item) => item.id === entry.reminderId);
      return Boolean(reminder?.completedAt && Number.isFinite(new Date(reminder.completedAt).getTime()));
    })
    .map((entry) => ({
      ...entry,
      time: new Date(reminders.find((item) => item.id === entry.reminderId)?.completedAt as string).getTime(),
    }))
    .sort((a, b) => a.time - b.time);

  if (similar.length < 3) return undefined;

  const gaps: number[] = [];
  for (let index = 1; index < similar.length; index += 1) {
    const gapDays = Math.round((similar[index].time - similar[index - 1].time) / 86_400_000);
    if (gapDays < 1) return undefined;
    gaps.push(gapDays);
  }
  if (gaps.length === 0) return undefined;

  const first = gaps[0];
  const evenlySpaced = gaps.every((gap) => Math.abs(gap - first) <= 1);
  if (!evenlySpaced) return undefined;
  if (first < 1 || first > 365) return undefined;

  const isWeekly = first >= 7 && first % 7 === 0;
  return {
    title: similar[similar.length - 1].title,
    occurrenceCount: similar.length,
    intervalDays: first,
    unit: isWeekly ? 'week' : 'day',
    confidence: { score: 0.8, reason: 'derived' },
  };
}

/**
 * Computes historical averages from stored data using the existing dashboard
 * calculator, so no statistic is derived twice or invented.
 */
export function summarizeCompletedHistory(
  reminders: readonly Reminder[] = [],
  categories: readonly Category[] = []
): CompletedHistorySummary {
  const completed = completedOnly(reminders);
  const withTimestamps = completed.filter((reminder) => {
    if (!reminder.completedAt) return false;
    const created = new Date(reminder.createdAt).getTime();
    const finished = new Date(reminder.completedAt).getTime();
    return Number.isFinite(created) && Number.isFinite(finished) && finished >= created;
  });

  if (completed.length === 0) {
    return { completedCount: 0, withTimestampsCount: 0, averageAvailable: false, byCategory: [] };
  }

  const metrics = computeDashboardMetrics(completed, [...categories], undefined, 'all', null);
  const averageAvailable = withTimestamps.length > 0;

  return {
    completedCount: completed.length,
    withTimestampsCount: withTimestamps.length,
    averageCompletionHours: averageAvailable ? metrics.overallAverageDurationHours : undefined,
    averageCompletionFormatted: averageAvailable ? metrics.formattedOverallDuration : undefined,
    averageAvailable,
    byCategory: metrics.categoryStats.map((stat) => ({
      categoryId: stat.categoryId,
      categoryName: stat.categoryName,
      completedCount: stat.completedCount,
      averageCompletionHours: stat.averageDurationHours,
      formatted: stat.formattedDuration,
    })),
  };
}

export const UNKNOWN_HISTORY_CONFIDENCE: Confidence = UNKNOWN;
