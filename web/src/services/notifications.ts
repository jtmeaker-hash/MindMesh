import { Reminder } from '../types';
import {
  ADVANCE_PRESETS,
  AppNotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationHistoryEntry,
  NotificationPermissionState,
  NotificationPlatform,
  formatAdvanceLabel,
  getReminderAdvanceMinutes,
  getReminderSnoozeMinutes,
  normalizeNotificationHistory,
} from '../types/notifications';
import { logger } from './logger';

/**
 * Reminder notification engine.
 *
 * Design notes / honest platform limits:
 * - Android native (`android-native`): scheduling is handed to the OS through the
 *   WebView JS bridge, so notifications fire even when the app is closed and
 *   survive restarts. Notification actions and "open reminder" are supported here.
 * - Browser / PWA (`browser`): the Web Notification API is used and delivery happens
 *   while the MindMesh page is open. There is no reliable cross-browser background
 *   scheduling API, so we never claim background delivery — instead we catch up on
 *   any notifications that came due while the page was closed.
 * - Unsupported environments (e.g. an Android WebView build with no bridge) report
 *   `supported: false` and explain what is missing rather than failing silently.
 *
 * No timer is started until the engine is configured, and the whole engine lives
 * outside React so scheduling never triggers component re-renders.
 */

const SWEEP_INTERVAL_MS = 20_000;
const PERMISSION_TIMEOUT_MS = 15_000;

export interface NativeNotificationBridge {
  isSupported(): boolean;
  getPermissionState(): string;
  requestPermission(): void;
  schedule(
    id: string,
    title: string,
    body: string,
    triggerAtMillis: number,
    optionsJson: string
  ): boolean;
  cancel(id: string): void;
  cancelAll(): void;
  getScheduledCount(): number;
  openNotificationSettings(): void;
}

/**
 * Native code cannot assign properties onto the injected JS object, so events flow
 * the other way: Java calls into this global object, which the web layer installs.
 */
export interface NativeNotificationEvents {
  onPermissionResult?: (state: string) => void;
  onDelivered?: (id: string) => void;
  onAction?: (id: string, action: string) => void;
  onOpened?: (id: string) => void;
}

declare global {
  interface Window {
    MindMeshNotifications?: NativeNotificationBridge;
    MindMeshNativeNotificationEvents?: NativeNotificationEvents;
  }
}

export interface NotificationEnvironment {
  platform: NotificationPlatform;
  supported: boolean;
  /** True only where the OS can deliver notifications with the app closed. */
  backgroundSupported: boolean;
  permission: NotificationPermissionState;
  serviceWorkerSupported: boolean;
  serviceWorkerActive: boolean;
  schedulingMode: 'native-alarm' | 'js-timer' | 'none';
  /** Human-readable reason when notifications are unavailable. */
  reason?: string;
  /** Where the user must go to change permissions. */
  settingsHint?: string;
}

export interface NotificationEngineState extends NotificationEnvironment {
  pendingCount: number;
  nextFireAt?: string;
  lastScheduledAt?: string;
  lastFiredAt?: string;
  lastError?: string;
  lastPermissionError?: string;
}

export interface PlannedNotification {
  id: string;
  reminderId: string;
  reminderTitle: string;
  /** Notification body is derived at delivery time from the reminder + offset. */
  offsetMinutes: number;
  fireAt: number;
  /** ISO due date/time key — changes when a recurring reminder rolls forward. */
  dueKey: string;
  snoozed: boolean;
}

export interface ReconcileContext {
  reminders: Reminder[];
  settings: AppNotificationSettings;
  permission: NotificationPermissionState;
  now?: number;
}

export interface ReconcileResult {
  /** Newest-first history, bounded by the retention limit. */
  history: NotificationHistoryEntry[];
  /** Pending entries that must be registered for future delivery. */
  toSchedule: PlannedNotification[];
  /** Pending entries whose time has arrived and should fire now. */
  toDeliver: PlannedNotification[];
  /** Pending/snoozed entries that should be cancelled (superseded or removed). */
  toCancel: string[];
  /** Pending entries that expired past the grace window. */
  toMiss: string[];
  /** True when at least one entry was mutated. */
  changed: boolean;
}

interface EngineCallbacks {
  reminders: Reminder[];
  settings: AppNotificationSettings;
  history: NotificationHistoryEntry[];
  onHistoryChange: (history: NotificationHistoryEntry[]) => void;
  onOpenReminder?: (reminderId: string) => void;
  onCompleteReminder?: (reminderId: string) => void;
  onActionError?: (message: string) => void;
}

let environment: NotificationEnvironment = {
  platform: 'unknown',
  supported: false,
  backgroundSupported: false,
  permission: 'unsupported',
  serviceWorkerSupported: false,
  serviceWorkerActive: false,
  schedulingMode: 'none',
};

let engineState: NotificationEngineState = { ...environment, pendingCount: 0 };

let callbacks: EngineCallbacks | null = null;
let sweepTimer: ReturnType<typeof setInterval> | null = null;
let permissionResolver: ((state: NotificationPermissionState) => void) | null = null;
let lastHistorySignature = '';
/** Entries already handed to the platform, so the sweep never re-registers them. */
const registeredIds = new Set<string>();
const engineListeners = new Set<(state: NotificationEngineState) => void>();

/** Normalises whatever the platform reports into our permission vocabulary. */
function toPermissionState(value: unknown): NotificationPermissionState {
  const raw = String(value ?? '').toLowerCase();
  if (raw === 'granted' || raw === 'authorized') return 'granted';
  if (raw === 'denied' || raw === 'blocked') return 'denied';
  if (raw === 'default' || raw === 'prompt' || raw === 'prompt_with_rationale') return 'default';
  return 'unsupported';
}

export function getNativeBridge(): NativeNotificationBridge | null {
  if (typeof window === 'undefined') return null;
  try {
    const bridge = window.MindMeshNotifications;
    if (bridge && typeof bridge.isSupported === 'function') {
      return bridge;
    }
  } catch {
    // Bridge access can throw in exotic webviews.
  }
  return null;
}

export function detectNotificationEnvironment(): NotificationEnvironment {
  const hasWindow = typeof window !== 'undefined';
  const bridge = getNativeBridge();
  const swSupported = typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
  const swActive = swSupported ? Boolean(navigator.serviceWorker?.controller) : false;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isAndroid = /Android/i.test(ua);
  const isWebView = isAndroid && (/;\s*wv\)/i.test(ua) || /Version\/\d+\.\d+/.test(ua) === false);

  let webPermission: NotificationPermissionState = 'unsupported';
  const hasWebNotifications = hasWindow && 'Notification' in window;
  if (hasWebNotifications) {
    try {
      webPermission = toPermissionState(Notification.permission);
    } catch {
      webPermission = 'unsupported';
    }
  }

  // 1. Native Android bridge: the only path that can deliver in the background.
  if (bridge) {
    let supported: boolean;
    let permission: NotificationPermissionState = 'default';
    try {
      supported = bridge.isSupported() === true;
      permission = toPermissionState(bridge.getPermissionState());
    } catch {
      supported = false;
    }
    if (supported) {
      return {
        platform: 'android-native',
        supported: true,
        backgroundSupported: true,
        permission,
        serviceWorkerSupported: swSupported,
        serviceWorkerActive: swActive,
        schedulingMode: 'native-alarm',
        settingsHint: 'Open your device notification settings and allow MindMesh notifications.',
      };
    }
  }

  // 2. Browser / PWA notifications (foreground delivery while MindMesh is open).
  if (hasWebNotifications) {
    return {
      platform: 'browser',
      supported: true,
      backgroundSupported: false,
      permission: webPermission,
      serviceWorkerSupported: swSupported,
      serviceWorkerActive: swActive,
      schedulingMode: 'js-timer',
      reason: 'Notifications are delivered while MindMesh is open in this browser.',
      settingsHint: 'Use your browser site settings to allow notifications for this page.',
    };
  }

  // 3. Android WebView without the native bridge.
  if (isAndroid || isWebView) {
    return {
      platform: 'android-webview',
      supported: false,
      backgroundSupported: false,
      permission: 'unsupported',
      serviceWorkerSupported: swSupported,
      serviceWorkerActive: swActive,
      schedulingMode: 'none',
      reason:
        'This Android build does not expose a notification bridge, so scheduled reminders cannot fire yet.',
      settingsHint: 'Update MindMesh to a build that includes native notification support.',
    };
  }

  return {
    platform: 'unknown',
    supported: false,
    backgroundSupported: false,
    permission: 'unsupported',
    serviceWorkerSupported: swSupported,
    serviceWorkerActive: swActive,
    schedulingMode: 'none',
    reason: 'This environment does not provide a notification API.',
  };
}

function publish(): void {
  const pending = engineState.pendingCount;
  engineState = { ...engineState, ...environment, pendingCount: pending };
  for (const listener of engineListeners) {
    try {
      listener(engineState);
    } catch {
      // Subscribers must not break the engine.
    }
  }
}

export function initNotificationEnvironment(): NotificationEnvironment {
  environment = detectNotificationEnvironment();
  engineState = { ...engineState, ...environment };
  publish();
  logger.info('Notifications', 'Notification environment resolved', {
    platform: environment.platform,
    supported: environment.supported,
    backgroundSupported: environment.backgroundSupported,
    permission: environment.permission,
  });
  return environment;
}

export function getNotificationEnvironment(): NotificationEnvironment {
  return environment;
}

export function getNotificationEngineState(): NotificationEngineState {
  return engineState;
}

export function subscribeNotificationEngine(listener: (state: NotificationEngineState) => void): () => void {
  engineListeners.add(listener);
  listener(engineState);
  return () => {
    engineListeners.delete(listener);
  };
}

function updateEngineState(patch: Partial<NotificationEngineState>): void {
  engineState = { ...engineState, ...patch };
  publish();
}

/** Parses a reminder's due date + time into an epoch timestamp (local time). */
export function getReminderDueTimestamp(reminder: Pick<Reminder, 'dueDate' | 'dueTime'>): number | null {
  if (!reminder.dueDate) return null;
  const parts = reminder.dueDate.split('-');
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]) - 1;
  const day = Number(parts[2]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

  let hours = 9;
  let minutes = 0;
  if (reminder.dueTime) {
    const timeParts = reminder.dueTime.split(':');
    const h = Number(timeParts[0]);
    const m = Number(timeParts[1] ?? 0);
    if (Number.isFinite(h)) hours = h;
    if (Number.isFinite(m)) minutes = m;
  }

  const date = new Date(year, month, day, hours, minutes, 0, 0);
  const time = date.getTime();
  return Number.isNaN(time) ? null : time;
}

/** Stable key identifying one occurrence of a reminder. */
export function getReminderDueKey(reminder: Pick<Reminder, 'dueDate' | 'dueTime'>): string {
  return `${reminder.dueDate ?? 'none'}T${reminder.dueTime ?? '09:00'}`;
}

export function buildNotificationEntryId(reminderId: string, dueKey: string, offsetMinutes: number): string {
  return `${reminderId}::${dueKey}::${offsetMinutes}`;
}

/** Advance selections offered in the reminder editor (kept in sync with the presets). */
export function getAdvanceOptions(): number[] {
  return ADVANCE_PRESETS.map((preset) => preset.minutes);
}

export function buildNotificationBody(reminder: Reminder, offsetMinutes: number): string {
  const when = reminder.dueTime ? `due ${reminder.dueTime}` : reminder.dueDate ? `due ${reminder.dueDate}` : 'due now';
  if (offsetMinutes <= 0) return `${reminder.title} is ${when}.`;
  return `${reminder.title} is ${when} — ${formatAdvanceLabel(offsetMinutes)}.`;
}

interface DesiredEntry {
  reminder: Reminder;
  id: string;
  offsetMinutes: number;
  fireAt: number;
  dueKey: string;
}

/** Builds the complete set of notifications that *should* exist right now. */
export function buildDesiredNotifications(
  reminders: Reminder[],
  settings: AppNotificationSettings
): DesiredEntry[] {
  const desired: DesiredEntry[] = [];
  if (!settings.enabled) return desired;

  for (const reminder of reminders) {
    if (!reminder.notifications?.enabled) continue;
    if (reminder.completed && !settings.showCompletedNotifications) continue;

    const dueAt = getReminderDueTimestamp(reminder);
    if (dueAt === null) continue;

    const dueKey = getReminderDueKey(reminder);
    const offsets = new Set<number>(getReminderAdvanceMinutes(reminder, settings));
    if (reminder.notifications.notifyAtDueTime) offsets.add(0);

    for (const offsetMinutes of offsets) {
      desired.push({
        reminder,
        id: buildNotificationEntryId(reminder.id, dueKey, offsetMinutes),
        offsetMinutes,
        fireAt: dueAt - offsetMinutes * 60_000,
        dueKey,
      });
    }
  }

  return desired;
}

function signatureOf(history: NotificationHistoryEntry[]): string {
  return history
    .map((entry) => `${entry.id}|${entry.status}|${entry.firedAt ?? ''}|${entry.snoozedUntil ?? ''}|${entry.error ?? ''}`)
    .join('\n');
}

/**
 * Pure reconciliation: given the current reminders, settings, permission and
 * history, work out what should be scheduled, delivered, cancelled or missed.
 * Keeping this pure makes the whole scheduling contract unit-testable.
 */
export function reconcileNotifications(
  history: NotificationHistoryEntry[],
  context: ReconcileContext
): ReconcileResult {
  const now = context.now ?? Date.now();
  const graceMs = Math.max(0, context.settings.missedGraceMinutes) * 60_000;
  const existing = new Map(history.map((entry) => [entry.id, entry]));
  const desired = buildDesiredNotifications(context.reminders, context.settings);
  const desiredIds = new Set(desired.map((item) => item.id));

  const next: NotificationHistoryEntry[] = [];
  const toSchedule: PlannedNotification[] = [];
  const toDeliver: PlannedNotification[] = [];
  const toCancel: string[] = [];
  const toMiss: string[] = [];
  let changed = false;

  const canDeliver = context.permission === 'granted';
  const permissionError = canDeliver
    ? undefined
    : context.permission === 'denied'
      ? 'Notification permission was denied.'
      : context.permission === 'unsupported'
        ? 'Notifications are not available in this environment.'
        : 'Notification permission has not been granted yet.';

  for (const item of desired) {
    const prior = existing.get(item.id);
    const snoozedUntil = prior?.snoozedUntil ? Date.parse(prior.snoozedUntil) : NaN;
    const isSnoozed = prior?.status === 'snoozed' && Number.isFinite(snoozedUntil);

    if (prior && (prior.status === 'fired' || prior.status === 'missed')) {
      next.push(prior);
      continue;
    }

    const effectiveFireAt = isSnoozed ? snoozedUntil : item.fireAt;

    // Cancelled/failed entries come back to life only if their time has not passed.
    if (effectiveFireAt > now) {
      const entry: NotificationHistoryEntry = {
        id: item.id,
        reminderId: item.reminder.id,
        reminderTitle: item.reminder.title,
        scheduledFor: new Date(effectiveFireAt).toISOString(),
        offsetMinutes: item.offsetMinutes,
        status: isSnoozed ? 'snoozed' : 'pending',
        ...(isSnoozed && prior?.snoozedUntil ? { snoozedUntil: prior.snoozedUntil } : {}),
        ...(permissionError ? { error: permissionError } : {}),
      };
      next.push(entry);
      toSchedule.push({
        id: item.id,
        reminderId: item.reminder.id,
        reminderTitle: item.reminder.title,
        offsetMinutes: item.offsetMinutes,
        fireAt: effectiveFireAt,
        dueKey: item.dueKey,
        snoozed: isSnoozed,
      });
      if (!sameEntry(prior, entry)) changed = true;
      continue;
    }

    // Due (or overdue) now.
    if (now - effectiveFireAt <= graceMs) {
      if (!canDeliver) {
        const entry: NotificationHistoryEntry = {
          id: item.id,
          reminderId: item.reminder.id,
          reminderTitle: item.reminder.title,
          scheduledFor: new Date(effectiveFireAt).toISOString(),
          offsetMinutes: item.offsetMinutes,
          status: 'pending',
          ...(permissionError ? { error: permissionError } : {}),
        };
        next.push(entry);
        toDeliver.push({
          id: item.id,
          reminderId: item.reminder.id,
          reminderTitle: item.reminder.title,
          offsetMinutes: item.offsetMinutes,
          fireAt: effectiveFireAt,
          dueKey: item.dueKey,
          snoozed: isSnoozed,
        });
        if (!sameEntry(prior, entry)) changed = true;
        continue;
      }

      const entry: NotificationHistoryEntry = {
        id: item.id,
        reminderId: item.reminder.id,
        reminderTitle: item.reminder.title,
        scheduledFor: new Date(effectiveFireAt).toISOString(),
        offsetMinutes: item.offsetMinutes,
        status: 'pending',
      };
      next.push(entry);
      toDeliver.push({
        id: item.id,
        reminderId: item.reminder.id,
        reminderTitle: item.reminder.title,
        offsetMinutes: item.offsetMinutes,
        fireAt: effectiveFireAt,
        dueKey: item.dueKey,
        snoozed: isSnoozed,
      });
      if (!sameEntry(prior, entry)) changed = true;
      continue;
    }

    // Past the grace window: record it as missed so the user can see what slipped.
    const missed: NotificationHistoryEntry = {
      id: item.id,
      reminderId: item.reminder.id,
      reminderTitle: item.reminder.title,
      scheduledFor: new Date(effectiveFireAt).toISOString(),
      offsetMinutes: item.offsetMinutes,
      status: 'missed',
    };
    next.push(missed);
    toMiss.push(item.id);
    if (!sameEntry(prior, missed)) changed = true;
  }

  // Anything still pending/snoozed that is no longer desired has been cancelled
  // (reminder deleted, completed, paused, rescheduled or notifications switched off).
  for (const entry of history) {
    if (desiredIds.has(entry.id)) continue;
    if (entry.status === 'pending' || entry.status === 'snoozed') {
      toCancel.push(entry.id);
      changed = true;
      continue;
    }
    // Superseded entries are dropped, but what actually fired or was missed is kept
    // so notification history stays useful without growing without limit.
    if (entry.status === 'cancelled') continue;
    next.push(entry);
  }

  const summarized = normalizeNotificationHistory(next, context.settings.historyLimit);

  return {
    history: summarized,
    toSchedule,
    toDeliver,
    toCancel,
    toMiss,
    changed: changed || signatureOf(summarized) !== signatureOf(history),
  };
}

function sameEntry(a: NotificationHistoryEntry | undefined, b: NotificationHistoryEntry): boolean {
  if (!a) return false;
  return (
    a.status === b.status &&
    a.scheduledFor === b.scheduledFor &&
    (a.firedAt ?? '') === (b.firedAt ?? '') &&
    (a.snoozedUntil ?? '') === (b.snoozedUntil ?? '') &&
    (a.error ?? '') === (b.error ?? '') &&
    a.reminderTitle === b.reminderTitle
  );
}

function buildNativeOptions(): string {
  return JSON.stringify({
    actions: ['complete', 'snooze', 'open'],
    sound: callbacks?.settings.sound ?? true,
    vibration: callbacks?.settings.vibration ?? true,
    channel: 'mindmesh-reminders',
  });
}

/** Registers a future notification with whichever platform can actually deliver it. */
function registerScheduled(item: PlannedNotification): { ok: boolean; error?: string } {
  if (environment.schedulingMode === 'native-alarm') {
    const bridge = getNativeBridge();
    if (!bridge) return { ok: false, error: 'Native notification bridge unavailable.' };
    try {
      const ok = bridge.schedule(
        item.id,
        item.reminderTitle,
        `${formatAdvanceLabel(item.offsetMinutes)}`,
        item.fireAt,
        buildNativeOptions()
      );
      return ok ? { ok: true } : { ok: false, error: 'Android rejected the notification schedule.' };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Native scheduling failed.' };
    }
  }
  // js-timer mode needs no registration: the sweep delivers when due.
  return { ok: true };
}

function cancelScheduled(id: string): void {
  if (environment.schedulingMode !== 'native-alarm') return;
  const bridge = getNativeBridge();
  try {
    bridge?.cancel(id);
  } catch {
    // Cancelling a missing alarm is harmless.
  }
}

/** Shows the notification through the Web Notification API. */
function deliverViaWebApi(item: PlannedNotification): { ok: boolean; error?: string } {
  const reminder = callbacks?.reminders.find((r) => r.id === item.reminderId);
  if (!reminder) return { ok: false, error: 'Reminder no longer exists.' };

  try {
    const notification = new Notification(reminder.title, {
      body: buildNotificationBody(reminder, item.offsetMinutes),
      tag: item.id,
      silent: !(callbacks?.settings.sound ?? true),
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // focus() can be blocked; ignore.
      }
      callbacks?.onOpenReminder?.(item.reminderId);
      notification.close();
    };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Could not display notification.' };
  }
}

function permissionFailureMessage(): string {
  if (environment.permission === 'denied') {
    return 'Notifications are blocked. ' + (environment.settingsHint || 'Enable them in your device settings.');
  }
  if (environment.permission === 'unsupported') {
    return environment.reason || 'Notifications are not available in this environment.';
  }
  return 'Notification permission has not been granted yet.';
}

function applyReconcileResult(result: ReconcileResult): void {
  if (!callbacks) return;

  for (const id of result.toCancel) {
    cancelScheduled(id);
    registeredIds.delete(id);
  }

  const canAttempt = environment.supported && environment.permission === 'granted';
  const deliveryFailures = new Map<string, string>();
  const deliveredIds = new Set<string>();
  let lastError: string | undefined;
  let lastScheduledAt: string | undefined;
  let lastFiredAt: string | undefined;

  for (const item of result.toSchedule) {
    if (!canAttempt) {
      // Not a platform failure: the reminder simply cannot be scheduled yet.
      lastError = permissionFailureMessage();
      continue;
    }
    // Already registered and unchanged: skip the redundant platform call.
    if (registeredIds.has(item.id)) continue;

    // Registration failures are retried by the next sweep, so they only raise a
    // transient error rather than poisoning the entry's history state.
    const outcome = registerScheduled(item);
    if (!outcome.ok) lastError = outcome.error;
    else {
      registeredIds.add(item.id);
      lastScheduledAt = new Date().toISOString();
    }
  }

  for (const item of result.toDeliver) {
    if (!canAttempt) {
      lastError = permissionFailureMessage();
      continue;
    }

    if (environment.schedulingMode === 'native-alarm') {
      // The OS owns delivery; a successful registration means it has been handed off.
      const outcome = registeredIds.has(item.id) ? { ok: true } : registerScheduled(item);
      if (!outcome.ok) {
        deliveryFailures.set(item.id, outcome.error || 'Android rejected the notification.');
      } else {
        registeredIds.add(item.id);
        deliveredIds.add(item.id);
      }
      continue;
    }

    const outcome = deliverViaWebApi(item);
    if (!outcome.ok) deliveryFailures.set(item.id, outcome.error || 'Notification delivery failed.');
    else deliveredIds.add(item.id);
  }

  if (deliveredIds.size > 0) lastFiredAt = new Date().toISOString();

  let history = result.history;
  if (deliveryFailures.size > 0 || deliveredIds.size > 0) {
    const nowIso = new Date().toISOString();
    history = result.history.map((entry) => {
      const failure = deliveryFailures.get(entry.id);
      if (failure) return { ...entry, status: 'failed' as const, error: failure };
      if (deliveredIds.has(entry.id) && entry.status !== 'fired') {
        return { ...entry, status: 'fired' as const, firedAt: nowIso, error: undefined };
      }
      return entry;
    });
  }

  const pending = history.filter((entry) => entry.status === 'pending' || entry.status === 'snoozed');
  const nextFireAt = pending
    .map((entry) => entry.scheduledFor)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];

  updateEngineState({
    pendingCount: pending.length,
    ...(nextFireAt ? { nextFireAt } : {}),
    ...(lastScheduledAt ? { lastScheduledAt } : {}),
    ...(lastFiredAt ? { lastFiredAt } : {}),
    lastError,
    permission: environment.permission,
  });

  // Compare by content, never by array identity: publishing an equivalent array would
  // push a new value into React state and re-run the sync effect forever.
  const changed = result.changed || signatureOf(history) !== signatureOf(result.history);
  if (changed) {
    lastHistorySignature = signatureOf(history);
    callbacks.history = history;
    callbacks.onHistoryChange(history);
  } else {
    callbacks.history = history;
  }
}

/** Runs one reconciliation pass against the latest configured state. */
export function syncNotificationSchedules(force = false): ReconcileResult | null {
  if (!callbacks) return null;
  // Refresh permission/platform each pass: the user may have changed it in settings.
  const previousPermission = environment.permission;
  const previousPlatform = environment.platform;
  environment = detectNotificationEnvironment();
  if (previousPermission !== environment.permission || previousPlatform !== environment.platform) {
    logger.info('Notifications', 'Notification environment changed', {
      permission: environment.permission,
      platform: environment.platform,
    });
  }

  try {
    const result = reconcileNotifications(callbacks.history, {
      reminders: callbacks.reminders,
      settings: callbacks.settings,
      permission: environment.permission,
    });

    const signature = signatureOf(result.history);
    if (!force && !result.changed && signature === lastHistorySignature) {
      updateEngineState({
        pendingCount: result.history.filter((e) => e.status === 'pending' || e.status === 'snoozed').length,
        permission: environment.permission,
      });
      return result;
    }

    applyReconcileResult(result);
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Notification scheduling failed.';
    logger.error('Notifications', 'Notification reconciliation failed', err);
    updateEngineState({ lastError: message });
    callbacks.onActionError?.(message);
    return null;
  }
}

export function configureNotificationEngine(next: EngineCallbacks): void {
  callbacks = next;
  if (!sweepTimer && typeof window !== 'undefined') {
    sweepTimer = setInterval(() => {
      syncNotificationSchedules();
    }, SWEEP_INTERVAL_MS);
  }
  syncNotificationSchedules(true);
}

export function teardownNotificationEngine(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
  callbacks = null;
}

function clampHistory(entries: NotificationHistoryEntry[], settings: AppNotificationSettings): NotificationHistoryEntry[] {
  return normalizeNotificationHistory(entries, settings.historyLimit);
}

export function snoozeNotification(entryId: string, minutes?: number): boolean {
  if (!callbacks) return false;
  const entry = callbacks.history.find((item) => item.id === entryId);
  if (!entry) return false;

  const reminder = callbacks.reminders.find((r) => r.id === entry.reminderId);
  const duration =
    minutes ?? (reminder ? getReminderSnoozeMinutes(reminder, callbacks.settings) : callbacks.settings.defaultSnoozeMinutes);
  const snoozedUntil = new Date(Date.now() + Math.max(1, duration) * 60_000).toISOString();

  const next = clampHistory(
    callbacks.history.map((item) =>
      item.id === entryId
        ? { ...item, status: 'snoozed' as const, snoozedUntil, firedAt: undefined, error: undefined }
        : item
    ),
    callbacks.settings
  );

  // The snooze target moved, so the platform registration must be refreshed.
  registeredIds.delete(entryId);

  logger.info('Notifications', 'Notification snoozed', { entryId, minutes: duration });
  lastHistorySignature = signatureOf(next);
  callbacks.history = next;
  callbacks.onHistoryChange(next);
  syncNotificationSchedules(true);
  return true;
}

/** Snoozes the most recent notification belonging to a reminder. */
export function snoozeReminderNotification(reminderId: string, minutes?: number): boolean {
  if (!callbacks) return false;
  const candidate = callbacks.history.find(
    (entry) => entry.reminderId === reminderId && (entry.status === 'fired' || entry.status === 'pending')
  );
  if (!candidate) return false;
  return snoozeNotification(candidate.id, minutes);
}

export function cancelReminderNotifications(reminderId: string): void {
  if (!callbacks) return;
  const affected = callbacks.history.filter(
    (entry) => entry.reminderId === reminderId && (entry.status === 'pending' || entry.status === 'snoozed')
  );
  if (affected.length === 0) return;

  affected.forEach((entry) => {
    cancelScheduled(entry.id);
    registeredIds.delete(entry.id);
  });
  const next = clampHistory(
    callbacks.history.map((entry) =>
      entry.reminderId === reminderId && (entry.status === 'pending' || entry.status === 'snoozed')
        ? { ...entry, status: 'cancelled' as const, error: undefined }
        : entry
    ),
    callbacks.settings
  );

  logger.info('Notifications', 'Cancelled reminder notifications', {
    reminderId,
    cancelled: affected.length,
  });
  lastHistorySignature = signatureOf(next);
  callbacks.history = next;
  callbacks.onHistoryChange(next);
}

/** Called by the native bridge once Android has actually shown a notification. */
export function markNotificationDelivered(entryId: string): void {
  if (!callbacks) return;
  const next = clampHistory(
    callbacks.history.map((entry) =>
      entry.id === entryId && entry.status !== 'fired'
        ? { ...entry, status: 'fired' as const, firedAt: new Date().toISOString() }
        : entry
    ),
    callbacks.settings
  );
  lastHistorySignature = signatureOf(next);
  callbacks.history = next;
  callbacks.onHistoryChange(next);
  updateEngineState({ lastFiredAt: new Date().toISOString() });
}

export function markNotificationMissed(entryId: string): void {
  if (!callbacks) return;
  const next = clampHistory(
    callbacks.history.map((entry) =>
      entry.id === entryId ? { ...entry, status: 'missed' as const } : entry
    ),
    callbacks.settings
  );
  lastHistorySignature = signatureOf(next);
  callbacks.history = next;
  callbacks.onHistoryChange(next);
}

/** Handles a notification action (complete / snooze / open) from any platform. */
export function handleNotificationAction(entryId: string, action: 'complete' | 'snooze' | 'open' | string): void {
  if (!callbacks) return;
  const entry = callbacks.history.find((item) => item.id === entryId);
  const reminderId = entry?.reminderId;
  if (!reminderId) return;

  switch (action) {
    case 'complete':
      logger.info('Notifications', 'Notification action: complete', { entryId });
      callbacks.onCompleteReminder?.(reminderId);
      cancelReminderNotifications(reminderId);
      break;
    case 'snooze':
      logger.info('Notifications', 'Notification action: snooze', { entryId });
      snoozeNotification(entryId);
      break;
    case 'open':
    default:
      logger.info('Notifications', 'Notification action: open', { entryId });
      callbacks.onOpenReminder?.(reminderId);
      break;
  }
}

/** Installs the event handlers native code calls into. Safe to call repeatedly. */
export function attachNativeBridgeHandlers(): void {
  if (typeof window === 'undefined') return;

  window.MindMeshNativeNotificationEvents = {
    onPermissionResult: (state: string) => {
      const resolved = toPermissionState(state);
      environment = { ...environment, permission: resolved };
      updateEngineState({
        permission: resolved,
        ...(resolved === 'granted' ? { lastPermissionError: undefined } : {}),
      });
      logger.info('Notifications', 'Native notification permission resolved', { permission: resolved });
      permissionResolver?.(resolved);
      permissionResolver = null;
      syncNotificationSchedules(true);
    },

    onDelivered: (id: string) => {
      markNotificationDelivered(id);
    },

    onAction: (id: string, action: string) => {
      handleNotificationAction(id, action);
    },

    onOpened: (id: string) => {
      const entry = callbacks?.history.find((item) => item.id === id);
      if (entry) {
        callbacks?.onOpenReminder?.(entry.reminderId);
      } else {
        // The notification may have been replaced/removed from history; the entry id
        // still starts with the reminder id, so fall back to that.
        const reminderId = id.split('::')[0];
        if (reminderId) callbacks?.onOpenReminder?.(reminderId);
      }
    },
  };
}

export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  environment = detectNotificationEnvironment();

  if (environment.platform === 'android-native') {
    const bridge = getNativeBridge();
    if (!bridge) return 'unsupported';
    logger.info('Notifications', 'Requesting native notification permission');
    return new Promise<NotificationPermissionState>((resolve) => {
      let settled = false;
      permissionResolver = (state) => {
        if (settled) return;
        settled = true;
        resolve(state);
      };
      try {
        bridge.requestPermission();
      } catch (err) {
        settled = true;
        logger.error('Notifications', 'Native permission request failed', err);
        resolve(environment.permission);
        return;
      }
      setTimeout(() => {
        if (settled) return;
        settled = true;
        permissionResolver = null;
        resolve(detectNotificationEnvironment().permission);
      }, PERMISSION_TIMEOUT_MS);
    });
  }

  if (environment.platform === 'browser') {
    try {
      logger.info('Notifications', 'Requesting browser notification permission');
      const result = await Notification.requestPermission();
      const resolved = toPermissionState(result);
      environment = { ...environment, permission: resolved };
      updateEngineState({ permission: resolved });
      syncNotificationSchedules(true);
      return resolved;
    } catch (err) {
      logger.error('Notifications', 'Browser permission request failed', err);
      return environment.permission;
    }
  }

  updateEngineState({
    lastPermissionError: environment.reason || 'Notifications are not available in this environment.',
  });
  return 'unsupported';
}

export interface NotificationActionResult {
  ok: boolean;
  message: string;
}

export async function sendTestNotification(): Promise<NotificationActionResult> {
  environment = detectNotificationEnvironment();

  if (!environment.supported) {
    return {
      ok: false,
      message:
        environment.reason ||
        'Notifications are not available in this environment, so a test notification cannot be sent.',
    };
  }

  let permission = environment.permission;
  if (permission !== 'granted') {
    permission = await requestNotificationPermission();
  }
  if (permission !== 'granted') {
    return {
      ok: false,
      message:
        permission === 'denied'
          ? 'Notifications are blocked. ' + (environment.settingsHint || 'Enable them in your device settings.')
          : 'Notification permission is required before a test notification can be sent.',
    };
  }

  const id = `test-${Date.now().toString(36)}`;
  const title = 'MindMesh test notification';
  const body = 'Notifications are working. Scheduled reminders will appear like this.';

  if (environment.schedulingMode === 'native-alarm') {
    const bridge = getNativeBridge();
    try {
      const ok = bridge?.schedule(id, title, body, Date.now() + 250, buildNativeOptions());
      if (ok) {
        logger.info('Notifications', 'Test notification scheduled through native bridge');
        return { ok: true, message: 'Test notification sent.' };
      }
      updateEngineState({ lastError: 'Android rejected the test notification.' });
      return { ok: false, message: 'Android rejected the test notification.' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Native test notification failed.';
      logger.error('Notifications', 'Native test notification failed', err);
      updateEngineState({ lastError: message });
      return { ok: false, message };
    }
  }

  try {
    const notification = new Notification(title, {
      body,
      tag: id,
      silent: !(callbacks?.settings.sound ?? true),
    });
    notification.onclick = () => {
      try {
        window.focus();
      } catch {
        // ignore
      }
      notification.close();
    };
    logger.info('Notifications', 'Test notification displayed');
    return { ok: true, message: 'Test notification sent.' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not display the test notification.';
    logger.error('Notifications', 'Test notification failed', err);
    updateEngineState({ lastError: message });
    return { ok: false, message };
  }
}

/** Opens the OS/browser notification settings when the platform allows it. */
export function openDeviceNotificationSettings(): NotificationActionResult {
  environment = detectNotificationEnvironment();

  if (environment.platform === 'android-native') {
    const bridge = getNativeBridge();
    try {
      bridge?.openNotificationSettings();
      return { ok: true, message: 'Opening device notification settings…' };
    } catch (err) {
      logger.error('Notifications', 'Could not open device notification settings', err);
    }
  }

  return {
    ok: false,
    message:
      environment.settingsHint ||
      'This platform does not allow MindMesh to open notification settings directly. Open your system or browser settings and allow notifications for MindMesh.',
  };
}

export interface ReminderNotificationStatus {
  status: 'off' | 'on' | 'permission' | 'failed' | 'unsupported';
  label: string;
  nextNotificationAt?: string;
  pendingCount: number;
  missedCount: number;
}

/** Compact per-reminder notification status used by the node badge. */
export function getReminderNotificationStatus(
  reminder: Reminder,
  settings: AppNotificationSettings,
  history: NotificationHistoryEntry[]
): ReminderNotificationStatus {
  const entries = history.filter((entry) => entry.reminderId === reminder.id);
  const pending = entries.filter((entry) => entry.status === 'pending' || entry.status === 'snoozed');
  const missed = entries.filter((entry) => entry.status === 'missed');
  const failed = entries.filter((entry) => entry.status === 'failed');

  if (!settings.enabled || !reminder.notifications?.enabled) {
    return { status: 'off', label: 'Notifications off', pendingCount: 0, missedCount: missed.length };
  }
  if (!environment.supported) {
    return {
      status: 'unsupported',
      label: environment.reason || 'Notifications unavailable',
      pendingCount: pending.length,
      missedCount: missed.length,
    };
  }
  if (failed.length > 0) {
    return {
      status: 'failed',
      label: 'Notification scheduling failed',
      pendingCount: pending.length,
      missedCount: missed.length,
    };
  }
  if (environment.permission !== 'granted') {
    return {
      status: 'permission',
      label: 'Notification permission required',
      pendingCount: pending.length,
      missedCount: missed.length,
    };
  }

  const next = pending
    .map((entry) => entry.scheduledFor)
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0];

  return {
    status: 'on',
    label: next ? 'Notifications on' : 'Notifications on — nothing scheduled yet',
    ...(next ? { nextNotificationAt: next } : {}),
    pendingCount: pending.length,
    missedCount: missed.length,
  };
}

export function getScheduledNotificationsForReminder(
  reminderId: string,
  history: NotificationHistoryEntry[]
): NotificationHistoryEntry[] {
  return history.filter(
    (entry) => entry.reminderId === reminderId && (entry.status === 'pending' || entry.status === 'snoozed')
  );
}

export function getPendingNotificationCount(history: NotificationHistoryEntry[]): number {
  return history.filter((entry) => entry.status === 'pending' || entry.status === 'snoozed').length;
}

export function getMissedNotificationCount(history: NotificationHistoryEntry[]): number {
  return history.filter((entry) => entry.status === 'missed').length;
}

/** Replaces the engine's cached history (used after a restore or reset). */
export function replaceNotificationHistory(history: NotificationHistoryEntry[], settings: AppNotificationSettings): void {
  const normalized = normalizeNotificationHistory(history, settings.historyLimit);
  lastHistorySignature = signatureOf(normalized);
  registeredIds.clear();
  if (callbacks) {
    callbacks.history = normalized;
  }
  syncNotificationSchedules(true);
}

/** Exposes the current environmental detection for the diagnostics dashboard. */
export function describeNotificationEnvironment(): NotificationEnvironment {
  environment = detectNotificationEnvironment();
  return environment;
}

export { DEFAULT_NOTIFICATION_SETTINGS };
