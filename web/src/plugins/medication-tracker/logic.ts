/**
 * Medication & Supplement Tracker — pure logic and reminder provider.
 *
 * Storage-free. The tracker UI and the notification provider share exactly the
 * same dose-occurrence maths, so what the user sees and what the platform
 * schedules can never disagree. No medical advice is produced anywhere here:
 * everything is derived from the user's own entries.
 */
import type {
  DoseEvent,
  DoseStatus,
  MedicationItem,
  MedicationSchedule,
  MedicationState,
  SupplyRecord,
} from './model';

export function uid(prefix = 'med'): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

export function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function dateAtTime(dayKey: string, time: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1, hours ?? 0, minutes ?? 0, 0, 0);
}

function isValidDateKey(key: string | undefined): key is string {
  return typeof key === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(key);
}

function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b).getTime() - startOfDay(a).getTime()) / 86_400_000);
}

/** Whether a day-based schedule produces a dose on the given local day. */
export function scheduleOccursOn(schedule: MedicationSchedule, day: Date): boolean {
  if (!schedule.active || schedule.frequency === 'as_needed' || schedule.frequency === 'every_hours') return false;
  const key = dateKey(day);
  if (isValidDateKey(schedule.startDate) && key < schedule.startDate) return false;
  if (isValidDateKey(schedule.endDate) && key > schedule.endDate) return false;

  switch (schedule.frequency) {
    case 'daily':
    case 'course':
    case 'custom':
      // Custom falls back to daily when no explicit weekdays are chosen.
      if (schedule.frequency === 'custom' && Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.length > 0) {
        return schedule.daysOfWeek.includes(day.getDay());
      }
      return true;
    case 'specific_times':
      return true;
    case 'specific_days':
    case 'weekly':
      return Array.isArray(schedule.daysOfWeek) && schedule.daysOfWeek.includes(day.getDay());
    case 'monthly':
      return day.getDate() === Math.min(31, Math.max(1, schedule.dayOfMonth ?? 1));
    case 'every_n_days': {
      if (!isValidDateKey(schedule.startDate)) return false;
      const interval = Math.max(1, Math.trunc(schedule.intervalDays ?? 1));
      const delta = daysBetween(dateAtTime(schedule.startDate, '00:00'), day);
      return delta >= 0 && delta % interval === 0;
    }
    default:
      return false;
  }
}

export interface DoseOccurrence {
  key: string;
  itemId: string;
  scheduleId: string;
  scheduledFor: string;
  time: string;
}

export function doseOccurrenceKey(scheduleId: string, scheduledFor: string): string {
  return `${scheduleId}::${scheduledFor}`;
}

const MAX_OCCURRENCES = 2000;

export function computeDoseOccurrences(state: MedicationState, from: Date, to: Date): DoseOccurrence[] {
  const occurrences: DoseOccurrence[] = [];
  if (to < from) return occurrences;
  const firstDay = startOfDay(from);
  const lastDay = startOfDay(to);

  for (const schedule of state.schedules) {
    if (!schedule.active || schedule.frequency === 'as_needed') continue;
    const item = state.items.find((candidate) => candidate.id === schedule.itemId);
    if (!item || !item.active) continue;

    if (schedule.frequency === 'every_hours') {
      const hours = Math.max(1, Math.trunc(schedule.intervalHours ?? 6));
      const anchor = dateAtTime(schedule.startDate, schedule.times[0] ?? '08:00');
      if (!Number.isFinite(anchor.getTime())) continue;
      const step = hours * 3_600_000;
      let start = anchor.getTime();
      if (start < from.getTime()) start = anchor.getTime() + Math.ceil((from.getTime() - anchor.getTime()) / step) * step;
      let guard = 0;
      for (let t = start; t <= to.getTime() && guard < MAX_OCCURRENCES; t += step, guard += 1) {
        const due = new Date(t);
        occurrences.push({
          key: doseOccurrenceKey(schedule.id, due.toISOString()),
          itemId: schedule.itemId,
          scheduleId: schedule.id,
          scheduledFor: due.toISOString(),
          time: `${String(due.getHours()).padStart(2, '0')}:${String(due.getMinutes()).padStart(2, '0')}`,
        });
      }
      continue;
    }

    const times = schedule.frequency === 'daily' || schedule.frequency === 'weekly' || schedule.frequency === 'monthly'
      ? schedule.times.slice(0, 1).length > 0
        ? schedule.times.slice(0, 1)
        : ['08:00']
      : schedule.times;

    for (let day = new Date(firstDay); day <= lastDay; day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
      if (!scheduleOccursOn(schedule, day)) continue;
      for (const time of times) {
        const due = dateAtTime(dateKey(day), time);
        if (due < from || due > to) continue;
        occurrences.push({
          key: doseOccurrenceKey(schedule.id, due.toISOString()),
          itemId: schedule.itemId,
          scheduleId: schedule.id,
          scheduledFor: due.toISOString(),
          time,
        });
      }
    }
  }
  return occurrences.sort((a, b) => Date.parse(a.scheduledFor) - Date.parse(b.scheduledFor));
}

export function findDoseEvent(
  state: MedicationState,
  occurrence: Pick<DoseOccurrence, 'itemId' | 'scheduleId' | 'scheduledFor'>
): DoseEvent | undefined {
  return state.doseEvents.find(
    (event) =>
      event.itemId === occurrence.itemId &&
      event.scheduleId === occurrence.scheduleId &&
      event.scheduledFor === occurrence.scheduledFor
  );
}

export type DoseDisplayStatus = 'taken' | 'skipped' | 'upcoming' | 'due' | 'missed';

export interface DoseStatusInfo {
  status: DoseDisplayStatus;
  event?: DoseEvent;
  minutesUntilDue: number;
}

export function getDoseStatus(occurrence: DoseOccurrence, state: MedicationState, now: Date = new Date()): DoseStatusInfo {
  const event = findDoseEvent(state, occurrence);
  const due = Date.parse(occurrence.scheduledFor);
  const minutesUntilDue = Math.round((due - now.getTime()) / 60_000);
  if (event && (event.status === 'taken' || event.status === 'skipped')) {
    return { status: event.status, event, minutesUntilDue };
  }
  if (now.getTime() < due) return { status: 'upcoming', event, minutesUntilDue };
  const grace = Math.max(0, state.settings.missAfterMinutes) * 60_000;
  if (now.getTime() - due <= grace) return { status: 'due', event, minutesUntilDue };
  return { status: 'missed', event, minutesUntilDue };
}

export function getDosesForDay(state: MedicationState, now: Date = new Date()): DoseOccurrence[] {
  const from = startOfDay(now);
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate(), 23, 59, 59, 999);
  return computeDoseOccurrences(state, from, to);
}

function supplyFor(state: MedicationState, itemId: string): SupplyRecord {
  return state.supply[itemId] ?? { usedPerDose: 1 };
}

/** Estimated units left, decremented by taken doses since the count was recorded. */
export function estimateRemaining(item: MedicationItem, supply: SupplyRecord, events: DoseEvent[]): number | undefined {
  if (typeof supply.quantity !== 'number') return undefined;
  const since = supply.asOf ? Date.parse(supply.asOf) : 0;
  const perDose = supply.usedPerDose > 0 ? supply.usedPerDose : 1;
  const consumed = events.filter(
    (event) =>
      event.itemId === item.id &&
      event.status === 'taken' &&
      Date.parse(event.takenAt ?? event.scheduledFor) >= (Number.isFinite(since) ? since : 0)
  ).length * perDose;
  return Math.max(0, supply.quantity - consumed);
}

export function isLowSupply(supply: SupplyRecord, remaining: number | undefined): boolean {
  if (typeof supply.refillThreshold !== 'number' || remaining === undefined) return false;
  return remaining <= supply.refillThreshold;
}

export interface ItemStatus {
  item: MedicationItem;
  schedules: MedicationSchedule[];
  supply: SupplyRecord;
  remaining?: number;
  lowSupply: boolean;
  nextDose?: DoseOccurrence;
}

export function getItemsWithStatus(state: MedicationState, now: Date = new Date()): ItemStatus[] {
  return state.items
    .filter((item) => item.active)
    .map((item) => {
      const supply = supplyFor(state, item.id);
      const remaining = estimateRemaining(item, supply, state.doseEvents);
      return {
        item,
        schedules: state.schedules.filter((schedule) => schedule.itemId === item.id),
        supply,
        remaining,
        lowSupply: isLowSupply(supply, remaining),
        nextDose: getNextDose(state, item.id, now),
      };
    });
}

export function getNextDose(state: MedicationState, itemId: string, now: Date = new Date()): DoseOccurrence | undefined {
  const horizon = new Date(now.getTime() + 60 * 24 * 3_600_000);
  const occurrences = computeDoseOccurrences(state, startOfDay(now), horizon).filter(
    (occurrence) => occurrence.itemId === itemId
  );
  for (const occurrence of occurrences) {
    const info = getDoseStatus(occurrence, state, now);
    if (info.status === 'upcoming' || info.status === 'due') return occurrence;
  }
  return occurrences[0];
}

export interface AdherenceStats {
  expected: number;
  taken: number;
  skipped: number;
  missed: number;
  rate: number;
}

export function getAdherenceStats(state: MedicationState, days: number, now: Date = new Date()): AdherenceStats {
  const from = new Date(startOfDay(now).getTime() - (Math.max(1, days) - 1) * 86_400_000);
  const occurrences = computeDoseOccurrences(state, from, now).filter(
    (occurrence) => Date.parse(occurrence.scheduledFor) <= now.getTime()
  );
  let taken = 0;
  let skipped = 0;
  let missed = 0;
  for (const occurrence of occurrences) {
    const { status } = getDoseStatus(occurrence, state, now);
    if (status === 'taken') taken += 1;
    else if (status === 'skipped') skipped += 1;
    else if (status === 'missed') missed += 1;
  }
  const expected = taken + skipped + missed;
  return { expected, taken, skipped, missed, rate: expected === 0 ? 0 : taken / expected };
}

/** Count of taken PRN doses logged on the local day containing `now`. */
export function getPrnTakenToday(state: MedicationState, itemId: string, now: Date = new Date()): number {
  const from = startOfDay(now).getTime();
  return state.doseEvents.filter(
    (event) =>
      event.itemId === itemId &&
      event.status === 'taken' &&
      Date.parse(event.takenAt ?? event.scheduledFor) >= from &&
      Date.parse(event.takenAt ?? event.scheduledFor) <= now.getTime()
  ).length;
}

// ---------------------------------------------------------------------------
// Mutations — pure, returning the next state.
// ---------------------------------------------------------------------------

function stamp<T extends object>(record: T): T & { createdAt: string; updatedAt: string } {
  const now = new Date().toISOString();
  const createdAt = (record as { createdAt?: string }).createdAt;
  return { ...record, createdAt: createdAt ?? now, updatedAt: now };
}

export function saveItem(state: MedicationState, item: MedicationItem): MedicationState {
  const exists = state.items.some((candidate) => candidate.id === item.id);
  const items = exists
    ? state.items.map((candidate) =>
        candidate.id === item.id ? (stamp({ ...candidate, ...item, createdAt: candidate.createdAt }) as MedicationItem) : candidate
      )
    : [...state.items, stamp(item) as MedicationItem];
  return { ...state, items };
}

export function setItemActive(state: MedicationState, itemId: string, active: boolean): MedicationState {
  return {
    ...state,
    items: state.items.map((item) =>
      item.id === itemId ? { ...item, active, updatedAt: new Date().toISOString() } : item
    ),
  };
}

/** Deleting an item also removes its schedules, dose events and supply record. */
export function deleteItem(state: MedicationState, itemId: string): MedicationState {
  const supply = { ...state.supply };
  delete supply[itemId];
  return {
    ...state,
    items: state.items.filter((item) => item.id !== itemId),
    schedules: state.schedules.filter((schedule) => schedule.itemId !== itemId),
    doseEvents: state.doseEvents.filter((event) => event.itemId !== itemId),
    supply,
  };
}

export function saveSchedule(state: MedicationState, schedule: MedicationSchedule): MedicationState {
  const exists = state.schedules.some((candidate) => candidate.id === schedule.id);
  const schedules = exists
    ? state.schedules.map((candidate) =>
        candidate.id === schedule.id
          ? (stamp({ ...candidate, ...schedule, createdAt: candidate.createdAt }) as MedicationSchedule)
          : candidate
      )
    : [...state.schedules, stamp(schedule) as MedicationSchedule];
  return { ...state, schedules };
}

export function deleteSchedule(state: MedicationState, scheduleId: string): MedicationState {
  return {
    ...state,
    schedules: state.schedules.filter((schedule) => schedule.id !== scheduleId),
    doseEvents: state.doseEvents.filter((event) => event.scheduleId !== scheduleId),
  };
}

export function setSupply(state: MedicationState, itemId: string, supply: SupplyRecord): MedicationState {
  return { ...state, supply: { ...state.supply, [itemId]: supply } };
}

export function updateSettings(state: MedicationState, settings: Partial<MedicationState['settings']>): MedicationState {
  return { ...state, settings: { ...state.settings, ...settings } };
}

export function logDose(
  state: MedicationState,
  input: {
    itemId: string;
    scheduleId?: string;
    scheduledFor: string;
    status: DoseStatus;
    amount?: number;
    unit?: MedicationItem['doseUnit'];
    note?: string;
  }
): MedicationState {
  const existing = state.doseEvents.find(
    (event) =>
      event.itemId === input.itemId &&
      event.scheduleId === input.scheduleId &&
      event.scheduledFor === input.scheduledFor
  );
  const entry: DoseEvent = {
    id: existing?.id ?? uid('dose'),
    itemId: input.itemId,
    scheduleId: input.scheduleId,
    scheduledFor: input.scheduledFor,
    status: input.status,
    takenAt: input.status === 'taken' ? new Date().toISOString() : undefined,
    amount: input.amount,
    unit: input.unit,
    note: input.note,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  const doseEvents = existing
    ? state.doseEvents.map((event) => (event.id === existing.id ? entry : event))
    : [...state.doseEvents, entry];
  return { ...state, doseEvents };
}

export function undoDose(state: MedicationState, eventId: string): MedicationState {
  return { ...state, doseEvents: state.doseEvents.filter((event) => event.id !== eventId) };
}

export function getRecentDoses(state: MedicationState, limit = 200): DoseEvent[] {
  return [...state.doseEvents]
    .sort((a, b) => Date.parse(b.takenAt ?? b.scheduledFor) - Date.parse(a.takenAt ?? a.scheduledFor))
    .slice(0, limit);
}

export function formatTime12(time: string): string {
  const [hours, minutes] = time.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return time;
  const period = hours >= 12 ? 'pm' : 'am';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return minutes === 0 ? `${hour12}${period}` : `${hour12}:${String(minutes).padStart(2, '0')}${period}`;
}

export function describeSchedule(schedule: MedicationSchedule): string {
  const times = schedule.times.map(formatTime12).join(', ');
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  switch (schedule.frequency) {
    case 'daily':
      return `Once daily${times ? ` at ${times}` : ''}`;
    case 'specific_times':
      return `Every day at ${times}`;
    case 'every_hours':
      return `Every ${schedule.intervalHours ?? 6} hours`;
    case 'specific_days': {
      const days = (schedule.daysOfWeek ?? []).map((day) => dayNames[day]).join(', ');
      return `${days || 'No days'}${times ? ` at ${times}` : ''}`;
    }
    case 'every_n_days':
      return `Every ${schedule.intervalDays ?? 1} day(s)${times ? ` at ${times}` : ''}`;
    case 'weekly':
      return `Weekly${times ? ` at ${times}` : ''}`;
    case 'monthly':
      return `Monthly on day ${schedule.dayOfMonth ?? 1}${times ? ` at ${times}` : ''}`;
    case 'course':
      return `Course${times ? ` at ${times}` : ''}`;
    case 'as_needed':
      return 'As needed (PRN)';
    case 'custom':
      return times ? `Custom: ${times}` : 'Custom';
    default:
      return times;
  }
}

// ---------------------------------------------------------------------------
// Reminder provider
// ---------------------------------------------------------------------------

export interface DesiredMedicationNotification {
  id: string;
  title: string;
  body: string;
  fireAt: number;
  cycleKey: string;
  ref?: string;
}

export function doseJobId(scheduleId: string, scheduledFor: string): string {
  return `dose:${scheduleId}:${scheduledFor}`;
}

export function refillJobId(itemId: string, remaining: number): string {
  return `refill:${itemId}:${remaining}`;
}

/**
 * Pure: every medication notification that should currently exist. The shared
 * engine reconciles this against the platform scheduler.
 */
export function buildDesiredNotifications(
  state: MedicationState,
  appNotificationsEnabled: boolean,
  now: Date = new Date()
): DesiredMedicationNotification[] {
  if (!appNotificationsEnabled || !state.settings.enabled) return [];
  const settings = state.settings;
  const nowMs = now.getTime();
  const graceMs = Math.max(0, settings.missAfterMinutes) * 60_000;
  const horizonMs = Math.max(1, settings.horizonDays) * 24 * 60 * 60_000;
  const advanceMs = Math.max(0, settings.advanceMinutes) * 60_000;

  const from = new Date(nowMs - graceMs);
  const to = new Date(nowMs + horizonMs);
  const jobs: DesiredMedicationNotification[] = [];

  for (const occurrence of computeDoseOccurrences(state, from, to)) {
    const item = state.items.find((candidate) => candidate.id === occurrence.itemId);
    if (!item || !item.active) continue;
    const event = findDoseEvent(state, occurrence);
    if (event && (event.status === 'taken' || event.status === 'skipped')) continue;

    const schedule = state.schedules.find((candidate) => candidate.id === occurrence.scheduleId);
    const doseLabel = schedule?.doseAmount
      ? `${schedule.doseAmount}${schedule.doseUnit ? ` ${schedule.doseUnit}` : ''}`
      : item.doseAmount
        ? `${item.doseAmount}${item.doseUnit ? ` ${item.doseUnit}` : ''}`
        : '';
    const due = Date.parse(occurrence.scheduledFor);
    const fireAt = due - advanceMs;
    if (nowMs - fireAt > graceMs) continue;

    jobs.push({
      id: doseJobId(occurrence.scheduleId, occurrence.scheduledFor),
      title: `${item.name}${doseLabel ? ` — ${doseLabel}` : ''}`,
      body: `Scheduled for ${formatTime12(occurrence.time)}. Tap to log this dose.`,
      fireAt,
      cycleKey: occurrence.scheduledFor,
      ref: item.id,
    });
  }

  if (settings.refillAlerts && settings.supplyTracking) {
    for (const item of state.items) {
      if (!item.active) continue;
      const supply = state.supply[item.id];
      if (!supply) continue;
      const remaining = estimateRemaining(item, supply, state.doseEvents);
      if (!isLowSupply(supply, remaining) || remaining === undefined) continue;
      const unit = supply.unit ? ` ${supply.unit}` : '';
      jobs.push({
        id: refillJobId(item.id, remaining),
        title: `Refill ${item.name}`,
        body: remaining <= 0 ? `You appear to be out of ${item.name}.` : `About ${remaining}${unit} left — at or below your refill level.`,
        fireAt: nowMs,
        cycleKey: `refill:${remaining}`,
        ref: item.id,
      });
    }
  }

  return jobs;
}

/**
 * Builds the provider registered with Core. `getState` always reflects the
 * latest persisted plugin data; `log` writes a dose event back.
 */
export function createNotificationProvider(
  getState: () => MedicationState,
  applyAction: (mutate: (state: MedicationState) => MedicationState) => void,
  isAppNotificationsEnabled: () => boolean
): {
  getDesired: (now: Date) => DesiredMedicationNotification[];
  onAction: (action: 'complete' | 'snooze' | 'skip' | 'open', job: { id: string; ref?: string }) => void;
} {
  return {
    getDesired: (now: Date) => buildDesiredNotifications(getState(), isAppNotificationsEnabled(), now),
    onAction: (action, job) => {
      if (!job.id.startsWith('dose:')) return;
      const rest = job.id.slice('dose:'.length);
      const separator = rest.indexOf(':');
      if (separator < 0) return;
      const scheduleId = rest.slice(0, separator);
      const scheduledFor = rest.slice(separator + 1);
      const itemId = job.ref;
      if (!itemId || !scheduledFor) return;
      if (action === 'complete') {
        applyAction((state) => logDose(state, { itemId, scheduleId, scheduledFor, status: 'taken' }));
      } else if (action === 'skip') {
        applyAction((state) => logDose(state, { itemId, scheduleId, scheduledFor, status: 'skipped' }));
      }
      // 'snooze' is handled by the shared engine; 'open' navigates to the tab.
    },
  };
}
