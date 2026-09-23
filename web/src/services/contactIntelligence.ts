import { Contact } from '../types/contact';
import { Ambiguity, Confidence } from '../types/smartEngine';

/**
 * Deterministic, local-only contact matching.
 *
 * The matcher only ever reads the on-device contact book: it never creates,
 * edits or deletes contacts, and it never guesses when the wording is unclear.
 */

/** Fuzzy matches below this similarity are treated as unknown rather than guessed. */
export const CONTACT_FUZZY_THRESHOLD = 0.82;
/** A runner-up within this distance of the best match makes the result ambiguous. */
export const CONTACT_AMBIGUITY_MARGIN = 0.05;

const UNKNOWN: Confidence = { score: 0, reason: 'unknown' };

export type ContactMatchReason = 'exact-match' | 'derived' | 'fuzzy-match';

export interface ContactMatch {
  contactId: string;
  name: string;
  displayName?: string;
  relationship?: string;
  score: number;
  reason: ContactMatchReason;
  /** What was actually compared, for debugging the decision. */
  matchedOn: string;
}

export interface ContactMatchResult {
  query: string;
  matches: ContactMatch[];
  best?: ContactMatch;
  ambiguities: Ambiguity[];
  confidence: Confidence;
  message: string;
}

export interface ContactMatchOptions {
  /** Minimum score kept in `matches`. Defaults to the conservative fuzzy threshold. */
  minimumScore?: number;
  maxResults?: number;
}

/** Lower-cases, strips accents and punctuation, and collapses whitespace. */
export function normalizeContactName(value: string): string {
  return (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function tokens(value: string): string[] {
  return normalizeContactName(value).split(' ').filter(Boolean);
}

/** Sørensen–Dice similarity over character bigrams (1 = identical). */
export function nameSimilarity(a: string, b: string): number {
  const left = normalizeContactName(a).replace(/ /g, '');
  const right = normalizeContactName(b).replace(/ /g, '');
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.length < 2 || right.length < 2) return left === right ? 1 : 0;

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

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Scores one contact against a query, or returns undefined when nothing is conservative. */
export function scoreContactName(query: string, contact: Contact): ContactMatch | undefined {
  const normalizedQuery = normalizeContactName(query);
  const normalizedFull = normalizeContactName(contact.fullName);
  if (!normalizedQuery || !normalizedFull) return undefined;

  const base = {
    contactId: contact.id,
    name: contact.fullName,
    displayName: contact.displayName,
    relationship: contact.relationship,
  };

  if (normalizedQuery === normalizedFull) {
    return { ...base, score: 0.98, reason: 'exact-match', matchedOn: 'full name' };
  }

  const alternatives: Array<{ value: string; label: string }> = [
    { value: contact.displayName ?? '', label: 'display name' },
    { value: contact.firstName ?? '', label: 'first name' },
    { value: contact.lastName ?? '', label: 'last name' },
  ].filter((entry) => Boolean(normalizeContactName(entry.value)));

  for (const alternative of alternatives) {
    if (normalizedQuery === normalizeContactName(alternative.value)) {
      return { ...base, score: 0.94, reason: 'exact-match', matchedOn: alternative.label };
    }
  }

  // Token containment: "josh" against "josh smith", or the full name inside a sentence.
  const queryTokens = tokens(query);
  const nameTokens = tokens(contact.fullName);
  const nameTokenSet = new Set(nameTokens);
  const queryTokenSet = new Set(queryTokens);
  const queryInsideName = queryTokens.length > 0 && queryTokens.every((token) => nameTokenSet.has(token));
  const nameInsideQuery = nameTokens.length > 0 && nameTokens.every((token) => queryTokenSet.has(token));
  if (queryInsideName || nameInsideQuery) {
    return {
      ...base,
      score: 0.88,
      reason: 'derived',
      matchedOn: queryInsideName ? 'query tokens appear in the contact name' : 'contact name appears in the text',
    };
  }

  // Conservative fuzzy matching; only the closest pairing above the threshold counts.
  let bestSimilarity = 0;
  let matchedOn = 'fuzzy name similarity';
  for (const candidate of [contact.fullName, ...alternatives.map((entry) => entry.value)]) {
    const similarity = nameSimilarity(query, candidate);
    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;
      matchedOn = `fuzzy similarity with “${candidate}”`;
    }
  }
  if (bestSimilarity >= CONTACT_FUZZY_THRESHOLD) {
    return { ...base, score: round(Math.min(0.86, 0.6 + bestSimilarity * 0.26)), reason: 'fuzzy-match', matchedOn };
  }

  return undefined;
}

/**
 * Matches a name against the local contact book. Multiple close candidates are
 * reported as ambiguity instead of one arbitrary winner, and nothing is created.
 */
export function matchContactByName(
  query: string,
  contacts: readonly Contact[] = [],
  options: ContactMatchOptions = {}
): ContactMatchResult {
  const trimmed = (query || '').trim();
  const minimumScore = options.minimumScore ?? 0.7;
  const maxResults = options.maxResults ?? 5;

  if (!trimmed) {
    return {
      query: trimmed,
      matches: [],
      ambiguities: [],
      confidence: UNKNOWN,
      message: 'No name was provided, so no contact was matched.',
    };
  }

  const matches = contacts
    .map((contact) => scoreContactName(trimmed, contact))
    .filter((match): match is ContactMatch => Boolean(match))
    .filter((match) => match.score >= minimumScore && match.score >= CONTACT_FUZZY_THRESHOLD * 0.85)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);

  if (matches.length === 0) {
    return {
      query: trimmed,
      matches: [],
      ambiguities: [],
      confidence: UNKNOWN,
      message: `No contact matched “${trimmed}”. Nothing was guessed and no contact was created.`,
    };
  }

  const top = matches[0];
  const closeMatches = matches.filter((match) => top.score - match.score < CONTACT_AMBIGUITY_MARGIN);
  if (closeMatches.length > 1) {
    return {
      query: trimmed,
      matches,
      ambiguities: [
        {
          field: 'contactId',
          message: `More than one contact matches “${trimmed}”; choose one.`,
          options: closeMatches.map((match) => match.name),
        },
      ],
      confidence: { score: 0.45, reason: 'ambiguous' },
      message: `More than one contact matches “${trimmed}”. No contact was changed.`,
    };
  }

  return {
    query: trimmed,
    matches,
    best: top,
    ambiguities: [],
    confidence: { score: top.score, reason: top.reason === 'fuzzy-match' ? 'fuzzy-match' : top.reason === 'derived' ? 'derived' : 'exact-match' },
    message: `Matched contact “${top.name}”. No contact was created or changed.`,
  };
}

/**
 * Finds contacts mentioned inside free text. Used only as local context; the
 * caller decides whether a proposal should reference them.
 */
export function findContactMentions(
  text: string,
  contacts: readonly Contact[] = [],
  options: ContactMatchOptions = {}
): ContactMatchResult[] {
  const normalizedText = normalizeContactName(text);
  if (!normalizedText) return [];

  const results: ContactMatchResult[] = [];
  for (const contact of contacts) {
    const fullName = normalizeContactName(contact.fullName);
    const firstName = normalizeContactName(contact.firstName ?? '');
    const displayName = normalizeContactName(contact.displayName ?? '');
    const candidates = [fullName, displayName, firstName].filter((value) => value && value.length > 1);
    const mentioned = candidates.some((candidate) => {
      const pattern = new RegExp(`(^| )${candidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( |$)`);
      return pattern.test(normalizedText);
    });
    if (!mentioned) continue;
    const match = scoreContactName(contact.fullName, contact) ?? scoreContactName(firstName || fullName, contact);
    if (match) {
      results.push({
        query: text,
        matches: [match],
        best: match,
        ambiguities: [],
        confidence: { score: 0.9, reason: 'exact-match' },
        message: `“${contact.fullName}” is mentioned in the text.`,
      });
    }
  }

  return results
    .sort((a, b) => (b.best?.score ?? 0) - (a.best?.score ?? 0))
    .slice(0, options.maxResults ?? 5);
}
