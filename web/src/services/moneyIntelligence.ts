import { Reminder, RecurrenceRule } from '../types';
import {
  BillFrequency,
  BillRecurrenceConfig,
  DirectDebitCategory,
  ExtraIncomeCategory,
  MoneyState,
  NotificationOffsetType,
  NotificationSetting,
} from '../types/finance';
import {
  Ambiguity,
  Confidence,
  CreateDirectDebitProposal,
  MissingField,
  SmartEngineField,
} from '../types/smartEngine';
import { addDecimals, calculatePayCycleSummary, formatCurrency, toDateString } from '../utils/finance';
import { createDirectDebitProposal, parseDateTime } from './smartEngineParsing';

/**
 * Deterministic, local-only money intelligence.
 *
 * This module never writes to storage. It interprets text into proposals, maps values
 * onto the existing finance models, and derives summaries from the existing
 * `utils/finance` calculators so every number is traceable to stored data.
 */

const EXPLICIT: Confidence = { score: 0.94, reason: 'explicit-pattern' };
const DERIVED: Confidence = { score: 0.86, reason: 'derived' };
const UNKNOWN: Confidence = { score: 0, reason: 'unknown' };

/** Domain concepts mapped onto the app's default bill category names. */
export const BILL_CATEGORY_DOMAIN_MAP: Record<string, string[]> = {
  'rent & housing': ['rent', 'mortgage', 'housing', 'landlord', 'board'],
  'utilities': ['electricity', 'power bill', 'gas bill', 'water', 'water bill', 'energy', 'utility', 'utilities'],
  'subscriptions': ['subscription', 'netflix', 'spotify', 'stan', 'disney', 'youtube premium', 'streaming', 'membership'],
  'car & transport': ['rego', 'registration', 'fuel', 'petrol', 'diesel', 'tyres', 'tires', 'mechanic', 'car service', 'car insurance'],
  'insurance': ['insurance', 'policy', 'premium'],
  'health & medical': ['doctor', 'dentist', 'medical', 'health', 'pharmacy', 'physio', 'script'],
  'food & groceries': ['groceries', 'grocery', 'supermarket', 'food'],
  'debt & loans': ['loan', 'debt', 'credit card', 'afterpay', 'repayment'],
  'entertainment': ['entertainment', 'cinema', 'concert', 'games'],
  'phone & internet': ['phone', 'mobile', 'internet', 'broadband', 'nbn', 'sim plan', 'data plan'],
  'other': [],
};

export interface BillCategorySuggestion {
  category?: DirectDebitCategory;
  confidence: Confidence;
  reason: string;
  alternatives: DirectDebitCategory[];
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function field<T>(value: T | undefined, confidence: Confidence, ambiguities?: Ambiguity[]): SmartEngineField<T> {
  return { value, confidence, ambiguities };
}

function stableHash(input: string): number {
  let hash = 0;
  for (const char of input) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

function keywordsForCategory(category: DirectDebitCategory): string[] {
  const name = category.name.toLowerCase();
  const ownWords = name.split(/[^a-z0-9]+/).filter((word) => word.length > 3);
  const domainWords = BILL_CATEGORY_DOMAIN_MAP[name] || [];
  return [...new Set([name, ...ownWords, ...domainWords])];
}

/**
 * Suggests an existing bill category. Exact user-created category names win before
 * domain keyword dictionaries, and nothing is invented when no match is conservative.
 */
export function suggestBillCategory(input: string, categories: readonly DirectDebitCategory[] = []): BillCategorySuggestion {
  const text = normalize(input).toLowerCase();
  if (!text || !categories.length) return { confidence: UNKNOWN, reason: 'No bill categories were available to match against.', alternatives: [] };

  const scored = categories
    .map((category) => {
      const name = category.name.toLowerCase();
      if (text.includes(name)) {
        return { category, score: 1, reason: 'The wording contains this category name.' };
      }
      const matched = keywordsForCategory(category).find((keyword) => keyword.length > 3 && text.includes(keyword));
      return { category, score: matched ? 0.86 : 0, reason: matched ? `Known domain keyword “${matched}” matched this category.` : '' };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return { confidence: UNKNOWN, reason: 'No existing category matched; a category can be chosen or created later.', alternatives: [] };

  const top = scored[0];
  const tied = scored.filter((item) => item.score === top.score);
  if (tied.length > 1) {
    return {
      confidence: { score: 0.55, reason: 'ambiguous' },
      reason: 'More than one existing category matches equally.',
      alternatives: tied.map((item) => item.category),
    };
  }
  return {
    category: top.category,
    confidence: top.score === 1 ? { score: 0.98, reason: 'exact-match' } : { score: 0.86, reason: 'derived' },
    reason: top.reason,
    alternatives: scored.slice(1, 3).map((item) => item.category),
  };
}

/** Maps a parsed recurrence rule into the app's existing bill frequency representation. */
export function mapRecurrenceToBillFrequency(rule?: RecurrenceRule): { frequency: BillFrequency; recurrenceConfig: BillRecurrenceConfig; confidence: Confidence } | undefined {
  if (!rule || rule.frequency === 'none') return undefined;
  const interval = Math.max(1, rule.interval || 1);
  const wrap = (frequency: BillFrequency, recurrenceConfig: BillRecurrenceConfig) => ({ frequency, recurrenceConfig, confidence: EXPLICIT });

  if (rule.frequency === 'daily') return wrap('every_x_days', { interval: 1, customDays: interval });
  if (rule.frequency === 'weekly') return interval === 1 ? wrap('weekly', { interval: 1 }) : wrap('every_x_weeks', { interval });
  if (rule.frequency === 'monthly') return interval === 1 ? wrap('monthly', { interval: 1 }) : wrap('every_x_months', { interval });

  const unit = rule.unit || 'day';
  if (unit === 'day') return wrap('every_x_days', { interval: 1, customDays: interval });
  if (unit === 'week') {
    if (interval === 1) return wrap('weekly', { interval: 1 });
    if (interval === 2) return wrap('fortnightly', { interval: 1 });
    return wrap('every_x_weeks', { interval });
  }
  if (interval === 1) return wrap('monthly', { interval: 1 });
  if (interval === 3) return wrap('quarterly', { interval: 1 });
  if (interval === 12) return wrap('annually', { interval: 1 });
  return wrap('every_x_months', { interval });
}

function collectExplicitDates(text: string, referenceDate: Date): string[] {
  const found: string[] = [];
  const iso = /\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/g;
  let match: RegExpExecArray | null;
  while ((match = iso.exec(text))) {
    found.push(localDate(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))));
  }
  const withoutIso = text.replace(iso, ' ');
  const au = /\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/g;
  while ((match = au.exec(withoutIso))) {
    const year = match[3] ? Number(match[3]) : referenceDate.getFullYear();
    found.push(localDate(new Date(year, Number(match[2]) - 1, Number(match[1]))));
  }
  return [...new Set(found)];
}

/** Derives the next occurrence of a payment day-of-month without inventing a different day. */
export function deriveNextPaymentDate(paymentDay: number, referenceDate: Date): string | undefined {
  if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) return undefined;
  const lastDayThisMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, 0).getDate();
  if (paymentDay > lastDayThisMonth) {
    const nextMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, paymentDay);
    if (nextMonth.getDate() !== paymentDay) nextMonth.setDate(0);
    return localDate(nextMonth);
  }
  const candidate = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), paymentDay);
  const reference = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  if (candidate.getTime() < reference.getTime()) {
    const nextMonth = new Date(referenceDate.getFullYear(), referenceDate.getMonth() + 1, paymentDay);
    if (nextMonth.getDate() !== paymentDay) nextMonth.setDate(0);
    return localDate(nextMonth);
  }
  return localDate(candidate);
}

const NOTIFICATION_PATTERNS: Array<{ pattern: RegExp; type: NotificationOffsetType; customValue?: number }> = [
  { pattern: /\b(?:on|the)\s+the?\s*day\b|\bday of\b|\bon the day\b/, type: 'on_day' },
  { pattern: /\b1\s+week\s+before\b|\ba\s+week\s+before\b|\b7\s+days?\s+before\b/, type: '1_week_before' },
  { pattern: /\b3\s+days?\s+before\b/, type: '3_days_before' },
  { pattern: /\b2\s+days?\s+before\b/, type: '2_days_before' },
  { pattern: /\b1\s+day\s+before\b|\bday\s+before\b/, type: '1_day_before' },
  { pattern: /\b(\d+)\s+hours?\s+before\b/, type: 'custom_hours_before' },
  { pattern: /\b(\d+)\s+days?\s+before\b/, type: 'custom_days_before' },
];

export function parseNotificationSettings(input: string): NotificationSetting[] {
  const text = normalize(input).toLowerCase();
  if (!/\b(?:remind|reminder|notify|notification|alert)\b/.test(text)) return [];
  const settings: NotificationSetting[] = [];
  for (const { pattern, type, customValue } of NOTIFICATION_PATTERNS) {
    const match = text.match(pattern);
    if (!match) continue;
    if (settings.some((item) => item.type === type)) continue;
    // A fixed offset already matched, so a generic "X days before" rule must not duplicate it.
    if ((type === 'custom_days_before' || type === 'custom_hours_before') && settings.length > 0) continue;
    const value = customValue ?? (match[1] ? Number(match[1]) : undefined);
    settings.push({
      id: `notif-${stableHash(`${type}-${value ?? ''}`)}`,
      type,
      customValue: value,
      enabled: true,
    });
  }
  return settings;
}

export interface BillProposalOptions {
  categories?: readonly DirectDebitCategory[];
  reminders?: readonly Reminder[];
  referenceDate?: Date;
}

function cleanBillTitle(title: string): string {
  return normalize(title)
    .replace(/^(?:create|add|new)\s+(?:a\s+)?(?:direct\s+debit|recurring\s+bill|bill|subscription|recurring\s+payment)s?\s*(?:for|called|named)?\s*/i, '')
    .replace(/\s*[,;]?\s*(?:and\s+)?(?:remind\s+me\b.*|link(?:ed)?\s+to\b.*|create\s+a\s+reminder\b.*)$/i, '')
    .replace(/^(?:the)\s+/i, '')
    .replace(/\s+(?:is|costs?)\s*$/i, '')
    .replace(/[.,!?;:]+$/, '')
    .trim();
}

/**
 * Builds a bill / direct-debit proposal from natural language using the existing
 * DirectDebit model. Nothing is written; the app applies the proposal after confirmation.
 */
export function createBillProposal(input: string, options: BillProposalOptions = {}): CreateDirectDebitProposal {
  const referenceDate = options.referenceDate ?? new Date();
  const categories = options.categories ?? [];
  const reminders = options.reminders ?? [];
  const text = normalize(input);

  const base = createDirectDebitProposal(input, referenceDate);
  const parsedRecurrence = (base.fields.frequency?.value ?? base.fields.recurrence?.value) as RecurrenceRule | undefined;
  const mapping = mapRecurrenceToBillFrequency(parsedRecurrence);
  const amount = base.fields.amount?.value as number | undefined;
  const paymentDay = base.fields.paymentDay?.value as number | undefined;
  const title = cleanBillTitle((base.fields.title?.value as string) || '');

  const ambiguities: Ambiguity[] = [...base.ambiguities];
  const missingFields: MissingField[] = base.missingFields.filter((item) => item.field !== 'frequency' && item.field !== 'paymentDay');

  // Conflicting explicit dates must not be resolved arbitrarily.
  const explicitDates = collectExplicitDates(text, referenceDate);
  let nextPaymentDate: string | undefined;
  if (explicitDates.length > 1) {
    ambiguities.push({
      field: 'nextPaymentDate',
      message: 'More than one date was provided; confirm which date is the next payment date.',
      options: explicitDates,
    });
    missingFields.push({ field: 'nextPaymentDate', label: 'Next payment date', required: true });
  } else if (explicitDates.length === 1) {
    nextPaymentDate = explicitDates[0];
  } else if (paymentDay !== undefined) {
    nextPaymentDate = deriveNextPaymentDate(paymentDay, referenceDate);
    if (nextPaymentDate) {
      ambiguities.push({
        field: 'nextPaymentDate',
        message: 'The next payment date was derived from the payment day of month; please confirm it.',
      });
    }
  }

  if (!mapping) missingFields.push({ field: 'frequency', label: 'Payment frequency', required: true });
  if (amount === undefined) missingFields.push({ field: 'amount', label: 'Amount', required: true });
  if (paymentDay === undefined && !nextPaymentDate) {
    missingFields.push({ field: 'paymentDay', label: 'Payment day or date', required: true });
  }

  const categorySuggestion = suggestBillCategory(title || text, categories);
  if (categorySuggestion.confidence.reason === 'ambiguous') {
    ambiguities.push({
      field: 'categoryId',
      message: categorySuggestion.reason,
      options: categorySuggestion.alternatives.map((item) => item.name),
    });
  }
  if (!categorySuggestion.category) {
    missingFields.push({ field: 'categoryId', label: 'Bill category suggestion', required: false });
  }

  const noteMatch = text.match(/\bnotes?\s*[:-]\s*(.+)$/i);
  const notes = noteMatch?.[1]?.trim();

  const endDateMatch = text.match(/\b(?:until|ends?(?:\s+on)?|ending(?:\s+on)?|end\s+date)\s+(.+)$/i);
  let endDate: string | undefined;
  if (endDateMatch) {
    const parsedEnd = parseDateTime(endDateMatch[1], referenceDate);
    endDate = parsedEnd.value?.date;
    if (!endDate) {
      ambiguities.push({ field: 'endDate', message: 'An end date was mentioned but could not be read as a date; please confirm.' });
    }
  }

  const paused = /\b(?:paused|inactive|not active|on hold)\b/i.test(text);
  const active = !paused;
  const activeConfidence: Confidence = paused ? EXPLICIT : DERIVED;

  const notificationSettings = parseNotificationSettings(text);

  const reminderLinkRequested = /\bremind me\b|\blink(?:ed)?\s+to\s+(?:a\s+)?reminder\b|\bcreate\s+a\s+reminder\b/i.test(text);
  const linkCandidates = reminderLinkRequested
    ? reminders.filter((reminder) => reminder.title && title && reminder.title.toLowerCase().includes(title.toLowerCase()))
    : [];
  const linkedReminder = reminderLinkRequested && linkCandidates.length === 1 ? linkCandidates[0] : undefined;
  if (reminderLinkRequested && linkCandidates.length > 1) {
    ambiguities.push({
      field: 'linkedReminderId',
      message: 'More than one existing reminder could be linked.',
      options: linkCandidates.slice(0, 5).map((reminder) => reminder.title),
    });
  }

  const requiredMissing = missingFields.some((item) => item.required);
  const overallScore = requiredMissing
    ? 0.45
    : Math.min(base.confidence.score, categorySuggestion.category ? categorySuggestion.confidence.score : 0.9);

  const previewParts = [
    title ? `Create recurring bill “${title}”` : 'Create recurring bill (name needed)',
    amount !== undefined ? formatCurrency(amount) : 'amount needed',
    mapping ? mapping.frequency.replace(/_/g, ' ') : 'frequency needed',
    nextPaymentDate ? `next payment ${nextPaymentDate}` : 'next payment date needed',
    categorySuggestion.category ? categorySuggestion.category.name : undefined,
    !active ? 'paused' : undefined,
    notificationSettings.length ? `${notificationSettings.length} notification setting${notificationSettings.length > 1 ? 's' : ''}` : undefined,
    reminderLinkRequested ? (linkedReminder ? `link existing reminder “${linkedReminder.title}”` : 'optional linked reminder') : undefined,
  ].filter(Boolean);

  const fields: Record<string, SmartEngineField<unknown>> = {
    title: base.fields.title,
    amount: base.fields.amount,
    frequency: field(mapping?.frequency, mapping?.confidence ?? UNKNOWN),
    recurrenceConfig: field(mapping?.recurrenceConfig, mapping?.confidence ?? UNKNOWN),
    paymentDay: base.fields.paymentDay,
    nextPaymentDate: field(nextPaymentDate, explicitDates.length === 1 ? EXPLICIT : DERIVED),
    categoryId: field(categorySuggestion.category?.id, categorySuggestion.confidence),
    categoryName: field(categorySuggestion.category?.name, categorySuggestion.confidence),
    endDate: field(endDate, endDate ? DERIVED : UNKNOWN),
    notes: field(notes, notes ? EXPLICIT : UNKNOWN),
    active: field(active, activeConfidence),
    notificationSettings: field(notificationSettings.length ? notificationSettings : undefined, notificationSettings.length ? EXPLICIT : UNKNOWN),
    linkReminderRequested: field(reminderLinkRequested, reminderLinkRequested ? EXPLICIT : UNKNOWN),
    linkedReminderId: field(linkedReminder?.id, linkedReminder ? { score: 0.9, reason: 'exact-match' } : UNKNOWN),
    linkedReminderTitle: field(linkedReminder?.title ?? (reminderLinkRequested ? title : undefined), linkedReminder ? { score: 0.9, reason: 'exact-match' } : reminderLinkRequested ? DERIVED : UNKNOWN),
  };

  return {
    type: 'create-direct-debit',
    fields,
    id: `smart-bill-${stableHash(text)}`,
    preview: previewParts.join(' · '),
    confidence: { score: overallScore, reason: requiredMissing || ambiguities.length ? 'ambiguous' : 'explicit-pattern' },
    missingFields,
    ambiguities,
    validation: { valid: false, canWrite: false, reasons: [] },
  };
}

/* ------------------------------------------------------------------ */
/* Money entry classification                                          */
/* ------------------------------------------------------------------ */

export type MoneyEntryKind = 'income-pay' | 'extra-income' | 'tip' | 'direct-debit' | 'shift' | 'unknown';

export interface MoneyEntryCandidate {
  kind: MoneyEntryKind;
  score: number;
  reason: string;
}

export interface MoneyEntryClassification {
  kind: MoneyEntryKind;
  confidence: Confidence;
  candidates: MoneyEntryCandidate[];
  ambiguities: Ambiguity[];
  suggestedBillCategoryId?: string;
  suggestedExtraIncomeCategoryId?: string;
}

export interface MoneyClassificationContext {
  billCategories?: readonly DirectDebitCategory[];
  extraIncomeCategories?: readonly ExtraIncomeCategory[];
}

/**
 * Classifies text into the app's existing money entry types. It does not create or
 * modify any transaction and never invents amounts.
 */
export function classifyMoneyEntry(input: string, context: MoneyClassificationContext = {}): MoneyEntryClassification {
  const text = normalize(input).toLowerCase();
  if (!text) return { kind: 'unknown', confidence: UNKNOWN, candidates: [], ambiguities: [] };

  const patterns: Array<[MoneyEntryKind, RegExp, number, string]> = [
    ['income-pay', /\b(?:pay\s?day|payroll|pay\s?slip|salary|wages?|employer|fortnightly\s+pay|weekly\s+pay)\b/, 0.92, 'pay or salary wording'],
    ['extra-income', /\b(?:extra\s+income|cash\s+job|marketplace|sold\s+(?:something|an?\s+item)|side\s+gig|bonus|refund|freelance)\b/, 0.88, 'extra income wording'],
    ['tip', /\btips?\b|\btipped\b|tip\s+out/, 0.9, 'tip wording'],
    ['direct-debit', /\b(?:direct\s+debit|recurring\s+bill|bill|subscription|rent|electricity|internet|insurance)\b/, 0.9, 'bill or direct debit wording'],
    ['shift', /\b(?:shift|hours\s+worked|rostered)\b/, 0.82, 'casual shift wording'],
  ];

  const candidates = patterns
    .filter(([, pattern]) => pattern.test(text))
    .map(([kind, , score, reason]) => ({ kind, score, reason }))
    .sort((a, b) => b.score - a.score);

  if (!candidates.length) return { kind: 'unknown', confidence: UNKNOWN, candidates: [], ambiguities: [] };

  const top = candidates[0];
  const tied = candidates.filter((candidate) => candidate.score >= top.score - 0.05);
  const ambiguities: Ambiguity[] = [];
  if (tied.length > 1) {
    ambiguities.push({
      field: 'moneyEntryKind',
      message: 'More than one money entry type matches this wording.',
      options: tied.map((candidate) => candidate.kind),
    });
  }

  const classification: MoneyEntryClassification = {
    kind: tied.length > 1 ? 'unknown' : top.kind,
    confidence: tied.length > 1 ? { score: 0.45, reason: 'ambiguous' } : { score: top.score, reason: 'explicit-pattern' },
    candidates,
    ambiguities,
  };

  if (classification.kind === 'direct-debit') {
    const suggestion = suggestBillCategory(text, context.billCategories ?? []);
    classification.suggestedBillCategoryId = suggestion.category?.id;
  }
  if (classification.kind === 'extra-income' && (context.extraIncomeCategories ?? []).length) {
    const categories = context.extraIncomeCategories as readonly ExtraIncomeCategory[];
    const matched = categories.find((category) => text.includes(category.name.toLowerCase()))
      ?? categories.find((category) => category.name.toLowerCase().split(/[^a-z0-9]+/).some((word) => word.length > 3 && text.includes(word)))
      ?? categories.find((category) => category.name.toLowerCase() === 'other income');
    classification.suggestedExtraIncomeCategoryId = matched?.id;
  }
  return classification;
}

/* ------------------------------------------------------------------ */
/* Pay-cycle calculations and fact-based insights                      */
/* ------------------------------------------------------------------ */

export interface PayCycleFacts {
  referenceDate: string;
  hasIncomeConfig: boolean;
  nextPayDate?: string;
  previousPayDate?: string;
  daysUntilNextPay?: number;
  expectedPay?: number;
  billsTotal?: number;
  billsDue: Array<{ title: string; amount: number; date: string }>;
  extraIncomeTotal?: number;
  tipsTotal?: number;
  remainingAfterBills?: number;
  shortfall?: boolean;
  activeBillCount: number;
  pausedBillCount: number;
}

/**
 * Calculates pay-cycle facts from stored data using the existing finance calculators.
 * Missing configuration is reported as missing rather than substituted.
 */
export function calculatePayCycleFacts(state: MoneyState, referenceDateStr: string = toDateString(new Date())): PayCycleFacts {
  const activeBillCount = state.directDebits.filter((bill) => bill.active).length;
  const pausedBillCount = state.directDebits.length - activeBillCount;

  if (!state.incomeConfig) {
    return {
      referenceDate: referenceDateStr,
      hasIncomeConfig: false,
      billsDue: [],
      activeBillCount,
      pausedBillCount,
    };
  }

  const override = state.payCycleOverrides[state.incomeConfig.nextPayDate];
  const summary = calculatePayCycleSummary(state.incomeConfig, state.directDebits, state.extraIncomeList, override, referenceDateStr);

  const tipsTotal = (state.tipEntries || [])
    .filter((tip) => tip.date >= summary.previousPayDate && tip.date <= summary.nextPayDate)
    .reduce((sum, tip) => addDecimals(sum, Number(tip.amount) || 0), 0);

  return {
    referenceDate: referenceDateStr,
    hasIncomeConfig: true,
    nextPayDate: summary.nextPayDate,
    previousPayDate: summary.previousPayDate,
    daysUntilNextPay: summary.daysRemaining,
    expectedPay: summary.expectedPay,
    billsTotal: summary.billsTotal,
    billsDue: summary.billsDue.map((item) => ({ title: item.bill.title, amount: item.amount, date: item.date })),
    extraIncomeTotal: summary.extraIncomeTotal,
    tipsTotal,
    remainingAfterBills: summary.remainingAfterBills,
    shortfall: summary.remainingAfterBills < 0,
    activeBillCount,
    pausedBillCount,
  };
}

export interface MoneyInsight {
  id: string;
  text: string;
  /** Every value quoted in `text` is available here for tracing and testing. */
  facts: Record<string, number | string | boolean>;
  confidence: Confidence;
}

/**
 * Builds readable summaries strictly from calculated facts. No statistics are invented
 * and no financial advice is given.
 */
export function generateMoneyInsights(state: MoneyState, referenceDateStr: string = toDateString(new Date())): MoneyInsight[] {
  const facts = calculatePayCycleFacts(state, referenceDateStr);
  const insights: MoneyInsight[] = [];

  if (!facts.hasIncomeConfig) {
    insights.push({
      id: 'money-no-income-config',
      text: 'No income configuration is set, so pay-cycle totals cannot be calculated.',
      facts: { hasIncomeConfig: false, activeBillCount: facts.activeBillCount },
      confidence: { score: 0.98, reason: 'exact-match' },
    });
    if (facts.activeBillCount > 0) {
      insights.push({
        id: 'money-active-bills',
        text: `${facts.activeBillCount} active direct debit${facts.activeBillCount === 1 ? '' : 's'} ${facts.activeBillCount === 1 ? 'is' : 'are'} stored.`,
        facts: { activeBillCount: facts.activeBillCount, pausedBillCount: facts.pausedBillCount },
        confidence: { score: 0.98, reason: 'exact-match' },
      });
    }
    return insights;
  }

  const billsTotal = facts.billsTotal ?? 0;
  const remaining = facts.remainingAfterBills ?? 0;

  if (facts.billsDue.length === 0) {
    insights.push({
      id: 'money-no-bills-due',
      text: `No active direct debits fall due before your next pay on ${facts.nextPayDate}.`,
      facts: { billsTotal, nextPayDate: facts.nextPayDate ?? '', daysUntilNextPay: facts.daysUntilNextPay ?? 0 },
      confidence: { score: 0.98, reason: 'exact-match' },
    });
  } else {
    insights.push({
      id: 'money-bills-before-pay',
      text: `${formatCurrency(billsTotal)} in direct debits ${facts.billsDue.length === 1 ? 'is' : 'are'} due before your next pay on ${facts.nextPayDate}.`,
      facts: { billsTotal, billCount: facts.billsDue.length, nextPayDate: facts.nextPayDate ?? '', daysUntilNextPay: facts.daysUntilNextPay ?? 0 },
      confidence: { score: 0.98, reason: 'exact-match' },
    });
  }

  insights.push({
    id: 'money-remaining-after-bills',
    text: `Based on configured average pay of ${formatCurrency(facts.expectedPay ?? 0)}, ${formatCurrency(remaining)} remains after scheduled bills.`,
    facts: { expectedPay: facts.expectedPay ?? 0, billsTotal, remainingAfterBills: remaining },
    confidence: { score: 0.98, reason: 'exact-match' },
  });

  if (remaining < 0) {
    insights.push({
      id: 'money-shortfall',
      text: `Scheduled bills exceed the expected pay for this cycle by ${formatCurrency(Math.abs(remaining))}.`,
      facts: { shortfallAmount: Math.abs(remaining), billsTotal, expectedPay: facts.expectedPay ?? 0 },
      confidence: { score: 0.98, reason: 'exact-match' },
    });
  } else if (remaining === 0) {
    insights.push({
      id: 'money-fully-allocated',
      text: `Expected pay is fully allocated: ${formatCurrency(billsTotal)} of scheduled bills with nothing remaining.`,
      facts: { billsTotal, remainingAfterBills: 0 },
      confidence: { score: 0.98, reason: 'exact-match' },
    });
  }

  if ((facts.extraIncomeTotal ?? 0) > 0) {
    insights.push({
      id: 'money-extra-income',
      text: `Extra income included in this pay cycle totals ${formatCurrency(facts.extraIncomeTotal ?? 0)}.`,
      facts: { extraIncomeTotal: facts.extraIncomeTotal ?? 0 },
      confidence: { score: 0.98, reason: 'exact-match' },
    });
  }

  if ((facts.tipsTotal ?? 0) > 0) {
    insights.push({
      id: 'money-tips',
      text: `Tips recorded during this pay cycle total ${formatCurrency(facts.tipsTotal ?? 0)}.`,
      facts: { tipsTotal: facts.tipsTotal ?? 0 },
      confidence: { score: 0.98, reason: 'exact-match' },
    });
  }

  return insights;
}

export interface MoneySummary {
  facts: PayCycleFacts;
  insights: MoneyInsight[];
  text: string;
}

export function summarizeMoney(state: MoneyState, referenceDateStr: string = toDateString(new Date())): MoneySummary {
  const facts = calculatePayCycleFacts(state, referenceDateStr);
  const insights = generateMoneyInsights(state, referenceDateStr);
  return { facts, insights, text: insights.map((insight) => insight.text).join(' ') };
}
