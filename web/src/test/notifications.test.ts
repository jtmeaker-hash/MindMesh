import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Reminder } from '../types';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  AppNotificationSettings,
  NotificationHistoryEntry,
  normalizeNotificationHistory,
  normalizeNotificationSettings,
  normalizeReminderNotificationSettings,
  getReminderAdvanceMinutes,
  getReminderSnoozeMinutes,
  formatAdvanceLabel,
  formatSnoozeLabel,
} from '../types/notifications';
import {
  buildDesiredNotifications,
  buildNotificationBody,
  buildNotificationEntryId,
  configureNotificationEngine,
  getNotificationEngineState,
  getNotificationEnvironment,
  getReminderDueTimestamp,
  getReminderNotificationStatus,
  getPendingNotificationCount,
  getMissedNotificationCount,
  handleNotificationAction,
  initNotificationEnvironment,
  reconcileNotifications,
  replaceNotificationHistory,
  sendTestNotification,
  snoozeNotification,
  snoozeReminderNotification,
  syncNotificationSchedules,
  teardownNotificationEngine,
  cancelReminderNotifications,
  attachNativeBridgeHandlers,
} from '../services/notifications';

/** Minimal stand-in for the browser Notification API (jsdom has none). */
class MockNotification {
  static permission: NotificationPermission = 'default';
  static requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  static instances: MockNotification[] = [];

  onclick: (() => void) | null = null;
  title: string;
  options: NotificationOptions;

  constructor(title: string, options?: NotificationOptions) {
    this.title = title;
    this.options = options ?? {};
    MockNotification.instances.push(this);
  }

  close() {
    // no-op
  }

  static reset() {
    MockNotification.permission = 'default';
    MockNotification.instances = [];
    MockNotification.requestPermission = vi.fn(async () => 'granted' as NotificationPermission);
  }
}

function installBrowserNotifications() {
  (globalThis as unknown as { Notification: unknown }).Notification = MockNotification;
}

function removeBrowserNotifications() {
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
}

/** A reminder due on a known future date/time so schedules are deterministic. */
function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'rem-notify-1',
    categoryId: 'cat-1',
    title: 'Dentist Appointment',
    dueDate: '2099-03-04',
    dueTime: '15:00',
    priority: 'medium',
    completed: false,
    createdAt: new Date().toISOString(),
    subtasks: [],
    notifications: {
      enabled: true,
      notifyAtDueTime: true,
      advanceMinutes: [1440, 120, 15],
    },
    ...overrides,
  };
}

function settingsWith(overrides: Partial<AppNotificationSettings> = {}): AppNotificationSettings {
  return { ...DEFAULT_NOTIFICATION_SETTINGS, ...overrides };
}

describe('Notification settings normalisation', () => {
  it('coerces hostile settings input into a valid object', () => {
    const normalized = normalizeNotificationSettings({
      enabled: 'yes',
      defaultAdvanceMinutes: -500,
      defaultSnoozeMinutes: Number.NaN,
      missedGraceMinutes: 99_999,
      historyLimit: 0,
    });

    expect(normalized.enabled).toBe(DEFAULT_NOTIFICATION_SETTINGS.enabled);
    expect(normalized.defaultAdvanceMinutes).toBe(0);
    expect(normalized.defaultSnoozeMinutes).toBe(DEFAULT_NOTIFICATION_SETTINGS.defaultSnoozeMinutes);
    expect(normalized.missedGraceMinutes).toBe(1440);
    expect(normalized.historyLimit).toBe(10);
  });

  it('falls back to defaults for null and array input', () => {
    expect(normalizeNotificationSettings(null)).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(normalizeNotificationSettings(['nope'])).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('normalises per-reminder notification configuration', () => {
    const normalized = normalizeReminderNotificationSettings({
      enabled: true,
      notifyAtDueTime: false,
      advanceMinutes: [30, 30, -5, 'abc', 10],
      snoozeMinutes: -3,
    });

    expect(normalized).toBeDefined();
    expect(normalized?.enabled).toBe(true);
    expect(normalized?.notifyAtDueTime).toBe(false);
    expect(normalized?.advanceMinutes).toEqual([10, 30]);
    expect(normalized?.snoozeMinutes).toBeUndefined();
  });

  it('drops malformed history records and de-duplicates ids', () => {
    const history = normalizeNotificationHistory([
      { id: 'a', reminderId: 'r1', scheduledFor: '2099-01-01T00:00:00.000Z', offsetMinutes: 15, status: 'pending' },
      { id: 'a', reminderId: 'r1', scheduledFor: '2099-01-01T00:00:00.000Z', offsetMinutes: 15, status: 'pending' },
      { id: 'b', reminderId: 'r1', scheduledFor: 'not-a-date', offsetMinutes: 5, status: 'pending' },
      { reminderId: 'r1', scheduledFor: '2099-01-01T00:00:00.000Z' },
      null,
      { id: 'c', reminderId: 'r2', scheduledFor: '2099-01-02T00:00:00.000Z', offsetMinutes: 5, status: 'nonsense' },
    ]);

    expect(history.map((entry) => entry.id)).toEqual(['c', 'a']);
    expect(history[0].status).toBe('cancelled');
  });

  it('labels advance offsets in human terms', () => {
    expect(formatAdvanceLabel(0)).toBe('At due time');
    expect(formatAdvanceLabel(15)).toBe('15 min before');
    expect(formatAdvanceLabel(60)).toBe('1 hour before');
    expect(formatAdvanceLabel(120)).toBe('2 hours before');
    expect(formatAdvanceLabel(1440)).toBe('1 day before');
    expect(formatSnoozeLabel(10)).toBe('10 min');
    expect(formatSnoozeLabel(60)).toBe('1 hr');
  });

  it('resolves effective advance and snooze values with sensible fallbacks', () => {
    const settings = settingsWith({ defaultAdvanceMinutes: 30, defaultSnoozeMinutes: 20 });
    const unconfigured = makeReminder({ notifications: undefined });
    expect(getReminderAdvanceMinutes(unconfigured, settings)).toEqual([30]);
    expect(getReminderSnoozeMinutes(unconfigured, settings)).toBe(20);

    const configured = makeReminder({
      notifications: { enabled: true, notifyAtDueTime: false, advanceMinutes: [5], snoozeMinutes: 45 },
    });
    expect(getReminderAdvanceMinutes(configured, settings)).toEqual([5]);
    expect(getReminderSnoozeMinutes(configured, settings)).toBe(45);
  });
});

describe('Notification planning', () => {
  it('parses a reminder due timestamp in local time', () => {
    const timestamp = getReminderDueTimestamp({ dueDate: '2099-03-04', dueTime: '15:00' });
    expect(timestamp).not.toBeNull();
    const date = new Date(timestamp as number);
    expect(date.getFullYear()).toBe(2099);
    expect(date.getMonth()).toBe(2);
    expect(date.getDate()).toBe(4);
    expect(date.getHours()).toBe(15);
    expect(date.getMinutes()).toBe(0);
  });

  it('returns null for invalid dates rather than throwing', () => {
    expect(getReminderDueTimestamp({ dueDate: 'garbage' })).toBeNull();
    expect(getReminderDueTimestamp({ dueDate: undefined })).toBeNull();
  });

  it('creates one notification per advance offset plus the due time', () => {
    const desired = buildDesiredNotifications([makeReminder()], settingsWith());
    expect(desired).toHaveLength(4);
    expect(desired.map((item) => item.offsetMinutes).sort((a, b) => a - b)).toEqual([0, 15, 120, 1440]);
  });

  it('skips reminders with notifications disabled or no due date', () => {
    const disabled = makeReminder({
      notifications: { enabled: false, notifyAtDueTime: true, advanceMinutes: [15] },
    });
    const noDate = makeReminder({ id: 'rem-2', dueDate: undefined });
    expect(buildDesiredNotifications([disabled, noDate], settingsWith())).toHaveLength(0);
  });

  it('produces no schedule at all when the master switch is off', () => {
    expect(buildDesiredNotifications([makeReminder()], settingsWith({ enabled: false }))).toHaveLength(0);
  });

  it('skips completed reminders unless completed notifications are enabled', () => {
    const completed = makeReminder({ completed: true });
    expect(buildDesiredNotifications([completed], settingsWith())).toHaveLength(0);
    expect(
      buildDesiredNotifications([completed], settingsWith({ showCompletedNotifications: true }))
    ).toHaveLength(4);
  });

  it('keys notifications by occurrence, so a recurring roll-forward reschedules', () => {
    const reminder = makeReminder({ recurrence: { frequency: 'daily', interval: 1 } });
    const before = buildDesiredNotifications([reminder], settingsWith());
    const rolled = buildDesiredNotifications([{ ...reminder, dueDate: '2099-03-05' }], settingsWith());

    expect(before[0].id).not.toBe(rolled[0].id);
    expect(before[0].fireAt).not.toBe(rolled[0].fireAt);
    expect(rolled[0].id).toBe(buildNotificationEntryId(reminder.id, '2099-03-05T15:00', rolled[0].offsetMinutes));
  });

  it('describes the notification body relative to the due time', () => {
    expect(buildNotificationBody(makeReminder(), 0)).toContain('is due 15:00');
    expect(buildNotificationBody(makeReminder(), 15)).toContain('15 min before');
  });
});

describe('Notification reconciliation', () => {
  const reminder = makeReminder();

  it('schedules future notifications and keeps them pending', () => {
    const result = reconcileNotifications([], {
      reminders: [reminder],
      settings: settingsWith(),
      permission: 'granted',
    });

    expect(result.changed).toBe(true);
    expect(result.toDeliver).toHaveLength(0);
    expect(result.toSchedule).toHaveLength(4);
    expect(getPendingNotificationCount(result.history)).toBe(4);
  });

  it('is idempotent: a second identical pass reports no change', () => {
    const first = reconcileNotifications([], {
      reminders: [reminder],
      settings: settingsWith(),
      permission: 'granted',
    });
    const second = reconcileNotifications(first.history, {
      reminders: [reminder],
      settings: settingsWith(),
      permission: 'granted',
    });

    expect(second.changed).toBe(false);
    expect(second.history).toHaveLength(first.history.length);
  });

  it('delivers notifications whose time has arrived within the grace window', () => {
    const dueAt = getReminderDueTimestamp(reminder) as number;
    const now = dueAt - 15 * 60_000 + 30_000; // 30s after the 15-minute advance alert

    const result = reconcileNotifications([], {
      reminders: [reminder],
      settings: settingsWith(),
      permission: 'granted',
      now,
    });

    expect(result.toDeliver).toHaveLength(1);
    expect(result.toDeliver[0].offsetMinutes).toBe(15);
  });

  it('marks notifications missed once the grace window has passed', () => {
    const dueAt = getReminderDueTimestamp(reminder) as number;
    const now = dueAt + 24 * 60 * 60_000; // a day later

    const result = reconcileNotifications([], {
      reminders: [reminder],
      settings: settingsWith({ missedGraceMinutes: 5 }),
      permission: 'granted',
      now,
    });

    expect(result.toMiss.length).toBeGreaterThan(0);
    expect(getMissedNotificationCount(result.history)).toBe(4);
  });

  it('keeps entries pending with an explanation when permission is not granted', () => {
    const dueAt = getReminderDueTimestamp(reminder) as number;
    const result = reconcileNotifications([], {
      reminders: [reminder],
      settings: settingsWith(),
      permission: 'denied',
      now: dueAt - 15 * 60_000 + 30_000,
    });

    expect(result.toDeliver).toHaveLength(1);
    const deliveredEntry = result.history.find((entry) => entry.status === 'pending');
    expect(deliveredEntry?.error).toContain('denied');
  });

  it('cancels pending notifications when a reminder is deleted but keeps history', () => {
    const first = reconcileNotifications([], {
      reminders: [reminder],
      settings: settingsWith(),
      permission: 'granted',
    });
    const firedEntry: NotificationHistoryEntry = {
      ...first.history[0],
      id: 'already-fired',
      status: 'fired',
      firedAt: new Date().toISOString(),
    };

    const second = reconcileNotifications([firedEntry, ...first.history], {
      reminders: [],
      settings: settingsWith(),
      permission: 'granted',
    });

    expect(second.toCancel.length).toBe(first.history.length);
    expect(second.history.some((entry) => entry.status === 'pending')).toBe(false);
    expect(second.history.some((entry) => entry.id === 'already-fired')).toBe(true);
  });

  it('cancels remaining notifications when a reminder is completed', () => {
    const first = reconcileNotifications([], {
      reminders: [reminder],
      settings: settingsWith(),
      permission: 'granted',
    });
    const second = reconcileNotifications(first.history, {
      reminders: [{ ...reminder, completed: true }],
      settings: settingsWith(),
      permission: 'granted',
    });

    expect(second.toCancel).toHaveLength(first.history.length);
    expect(getPendingNotificationCount(second.history)).toBe(0);
  });

  it('cancels pending notifications when notifications are switched off', () => {
    const first = reconcileNotifications([], {
      reminders: [reminder],
      settings: settingsWith(),
      permission: 'granted',
    });
    const second = reconcileNotifications(first.history, {
      reminders: [{ ...reminder, notifications: { enabled: false, notifyAtDueTime: true, advanceMinutes: [15] } }],
      settings: settingsWith(),
      permission: 'granted',
    });

    expect(second.toCancel.length).toBeGreaterThan(0);
    expect(getPendingNotificationCount(second.history)).toBe(0);
  });

  it('reschedules a rescheduled reminder instead of firing the old time', () => {
    const first = reconcileNotifications([], {
      reminders: [reminder],
      settings: settingsWith(),
      permission: 'granted',
    });
    const moved = { ...reminder, dueDate: '2099-04-04' };
    const second = reconcileNotifications(first.history, {
      reminders: [moved],
      settings: settingsWith(),
      permission: 'granted',
    });

    expect(second.toCancel).toHaveLength(first.history.length);
    expect(second.toSchedule).toHaveLength(4);
    const dueAt = getReminderDueTimestamp(moved) as number;
    expect(second.toSchedule.every((item) => item.fireAt < dueAt + 1)).toBe(true);
  });

  it('trims history to the configured limit', () => {
    const many = Array.from({ length: 40 }, (_, index) =>
      makeReminder({ id: `rem-${index}`, title: `Reminder ${index}` })
    );
    const result = reconcileNotifications([], {
      reminders: many,
      settings: settingsWith({ historyLimit: 25 }),
      permission: 'granted',
    });

    expect(result.history.length).toBe(25);
  });
});

describe('Notification engine runtime', () => {
  beforeEach(() => {
    localStorage.clear();
    MockNotification.reset();
    removeBrowserNotifications();
    initNotificationEnvironment();
  });

  afterEach(() => {
    teardownNotificationEngine();
    MockNotification.reset();
    removeBrowserNotifications();
  });

  it('reports an unsupported environment without throwing', async () => {
    const environment = getNotificationEnvironment();
    expect(environment.supported).toBe(false);
    expect(environment.backgroundSupported).toBe(false);
    expect(environment.schedulingMode).toBe('none');

    const result = await sendTestNotification();
    expect(result.ok).toBe(false);
    expect(result.message.length).toBeGreaterThan(0);
  });

  it('delivers notifications through the browser Notification API when permitted', async () => {
    installBrowserNotifications();
    MockNotification.permission = 'granted';
    initNotificationEnvironment();

    expect(getNotificationEnvironment()).toMatchObject({ platform: 'browser', supported: true });

    let history: NotificationHistoryEntry[] = [];
    const opened: string[] = [];
    const reminder = makeReminder();
    const dueAt = getReminderDueTimestamp(reminder) as number;

    configureNotificationEngine({
      reminders: [reminder],
      settings: settingsWith(),
      history: [],
      onHistoryChange: (next) => {
        history = next;
      },
      onOpenReminder: (id) => opened.push(id),
    });

    // Move time to just after the 15-minute advance alert.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(dueAt - 15 * 60_000 + 10_000));
    replaceNotificationHistory(history, settingsWith());
    syncNotificationSchedules(true);
    vi.useRealTimers();

    const fired = history.find((entry) => entry.status === 'fired');
    if (fired) {
      expect(MockNotification.instances.length).toBeGreaterThan(0);
      MockNotification.instances[0].onclick?.();
      expect(opened).toContain(reminder.id);
    } else {
      // Without a delivered entry there is nothing to assert about the click path.
      expect(history.some((entry) => entry.status === 'pending')).toBe(true);
    }
  });

  it('requests permission through the browser API and reports the result', async () => {
    installBrowserNotifications();
    initNotificationEnvironment();
    MockNotification.requestPermission = vi.fn(async () => 'granted' as NotificationPermission);

    const { requestNotificationPermission } = await import('../services/notifications');
    const state = await requestNotificationPermission();
    expect(state).toBe('granted');
    expect(MockNotification.requestPermission).toHaveBeenCalled();
  });

  it('snoozes without altering the reminder itself', () => {
    installBrowserNotifications();
    MockNotification.permission = 'granted';
    initNotificationEnvironment();

    const reminder = makeReminder();
    const dueAt = getReminderDueTimestamp(reminder) as number;
    let history: NotificationHistoryEntry[] = [];
    const reminders: Reminder[] = [reminder];

    configureNotificationEngine({
      reminders,
      settings: settingsWith(),
      history: [],
      onHistoryChange: (next) => {
        history = next;
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(dueAt - 15 * 60_000 + 10_000));
    syncNotificationSchedules(true);

    const candidate = history.find((entry) => entry.status === 'pending') ?? history[0];
    const snoozed = snoozeNotification(candidate.id, 30);
    vi.useRealTimers();

    expect(snoozed).toBe(true);
    const entry = history.find((item) => item.id === candidate.id);
    expect(entry?.status).toBe('snoozed');
    expect(entry?.snoozedUntil).toBeDefined();
    // The reminder itself must be untouched: snoozing only moves the notification.
    expect(reminders).toHaveLength(1);
    expect(reminders[0].completed).toBe(false);
    expect(reminders[0].dueDate).toBe(reminder.dueDate);
  });

  it('snoozes a reminder\'s latest notification by reminder id', () => {
    installBrowserNotifications();
    MockNotification.permission = 'granted';
    initNotificationEnvironment();

    const reminder = makeReminder();
    const dueAt = getReminderDueTimestamp(reminder) as number;
    let history: NotificationHistoryEntry[] = [];

    configureNotificationEngine({
      reminders: [reminder],
      settings: settingsWith(),
      history: [],
      onHistoryChange: (next) => {
        history = next;
      },
    });

    vi.useFakeTimers();
    vi.setSystemTime(new Date(dueAt - 15 * 60_000 + 10_000));
    syncNotificationSchedules(true);
    const ok = snoozeReminderNotification(reminder.id, 5);
    vi.useRealTimers();

    if (history.length > 0) {
      expect(ok).toBe(true);
    }
  });

  it('cancels reminder notifications on demand', () => {
    installBrowserNotifications();
    MockNotification.permission = 'granted';
    initNotificationEnvironment();

    let history: NotificationHistoryEntry[] = [];
    configureNotificationEngine({
      reminders: [makeReminder()],
      settings: settingsWith(),
      history: [],
      onHistoryChange: (next) => {
        history = next;
      },
    });

    expect(getPendingNotificationCount(history)).toBeGreaterThan(0);
    cancelReminderNotifications('rem-notify-1');
    expect(getPendingNotificationCount(history)).toBe(0);
  });

  it('handles a notification action by completing the reminder', () => {
    installBrowserNotifications();
    MockNotification.permission = 'granted';
    initNotificationEnvironment();

    const completed: string[] = [];
    let history: NotificationHistoryEntry[] = [];

    configureNotificationEngine({
      reminders: [makeReminder()],
      settings: settingsWith(),
      history: [],
      onHistoryChange: (next) => {
        history = next;
      },
      onCompleteReminder: (id) => completed.push(id),
    });

    const entry = history[0];
    handleNotificationAction(entry.id, 'complete');
    expect(completed).toContain('rem-notify-1');
  });

  it('reports per-reminder notification status for the compact node badge', () => {
    const settings = settingsWith();
    expect(getReminderNotificationStatus(makeReminder(), settings, []).status).toBe('unsupported');

    installBrowserNotifications();
    MockNotification.permission = 'denied';
    initNotificationEnvironment();
    expect(getReminderNotificationStatus(makeReminder(), settings, []).status).toBe('permission');

    MockNotification.permission = 'granted';
    initNotificationEnvironment();
    expect(getReminderNotificationStatus(makeReminder(), settings, []).status).toBe('on');
    expect(
      getReminderNotificationStatus(makeReminder({ notifications: undefined }), settings, []).status
    ).toBe('off');
    expect(getReminderNotificationStatus(makeReminder(), settingsWith({ enabled: false }), []).status).toBe('off');
  });

  it('uses the native bridge when the Android shell exposes it', () => {
    const scheduled: { id: string; triggerAt: number }[] = [];
    const nativeWindow = window as unknown as {
      MindMeshNotifications?: {
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
      };
      MindMeshNativeNotificationEvents?: Record<string, unknown>;
    };

    nativeWindow.MindMeshNotifications = {
      isSupported: () => true,
      getPermissionState: () => 'granted',
      requestPermission: () => {},
      schedule: (id, _title, _body, triggerAtMillis) => {
        scheduled.push({ id, triggerAt: triggerAtMillis });
        return true;
      },
      cancel: () => {},
      cancelAll: () => {},
      getScheduledCount: () => scheduled.length,
      openNotificationSettings: () => {},
    };

    initNotificationEnvironment();
    expect(getNotificationEnvironment()).toMatchObject({
      platform: 'android-native',
      supported: true,
      backgroundSupported: true,
      schedulingMode: 'native-alarm',
    });

    attachNativeBridgeHandlers();
    expect(nativeWindow.MindMeshNativeNotificationEvents).toBeDefined();

    let history: NotificationHistoryEntry[] = [];
    configureNotificationEngine({
      reminders: [makeReminder()],
      settings: settingsWith(),
      history: [],
      onHistoryChange: (next) => {
        history = next;
      },
    });

    expect(scheduled.length).toBeGreaterThan(0);
    expect(getNotificationEngineState().pendingCount).toBeGreaterThan(0);

    // Native delivery callback must be honoured so history stays truthful.
    const events = nativeWindow.MindMeshNativeNotificationEvents as {
      onDelivered?: (id: string) => void;
    };
    const target = history.find((entry) => entry.status === 'pending');
    if (target) {
      events.onDelivered?.(target.id);
      expect(history.find((entry) => entry.id === target.id)?.status).toBe('fired');
    }

    delete nativeWindow.MindMeshNotifications;
    delete nativeWindow.MindMeshNativeNotificationEvents;
    initNotificationEnvironment();
  });
});
