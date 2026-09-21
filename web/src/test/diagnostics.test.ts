import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearLogs,
  exportLogsAsJson,
  exportLogsAsText,
  filterLogs,
  flushLogs,
  getLogRetention,
  getLogs,
  isLoggingHealthy,
  logging,
  setLogRetention,
  subscribeLogs,
} from '../services/logging';
import {
  DIAGNOSTICS_STORAGE_KEY,
  appendDiagnosticsHistory,
  clearDiagnosticsHistory,
  loadDiagnosticsStore,
  pruneLogs,
  recordError,
  recordStartup,
  updateLogRetention,
} from '../services/diagnosticsStore';
import { runDiagnostics, runStartupSelfCheck, buildDiagnosticsReportText } from '../services/diagnostics';
import {
  FIX_DEFINITIONS,
  getSafeFixes,
  isFixImplemented,
  runAllSafeFixes,
  runFix,
} from '../services/fixer';
import {
  BACKUP_FORMAT_VERSION,
  createBackup,
  migrateBackup,
  restoreBackup,
  validateBackup,
} from '../services/backup';
import {
  loadAllData,
  loadNotificationHistory,
  loadNotificationSettings,
  saveAllData,
  saveDiagnosticPreferences,
  loadDiagnosticPreferences,
  loadNodePositions,
  saveNodePositions,
  saveReminders,
  loadReminders,
  CURRENT_STORAGE_VERSION,
} from '../services/storage';
import { DEFAULT_NOTIFICATION_SETTINGS } from '../types/notifications';
import { DIAGNOSTICS_HISTORY_LIMIT, LogEntry } from '../types/diagnostics';
import { Reminder } from '../types';

function makeLog(index: number, overrides: Partial<LogEntry> = {}): LogEntry {
  return {
    id: `log-${index}`,
    timestamp: new Date(Date.now() - index * 1000).toISOString(),
    level: index % 2 === 0 ? 'INFO' : 'ERROR',
    subsystem: index % 3 === 0 ? 'Storage' : 'Notifications',
    message: `Message ${index}`,
    ...overrides,
  };
}

describe('Diagnostic logging', () => {
  beforeEach(() => {
    localStorage.clear();
    flushLogs();
    clearLogs();
  });

  it('records structured entries with level and subsystem', () => {
    logging.debug('Storage', 'debug message');
    logging.info('Storage', 'info message', { count: 2 });
    logging.warn('Notifications', 'warn message');
    logging.error('Backup', 'error message', new Error('boom'));
    logging.critical('App', 'critical message');

    const logs = getLogs();
    const levels = logs.map((entry) => entry.level);
    expect(levels).toContain('INFO');
    expect(levels).toContain('WARNING');
    expect(levels).toContain('ERROR');
    expect(levels).toContain('CRITICAL');

    const errorEntry = logs.find((entry) => entry.level === 'ERROR');
    expect(errorEntry?.subsystem).toBe('Backup');
    expect(errorEntry?.details?.errorMessage).toBe('boom');
    expect(isLoggingHealthy()).toBe(true);
  });

  it('never writes secrets, tokens or image data into the log store', () => {
    logging.info('Auth', 'credentials checked', {
      password: 'hunter2',
      apiKey: 'sk-live-secret',
      nested: { authorizationToken: 'Bearer abc', safe: 'visible' },
      photo: 'data:image/png;base64,AAAA',
      backup: { reminders: ['secret'] },
    });

    const entry = getLogs()[0];
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('sk-live-secret');
    expect(serialized).not.toContain('Bearer abc');
    expect(serialized).not.toContain('base64,AAAA');
    expect(serialized).toContain('[redacted]');
    expect((entry.details?.nested as Record<string, unknown> | undefined)?.safe).toBe('visible');
  });

  it('notifies subscribers and supports filtering', () => {
    const seen: LogEntry[][] = [];
    const unsubscribe = subscribeLogs((logs) => seen.push(logs));
    logging.warn('Money', 'pay cycle recalculated');

    expect(seen.length).toBeGreaterThan(1);
    expect(filterLogs(getLogs(), { levels: ['WARNING'] }).length).toBeGreaterThan(0);
    expect(filterLogs(getLogs(), { subsystem: 'Money' }).length).toBeGreaterThan(0);
    expect(filterLogs(getLogs(), { search: 'pay cycle' }).length).toBeGreaterThan(0);
    expect(filterLogs(getLogs(), { search: 'nothing-matches-this' })).toHaveLength(0);
    unsubscribe();
  });

  it('exports logs as text and JSON with metadata', () => {
    logging.info('Storage', 'export me');
    const text = exportLogsAsText(getLogs());
    expect(text).toContain('export me');

    const json = JSON.parse(exportLogsAsJson(getLogs()));
    expect(json.app).toBe('MindMesh');
    expect(json.entryCount).toBeGreaterThan(0);
    expect(Array.isArray(json.logs)).toBe(true);
  });

  it('applies the entry cap, age cutoff and byte budget', () => {
    const now = Date.now();
    const entries: LogEntry[] = [
      makeLog(0, { timestamp: new Date(now).toISOString() }),
      makeLog(1, { timestamp: new Date(now - 10 * 24 * 3600_000).toISOString() }), // older than 7 days
      makeLog(2, { timestamp: new Date(now - 1000).toISOString() }),
    ];

    const byAge = pruneLogs(entries, { maxEntries: 100, maxBytes: 1_000_000, retentionDays: 7 }, now);
    expect(byAge).toHaveLength(2);

    const byCount = pruneLogs(entries, { maxEntries: 1, maxBytes: 1_000_000, retentionDays: 30 }, now);
    expect(byCount).toHaveLength(1);

    const big = Array.from({ length: 10 }, (_, index) =>
      makeLog(index, { message: 'x'.repeat(500), timestamp: new Date(now - index).toISOString() })
    );
    const byBytes = pruneLogs(big, { maxEntries: 100, maxBytes: 1200, retentionDays: 30 }, now);
    expect(byBytes.length).toBeLessThan(big.length);
  });

  it('persists retention changes and trims stored entries', () => {
    for (let index = 0; index < 20; index += 1) logging.info('Storage', `entry ${index}`);
    const next = setLogRetention({ maxEntries: 60 });
    expect(next.maxEntries).toBe(60);
    expect(getLogRetention().maxEntries).toBe(60);
    expect(updateLogRetention({ retentionDays: 3 }).retentionDays).toBe(3);
  });

  it('recovers from a corrupted diagnostics store without losing the app', () => {
    localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, '{ this is not json');
    const store = loadDiagnosticsStore();
    expect(store.logs).toEqual([]);
    expect(store.history).toEqual([]);
    expect(store.version).toBeGreaterThan(0);
  });

  it('survives storage write failures without entering a logging loop', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => logging.error('Storage', 'write failure path')).not.toThrow();
    expect(getLogs().length).toBeGreaterThan(0);

    setItem.mockRestore();
  });

  it('records the most recent error so diagnostics can surface it', () => {
    recordError({
      message: 'simulated failure',
      at: new Date().toISOString(),
      subsystem: 'Storage',
      level: 'ERROR',
    });
    expect(loadDiagnosticsStore().lastError?.message).toBe('simulated failure');

    clearDiagnosticsHistory();
    expect(loadDiagnosticsStore().history).toEqual([]);
  });
});

describe('Diagnostics checks', () => {
  beforeEach(() => {
    localStorage.clear();
    flushLogs();
    clearLogs();
  });

  it('returns well-formed results for every check', async () => {
    const report = await runDiagnostics('quick');

    expect(report.results.length).toBeGreaterThan(20);
    for (const result of report.results) {
      expect(result.id).toBeTruthy();
      expect(result.name).toBeTruthy();
      expect(result.explanation).toBeTruthy();
      expect(['pass', 'warning', 'fail', 'unknown']).toContain(result.status);
      expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
    }

    const counted =
      report.summary.passed + report.summary.warnings + report.summary.failed + report.summary.unknown;
    expect(counted).toBe(report.results.length);
    expect(report.summary.total).toBe(report.results.length);
  });

  it('adds deep-only consistency checks when running deep diagnostics', async () => {
    const quick = await runDiagnostics('quick');
    const deep = await runDiagnostics('deep');

    expect(deep.results.length).toBeGreaterThan(quick.results.length);
    expect(deep.results.some((result) => result.id === 'deep.nodePositions')).toBe(true);
    expect(deep.summary.mode).toBe('deep');
  });

  it('reports a real storage failure instead of a hardcoded pass', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const report = await runDiagnostics('quick');
    setItem.mockRestore();

    const storageCheck = report.results.find((result) => result.id === 'storage.available');
    expect(storageCheck?.status).toBe('fail');
    expect(storageCheck?.explanation).toContain('could not be written');
    expect(storageCheck?.suggestedFix).toBeTruthy();
  });

  it('detects an older stored schema and a future schema', async () => {
    // Written directly: saveAllData always stamps the current schema version.
    const older = loadAllData();
    localStorage.setItem(
      'mindmesh_state_v2',
      JSON.stringify({ ...older, version: CURRENT_STORAGE_VERSION - 2 })
    );
    const olderReport = await runDiagnostics('quick');
    expect(olderReport.results.find((result) => result.id === 'migration.schema')?.status).toBe('warning');

    localStorage.setItem(
      'mindmesh_state_v2',
      JSON.stringify({ version: CURRENT_STORAGE_VERSION + 5, categories: [], reminders: [] })
    );
    const newerReport = await runDiagnostics('quick');
    const futureCheck = newerReport.results.find((result) => result.id === 'migration.schema');
    expect(futureCheck?.status).toBe('fail');
    expect(futureCheck?.explanation).toContain('newer');
  });

  it('reports notification capability honestly for the current environment', async () => {
    const report = await runDiagnostics('quick');
    const service = report.results.find((result) => result.id === 'notifications.service');
    const background = report.results.find((result) => result.id === 'notifications.background');
    const permission = report.results.find((result) => result.id === 'notifications.permission');

    expect(service).toBeDefined();
    expect(permission).toBeDefined();
    // jsdom has no Notification API, so nothing may claim background delivery.
    expect(background?.details?.backgroundSupported).toBe(false);
    expect(service?.status).toBe('warning');
  });

  it('flags reminders that point at a missing category', async () => {
    saveReminders([
      {
        id: 'orphan-1',
        categoryId: 'does-not-exist',
        title: 'Orphaned reminder',
        priority: 'medium',
        completed: false,
        createdAt: new Date().toISOString(),
        subtasks: [],
      },
    ]);

    const report = await runDiagnostics('quick');
    const reminderCheck = report.results.find((result) => result.id === 'reminders.storage');
    expect(reminderCheck?.status).toBe('warning');
    expect(reminderCheck?.fixId).toBe('fix.reassignOrphanedReminders');
    expect(reminderCheck?.userDataAtRisk).toBe(true);
  });

  it('flags unreadable reminder dates', async () => {
    saveReminders([
      {
        id: 'bad-date',
        categoryId: loadAllData().categories[0].id,
        title: 'Bad date',
        dueDate: '31/12/2099',
        priority: 'medium',
        completed: false,
        createdAt: new Date().toISOString(),
        subtasks: [],
      },
    ]);

    const report = await runDiagnostics('quick');
    expect(report.results.find((result) => result.id === 'reminders.dates')?.status).toBe('warning');
  });

  it('reports the most recent error in the last-error check', async () => {
    logging.error('Notifications', 'scheduling blew up', new Error('nope'));
    const report = await runDiagnostics('quick');
    const lastError = report.results.find((result) => result.id === 'app.lastError');
    expect(lastError?.status).toBe('warning');
    expect(String(lastError?.explanation)).toMatch(/hour|earlier/);
  });

  it('records startup results and warns only about real failures', async () => {
    vi.useFakeTimers();
    const promise = runStartupSelfCheck();
    await vi.advanceTimersByTimeAsync(2000);
    const result = await promise;
    vi.useRealTimers();

    expect(result.summary.total).toBeGreaterThan(0);
    expect(result.critical.every((entry) => entry.status === 'fail')).toBe(true);

    recordStartup({ passed: result.summary.passed, warnings: result.summary.warnings, failed: 0 });
    expect(loadDiagnosticsStore().lastStartupAt).toBeTruthy();
  });

  it('builds a privacy-safe text report by default', async () => {
    const report = await runDiagnostics('quick');
    const text = buildDiagnosticsReportText(report);

    expect(text).toContain('MindMesh Diagnostics Report');
    expect(text).toContain('App Version');
    expect(text).toContain('-- Notification Information --');
    expect(text).toContain('Excluded (privacy-safe default)');

    const withData = buildDiagnosticsReportText(report, { includeAppData: true });
    expect(withData).toContain('Application Data (explicitly included)');
  });

  it('keeps diagnostic history bounded', () => {
    for (let index = 0; index < DIAGNOSTICS_HISTORY_LIMIT + 15; index += 1) {
      appendDiagnosticsHistory({
        id: `diag-${index}`,
        timestamp: new Date().toISOString(),
        mode: 'quick',
        passed: 1,
        warnings: 0,
        failed: 0,
        unknown: 0,
        fixesPerformed: [],
      });
    }

    const history = loadDiagnosticsStore().history;
    expect(history.length).toBe(DIAGNOSTICS_HISTORY_LIMIT);
    // Newest first, so the most recent run survives the trim.
    expect(history[0].id).toBe(`diag-${DIAGNOSTICS_HISTORY_LIMIT + 14}`);
  });
});

describe('Diagnostics fixer', () => {
  beforeEach(() => {
    localStorage.clear();
    flushLogs();
    clearLogs();
  });

  it('implements every repair it advertises', () => {
    for (const fix of FIX_DEFINITIONS) {
      expect(isFixImplemented(fix.id), `missing implementation for ${fix.id}`).toBe(true);
    }
  });

  it('refuses a confirmation-required repair until it is confirmed', async () => {
    const before = loadAllData();
    const outcome = await runFix('fix.removeDuplicatedRecords', { confirmed: false });

    expect(outcome.status).toBe('manual_action_required');
    expect(loadAllData().reminders.length).toBe(before.reminders.length);
  });

  it('removes only orphaned layout positions', async () => {
    const state = loadAllData();
    const validNodeId = state.categories[0].id;
    saveNodePositions({
      [validNodeId]: { nodeId: validNodeId, x: 10, y: 20, manuallyPositioned: true },
      'ghost-node': { nodeId: 'ghost-node', x: 99, y: 99, manuallyPositioned: true },
    });

    const outcome = await runFix('fix.removeOrphanedNodePositions', { confirmed: true });
    const positions = loadNodePositions();

    expect(outcome.status === 'fixed' || outcome.status === 'still_failing').toBe(true);
    expect(positions['ghost-node']).toBeUndefined();
    expect(positions[validNodeId]).toBeDefined();
  });

  it('clears broken contact links without touching the reminder', async () => {
    const base = loadAllData();
    const reminder: Reminder = {
      id: 'linked-rem',
      categoryId: base.categories[0].id,
      title: 'Call the dentist',
      priority: 'medium',
      completed: false,
      createdAt: new Date().toISOString(),
      linkedContactId: 'contact-that-was-deleted',
      subtasks: [],
    };
    saveReminders([reminder]);

    await runFix('fix.clearDanglingContactLinks', { confirmed: true });
    const reminders = loadReminders();

    expect(reminders).toHaveLength(1);
    expect(reminders[0].title).toBe('Call the dentist');
    expect(reminders[0].linkedContactId).toBeUndefined();
  });

  it('removes orphaned notification entries and keeps valid ones', async () => {
    const base = loadAllData();
    const reminder: Reminder = {
      id: 'kept-rem',
      categoryId: base.categories[0].id,
      title: 'Kept reminder',
      priority: 'medium',
      completed: false,
      createdAt: new Date().toISOString(),
      subtasks: [],
    };
    saveReminders([reminder]);
    saveAllData({
      ...base,
      reminders: [reminder],
      notificationHistory: [
        {
          id: 'kept-entry',
          reminderId: 'kept-rem',
          reminderTitle: 'Kept reminder',
          scheduledFor: new Date(Date.now() + 60_000).toISOString(),
          offsetMinutes: 15,
          status: 'pending',
        },
        {
          id: 'orphan-entry',
          reminderId: 'deleted-rem',
          reminderTitle: 'Deleted reminder',
          scheduledFor: new Date(Date.now() + 60_000).toISOString(),
          offsetMinutes: 15,
          status: 'pending',
        },
      ],
    });

    await runFix('fix.removeOrphanedNotificationEntries', { confirmed: true });
    const history = loadNotificationHistory();

    expect(history.map((entry) => entry.id)).toEqual(['kept-entry']);
  });

  it('repairs missing default settings without changing chosen values', async () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      notifications: undefined,
      appearance: undefined,
      contactCategories: [],
      money: { ...base.money!, billCategories: [] },
    });

    await runFix('fix.repairDefaults', { confirmed: true });
    const state = loadAllData();

    expect(state.notifications).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(state.appearance).toBeTruthy();
    expect(state.contactCategories?.length).toBeGreaterThan(0);
    expect(state.money?.billCategories.length).toBeGreaterThan(0);
    expect(state.reminders).toHaveLength(base.reminders.length);
  });

  it('runs only safe repairs for Fix All and never deletes user records', async () => {
    const before = loadAllData();
    const summary = await runAllSafeFixes();

    expect(summary.outcomes.length).toBe(getSafeFixes().length);
    expect(summary.outcomes.every((outcome) => !outcome.fixId.startsWith('fix.removeDuplicated'))).toBe(true);

    const after = loadAllData();
    expect(after.reminders.length).toBe(before.reminders.length);
    expect(after.categories.length).toBeGreaterThanOrEqual(before.categories.length);
    expect(after.contacts?.length).toBe(before.contacts?.length);
  });

  it('logs every repair that runs', async () => {
    await runFix('fix.refreshNotificationSchedules', { confirmed: true });
    expect(exportLogsAsText(getLogs())).toContain('Refreshing notification schedules');
  });
});

describe('Backup integration for notifications and diagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
    flushLogs();
    clearLogs();
  });

  it('includes notification settings and history in a full backup', () => {
    const backup = createBackup();
    expect(backup.backupVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.data.notifications).toBeDefined();
    expect(backup.data.notifications?.enabled).toBe(loadNotificationSettings().enabled);
    expect(Array.isArray(backup.data.notificationHistory)).toBe(true);
    expect(backup.data.diagnostics?.preferences).toBeDefined();
  });

  it('excludes diagnostic logs by default and includes them only when opted in', () => {
    logging.info('Storage', 'a log line that may be exported');

    const defaultBackup = createBackup();
    expect(defaultBackup.data.diagnostics?.logs).toBeUndefined();
    expect(defaultBackup.data.diagnostics?.preferences.includeDiagnosticLogs).toBe(false);

    saveDiagnosticPreferences({ ...loadDiagnosticPreferences(), includeDiagnosticLogs: true });
    const optedIn = createBackup();
    expect(Array.isArray(optedIn.data.diagnostics?.logs)).toBe(true);
    expect((optedIn.data.diagnostics?.logs ?? []).length).toBeGreaterThan(0);

    saveDiagnosticPreferences({ ...loadDiagnosticPreferences(), includeDiagnosticLogs: false });
  });

  it('reports notification and diagnostics information in the restore summary', () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      notificationHistory: [
        {
          id: 'entry-1',
          reminderId: base.reminders[0]?.id ?? 'x',
          reminderTitle: 'Entry',
          scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
          offsetMinutes: 15,
          status: 'pending',
        },
      ],
    });

    const validation = validateBackup(JSON.stringify(createBackup()));
    expect(validation.valid).toBe(true);
    expect(validation.summary?.hasNotifications).toBe(true);
    expect(validation.summary?.notificationHistoryCount).toBe(1);
    expect(validation.summary?.scheduledNotificationsCount).toBe(1);
    expect(validation.summary?.hasDiagnosticLogs).toBe(false);
  });

  it('restores notification configuration and history round-trip', () => {
    const base = loadAllData();
    const notificationSettings = { ...loadNotificationSettings(), enabled: true, defaultSnoozeMinutes: 25 };
    saveAllData({
      ...base,
      notifications: notificationSettings,
      notificationHistory: [
        {
          id: 'round-trip',
          reminderId: base.reminders[0]?.id ?? 'x',
          reminderTitle: 'Round trip',
          scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
          offsetMinutes: 30,
          status: 'pending',
        },
      ],
    });
    const backup = createBackup();

    localStorage.clear();
    const restored = restoreBackup(backup);

    expect(restored.success).toBe(true);
    expect(loadNotificationSettings().defaultSnoozeMinutes).toBe(25);
    expect(loadNotificationHistory().map((entry) => entry.id)).toEqual(['round-trip']);
  });

  it('migrates an older backup that predates notifications to safe defaults', () => {
    const base = loadAllData();
    const legacy = {
      backupVersion: 1,
      appVersion: '1.3.0',
      appName: 'MindMesh',
      createdAt: new Date().toISOString(),
      schemaVersion: CURRENT_STORAGE_VERSION - 1,
      data: {
        categories: base.categories,
        reminders: base.reminders,
        nodePositions: base.nodePositions,
        money: base.money,
        contacts: base.contacts,
        appearance: base.appearance,
        preferences: { theme: 'dark' },
      },
    };

    const migrated = migrateBackup(legacy as never);
    expect(migrated.notifications).toEqual(DEFAULT_NOTIFICATION_SETTINGS);
    expect(migrated.notificationHistory).toEqual([]);
    expect(migrated.version).toBe(CURRENT_STORAGE_VERSION);
  });

  it('still rejects unsupported future backup versions', () => {
    const future = JSON.stringify({
      backupVersion: BACKUP_FORMAT_VERSION + 10,
      appVersion: '9.9.9',
      createdAt: new Date().toISOString(),
      schemaVersion: 99,
      data: { categories: [], reminders: [] },
    });
    const result = validateBackup(future);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Unsupported future backup format version');
  });
});

afterEach(() => {
  vi.useRealTimers();
  flushLogs();
});
