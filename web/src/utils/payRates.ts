import {
  CasualPayRateRule,
  HourlyRateConfig,
  IncomeConfig,
  RateRuleMode,
  ShiftRateSegment,
} from '../types/finance';
import { addDecimals, parseLocalDate } from './finance';

/**
 * Casual pay rate engine.
 *
 * This module is additive to the existing `HourlyRateConfig`. When a config has
 * no `rateRules` the shift calculator keeps using the original per-`rateType`
 * logic in `utils/finance`. As soon as one or more rules exist they take over
 * day/time matching and unmatched time falls back to the base rate.
 *
 * Money follows the project's existing convention: plain numbers rounded to
 * cents through `addDecimals` / `roundCurrency`, never raw binary floats that
 * are left unrounded.
 */

const MINUTES_PER_DAY = 24 * 60;

export const RATE_RULE_DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Rounds a money value to whole cents using the same convention as `addDecimals`. */
export function roundCurrency(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

/** Parses `HH:mm` into minutes past midnight, or null when invalid. */
export function timeToMinutes(value?: string): number | null {
  if (!value || typeof value !== 'string') return null;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/** Formats minutes past midnight back into a wrapped `HH:mm` clock string. */
export function minutesToTime(totalMinutes: number): string {
  const wrapped = ((Math.round(totalMinutes) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const hours = Math.floor(wrapped / 60);
  const minutes = wrapped % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function coerceNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Defensively normalizes persisted/user-entered rate rules. Malformed entries
 * are repaired with safe defaults rather than dropped, and the output order is
 * preserved so list position stays deterministic.
 */
export function normalizeRateRules(input: unknown): CasualPayRateRule[] {
  if (!Array.isArray(input)) return [];
  return input.map((entry, index) => {
    const raw = (entry && typeof entry === 'object' ? entry : {}) as Record<string, unknown>;
    const mode: RateRuleMode = raw.mode === 'multiplier' ? 'multiplier' : 'fixed';
    const days = Array.isArray(raw.days)
      ? Array.from(
          new Set(
            raw.days
              .map((day) => coerceNumber(day, -1))
              .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
          )
        ).sort((a, b) => a - b)
      : [];
    const startTime = timeToMinutes(typeof raw.startTime === 'string' ? raw.startTime : undefined);
    const endTime = timeToMinutes(typeof raw.endTime === 'string' ? raw.endTime : undefined);
    return {
      id: typeof raw.id === 'string' && raw.id.length > 0 ? raw.id : `rate-rule-${index}`,
      label: typeof raw.label === 'string' && raw.label.trim().length > 0 ? raw.label.trim() : `Rule ${index + 1}`,
      enabled: raw.enabled !== false,
      days,
      allDay: raw.allDay === true,
      startTime: startTime === null ? undefined : minutesToTime(startTime),
      endTime: endTime === null ? undefined : minutesToTime(endTime),
      mode,
      rate: coerceNumber(raw.rate, mode === 'multiplier' ? 1 : 0),
      priority: Number.isInteger(raw.priority) ? (raw.priority as number) : index,
    };
  });
}

/**
 * Normalizes an hourly rate config, guaranteeing `rateRules` is an array while
 * leaving the existing named rates and any other fields untouched.
 */
export function normalizeHourlyRates(input: unknown): HourlyRateConfig | undefined {
  if (!input || typeof input !== 'object') return undefined;
  const raw = input as Partial<HourlyRateConfig>;
  return {
    ...raw,
    baseRate: coerceNumber(raw.baseRate, 0),
    rateRules: normalizeRateRules(raw.rateRules),
  };
}

/**
 * Normalizes an income config for load/restore. Existing fields (including all
 * legacy `hourlyRates`) are preserved; only `rateRules` is guaranteed.
 */
export function normalizeIncomeConfig(input: unknown): IncomeConfig | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<IncomeConfig>;
  if (raw.hourlyRates === undefined) {
    return raw as IncomeConfig;
  }
  return { ...(raw as IncomeConfig), hourlyRates: normalizeHourlyRates(raw.hourlyRates) };
}

/** Resolves the effective hourly rate for a rule against the base rate. */
export function resolveRuleRate(rule: CasualPayRateRule, baseRate: number): number {
  const safeBase = Number.isFinite(baseRate) ? baseRate : 0;
  if (rule.mode === 'multiplier') {
    return roundCurrency(safeBase * coerceNumber(rule.rate, 1));
  }
  return roundCurrency(coerceNumber(rule.rate, 0));
}

/**
 * True when an enabled rule covers the given day of week and minute-of-day.
 * Window start is inclusive and end is exclusive, so a 19:00 start means the
 * evening rate begins exactly at 19:00. Windows that cross midnight match the
 * selected day's evening and the following morning.
 */
export function ruleMatches(rule: CasualPayRateRule, dayOfWeek: number, timeOfDayMinutes: number): boolean {
  if (!rule.enabled) return false;
  const selected = (day: number) => rule.days.includes(((day % 7) + 7) % 7);
  if (rule.allDay) return selected(dayOfWeek);

  const start = timeToMinutes(rule.startTime);
  const end = timeToMinutes(rule.endTime);
  // A missing or equal window is treated as a full-day window on selected days.
  if (start === null || end === null || start === end) return selected(dayOfWeek);

  if (start < end) {
    return selected(dayOfWeek) && timeOfDayMinutes >= start && timeOfDayMinutes < end;
  }

  // Crosses midnight: evening belongs to the selected day, morning to the day after.
  if (timeOfDayMinutes >= start) return selected(dayOfWeek);
  if (timeOfDayMinutes < end) return selected(dayOfWeek - 1);
  return false;
}

export interface RateSelection {
  rate: number;
  rule: CasualPayRateRule | null;
}

/**
 * Deterministically selects the rate for a moment. The highest-priority enabled
 * matching rule wins; ties fall back to the rule's position in the list, so the
 * result never depends on unspecified iteration order.
 */
export function selectRateAt(
  rules: CasualPayRateRule[],
  baseRate: number,
  dayOfWeek: number,
  timeOfDayMinutes: number
): RateSelection {
  let bestRule: CasualPayRateRule | null = null;
  let bestPriority = -Infinity;
  let bestIndex = Infinity;

  rules.forEach((rule, index) => {
    if (!ruleMatches(rule, dayOfWeek, timeOfDayMinutes)) return;
    if (rule.priority > bestPriority || (rule.priority === bestPriority && index < bestIndex)) {
      bestRule = rule;
      bestPriority = rule.priority;
      bestIndex = index;
    }
  });

  if (!bestRule) return { rate: roundCurrency(baseRate), rule: null };
  return { rate: resolveRuleRate(bestRule, baseRate), rule: bestRule };
}

export interface RuledShiftPayResult {
  paidHours: number;
  estimatedPay: number;
  segments: ShiftRateSegment[];
  appliedRuleIds: string[];
}

interface RawSegment {
  start: number;
  end: number;
  dayOfWeek: number;
  rate: number;
  ruleId?: string;
  ruleLabel?: string;
  isBase: boolean;
  /** Paid minutes after break allocation; only set while merging. */
  minutes?: number;
}

/**
 * Distributes an unpaid break proportionally across raw segments using whole
 * minutes and a largest-remainder correction. A single-segment shift therefore
 * matches the original `duration - break` behaviour exactly.
 */
function allocateBreak(rawMinutes: number[], breakMinutes: number): number[] {
  const totalRaw = rawMinutes.reduce((sum, minutes) => sum + minutes, 0);
  if (totalRaw <= 0) return rawMinutes.map(() => 0);
  const paidTotal = Math.max(0, totalRaw - Math.max(0, breakMinutes));
  if (paidTotal <= 0) return rawMinutes.map(() => 0);
  if (paidTotal === totalRaw) return [...rawMinutes];

  const exact = rawMinutes.map((minutes) => (minutes * paidTotal) / totalRaw);
  const result = exact.map((value) => Math.floor(value));
  let remaining = paidTotal - result.reduce((sum, value) => sum + value, 0);

  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);

  let cursor = 0;
  while (remaining > 0 && order.length > 0) {
    result[order[cursor % order.length].index] += 1;
    remaining -= 1;
    cursor += 1;
  }
  return result;
}

/**
 * Splits a shift across every rate window boundary and totals the gross pay.
 * Works for shifts that cross midnight by evaluating the correct day-of-week
 * rules on each side of midnight.
 */
export function calculateRuledShiftPay(
  hourlyRates: HourlyRateConfig | null | undefined,
  date: string,
  startTime: string,
  endTime: string,
  breakMinutes = 0
): RuledShiftPayResult {
  const baseRate = roundCurrency(Number(hourlyRates?.baseRate) || 0);
  const rules = hourlyRates?.rateRules ?? [];

  const startMinutes = timeToMinutes(startTime) ?? 0;
  let endMinutes = timeToMinutes(endTime) ?? 0;
  if (endMinutes <= startMinutes) endMinutes += MINUTES_PER_DAY;
  const span = endMinutes - startMinutes;

  if (span <= 0) {
    return { paidHours: 0, estimatedPay: 0, segments: [], appliedRuleIds: [] };
  }

  const startDayOfWeek = parseLocalDate(date).getDay();

  // Collect every moment where the applicable rate can change: shift edges,
  // local midnights, and each rule window's start/end repeated across days.
  const boundaries = new Set<number>([0, span]);
  for (let day = 1; day * MINUTES_PER_DAY - startMinutes < span; day++) {
    boundaries.add(day * MINUTES_PER_DAY - startMinutes);
  }
  const dayOffsets = Math.ceil((startMinutes + span) / MINUTES_PER_DAY) + 1;
  for (const rule of rules) {
    if (!rule.enabled || rule.allDay) continue;
    const ruleStart = timeToMinutes(rule.startTime);
    const ruleEnd = timeToMinutes(rule.endTime);
    if (ruleStart === null || ruleEnd === null) continue;
    for (let day = 0; day <= dayOffsets; day++) {
      for (const boundary of [ruleStart, ruleEnd]) {
        const offset = day * MINUTES_PER_DAY + boundary - startMinutes;
        if (offset > 0 && offset < span) boundaries.add(offset);
      }
    }
  }

  const ordered = [...boundaries].sort((a, b) => a - b);
  const rawSegments: RawSegment[] = [];
  for (let index = 0; index < ordered.length - 1; index++) {
    const start = ordered[index];
    const end = ordered[index + 1];
    if (end <= start) continue;
    const absolute = startMinutes + start;
    const dayIndex = Math.floor(absolute / MINUTES_PER_DAY);
    const dayOfWeek = (((startDayOfWeek + dayIndex) % 7) + 7) % 7;
    const timeOfDay = ((absolute % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    const selection = selectRateAt(rules, baseRate, dayOfWeek, timeOfDay);
    rawSegments.push({
      start,
      end,
      dayOfWeek,
      rate: selection.rate,
      ruleId: selection.rule?.id,
      ruleLabel: selection.rule?.label,
      isBase: selection.rule === null,
    });
  }

  const paidMinutes = allocateBreak(
    rawSegments.map((segment) => segment.end - segment.start),
    breakMinutes
  );

  // Merge adjacent segments that resolve to the same rate so the breakdown is
  // readable and totals are summed once.
  const groups: RawSegment[] = [];
  rawSegments.forEach((segment, index) => {
    const minutes = paidMinutes[index];
    const previous = groups[groups.length - 1];
    if (
      previous &&
      previous.rate === segment.rate &&
      previous.ruleId === segment.ruleId &&
      previous.isBase === segment.isBase &&
      previous.end === segment.start
    ) {
      previous.end = segment.end;
      previous.minutes = (previous.minutes ?? 0) + minutes;
      return;
    }
    groups.push({ ...segment, minutes });
  });

  let totalMinutes = 0;
  let totalPay = 0;
  const segments: ShiftRateSegment[] = [];
  const appliedRuleIds = new Set<string>();

  for (const group of groups) {
    const minutes = group.minutes ?? 0;
    if (minutes <= 0) continue;
    const hours = minutes / 60;
    const pay = roundCurrency(hours * group.rate);
    totalMinutes += minutes;
    totalPay = addDecimals(totalPay, pay);
    if (group.ruleId) appliedRuleIds.add(group.ruleId);
    segments.push({
      ruleId: group.ruleId,
      ruleLabel: group.ruleLabel,
      dayOfWeek: group.dayOfWeek,
      startTime: minutesToTime(startMinutes + group.start),
      endTime: minutesToTime(startMinutes + group.end),
      hours: Math.round(hours * 100) / 100,
      rate: group.rate,
      pay,
      isBase: group.isBase,
    });
  }

  return {
    paidHours: Math.round((totalMinutes / 60) * 100) / 100,
    estimatedPay: roundCurrency(totalPay),
    segments,
    appliedRuleIds: [...appliedRuleIds],
  };
}

/**
 * Runs the rule engine only when the config actually defines rules. Returns
 * null so callers can fall back to the legacy `rateType` calculation.
 */
export function calculateShiftPayWithRules(
  hourlyRates: HourlyRateConfig | null | undefined,
  shift: { date: string; startTime: string; endTime: string; breakMinutes: number }
): RuledShiftPayResult | null {
  if (!hourlyRates?.rateRules || hourlyRates.rateRules.length === 0) return null;
  return calculateRuledShiftPay(
    hourlyRates,
    shift.date,
    shift.startTime,
    shift.endTime,
    shift.breakMinutes
  );
}

/** Human-readable day summary such as `Mon-Fri` or `Sat, Sun`. */
export function formatRuleDays(days: number[]): string {
  const sorted = Array.from(new Set(days.filter((day) => day >= 0 && day <= 6))).sort((a, b) => a - b);
  if (sorted.length === 0) return 'No days';
  if (sorted.length === 7) return 'Every day';
  const runs: number[][] = [];
  for (const day of sorted) {
    const current = runs[runs.length - 1];
    if (current && day === current[current.length - 1] + 1) current.push(day);
    else runs.push([day]);
  }
  return runs
    .map((run) =>
      run.length >= 3
        ? `${RATE_RULE_DAY_NAMES[run[0]]}-${RATE_RULE_DAY_NAMES[run[run.length - 1]]}`
        : run.map((day) => RATE_RULE_DAY_NAMES[day]).join(', ')
    )
    .join(', ');
}

/** One-line description of a rule for the config summary and previews. */
export function describeRateRule(rule: CasualPayRateRule, baseRate: number): string {
  const days = formatRuleDays(rule.days);
  const time = rule.allDay
    ? 'all day'
    : `${rule.startTime ?? '--:--'}-${rule.endTime ?? '--:--'}`;
  const rate =
    rule.mode === 'multiplier'
      ? `x${rule.rate} base (${formatRuleRate(rule, baseRate)})`
      : `${formatRuleRate(rule, baseRate)}`;
  return `${days} ${time}: ${rate}`;
}

function formatRuleRate(rule: CasualPayRateRule, baseRate: number): string {
  const value = resolveRuleRate(rule, baseRate);
  return `$${value.toFixed(2)}/hr`;
}

/**
 * Summary lines for a config: base plus every enabled rule. Disabled rules are
 * intentionally omitted so the summary reflects what actually applies.
 */
export function summarizeRateRules(hourlyRates: HourlyRateConfig | null | undefined): string[] {
  if (!hourlyRates) return [];
  const baseRate = Number(hourlyRates.baseRate) || 0;
  const lines = [`Base: $${roundCurrency(baseRate).toFixed(2)}/hr`];
  for (const rule of hourlyRates.rateRules ?? []) {
    if (!rule.enabled) continue;
    lines.push(`${rule.label}: ${describeRateRule(rule, baseRate)}`);
  }
  return lines;
}
