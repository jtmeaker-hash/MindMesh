import { Reminder } from './index';

/**
 * Where the notification capability physically comes from.
 * `android-native` means the MindMesh Android WebView shell exposes its
 * AlarmManager/NotificationManager bridge, which can fire while the app is closed.
 */
export type NotificationPlatform = 'android-native' | 'android-webview' | 'browser' | 'unknown';

export type NotificationPermissionState = 'unsupported' | 'granted' | 'denied' | 'default';

export type NotificationDeliveryStatus =
  | 'pending'
  | 'fired'
  | 'snoozed'
  | 'cancelled'
  | 'missed'
  | 'failed';

/**
 * Per-reminder notification configuration. Always stored on the reminder itself so
 * the reminder remains the single source of truth (no separate reminder database).
 */
export interface ReminderNotificationSettings {
  /** Notifications enabled for this specific reminder. */
  enabled: boolean;
  /** Fire a notification at the exact due time. */
  notifyAtDueTime: boolean;
  /** Advance offsets in minutes before the due time (5, 15, 1440 ...). */
  advanceMinutes: number[];
  /** Custom snooze duration for this reminder; falls back to the app default. */
  snoozeMinutes?: number;
}

/** One scheduled / delivered notification. Persisted so history survives refreshes. */
export interface NotificationHistoryEntry {
  /** Stable key: `${reminderId}::${dueKey}::${offsetMinutes}` */
  id: string;
  reminderId: string;
  reminderTitle: string;
  /** ISO timestamp the notification targets. */
  scheduledFor: string;
  /** ISO timestamp it was actually delivered (or superseded). */
  firedAt?: string;
  /** Minutes before the due time. 0 = at due time. */
  offsetMinutes: number;
  status: NotificationDeliveryStatus;
  /** Set when the user snoozed; the entry becomes due again at this time. */
  snoozedUntil?: string;
  /** Present when the entry could not be scheduled/delivered. */
  error?: string;
}

export interface AppNotificationSettings {
  /** Master switch for the whole notification system. */
  enabled: boolean;
  /** Whether brand new reminders start with notifications turned on. */
  defaultReminderNotifications: boolean;
  /** Default advance offset (minutes) applied to new reminders. */
  defaultAdvanceMinutes: number;
  /** Default: also notify at the exact due time. */
  defaultNotifyAtDueTime: boolean;
  defaultSnoozeMinutes: number;
  sound: boolean;
  vibration: boolean;
  showCompletedNotifications: boolean;
  /** How long after the target time a notification may still fire before it is missed. */
  missedGraceMinutes: number;
  /** Maximum notification history entries retained locally. */
  historyLimit: number;
}

export const NOTIFICATION_HISTORY_LIMIT = 120;

export const DEFAULT_NOTIFICATION_SETTINGS: AppNotificationSettings = {
  enabled: true,
  defaultReminderNotifications: true,
  defaultAdvanceMinutes: 15,
  defaultNotifyAtDueTime: true,
  defaultSnoozeMinutes: 10,
  sound: true,
  vibration: true,
  showCompletedNotifications: false,
  missedGraceMinutes: 10,
  historyLimit: NOTIFICATION_HISTORY_LIMIT,
};

export interface AdvancePreset {
  label: string;
  minutes: number;
}

/** Advance notification options offered in the reminder editor. */
export const ADVANCE_PRESETS: AdvancePreset[] = [
  { label: '5 min before', minutes: 5 },
  { label: '10 min before', minutes: 10 },
  { label: '15 min before', minutes: 15 },
  { label: '30 min before', minutes: 30 },
  { label: '1 hour before', minutes: 60 },
  { label: '2 hours before', minutes: 120 },
  { label: '1 day before', minutes: 1440 },
];

export const SNOOZE_PRESETS: AdvancePreset[] = [
  { label: '5 minutes', minutes: 5 },
  { label: '10 minutes', minutes: 10 },
  { label: '15 minutes', minutes: 15 },
  { label: '30 minutes', minutes: 30 },
  { label: '1 hour', minutes: 60 },
];

const MAX_ADVANCE_MINUTES = 60 * 24 * 60; // one year

/** Formats an advance offset like "15 min before" / "2 hours before" / "1 day before". */
export function formatAdvanceLabel(minutes: number): string {
  if (minutes <= 0) return 'At due time';
  if (minutes < 60) return `${minutes} min before`;
  if (minutes < 1440) {
    const hours = minutes / 60;
    return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hour${hours === 1 ? '' : 's'} before`;
  }
  const days = minutes / 1440;
  return `${Number.isInteger(days) ? days : days.toFixed(1)} day${days === 1 ? '' : 's'} before`;
}

/** Formats a snooze duration, e.g. "10 min". */
export function formatSnoozeLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
}

/** Defensive coercion of any persisted/hostile notification settings payload. */
export function normalizeNotificationSettings(input: unknown): AppNotificationSettings {
  const base = { ...DEFAULT_NOTIFICATION_SETTINGS };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const raw = input as Record<string, unknown>;

  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;
  const num = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };

  return {
    enabled: bool(raw.enabled, base.enabled),
    defaultReminderNotifications: bool(raw.defaultReminderNotifications, base.defaultReminderNotifications),
    defaultAdvanceMinutes: num(raw.defaultAdvanceMinutes, base.defaultAdvanceMinutes, 0, MAX_ADVANCE_MINUTES),
    defaultNotifyAtDueTime: bool(raw.defaultNotifyAtDueTime, base.defaultNotifyAtDueTime),
    defaultSnoozeMinutes: num(raw.defaultSnoozeMinutes, base.defaultSnoozeMinutes, 1, 1440),
    sound: bool(raw.sound, base.sound),
    vibration: bool(raw.vibration, base.vibration),
    showCompletedNotifications: bool(raw.showCompletedNotifications, base.showCompletedNotifications),
    missedGraceMinutes: num(raw.missedGraceMinutes, base.missedGraceMinutes, 0, 1440),
    historyLimit: num(raw.historyLimit, base.historyLimit, 10, 1000),
  };
}

/** Normalises a single reminder's notification config, dropping nonsense offsets. */
export function normalizeReminderNotificationSettings(
  input: unknown
): ReminderNotificationSettings | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, unknown>;

  const advance = Array.isArray(raw.advanceMinutes)
    ? Array.from(
        new Set(
          raw.advanceMinutes
            .map((value) => (typeof value === 'number' ? value : Number(value)))
            .filter((n) => Number.isFinite(n) && n > 0 && n <= MAX_ADVANCE_MINUTES)
            .map((n) => Math.round(n))
        )
      ).sort((a, b) => a - b)
    : [];

  const snoozeRaw = raw.snoozeMinutes;
  const snooze =
    typeof snoozeRaw === 'number' && Number.isFinite(snoozeRaw) && snoozeRaw > 0
      ? Math.min(1440, Math.round(snoozeRaw))
      : undefined;

  return {
    enabled: raw.enabled === true,
    notifyAtDueTime: raw.notifyAtDueTime !== false,
    advanceMinutes: advance,
    ...(snooze !== undefined ? { snoozeMinutes: snooze } : {}),
  };
}

/** Normalises persisted notification history, discarding malformed records. */
export function normalizeNotificationHistory(input: unknown, limit = NOTIFICATION_HISTORY_LIMIT): NotificationHistoryEntry[] {
  if (!Array.isArray(input)) return [];
  const validStatuses: NotificationDeliveryStatus[] = [
    'pending',
    'fired',
    'snoozed',
    'cancelled',
    'missed',
    'failed',
  ];

  const seen = new Set<string>();
  const entries: NotificationHistoryEntry[] = [];

  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== 'string' || !raw.id) continue;
    if (typeof raw.reminderId !== 'string' || !raw.reminderId) continue;
    if (typeof raw.scheduledFor !== 'string' || Number.isNaN(Date.parse(raw.scheduledFor))) continue;
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);

    const status = validStatuses.includes(raw.status as NotificationDeliveryStatus)
      ? (raw.status as NotificationDeliveryStatus)
      : 'cancelled';

    const offset = typeof raw.offsetMinutes === 'number' && Number.isFinite(raw.offsetMinutes)
      ? Math.round(raw.offsetMinutes)
      : 0;

    entries.push({
      id: raw.id,
      reminderId: raw.reminderId,
      reminderTitle: typeof raw.reminderTitle === 'string' ? raw.reminderTitle : 'Reminder',
      scheduledFor: raw.scheduledFor,
      offsetMinutes: offset,
      status,
      ...(typeof raw.firedAt === 'string' ? { firedAt: raw.firedAt } : {}),
      ...(typeof raw.snoozedUntil === 'string' ? { snoozedUntil: raw.snoozedUntil } : {}),
      ...(typeof raw.error === 'string' ? { error: raw.error } : {}),
    });
  }

  // Newest first, bounded so history cannot grow without limit.
  return entries
    .sort((a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor))
    .slice(0, Math.max(10, limit));
}

/** Whether this reminder should receive notifications right now. */
export function isReminderNotificationsEnabled(
  reminder: Pick<Reminder, 'notifications'>,
  settings: AppNotificationSettings
): boolean {
  if (!settings.enabled) return false;
  return reminder.notifications?.enabled === true;
}

/** The effective advance offsets for a reminder, sorted ascending. */
export function getReminderAdvanceMinutes(
  reminder: Pick<Reminder, 'notifications'>,
  settings: AppNotificationSettings
): number[] {
  const configured = reminder.notifications?.advanceMinutes ?? [];
  if (configured.length > 0) return [...configured].sort((a, b) => a - b);
  // Fall back to the app default only when the reminder has not been configured at all.
  if (!reminder.notifications) {
    return settings.defaultAdvanceMinutes > 0 ? [settings.defaultAdvanceMinutes] : [];
  }
  return [];
}

/** The effective snooze duration for a reminder. */
export function getReminderSnoozeMinutes(
  reminder: Pick<Reminder, 'notifications'>,
  settings: AppNotificationSettings
): number {
  return reminder.notifications?.snoozeMinutes ?? settings.defaultSnoozeMinutes;
}

/** Distinct advance offsets offered for scheduling (sorted ascending). */
export function availableAdvanceOptions(): number[] {
  return ADVANCE_PRESETS.map((preset) => preset.minutes);
}
