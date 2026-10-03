/**
 * Medication & Supplement Tracker — plugin-owned data model.
 *
 * This module is entirely self-contained: it does not import or mutate Core
 * state. Every record is stored in the plugin's own namespaced storage and is
 * included in MindMesh backups through the plugin backup handler, so disabling
 * or removing the plugin never discards data.
 *
 * SAFETY: the plugin stores only what the user enters. It never calculates,
 * suggests or adjusts a dose, and it makes no medical conclusions.
 */

export type MedicationKind = 'medication' | 'supplement' | 'vitamin' | 'other';

export type MedicationForm =
  | 'tablet'
  | 'capsule'
  | 'liquid'
  | 'injection'
  | 'cream'
  | 'inhaler'
  | 'powder'
  | 'drops'
  | 'patch'
  | 'other';

export type MedicationDoseUnit =
  | 'mg'
  | 'mcg'
  | 'g'
  | 'ml'
  | 'IU'
  | 'units'
  | 'drops'
  | 'puffs'
  | 'tablets'
  | 'capsules'
  | 'scoops'
  | 'patches';

export const KIND_LABELS: Record<MedicationKind, string> = {
  medication: 'Medication',
  supplement: 'Supplement',
  vitamin: 'Vitamin',
  other: 'Other',
};

export const FORM_LABELS: Record<MedicationForm, string> = {
  tablet: 'Tablet',
  capsule: 'Capsule',
  liquid: 'Liquid',
  injection: 'Injection',
  cream: 'Cream / ointment',
  inhaler: 'Inhaler',
  powder: 'Powder',
  drops: 'Drops',
  patch: 'Patch',
  other: 'Other',
};

export const DOSE_UNITS: MedicationDoseUnit[] = [
  'mg',
  'mcg',
  'g',
  'ml',
  'IU',
  'units',
  'drops',
  'puffs',
  'tablets',
  'capsules',
  'scoops',
  'patches',
];

export type ScheduleFrequency =
  | 'daily'
  | 'specific_times'
  | 'every_hours'
  | 'specific_days'
  | 'every_n_days'
  | 'weekly'
  | 'monthly'
  | 'course'
  | 'as_needed'
  | 'custom';

export const FREQUENCY_LABELS: Record<ScheduleFrequency, string> = {
  daily: 'Once daily',
  specific_times: 'Specific times every day',
  every_hours: 'Every X hours',
  specific_days: 'Certain days of the week',
  every_n_days: 'Every X days',
  weekly: 'Weekly',
  monthly: 'Monthly',
  course: 'Temporary course',
  as_needed: 'As needed (PRN)',
  custom: 'Custom schedule',
};

export type DoseStatus = 'taken' | 'skipped' | 'snoozed';

export interface MedicationItem {
  id: string;
  name: string;
  brandName?: string;
  kind: MedicationKind;
  form?: MedicationForm;
  strengthAmount?: number;
  strengthUnit?: MedicationDoseUnit;
  /** User-entered dose per administration, e.g. 1 tablet. */
  doseAmount?: number;
  doseUnit?: MedicationDoseUnit;
  instructions?: string;
  reason?: string;
  prescriber?: string;
  pharmacy?: string;
  notes?: string;
  /** YYYY-MM-DD */
  startDate?: string;
  /** YYYY-MM-DD optional */
  endDate?: string;
  active: boolean;
  /** PRN / as-needed item: logged manually, no fixed reminder. */
  asNeeded: boolean;
  /** User-entered maximum doses per day (PRN). Never suggested by the app. */
  maxDaily?: number;
  color?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MedicationSchedule {
  id: string;
  itemId: string;
  frequency: ScheduleFrequency;
  /** HH:MM local times. */
  times: string[];
  /** 0 = Sun .. 6 = Sat (specific_days / weekly). */
  daysOfWeek?: number[];
  /** Day of month 1-31 (monthly). */
  dayOfMonth?: number;
  /** Every X hours. */
  intervalHours?: number;
  /** Every X days. */
  intervalDays?: number;
  /** YYYY-MM-DD */
  startDate: string;
  /** YYYY-MM-DD optional inclusive end (temporary course). */
  endDate?: string;
  doseAmount?: number;
  doseUnit?: MedicationDoseUnit;
  instructions?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DoseEvent {
  id: string;
  itemId: string;
  scheduleId?: string;
  /** ISO timestamp the dose was scheduled for (or logged at, for PRN). */
  scheduledFor: string;
  status: DoseStatus;
  takenAt?: string;
  amount?: number;
  unit?: MedicationDoseUnit;
  note?: string;
  createdAt: string;
}

export interface MedicationSettings {
  enabled: boolean;
  /** Reminder lead time in minutes (0 = at the dose time). */
  advanceMinutes: number;
  /** Minutes after which an unlogged dose is treated as missed. */
  missAfterMinutes: number;
  /** Default snooze duration in minutes. */
  defaultSnoozeMinutes: number;
  showCompletedDoses: boolean;
  showMissedDoses: boolean;
  supplyTracking: boolean;
  refillAlerts: boolean;
  /** Days of upcoming doses pre-scheduled with the platform. */
  horizonDays: number;
  /** Factual weekly summary notification. */
  weeklySummary: boolean;
  /** History retention in days (0 = unlimited). */
  historyRetentionDays: number;
}

export interface SupplyRecord {
  /** Units on hand when `asOf` was recorded. */
  quantity?: number;
  unit?: MedicationDoseUnit;
  asOf?: string;
  /** Quantity consumed per dose (defaults to 1). */
  usedPerDose: number;
  /** Refill amount to order. */
  refillQuantity?: number;
  /** Low-supply threshold. */
  refillThreshold?: number;
  /** Optional user-selected refill-by date. */
  refillByDate?: string;
}

export interface MedicationState {
  items: MedicationItem[];
  schedules: MedicationSchedule[];
  doseEvents: DoseEvent[];
  supply: Record<string, SupplyRecord>;
  settings: MedicationSettings;
}

export const DEFAULT_SETTINGS: MedicationSettings = {
  enabled: true,
  advanceMinutes: 0,
  missAfterMinutes: 60,
  defaultSnoozeMinutes: 10,
  showCompletedDoses: true,
  showMissedDoses: true,
  supplyTracking: true,
  refillAlerts: true,
  horizonDays: 7,
  weeklySummary: false,
  historyRetentionDays: 0,
};

export const ITEM_COLORS = ['#34d399', '#2dd4bf', '#38bdf8', '#6366f1', '#f472b6', '#fbbf24', '#fb923c'];

export function createDefaultState(): MedicationState {
  return { items: [], schedules: [], doseEvents: [], supply: {}, settings: { ...DEFAULT_SETTINGS } };
}

// ---------------------------------------------------------------------------
// Normalizers — non-destructive and tolerant of older/partial payloads.
// ---------------------------------------------------------------------------

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
function optStr(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

const KIND_VALUES: readonly MedicationKind[] = ['medication', 'supplement', 'vitamin', 'other'];
const FORM_VALUES: readonly MedicationForm[] = [
  'tablet',
  'capsule',
  'liquid',
  'injection',
  'cream',
  'inhaler',
  'powder',
  'drops',
  'patch',
  'other',
];
const FREQ_VALUES: readonly ScheduleFrequency[] = [
  'daily',
  'specific_times',
  'every_hours',
  'specific_days',
  'every_n_days',
  'weekly',
  'monthly',
  'course',
  'as_needed',
  'custom',
];
const STATUS_VALUES: readonly DoseStatus[] = ['taken', 'skipped', 'snoozed'];

export function normalizeTime(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return undefined;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function normalizeItem(input: unknown): MedicationItem | null {
  if (!isObject(input) || typeof input.id !== 'string' || typeof input.name !== 'string') return null;
  const now = new Date().toISOString();
  return {
    id: input.id,
    name: input.name,
    brandName: optStr(input.brandName),
    kind: oneOf(input.kind, KIND_VALUES, 'medication'),
    form: input.form === undefined ? undefined : oneOf(input.form, FORM_VALUES, 'other'),
    strengthAmount: num(input.strengthAmount),
    strengthUnit: input.strengthUnit === undefined ? undefined : oneOf(input.strengthUnit, DOSE_UNITS, 'mg'),
    doseAmount: num(input.doseAmount),
    doseUnit: input.doseUnit === undefined ? undefined : oneOf(input.doseUnit, DOSE_UNITS, 'tablets'),
    instructions: optStr(input.instructions),
    reason: optStr(input.reason),
    prescriber: optStr(input.prescriber),
    pharmacy: optStr(input.pharmacy),
    notes: optStr(input.notes),
    startDate: optStr(input.startDate),
    endDate: optStr(input.endDate),
    active: bool(input.active, true),
    asNeeded: bool(input.asNeeded, false),
    maxDaily: num(input.maxDaily),
    color: optStr(input.color),
    createdAt: optStr(input.createdAt) ?? now,
    updatedAt: optStr(input.updatedAt) ?? optStr(input.createdAt) ?? now,
  };
}

function normalizeSchedule(input: unknown): MedicationSchedule | null {
  if (!isObject(input) || typeof input.id !== 'string' || typeof input.itemId !== 'string') return null;
  const now = new Date().toISOString();
  const frequency = oneOf(input.frequency, FREQ_VALUES, 'daily');
  const times = Array.isArray(input.times)
    ? Array.from(new Set(input.times.map(normalizeTime).filter((t): t is string => Boolean(t)))).sort()
    : [];
  const daysOfWeek = Array.isArray(input.daysOfWeek)
    ? Array.from(
        new Set(
          input.daysOfWeek
            .map((day) => (typeof day === 'number' ? Math.trunc(day) : NaN))
            .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
        )
      ).sort((a, b) => a - b)
    : undefined;
  return {
    id: input.id,
    itemId: input.itemId,
    frequency,
    times,
    daysOfWeek,
    dayOfMonth:
      frequency === 'monthly' ? Math.min(31, Math.max(1, Math.trunc(num(input.dayOfMonth) ?? 1))) : num(input.dayOfMonth),
    intervalHours: frequency === 'every_hours' ? Math.max(1, Math.trunc(num(input.intervalHours) ?? 6)) : num(input.intervalHours),
    intervalDays: frequency === 'every_n_days' ? Math.max(1, Math.trunc(num(input.intervalDays) ?? 2)) : num(input.intervalDays),
    startDate: optStr(input.startDate) ?? now.slice(0, 10),
    endDate: optStr(input.endDate),
    doseAmount: num(input.doseAmount),
    doseUnit: input.doseUnit === undefined ? undefined : oneOf(input.doseUnit, DOSE_UNITS, 'tablets'),
    instructions: optStr(input.instructions),
    active: bool(input.active, true),
    createdAt: optStr(input.createdAt) ?? now,
    updatedAt: optStr(input.updatedAt) ?? optStr(input.createdAt) ?? now,
  };
}

function normalizeDoseEvent(input: unknown): DoseEvent | null {
  if (!isObject(input) || typeof input.id !== 'string' || typeof input.itemId !== 'string') return null;
  if (typeof input.scheduledFor !== 'string') return null;
  const now = new Date().toISOString();
  return {
    id: input.id,
    itemId: input.itemId,
    scheduleId: optStr(input.scheduleId),
    scheduledFor: input.scheduledFor,
    status: oneOf(input.status, STATUS_VALUES, 'taken'),
    takenAt: optStr(input.takenAt),
    amount: num(input.amount),
    unit: input.unit === undefined ? undefined : oneOf(input.unit, DOSE_UNITS, 'tablets'),
    note: optStr(input.note),
    createdAt: optStr(input.createdAt) ?? now,
  };
}

function normalizeSupply(input: unknown): Record<string, SupplyRecord> {
  const result: Record<string, SupplyRecord> = {};
  if (!isObject(input)) return result;
  for (const [itemId, value] of Object.entries(input)) {
    if (!isObject(value)) continue;
    result[itemId] = {
      quantity: num(value.quantity),
      unit: value.unit === undefined ? undefined : oneOf(value.unit, DOSE_UNITS, 'tablets'),
      asOf: optStr(value.asOf),
      usedPerDose: Math.max(0, num(value.usedPerDose) ?? 1),
      refillQuantity: num(value.refillQuantity),
      refillThreshold: num(value.refillThreshold),
      refillByDate: optStr(value.refillByDate),
    };
  }
  return result;
}

function normalizeSettings(input: unknown): MedicationSettings {
  if (!isObject(input)) return { ...DEFAULT_SETTINGS };
  return {
    enabled: bool(input.enabled, DEFAULT_SETTINGS.enabled),
    advanceMinutes: Math.max(0, Math.trunc(num(input.advanceMinutes) ?? DEFAULT_SETTINGS.advanceMinutes)),
    missAfterMinutes: Math.max(0, Math.trunc(num(input.missAfterMinutes) ?? DEFAULT_SETTINGS.missAfterMinutes)),
    defaultSnoozeMinutes: Math.max(1, Math.trunc(num(input.defaultSnoozeMinutes) ?? DEFAULT_SETTINGS.defaultSnoozeMinutes)),
    showCompletedDoses: bool(input.showCompletedDoses, DEFAULT_SETTINGS.showCompletedDoses),
    showMissedDoses: bool(input.showMissedDoses, DEFAULT_SETTINGS.showMissedDoses),
    supplyTracking: bool(input.supplyTracking, DEFAULT_SETTINGS.supplyTracking),
    refillAlerts: bool(input.refillAlerts, DEFAULT_SETTINGS.refillAlerts),
    horizonDays: Math.min(60, Math.max(1, Math.trunc(num(input.horizonDays) ?? DEFAULT_SETTINGS.horizonDays))),
    weeklySummary: bool(input.weeklySummary, DEFAULT_SETTINGS.weeklySummary),
    historyRetentionDays: Math.max(0, Math.trunc(num(input.historyRetentionDays) ?? DEFAULT_SETTINGS.historyRetentionDays)),
  };
}

/** Non-destructive normalizer: malformed records are skipped, never fatal. */
export function normalizeState(input: unknown): MedicationState {
  if (!isObject(input)) return createDefaultState();
  const items = Array.isArray(input.items)
    ? input.items.map(normalizeItem).filter((item): item is MedicationItem => item !== null)
    : [];
  const itemIds = new Set(items.map((item) => item.id));
  const schedules = Array.isArray(input.schedules)
    ? input.schedules
        .map(normalizeSchedule)
        .filter((schedule): schedule is MedicationSchedule => schedule !== null && itemIds.has(schedule.itemId))
    : [];
  const scheduleIds = new Set(schedules.map((schedule) => schedule.id));
  const doseEvents = Array.isArray(input.doseEvents)
    ? input.doseEvents
        .map(normalizeDoseEvent)
        .filter(
          (event): event is DoseEvent =>
            event !== null && itemIds.has(event.itemId) && (!event.scheduleId || scheduleIds.has(event.scheduleId))
        )
    : [];
  const supply = normalizeSupply(input.supply);
  for (const itemId of Object.keys(supply)) {
    if (!itemIds.has(itemId)) delete supply[itemId];
  }
  return { items, schedules, doseEvents, supply, settings: normalizeSettings(input.settings) };
}
