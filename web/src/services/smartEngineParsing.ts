import { RecurrenceRule } from '../types';
import {
  Ambiguity,
  Confidence,
  CreateDirectDebitProposal,
  CreateReminderProposal,
  MissingField,
  SmartEngineField,
} from '../types/smartEngine';

export type SmartIntent =
  | 'create-reminder'
  | 'edit-reminder'
  | 'create-category'
  | 'create-subcategory'
  | 'create-direct-debit'
  | 'query-reminders'
  | 'query-dashboard'
  | 'query-money'
  | 'search-contact'
  | 'diagnostics-help'
  | 'unknown';

export interface IntentCandidate { intent: SmartIntent; score: number; reason: string; }
export interface IntentResult {
  intent: SmartIntent;
  confidence: Confidence;
  candidates: IntentCandidate[];
  ambiguities: Ambiguity[];
}

export interface DateTimeValue { date?: string; time?: string; approximate?: boolean; }
export interface DateTimeParseResult {
  value?: DateTimeValue;
  confidence: Confidence;
  ambiguities: Ambiguity[];
  missingFields: MissingField[];
}
export interface RecurrenceParseResult {
  value?: RecurrenceRule;
  confidence: Confidence;
  ambiguities: Ambiguity[];
}
export interface AmountParseResult {
  amount?: number;
  currency?: string;
  frequency?: string;
  paymentDay?: number;
  confidence: Confidence;
  ambiguities: Ambiguity[];
}

const UNKNOWN: Confidence = { score: 0, reason: 'unknown' };
const EXPLICIT: Confidence = { score: 0.96, reason: 'explicit-pattern' };
const DERIVED: Confidence = { score: 0.86, reason: 'derived' };
const DAYS: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const DATE_WORDS = /\b(today|tomorrow|yesterday|next\s+(?:sun|mon|tues|wednes|thurs|fri|satur)day|(?:sun|mon|tues|wednes|thurs|fri|satur)day)\b/i;

function normalize(input: string): string { return input.trim().replace(/\s+/g, ' '); }
function confidence(score: number, reason: Confidence['reason']): Confidence { return { score, reason }; }
function field<T>(value: T | undefined, confidenceValue: Confidence, ambiguities?: Ambiguity[]): SmartEngineField<T> {
  return { value, confidence: confidenceValue, ambiguities };
}

export function detectIntent(input: string): IntentResult {
  const text = normalize(input).toLowerCase();
  if (!text) return { intent: 'unknown', confidence: UNKNOWN, candidates: [], ambiguities: [] };
  const patterns: Array<[SmartIntent, RegExp, number, string]> = [
    ['create-direct-debit', /\b(?:direct debit|recurring bill|bill|subscription)\b|\bevery\s+(?:month|week|fortnight|quarter|year)\b.*\$?\d/i, 0.94, 'bill or recurring-payment wording'],
    ['create-reminder', /\b(?:remind me|reminder|remember to|todo|to-do|task)\b/i, 0.95, 'explicit reminder wording'],
    ['edit-reminder', /\b(?:edit|change|update|rename|move|reschedule|make)\b.*\b(?:reminder|task|title|due|date|time)\b/i, 1, 'edit wording'],
    ['create-subcategory', /\b(?:create|add|new)\b.*\bsubcategor(?:y|ies)\b/i, 0.94, 'explicit subcategory wording'],
    ['create-category', /\b(?:create|add|new)\b.*\bcategory\b/i, 0.94, 'explicit category wording'],
    ['query-dashboard', /\b(?:dashboard|statistics|stats|completion rate|how am i doing|summary of my tasks)\b/i, 0.9, 'dashboard/statistics wording'],
    ['query-money', /\b(?:money|finance|financial|bills?|pay cycle|payday|remaining|spend|income)\b/i, 0.86, 'money wording'],
    ['search-contact', /\b(?:contact|phone number|call|message|text)\b/i, 0.82, 'contact wording'],
    ['diagnostics-help', /\b(?:diagnostic|diagnostics|notification problem|help|how do i fix)\b/i, 0.82, 'help or diagnostics wording'],
    ['query-reminders', /\b(?:what(?:'s| is) due|upcoming reminders|show reminders|list reminders|overdue)\b/i, 0.88, 'reminder query wording'],
  ];
  const candidates = patterns.filter(([, pattern]) => pattern.test(text)).map(([intent, , score, reason]) => ({ intent, score, reason }));
  if (candidates.length === 0) return { intent: 'unknown', confidence: UNKNOWN, candidates: [], ambiguities: [] };
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0];
  const tied = candidates.filter((candidate) => candidate.score >= top.score - 0.04);
  if (tied.length > 1) {
    return {
      intent: 'unknown',
      confidence: confidence(0.45, 'ambiguous'),
      candidates,
      ambiguities: [{ field: 'intent', message: 'More than one command type matches this input.', options: tied.map((candidate) => candidate.intent) }],
    };
  }
  return { intent: top.intent, confidence: confidence(top.score, 'explicit-pattern'), candidates, ambiguities: [] };
}

function localDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(base: Date, days: number): Date { const result = new Date(base); result.setDate(result.getDate() + days); return result; }

export function parseDateTime(input: string, referenceDate: Date = new Date()): DateTimeParseResult {
  const text = normalize(input).toLowerCase();
  const ambiguities: Ambiguity[] = [];
  let date: Date | undefined;
  let confidenceValue: Confidence = UNKNOWN;
  if (/\btoday\b/.test(text)) { date = referenceDate; confidenceValue = EXPLICIT; }
  else if (/\btomorrow\b/.test(text)) { date = addDays(referenceDate, 1); confidenceValue = EXPLICIT; }
  else if (/\byesterday\b/.test(text)) { date = addDays(referenceDate, -1); confidenceValue = EXPLICIT; }

  const relative = text.match(/\bin\s+(\d+)\s+(day|days|week|weeks|month|months)\b/);
  if (relative) {
    const count = Number(relative[1]);
    const unit = relative[2].startsWith('week') ? 7 : relative[2].startsWith('month') ? 30 : 1;
    date = addDays(referenceDate, count * unit);
    confidenceValue = EXPLICIT;
  }

  const explicitIso = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/);
  const explicitAu = text.match(/\b(\d{1,2})[/-](\d{1,2})(?:[/-](20\d{2}))?\b/);
  if (explicitIso) date = new Date(Number(explicitIso[1]), Number(explicitIso[2]) - 1, Number(explicitIso[3]));
  else if (explicitAu) {
    const year = explicitAu[3] ? Number(explicitAu[3]) : referenceDate.getFullYear();
    date = new Date(year, Number(explicitAu[2]) - 1, Number(explicitAu[1]));
    confidenceValue = explicitAu[3] ? EXPLICIT : confidence(0.82, 'explicit-pattern');
  }
  const weekday = text.match(/\b(?:next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
  if (weekday) {
    const target = DAYS[weekday[1]];
    const current = referenceDate.getDay();
    let delta = (target - current + 7) % 7;
    if (delta === 0) delta += 7;
    date = addDays(referenceDate, delta);
    confidenceValue = EXPLICIT;
  }

  let time: string | undefined;
  const timeMatch = text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (timeMatch) {
    if (timeMatch[4]) time = `${String(Number(timeMatch[4])).padStart(2, '0')}:${timeMatch[5]}`;
    else {
      let hours = Number(timeMatch[1]);
      const minutes = Number(timeMatch[2] || '00');
      if (timeMatch[3] === 'pm' && hours < 12) hours += 12;
      if (timeMatch[3] === 'am' && hours === 12) hours = 0;
      time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    }
  }
  if (/\b(?:morning|afternoon|evening)\b/.test(text) && !time) {
    ambiguities.push({ field: 'time', message: 'A broad time-of-day was provided; an exact time is required for an exact schedule.' });
    confidenceValue = confidence(Math.min(confidenceValue.score || 0.5, 0.65), 'ambiguous');
  }
  if (!date && !time) return { confidence: UNKNOWN, ambiguities, missingFields: [{ field: 'dueDate', label: 'Due date', required: true }] };
  return { value: { date: date ? localDate(date) : undefined, time, approximate: ambiguities.length > 0 }, confidence: confidenceValue.score ? confidenceValue : DERIVED, ambiguities, missingFields: [] };
}

export function parseRecurrence(input: string): RecurrenceParseResult {
  const text = normalize(input).toLowerCase();
  const match = text.match(/\bevery\s+(\d+)\s+(day|days|week|weeks|month|months)\b/);
  if (match) {
    const interval = Math.max(1, Number(match[1]));
    const unit = match[2].startsWith('day') ? 'day' : match[2].startsWith('week') ? 'week' : 'month';
    return { value: { frequency: 'custom', unit, interval }, confidence: EXPLICIT, ambiguities: [] };
  }
  if (/\bfortnightly\b|\bevery\s+2\s+weeks?\b/.test(text)) return { value: { frequency: 'custom', unit: 'week', interval: 2 }, confidence: EXPLICIT, ambiguities: [] };
  if (/\bquarterly\b/.test(text)) return { value: { frequency: 'custom', unit: 'month', interval: 3 }, confidence: EXPLICIT, ambiguities: [] };
  if (/\b(?:yearly|annually|annual)\b/.test(text)) return { value: { frequency: 'custom', unit: 'month', interval: 12 }, confidence: EXPLICIT, ambiguities: [] };
  if (/\bmonthly\b|\bevery\s+month\b/.test(text)) return { value: { frequency: 'monthly', interval: 1 }, confidence: EXPLICIT, ambiguities: [] };
  if (/\bweekly\b|\bevery\s+week\b/.test(text)) return { value: { frequency: 'weekly', interval: 1 }, confidence: EXPLICIT, ambiguities: [] };
  if (/\bdaily\b|\bevery\s+day\b/.test(text)) return { value: { frequency: 'daily', interval: 1 }, confidence: EXPLICIT, ambiguities: [] };
  return { confidence: UNKNOWN, ambiguities: [] };
}

export function parseAmount(input: string): AmountParseResult {
  const text = normalize(input).toLowerCase();
  const amountMatch = text.match(/(?:[$€£]\s?)(\d+(?:[.,]\d{1,2})?)|\b(\d+(?:[.,]\d{1,2})?)\s*(?:dollars?|aud|usd|eur|pounds?)\b/i);
  const paymentDayMatch = text.match(/\b(?:on|the)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?\b/);
  const frequency = parseRecurrence(text).value;
  if (!amountMatch && !frequency && !paymentDayMatch) return { confidence: UNKNOWN, ambiguities: [] };
  const raw = amountMatch?.[1] || amountMatch?.[2];
  const amount = raw ? Number(raw.replace(',', '.')) : undefined;
  const ambiguities: Ambiguity[] = [];
  if (amount === undefined) ambiguities.push({ field: 'amount', message: 'No currency amount was provided.' });
  return { amount, currency: amountMatch?.[0].trim().charAt(0) === '$' ? 'AUD-or-local' : undefined, frequency: frequency?.frequency, paymentDay: paymentDayMatch ? Number(paymentDayMatch[1]) : undefined, confidence: amount !== undefined ? EXPLICIT : confidence(0.55, 'ambiguous'), ambiguities };
}

function cleanReminderTitle(input: string): string {
  return normalize(input)
    .replace(/^remind me to\s+/i, '').replace(/^reminder:\s*/i, '')
    .replace(/\b(?:today|tomorrow|yesterday|next\s+\w+day|(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))\b/gi, '')
    .replace(/\bin\s+\d+\s+(?:days?|weeks?|months?)\b/gi, '')
    .replace(/\s+at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?/gi, '')
    .replace(/\s+/g, ' ').replace(/[,.!?]+$/, '').trim();
}

function proposalId(prefix: string, input: string): string { let hash = 0; for (const char of input) hash = (hash * 31 + char.charCodeAt(0)) | 0; return `${prefix}-${Math.abs(hash)}`; }
function validateProposalBase(confidenceValue: Confidence, missingFields: MissingField[], ambiguities: Ambiguity[], preview: string) {
  return { id: proposalId('smart', preview), preview, confidence: confidenceValue, missingFields, ambiguities, validation: { valid: false, canWrite: false, reasons: [] } };
}

export function createReminderProposal(input: string, referenceDate: Date = new Date()): CreateReminderProposal {
  const title = cleanReminderTitle(input);
  const date = parseDateTime(input, referenceDate);
  const recurrence = parseRecurrence(input);
  const titleConfidence = title.length >= 3 ? EXPLICIT : UNKNOWN;
  const missingFields: MissingField[] = [];
  const ambiguities = [...date.ambiguities, ...recurrence.ambiguities];
  if (!title) missingFields.push({ field: 'title', label: 'Reminder title', required: true });
  const overall = titleConfidence.score > 0 && (date.value || !DATE_WORDS.test(input)) ? Math.min(titleConfidence.score, date.confidence.score || 0.86) : 0.35;
  if (DATE_WORDS.test(input) && !date.value?.date) missingFields.push({ field: 'dueDate', label: 'Due date', required: true });
  const fields: Record<string, SmartEngineField<unknown>> = {
    title: field(title || undefined, titleConfidence),
    dueDate: field(date.value?.date, date.confidence, date.ambiguities),
    dueTime: field(date.value?.time, date.confidence),
    recurrence: field(recurrence.value, recurrence.confidence, recurrence.ambiguities),
  };
  const preview = title ? `Create reminder “${title}”${date.value?.date ? ` on ${date.value.date}` : ''}${recurrence.value ? ` (${recurrence.value.frequency})` : ''}` : 'Create reminder (title needed)';
  return { type: 'create-reminder', fields, ...validateProposalBase(confidence(overall, overall < 0.7 ? 'ambiguous' : 'derived'), missingFields, ambiguities, preview) };
}

export function createDirectDebitProposal(input: string, referenceDate: Date = new Date()): CreateDirectDebitProposal {
  const amount = parseAmount(input);
  const recurrence = parseRecurrence(input);
  const paymentDate = parseDateTime(input, referenceDate);
  const title = normalize(input).replace(/\$?\d+(?:[.,]\d{1,2})?\s*(?:dollars?|aud|usd)?/i, '').replace(/\bevery\s+(?:\d+\s+)?(?:day|days|week|weeks|month|months|year|years)\b|\b(?:monthly|weekly|fortnightly|quarterly|yearly|annually)\b/gi, '').replace(/\bon\s+the\s+\d{1,2}(?:st|nd|rd|th)?\b/gi, '').replace(/\s+is\s*$/i, '').trim();
  const missingFields: MissingField[] = [];
  const ambiguities = [...amount.ambiguities, ...paymentDate.ambiguities];
  if (!title) missingFields.push({ field: 'title', label: 'Bill name', required: true });
  if (amount.amount === undefined) missingFields.push({ field: 'amount', label: 'Amount', required: true });
  if (!recurrence.value) missingFields.push({ field: 'frequency', label: 'Payment frequency', required: true });
  if (amount.paymentDay === undefined && !paymentDate.value?.date) missingFields.push({ field: 'paymentDay', label: 'Payment day/date', required: true });
  const preview = title ? `Create recurring bill “${title}”${amount.amount !== undefined ? ` for ${amount.amount}` : ''}` : 'Create recurring bill (details needed)';
  return { type: 'create-direct-debit', fields: { title: field(title || undefined, title ? EXPLICIT : UNKNOWN), amount: field(amount.amount, amount.confidence), frequency: field(recurrence.value, recurrence.confidence), paymentDay: field(amount.paymentDay, amount.confidence), nextPaymentDate: field(paymentDate.value?.date, paymentDate.confidence) }, ...validateProposalBase(confidence(missingFields.length ? 0.45 : 0.94, missingFields.length ? 'ambiguous' : 'explicit-pattern'), missingFields, ambiguities, preview) };
}
