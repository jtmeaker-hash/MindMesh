/**
 * Self Care plugin — storage, recurrence and native notification delivery.
 *
 * Delivery uses the real Android bridge (`window.MindMeshNotifications`, the
 * same AlarmManager pipeline as Core reminders): alarms fire with the UI
 * closed, survive reboot/update via NotificationStore + BootReceiver, and
 * action taps (Done/Snooze/Skip/Open) are routed back through the existing
 * `mindmesh-selfcare-action` CustomEvent (mirroring the routine-action
 * pattern in `services/notifications.ts`).
 *
 * Everything is local and offline. Diagnostics never include message text.
 */
import {
  SELF_CARE_MISSED_GRACE_MINUTES,
  SELF_CARE_NOTIFICATION_PREFIX,
  checkInDisplayLabel,
  defaultSelfCareState,
  normalizeSelfCareState,
  pickVariant,
  type SelfCareCheckIn,
  type SelfCareHistoryEntry,
  type SelfCareHistoryResult,
  type SelfCareQuietHours,
  type SelfCareSettings,
  type SelfCareState,
} from '../types/selfCare';
import { getNativeBridge } from './notifications';
import { logger } from './logger';

export const SELF_CARE_STORAGE_KEY = 'mindmesh_selfcare_v1';
/** How far ahead alarms are registered (AlarmManager persists them). */
export const SELF_CARE_SCHEDULE_HORIZON_DAYS = 8;
export const SELF_CARE_ACTION_EVENT = 'mindmesh-selfcare-action';
export const SELF_CARE_CHANGED_EVENT = 'mindmesh-selfcare-changed';
export const SELF_CARE_NAVIGATE_EVENT = 'mindmesh-navigate-selfcare';
export const SELF_CARE_GENERIC_BODY = 'A gentle check-in is waiting for you 💛 (open to read it)';

declare global {
  interface Window {
    MindMeshSelfCareActionQueue?: Array<{ id: string; action: string }>;
  }
}

// ---------------------------------------------------------------------------
// Storage (single namespaced key; backup/migrations go through here)
// ---------------------------------------------------------------------------

export function loadSelfCareState(): SelfCareState {
  try {
    const raw = localStorage.getItem(SELF_CARE_STORAGE_KEY);
    if (!raw) return defaultSelfCareState();
    return normalizeSelfCareState(JSON.parse(raw));
  } catch {
    return defaultSelfCareState();
  }
}

export function saveSelfCareState(state: SelfCareState): void {
  try {
    localStorage.setItem(
      SELF_CARE_STORAGE_KEY,
      JSON.stringify({ ...state, lastModified: new Date().toISOString() })
    );
  } catch (err) {
    logger.warn('SelfCare', 'Failed to persist Self Care state', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export function resetSelfCareState(): SelfCareState {
  const fresh = defaultSelfCareState();
  saveSelfCareState(fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Local wall-clock helpers (timezone/DST-safe by construction)
// ---------------------------------------------------------------------------

function parseTime(value: string): { h: number; m: number } {
  const match = value.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return { h: 9, m: 0 };
  return {
    h: Math.min(23, Math.max(0, Number(match[1]))),
    m: Math.min(59, Math.max(0, Number(match[2]))),
  };
}

export function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`;
}

function localMidnightDayNumber(date: Date): number {
  return Math.floor(new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() / 86_400_000);
}

function quietContains(quiet: SelfCareQuietHours, date: Date): boolean {
  const t = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  if (quiet.start <= quiet.end) return t >= quiet.start && t < quiet.end;
  return t >= quiet.start || t < quiet.end;
}

/** Moves a fire time out of quiet hours; deterministic, never duplicates. */
export function applyQuietHours(quiet: SelfCareQuietHours, fireAt: Date): Date {
  if (!quiet.enabled || !quietContains(quiet, fireAt)) return fireAt;
  const end = parseTime(quiet.end);
  const moved = new Date(fireAt);
  moved.setHours(end.h, end.m, 0, 0);
  if (moved.getTime() <= fireAt.getTime()) moved.setDate(moved.getDate() + 1);
  return moved;
}

/**
 * Best-effort fire time for a scheduled occurrence key. Regular occurrences
 * encode `id::YYYY-MM-DD::HH:MM` (local wall clock); snooze alarms encode
 * `id::snooze::<epochMs>`. Returns null when the key carries no usable time.
 */
export function fireTimeOfOccurrenceKey(occurrenceKey: string): number | null {
  const parts = occurrenceKey.split('::');
  const tail = parts[parts.length - 1] ?? '';
  if (parts.length >= 3 && parts[parts.length - 2] === 'snooze' && /^\d+$/.test(tail)) {
    return Number(tail);
  }
  const datePart = parts.length >= 3 ? parts[parts.length - 2] : '';
  const dateMatch = datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = tail.match(/^(\d{2}):(\d{2})$/);
  if (!dateMatch || !timeMatch) return null;
  return new Date(
    Number(dateMatch[1]),
    Number(dateMatch[2]) - 1,
    Number(dateMatch[3]),
    Number(timeMatch[1]),
    Number(timeMatch[2]),
    0,
    0
  ).getTime();
}

function hashKey(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

// ---------------------------------------------------------------------------
// Occurrence computation (pure)
// ---------------------------------------------------------------------------

export interface SelfCareOccurrence {
  checkInId: string;
  occurrenceKey: string;
  fireAt: number;
  dateKey: string;
}

export function computeOccurrences(
  state: SelfCareState,
  now: number = Date.now(),
  horizonDays: number = SELF_CARE_SCHEDULE_HORIZON_DAYS
): SelfCareOccurrence[] {
  if (state.settings.pausedAll) return [];
  const nowDate = new Date(now);
  const base = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
  const seen = new Set<string>();
  const out: SelfCareOccurrence[] = [];

  for (const checkIn of state.checkIns) {
    if (!checkIn.enabled || checkIn.paused) continue;
    if (checkIn.schedule.weekdays.length === 0 || checkIn.schedule.times.length === 0) continue;
    const anchor = localMidnightDayNumber(new Date(checkIn.createdAt));
    const step = Math.max(1, checkIn.schedule.everyNDays);

    for (let offset = 0; offset < horizonDays; offset += 1) {
      const day = new Date(base);
      day.setDate(day.getDate() + offset);
      if (!checkIn.schedule.weekdays.includes(day.getDay())) continue;
      if ((localMidnightDayNumber(day) - anchor) % step !== 0) continue;

      for (const time of checkIn.schedule.times) {
        const { h, m } = parseTime(time);
        let fire = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
        fire = applyQuietHours(state.settings.quietHours, fire);
        if (fire.getTime() <= now) continue;
        const dateKey = localDateKey(fire);
        const key = `${checkIn.id}::${dateKey}::${String(fire.getHours()).padStart(2, '0')}:${String(
          fire.getMinutes()
        ).padStart(2, '0')}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ checkInId: checkIn.id, occurrenceKey: key, fireAt: fire.getTime(), dateKey });
      }
    }
  }

  out.sort((a, b) => a.fireAt - b.fireAt);
  return out;
}

export interface DesiredSelfCareNotification extends SelfCareOccurrence {
  id: string;
  title: string;
  body: string;
}

export function notificationIdFor(checkInId: string, occurrenceKey: string): string {
  return `${SELF_CARE_NOTIFICATION_PREFIX}${occurrenceKey}`;
}

export function buildDesiredNotifications(
  state: SelfCareState,
  occurrences: SelfCareOccurrence[]
): { desired: DesiredSelfCareNotification[]; droppedByLimit: number } {
  const byDay = new Map<string, SelfCareOccurrence[]>();
  for (const occ of occurrences) {
    const list = byDay.get(occ.dateKey) ?? [];
    list.push(occ);
    byDay.set(occ.dateKey, list);
  }
  const desired: DesiredSelfCareNotification[] = [];
  let droppedByLimit = 0;
  const checkInById = new Map(state.checkIns.map((c) => [c.id, c]));

  for (const list of byDay.values()) {
    const kept = list.slice(0, Math.max(1, state.settings.maxPerDay));
    droppedByLimit += list.length - kept.length;
    for (const occ of kept) {
      const checkIn = checkInById.get(occ.checkInId);
      if (!checkIn) continue;
      const body = state.settings.privateLockScreen
        ? SELF_CARE_GENERIC_BODY
        : pickVariant(checkIn, hashKey(occ.occurrenceKey));
      desired.push({
        ...occ,
        id: notificationIdFor(occ.checkInId, occ.occurrenceKey),
        title: `${checkInDisplayLabel(checkIn)} 💛`,
        body,
      });
    }
  }
  desired.sort((a, b) => a.fireAt - b.fireAt);
  return { desired, droppedByLimit };
}

// ---------------------------------------------------------------------------
// Reconciliation against the native scheduler
// ---------------------------------------------------------------------------

export interface SelfCareReconcileResult {
  scheduled: string[];
  cancelled: string[];
  missedRecorded: number;
  droppedByLimit: number;
  nativeAvailable: boolean;
  error?: string;
}

function nativeOptions(): string {
  return JSON.stringify({
    sound: true,
    vibration: true,
    kind: 'self-care',
    actionKind: 'reminder',
    priority: 'high',
    actions: ['complete', 'snooze', 'skip', 'open'],
  });
}

/**
 * Reconciles Self Care alarms: cancels obsolete native alarms, records
 * silently-missed occurrences (scheduled but unanswered past the grace
 * window — no flood), and schedules upcoming occurrences within the daily
 * limit. Returns counts only; message text never leaves this module.
 */
export function reconcileSelfCare(
  now: number = Date.now(),
  horizonDays: number = SELF_CARE_SCHEDULE_HORIZON_DAYS
): SelfCareReconcileResult {
  const state = loadSelfCareState();
  const occurrences = computeOccurrences(state, now, horizonDays);
  const { desired, droppedByLimit } = buildDesiredNotifications(state, occurrences);
  const desiredIds = new Set(desired.map((d) => d.id));

  const bridge = getNativeBridge();
  const cancelled: string[] = [];
  const scheduled: string[] = [];

  // Missed: previously scheduled, fired past the grace window, never answered.
  // Superseded future occurrences are cancelled silently — never logged as
  // missed — so editing a schedule can never rewrite history with guilt.
  const answeredKeys = new Set(state.history.map((h) => h.occurrenceKey));
  let missedRecorded = 0;
  const missedEntries: SelfCareHistoryEntry[] = [];
  if (bridge) {
    for (const id of state.scheduledIds) {
      if (desiredIds.has(id)) continue;
      // The alarm is gone from the desired set: either fired or superseded.
      const occKey = id.slice(SELF_CARE_NOTIFICATION_PREFIX.length);
      if (!occKey || answeredKeys.has(occKey)) continue;
      const parts = occKey.split('::');
      const checkInId = parts[0] ?? '';
      try {
        bridge.cancel(id);
      } catch {
        /* cancelling a missing alarm is harmless */
      }
      cancelled.push(id);
      const firedAt = fireTimeOfOccurrenceKey(occKey);
      if (firedAt !== null && now - firedAt > SELF_CARE_MISSED_GRACE_MINUTES * 60_000) {
        missedEntries.push({
          id: `hist-${now}-${missedRecorded}`,
          checkInId,
          occurrenceKey: occKey,
          result: 'missed',
          at: new Date(now).toISOString(),
        });
        missedRecorded += 1;
      }
    }
  } else {
    // No native bridge (browser preview): drop stale ids without history spam.
    for (const id of state.scheduledIds) {
      if (!desiredIds.has(id)) cancelled.push(id);
    }
  }

  if (bridge) {
    for (const item of desired) {
      if (state.scheduledIds.includes(item.id)) continue;
      try {
        const ok = bridge.schedule(item.id, item.title, item.body, item.fireAt, nativeOptions());
        if (ok) scheduled.push(item.id);
      } catch {
        /* a rejected schedule is retried on the next reconcile */
      }
    }
    // Cancel desired ids the bridge rejected previously? No — keep them listed
    // so the next reconcile retries; only successfully scheduled ids persist.
  }

  const nextScheduled = [...new Set([...state.scheduledIds.filter((id) => desiredIds.has(id)), ...scheduled])];
  saveSelfCareState({
    ...state,
    history: [...state.history, ...missedEntries].slice(-500),
    scheduledIds: nextScheduled,
  });

  logger.info('SelfCare', 'Reconciled Self Care schedules', {
    scheduled: scheduled.length,
    cancelled: cancelled.length,
    missedRecorded,
    droppedByLimit,
    nativeAvailable: Boolean(bridge),
    reason: 'reconcile',
  });

  return {
    scheduled: nextScheduled,
    cancelled,
    missedRecorded,
    droppedByLimit,
    nativeAvailable: Boolean(bridge),
  };
}

/** Cancels every Self Care native alarm in scope. Data is retained. */
export function cancelAllSelfCareAlarms(): string[] {
  const state = loadSelfCareState();
  const bridge = getNativeBridge();
  const cancelled: string[] = [];
  if (bridge) {
    for (const id of state.scheduledIds) {
      try {
        bridge.cancel(id);
        cancelled.push(id);
      } catch {
        /* ignore */
      }
    }
  }
  saveSelfCareState({ ...state, scheduledIds: [] });
  return cancelled;
}

// ---------------------------------------------------------------------------
// Notification actions: Done / Snooze / Skip / Open
// ---------------------------------------------------------------------------

export function parseSelfCareNotificationId(id: string): { checkInId: string; occurrenceKey: string } | null {
  if (!id.startsWith(SELF_CARE_NOTIFICATION_PREFIX)) return null;
  const occurrenceKey = id.slice(SELF_CARE_NOTIFICATION_PREFIX.length);
  const checkInId = occurrenceKey.split('::')[0] ?? '';
  if (!checkInId) return null;
  return { checkInId, occurrenceKey };
}

function recordHistory(
  state: SelfCareState,
  checkInId: string,
  occurrenceKey: string,
  result: SelfCareHistoryResult
): SelfCareState {
  return {
    ...state,
    history: [
      ...state.history,
      {
        id: `hist-${Date.now()}-${state.history.length}`,
        checkInId,
        occurrenceKey,
        result,
        at: new Date().toISOString(),
      },
    ].slice(-500),
  };
}

/**
 * Applies a notification action tapped on the device. Returns true when the
 * action belonged to Self Care and was handled.
 */
export function handleSelfCareAction(id: string, action: string): boolean {
  const parsed = parseSelfCareNotificationId(id);
  if (!parsed) return false;
  let state = loadSelfCareState();
  const checkIn = state.checkIns.find((c) => c.id === parsed.checkInId);
  if (!checkIn) return false;

  const bridge = getNativeBridge();
  try {
    bridge?.cancel(id);
  } catch {
    /* ignore */
  }
  state = {
    ...state,
    scheduledIds: state.scheduledIds.filter((scheduledId) => scheduledId !== id),
  };

  if (action === 'snooze') {
    const target = applyQuietHours(
      state.settings.quietHours,
      new Date(Date.now() + checkIn.snoozeMinutes * 60_000)
    );
    const snoozeKey = `${checkIn.id}::snooze::${target.getTime()}`;
    const snoozeId = notificationIdFor(checkIn.id, snoozeKey);
    const body = state.settings.privateLockScreen
      ? SELF_CARE_GENERIC_BODY
      : pickVariant(checkIn, hashKey(snoozeKey));
    try {
      bridge?.schedule(snoozeId, `${checkInDisplayLabel(checkIn)} 💛`, body, target.getTime(), nativeOptions());
      state = { ...state, scheduledIds: [...state.scheduledIds, snoozeId] };
    } catch {
      /* retry on next reconcile */
    }
    state = recordHistory(state, checkIn.id, parsed.occurrenceKey, 'snoozed');
  } else if (action === 'complete') {
    state = recordHistory(state, checkIn.id, parsed.occurrenceKey, 'done');
  } else if (action === 'skip') {
    // Neutral skip: no guilt, no follow-up, just a quiet log entry.
    state = recordHistory(state, checkIn.id, parsed.occurrenceKey, 'skipped');
  } else {
    state = recordHistory(state, checkIn.id, parsed.occurrenceKey, 'opened');
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(SELF_CARE_NAVIGATE_EVENT));
    }
  }

  saveSelfCareState(state);
  logger.info('SelfCare', 'Handled Self Care notification action', {
    checkInId: checkIn.id,
    action,
  });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(SELF_CARE_CHANGED_EVENT));
  }
  return true;
}

/**
 * Listens for device notification actions routed through the
 * `mindmesh-selfcare-action` event. Replays anything queued before attach.
 */
export function attachSelfCareActionListener(): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const drain = () => {
    const queued = window.MindMeshSelfCareActionQueue ?? [];
    window.MindMeshSelfCareActionQueue = [];
    for (const item of queued) handleSelfCareAction(item.id, item.action);
  };
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<{ id: string; action: string }>).detail;
    if (detail) handleSelfCareAction(detail.id, detail.action);
  };
  drain();
  window.addEventListener(SELF_CARE_ACTION_EVENT, onEvent);
  return () => window.removeEventListener(SELF_CARE_ACTION_EVENT, onEvent);
}

// ---------------------------------------------------------------------------
// Diagnostics (counts only — never message text)
// ---------------------------------------------------------------------------

export interface SelfCareDiagnostics {
  checkIns: number;
  enabledCheckIns: number;
  scheduled: number;
  historyEntries: number;
  doneCount: number;
  skippedCount: number;
  nativeAvailable: boolean;
}

export function selfCareDiagnostics(state: SelfCareState): SelfCareDiagnostics {
  return {
    checkIns: state.checkIns.length,
    enabledCheckIns: state.checkIns.filter((c) => c.enabled && !c.paused).length,
    scheduled: state.scheduledIds.length,
    historyEntries: state.history.length,
    doneCount: state.history.filter((h) => h.result === 'done').length,
    skippedCount: state.history.filter((h) => h.result === 'skipped').length,
    nativeAvailable: getNativeBridge() !== null,
  };
}

export type { SelfCareCheckIn, SelfCareSettings, SelfCareState };
