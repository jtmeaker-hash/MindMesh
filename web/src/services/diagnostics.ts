import { MindMeshStorageData, Reminder, NodePositionMap } from '../types';
import {
  DiagnosticCategory,
  DiagnosticMode,
  DiagnosticReport,
  DiagnosticResult,
  DiagnosticStatus,
  DiagnosticSummary,
  LogEntry,
  StoredErrorRecord,
  summarizeDiagnostics,
} from '../types/diagnostics';
import { NotificationHistoryEntry } from '../types/notifications';
import { CURRENT_STORAGE_VERSION, loadAllData } from './storage';
import { APPEARANCE_PRESETS, getDefaultAppearance, normalizeAppearance } from './appearance';
import { APP_VERSION, BACKUP_FORMAT_VERSION, createBackup, serializeBackup, validateBackup } from './backup';
import { computeNextDueDate, formatDateIso, parseIsoDate } from './recurrence';
import {
  getNotificationEngineState,
  getNotificationEnvironment,
  getPendingNotificationCount,
  getMissedNotificationCount,
} from './notifications';
import { getLogRetention, getLogs, isLoggingHealthy } from './logging';
import { hasDiagnosticsStorageFailed, loadDiagnosticsStore } from './diagnosticsStore';
import { computeDashboardMetrics } from '../utils/dashboard';
import { getCurrentPayCycleSummary, getUpcomingMoneyTimeline } from '../utils/finance';
import { logger } from './logger';
import { diagnoseRoutines } from './routineSafety';

export const BUILD_VERSION = `${APP_VERSION} (${import.meta.env.MODE})`;

const BACKUP_STORAGE_KEY = 'mindmesh_state_v2';
const LOCAL_STORAGE_PROBE_KEY = 'mindmesh_diag_probe';

interface DiagnosticsContext {
  mode: DiagnosticMode;
  state: MindMeshStorageData;
  now: number;
}

type DiagnosticCheck = (ctx: DiagnosticsContext) => DiagnosticResult | Promise<DiagnosticResult>;

interface ResultInput {
  id: string;
  name: string;
  category: DiagnosticCategory;
  status: DiagnosticStatus;
  explanation: string;
  details?: Record<string, unknown>;
  suggestedFix?: string;
  fixId?: string;
  userDataAtRisk?: boolean;
}

function makeResult(input: ResultInput): DiagnosticResult {
  return {
    ...input,
    timestamp: new Date().toISOString(),
    ...(input.details && Object.keys(input.details).length > 0 ? { details: input.details } : {}),
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function countInvalidDates(reminders: Reminder[]): number {
  let invalid = 0;
  for (const reminder of reminders) {
    if (reminder.dueDate) {
      const iso = /^\d{4}-\d{2}-\d{2}$/;
      if (!iso.test(reminder.dueDate)) {
        invalid += 1;
        continue;
      }
      const parsed = parseIsoDate(reminder.dueDate);
      if (Number.isNaN(parsed.getTime())) invalid += 1;
    }
    if (reminder.dueTime && !/^\d{1,2}:\d{2}$/.test(reminder.dueTime)) invalid += 1;
  }
  return invalid;
}

/* ------------------------------------------------------------------ *
 * Individual diagnostic checks
 * ------------------------------------------------------------------ */

const checkAppStartup: DiagnosticCheck = () => {
  const store = loadDiagnosticsStore();
  const hadPrevious = Boolean(store.lastStartupAt);
  return makeResult({
    id: 'app.startup',
    name: 'Application startup',
    category: 'app',
    status: 'pass',
    explanation: 'MindMesh bootstrapped and reached the diagnostics runner.',
    details: {
      lastStartupAt: store.lastStartupAt ?? 'none recorded',
      previousStartupWarnings: store.lastStartupSummary?.warnings ?? 0,
      previousStartupFailures: store.lastStartupSummary?.failed ?? 0,
      hasPreviousStartup: hadPrevious,
    },
  });
};

const checkAppVersions: DiagnosticCheck = () =>
  makeResult({
    id: 'app.version',
    name: 'App & build version',
    category: 'app',
    status: 'pass',
    explanation: `MindMesh ${APP_VERSION} is running.`,
    details: {
      appVersion: APP_VERSION,
      buildVersion: BUILD_VERSION,
      backupFormatVersion: BACKUP_FORMAT_VERSION,
      schemaVersion: CURRENT_STORAGE_VERSION,
      environment: import.meta.env.MODE,
    },
  });

const checkStorageAvailable: DiagnosticCheck = () => {
  let writable = true;
  let error: string | undefined;
  try {
    localStorage.setItem(LOCAL_STORAGE_PROBE_KEY, '1');
    localStorage.removeItem(LOCAL_STORAGE_PROBE_KEY);
  } catch (err) {
    writable = false;
    error = err instanceof Error ? err.message : 'unknown error';
  }

  return makeResult({
    id: 'storage.available',
    name: 'Local storage health',
    category: 'storage',
    status: writable ? 'pass' : 'fail',
    explanation: writable
      ? 'Local storage is readable and writable.'
      : 'Local storage could not be written to, so changes cannot be saved.',
    details: writable ? { writable: true } : { writable: false, error },
    ...(writable
      ? {}
      : {
          suggestedFix:
            'Free up device storage, close private/incognito mode, or allow site data for MindMesh, then reload.',
        }),
  });
};

const checkStorageReadable: DiagnosticCheck = ({ state }) => {
  const raw = (() => {
    try {
      return localStorage.getItem(BACKUP_STORAGE_KEY);
    } catch {
      return null;
    }
  })();

  if (!raw) {
    return makeResult({
      id: 'storage.readable',
      name: 'Stored data readability',
      category: 'storage',
      status: 'warning',
      explanation: 'No MindMesh state is stored on this device yet; defaults are in use.',
      suggestedFix: 'Start using MindMesh (or restore a backup) to create stored data.',
    });
  }

  let storedVersion: unknown;
  try {
    storedVersion = (JSON.parse(raw) as Record<string, unknown>).version;
  } catch {
    storedVersion = undefined;
  }

  const readable = Array.isArray(state.categories) && Array.isArray(state.reminders);
  return makeResult({
    id: 'storage.readable',
    name: 'Stored data readability',
    category: 'storage',
    status: readable ? 'pass' : 'fail',
    explanation: readable
      ? 'Stored state parsed successfully and loaded into the app.'
      : 'Stored state could not be parsed into the expected shape.',
    details: {
      payloadBytes: raw.length,
      storedSchemaVersion: storedVersion ?? 'unknown',
      categories: state.categories?.length ?? 0,
      reminders: state.reminders?.length ?? 0,
    },
    ...(readable
      ? {}
      : { suggestedFix: 'Restore a known-good backup, or reset MindMesh to start from a clean state.' }),
  });
};

const checkStateHydration: DiagnosticCheck = ({ state }) => {
  const issues: string[] = [];
  if (state.version !== CURRENT_STORAGE_VERSION) {
    issues.push(`state version ${state.version} != current ${CURRENT_STORAGE_VERSION}`);
  }
  if (hasDiagnosticsStorageFailed()) {
    issues.push('diagnostics store write failed');
  }

  const status: DiagnosticStatus = issues.length === 0 ? 'pass' : 'warning';
  return makeResult({
    id: 'storage.hydration',
    name: 'State hydration',
    category: 'storage',
    status,
    explanation:
      issues.length === 0
        ? 'All stored slices hydrated cleanly at the current schema version.'
        : `State hydrated with warnings: ${issues.join('; ')}.`,
    details: {
      schemaVersion: state.version,
      expectedSchemaVersion: CURRENT_STORAGE_VERSION,
      categories: state.categories.length,
      reminders: state.reminders.length,
      contacts: state.contacts?.length ?? 0,
      nodePositions: Object.keys(state.nodePositions || {}).length,
      appearance: Boolean(state.appearance),
      money: Boolean(state.money),
      diagnosticsStoreHealthy: !hasDiagnosticsStorageFailed(),
    },
    ...(issues.length > 0
      ? {
          suggestedFix: 'Re-run safe migrations to rebuild normalised state.',
          fixId: 'fix.rerunSafeMigrations',
        }
      : {}),
  });
};

const checkMigrationSchema: DiagnosticCheck = () => {
  let storedVersion: number | null = null;
  try {
    const raw = localStorage.getItem(BACKUP_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      storedVersion = isFiniteNumber(parsed.version) ? parsed.version : null;
    }
  } catch {
    storedVersion = null;
  }

  if (storedVersion === null) {
    return makeResult({
      id: 'migration.schema',
      name: 'Migration / schema version',
      category: 'storage',
      status: 'unknown',
      explanation: 'No schema version could be read from stored data.',
      details: { currentSchemaVersion: CURRENT_STORAGE_VERSION },
      suggestedFix: 'Save any change in MindMesh to write a fresh state payload.',
      fixId: 'fix.rerunSafeMigrations',
    });
  }

  if (storedVersion === CURRENT_STORAGE_VERSION) {
    return makeResult({
      id: 'migration.schema',
      name: 'Migration / schema version',
      category: 'storage',
      status: 'pass',
      explanation: `Stored schema v${storedVersion} matches the current schema.`,
      details: { storedVersion, currentSchemaVersion: CURRENT_STORAGE_VERSION },
    });
  }

  if (storedVersion < CURRENT_STORAGE_VERSION) {
    return makeResult({
      id: 'migration.schema',
      name: 'Migration / schema version',
      category: 'storage',
      status: 'warning',
      explanation: `Stored schema v${storedVersion} is older than the current v${CURRENT_STORAGE_VERSION}; it will be migrated on the next save.`,
      details: { storedVersion, currentSchemaVersion: CURRENT_STORAGE_VERSION },
      suggestedFix: 'Re-run safe migrations to normalise and re-save stored state.',
      fixId: 'fix.rerunSafeMigrations',
    });
  }

  return makeResult({
    id: 'migration.schema',
    name: 'Migration / schema version',
    category: 'storage',
    status: 'fail',
    explanation: `Stored schema v${storedVersion} is newer than this build supports (v${CURRENT_STORAGE_VERSION}).`,
    details: { storedVersion, currentSchemaVersion: CURRENT_STORAGE_VERSION },
    suggestedFix: 'Update MindMesh to the version that created this data. Avoid editing data with older builds.',
  });
};

const checkReminderStorage: DiagnosticCheck = ({ state }) => {
  const reminders = state.reminders || [];
  const ids = new Set<string>();
  const duplicates: string[] = [];
  const malformed: string[] = [];
  const orphanCategory: string[] = [];
  const categoryIds = new Set(state.categories.map((c) => c.id));

  for (const reminder of reminders) {
    if (!reminder || typeof reminder.id !== 'string' || !reminder.id) {
      malformed.push('(missing id)');
      continue;
    }
    if (ids.has(reminder.id)) duplicates.push(reminder.id);
    ids.add(reminder.id);
    if (typeof reminder.title !== 'string' || !reminder.title.trim()) malformed.push(reminder.id);
    if (!categoryIds.has(reminder.categoryId)) orphanCategory.push(reminder.id);
  }

  const problems = duplicates.length + malformed.length + orphanCategory.length;
  const status: DiagnosticStatus = malformed.length > 0 ? 'fail' : problems > 0 ? 'warning' : 'pass';

  return makeResult({
    id: 'reminders.storage',
    name: 'Reminder storage',
    category: 'reminders',
    status,
    explanation:
      problems === 0
        ? `${reminders.length} reminders stored with unique ids and valid categories.`
        : `Found ${problems} reminder storage issue(s): ${duplicates.length} duplicate id(s), ${malformed.length} malformed, ${orphanCategory.length} pointing at a missing category.`,
    details: {
      total: reminders.length,
      active: reminders.filter((r) => !r.completed).length,
      completed: reminders.filter((r) => r.completed).length,
      subtasks: reminders.reduce((sum, r) => sum + (r.subtasks?.length ?? 0), 0),
      duplicateIds: duplicates.slice(0, 10),
      malformedIds: malformed.slice(0, 10),
      missingCategoryIds: orphanCategory.slice(0, 10),
      categories: state.categories.length,
    },
    ...(problems > 0
      ? orphanCategory.length > 0
        ? {
            suggestedFix:
              'Reassign reminders whose category no longer exists to a valid category (the reminders themselves are never deleted).',
            fixId: 'fix.reassignOrphanedReminders',
            userDataAtRisk: true,
          }
        : {
            suggestedFix: 'Remove duplicated or malformed records after exporting a backup first.',
            fixId: 'fix.removeCorruptedRecords',
            userDataAtRisk: true,
          }
      : {}),
  });
};

const checkReminderDates: DiagnosticCheck = ({ state }) => {
  const invalid = countInvalidDates(state.reminders || []);
  return makeResult({
    id: 'reminders.dates',
    name: 'Reminder dates & times',
    category: 'reminders',
    status: invalid === 0 ? 'pass' : 'warning',
    explanation:
      invalid === 0
        ? 'All reminder due dates and times are valid.'
        : `${invalid} reminder date/time value(s) could not be parsed, so notifications cannot be scheduled for them.`,
    details: { invalidCount: invalid, total: (state.reminders || []).length },
    ...(invalid > 0
      ? {
          suggestedFix:
            'Open each affected reminder and re-select a valid date and time. Invalid dates are never changed automatically.',
        }
      : {}),
  });
};

const checkRecurrenceEngine: DiagnosticCheck = () => {
  try {
    const probe: Reminder = {
      id: 'diagnostics-recurrence-probe',
      categoryId: 'diagnostics',
      title: 'Diagnostics recurrence probe',
      priority: 'medium',
      completed: false,
      createdAt: new Date().toISOString(),
      dueDate: formatDateIso(new Date()),
      recurrence: { frequency: 'daily', interval: 1 },
      subtasks: [],
    };
    const next = computeNextDueDate(probe);
    const parsed = parseIsoDate(next);
    const valid = typeof next === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(next) && !Number.isNaN(parsed.getTime());
    return makeResult({
      id: 'recurrence.engine',
      name: 'Recurring reminder engine',
      category: 'reminders',
      status: valid ? 'pass' : 'fail',
      explanation: valid
        ? 'The recurrence engine produced a valid next occurrence.'
        : 'The recurrence engine returned an invalid next date.',
      details: { probeResult: next },
      ...(valid ? {} : { suggestedFix: 'Report this with the diagnostics export; recurrence rules may need to be re-entered.' }),
    });
  } catch (err) {
    return makeResult({
      id: 'recurrence.engine',
      name: 'Recurring reminder engine',
      category: 'reminders',
      status: 'fail',
      explanation: 'The recurrence engine threw while computing an occurrence.',
      details: { error: err instanceof Error ? err.message : String(err) },
      suggestedFix: 'Export diagnostics, then re-create the affected recurring reminder.',
    });
  }
};

const checkRecurrenceScheduling: DiagnosticCheck = ({ state }) => {
  const recurring = (state.reminders || []).filter(
    (r) => !r.completed && r.recurrence && r.recurrence.frequency !== 'none'
  );
  const missingSeriesId = recurring.filter((r) => !r.recurringSeriesId);
  const today = formatDateIso(new Date());
  const overdue = recurring.filter((r) => r.dueDate && r.dueDate < today);

  const status: DiagnosticStatus = missingSeriesId.length > 0 ? 'warning' : 'pass';
  return makeResult({
    id: 'recurrence.scheduling',
    name: 'Recurring reminder scheduling',
    category: 'reminders',
    status,
    explanation:
      missingSeriesId.length > 0
        ? `${missingSeriesId.length} recurring reminder(s) are missing their series identifier, so completions may not roll forward correctly.`
        : `${recurring.length} recurring reminder(s) are scheduled correctly.`,
    details: {
      recurringCount: recurring.length,
      missingSeriesIds: missingSeriesId.slice(0, 10),
      overdueOccurrences: overdue.length,
    },
    ...(missingSeriesId.length > 0
      ? {
          suggestedFix: 'Rebuild derived reminder metadata to restore the recurring series identifiers.',
          fixId: 'fix.rebuildReminderMetadata',
        }
      : {}),
  });
};

const checkNotificationPermission: DiagnosticCheck = () => {
  const env = getNotificationEnvironment();
  if (env.permission === 'granted') {
    return makeResult({
      id: 'notifications.permission',
      name: 'Notification permission',
      category: 'notifications',
      status: 'pass',
      explanation: 'Notification permission is granted.',
      details: { permission: env.permission, platform: env.platform },
    });
  }

  const isDenied = env.permission === 'denied';
  return makeResult({
    id: 'notifications.permission',
    name: 'Notification permission',
    category: 'notifications',
    status: isDenied ? 'warning' : env.permission === 'unsupported' ? 'warning' : 'warning',
    explanation: isDenied
      ? `Notifications are currently blocked on ${env.platform === 'android-native' ? 'Android' : 'this device'}.`
      : env.permission === 'unsupported'
        ? env.reason || 'Notifications are not available in this environment.'
        : 'Notification permission has not been requested yet.',
    details: { permission: env.permission, platform: env.platform },
    suggestedFix:
      isDenied || env.permission === 'default'
        ? env.settingsHint
          ? `Allow notifications for MindMesh, then retry. ${env.settingsHint}`
          : 'Allow notifications for MindMesh in your device or browser settings, then retry.'
        : env.settingsHint,
    fixId: env.platform === 'android-native' ? 'fix.openNotificationSettings' : undefined,
  });
};

const checkNotificationService: DiagnosticCheck = () => {
  const env = getNotificationEnvironment();
  return makeResult({
    id: 'notifications.service',
    name: 'Notification service status',
    category: 'notifications',
    status: env.supported ? 'pass' : 'warning',
    explanation: env.supported
      ? `Notification service available via ${env.platform} (${env.schedulingMode}).`
      : env.reason || 'No notification service is available in this environment.',
    details: {
      platform: env.platform,
      schedulingMode: env.schedulingMode,
      supported: env.supported,
      serviceWorkerSupported: env.serviceWorkerSupported,
      serviceWorkerActive: env.serviceWorkerActive,
      settingsHint: env.settingsHint ?? 'n/a',
    },
  });
};

const checkNotificationScheduling: DiagnosticCheck = ({ state }) => {
  const engine = getNotificationEngineState();
  const history: NotificationHistoryEntry[] = state.notificationHistory || [];
  const pending = getPendingNotificationCount(history);
  const missed = getMissedNotificationCount(history);
  const failed = history.filter((entry) => entry.status === 'failed').length;

  const problems: string[] = [];
  if (engine.lastError) problems.push(engine.lastError);
  if (failed > 0) problems.push(`${failed} notification(s) failed to deliver`);

  const status: DiagnosticStatus = problems.length === 0 ? 'pass' : failed > 0 ? 'fail' : 'warning';
  return makeResult({
    id: 'notifications.scheduling',
    name: 'Notification scheduling',
    category: 'notifications',
    status,
    explanation:
      problems.length === 0
        ? `${pending} notification(s) pending, ${missed} missed, none failed.`
        : problems.join('; '),
    details: {
      pending,
      missed,
      failed,
      fired: history.filter((entry) => entry.status === 'fired').length,
      nextFireAt: engine.nextFireAt ?? 'none',
      lastScheduledAt: engine.lastScheduledAt ?? 'none',
      lastFiredAt: engine.lastFiredAt ?? 'none',
      lastError: engine.lastError ?? 'none',
    },
    ...(problems.length > 0
      ? {
          suggestedFix: 'Refresh notification schedules, then send a test notification.',
          fixId: 'fix.refreshNotificationSchedules',
        }
      : {}),
  });
};

const checkNotificationBackground: DiagnosticCheck = () => {
  const env = getNotificationEnvironment();
  if (env.backgroundSupported) {
    return makeResult({
      id: 'notifications.background',
      name: 'Background scheduling availability',
      category: 'notifications',
      status: 'pass',
      explanation: 'The operating system can deliver scheduled reminders while MindMesh is closed.',
      details: { platform: env.platform, backgroundSupported: true },
    });
  }

  return makeResult({
    id: 'notifications.background',
    name: 'Background scheduling availability',
    category: 'notifications',
    status: 'warning',
    explanation: env.supported
      ? 'This platform can only deliver notifications while MindMesh is open. Anything that comes due while it is closed is caught up and flagged as missed when you return.'
      : env.reason || 'Background scheduling is not available in this environment.',
    details: { platform: env.platform, backgroundSupported: false, supported: env.supported },
    suggestedFix: env.supported
      ? 'Keep the MindMesh tab open around reminder times, or use the Android build with native notifications for full background delivery.'
      : undefined,
  });
};

const checkNotificationHistory: DiagnosticCheck = ({ state }) => {
  const history: NotificationHistoryEntry[] = state.notificationHistory || [];
  const reminderIds = new Set((state.reminders || []).map((r) => r.id));
  const orphans = history.filter((entry) => !reminderIds.has(entry.reminderId));
  const pendingOrphans = orphans.filter((entry) => entry.status === 'pending' || entry.status === 'snoozed');

  const status: DiagnosticStatus = pendingOrphans.length > 0 ? 'warning' : 'pass';
  return makeResult({
    id: 'notifications.history',
    name: 'Notification history',
    category: 'notifications',
    status,
    explanation:
      pendingOrphans.length === 0
        ? `${history.length} notification record(s) stored, all references intact.`
        : `${pendingOrphans.length} scheduled notification(s) point at reminders that no longer exist.`,
    details: {
      total: history.length,
      orphans: orphans.length,
      pendingOrphans: pendingOrphans.length,
    },
    ...(pendingOrphans.length > 0
      ? {
          suggestedFix: 'Remove orphaned notification schedule entries (reminders are not affected).',
          fixId: 'fix.removeOrphanedNotificationEntries',
        }
      : {}),
  });
};

const checkMoneyStorage: DiagnosticCheck = ({ state }) => {
  const money = state.money;
  if (!money) {
    return makeResult({
      id: 'money.storage',
      name: 'Money Management storage',
      category: 'money',
      status: 'warning',
      explanation: 'No Money Management data is stored yet.',
      suggestedFix: 'Open the Money tab once to initialise financial settings.',
      fixId: 'fix.repairDefaults',
    });
  }

  const nonFiniteBills = money.directDebits.filter((bill) => !isFiniteNumber(bill.amount)).length;
  const nonFiniteExtra = money.extraIncomeList.filter((entry) => !isFiniteNumber(entry.amount)).length;
  const nonFiniteTips = money.tipEntries.filter((entry) => !isFiniteNumber(entry.amount)).length;
  const problems = nonFiniteBills + nonFiniteExtra + nonFiniteTips;

  return makeResult({
    id: 'money.storage',
    name: 'Money Management storage',
    category: 'money',
    status: problems === 0 ? 'pass' : 'fail',
    explanation:
      problems === 0
        ? 'Money Management data is readable with valid numeric amounts.'
        : `${problems} financial record(s) contain invalid amounts.`,
    details: {
      directDebits: money.directDebits.length,
      activeDirectDebits: money.directDebits.filter((b) => b.active).length,
      billCategories: money.billCategories.length,
      extraIncome: money.extraIncomeList.length,
      tips: money.tipEntries.length,
      shifts: money.shifts.length,
      hasIncomeConfig: Boolean(money.incomeConfig),
      invalidAmounts: problems,
    },
    ...(problems > 0
      ? {
          suggestedFix: 'Export a backup, then remove or correct the affected financial record.',
          fixId: 'fix.removeCorruptedRecords',
          userDataAtRisk: true,
        }
      : {}),
  });
};

const checkMoneyCalculations: DiagnosticCheck = ({ state }) => {
  if (!state.money) {
    return makeResult({
      id: 'money.calculations',
      name: 'Money calculations',
      category: 'money',
      status: 'unknown',
      explanation: 'No Money Management data is stored, so pay cycle calculations were skipped.',
    });
  }

  try {
    const summary = getCurrentPayCycleSummary(state.money);
    const upcoming = getUpcomingMoneyTimeline(state.money, formatDateIso(new Date()), 7);
    const numeric = [
      summary.expectedPayThisCycle,
      summary.billsTotalThisCycle,
      summary.extraIncomeTotalThisCycle,
      summary.daysUntilNextPay,
      summary.daysRemainingInCycle,
    ].filter((value) => value !== undefined && value !== null);
    const badValues = numeric.filter((value) => !isFiniteNumber(value));
    const ok = badValues.length === 0 && Array.isArray(upcoming);

    return makeResult({
      id: 'money.calculations',
      name: 'Money calculations',
      category: 'money',
      status: ok ? 'pass' : 'fail',
      explanation: ok
        ? 'Pay cycle and bill calculations completed with finite values.'
        : 'Money calculations produced invalid numeric output.',
      details: {
        payCycleComputed: Boolean(summary),
        timelineItems: Array.isArray(upcoming) ? upcoming.length : 0,
        invalidValues: badValues.length,
      },
    });
  } catch (err) {
    return makeResult({
      id: 'money.calculations',
      name: 'Money calculations',
      category: 'money',
      status: 'fail',
      explanation: 'Money calculations threw while computing this pay cycle.',
      details: { error: err instanceof Error ? err.message : String(err) },
      suggestedFix: 'Check income configuration and pay cycle dates, then re-run diagnostics.',
    });
  }
};

const checkDashboardCalculations: DiagnosticCheck = ({ state }) => {
  try {
    const metrics = computeDashboardMetrics(state.reminders || [], state.categories || [], state.money ?? undefined);
    const numeric = Object.values(metrics).filter((value) => typeof value === 'number') as number[];
    const bad = numeric.filter((value) => !Number.isFinite(value));

    return makeResult({
      id: 'dashboard.calculations',
      name: 'Dashboard calculations',
      category: 'dashboard',
      status: bad.length === 0 ? 'pass' : 'fail',
      explanation:
        bad.length === 0
          ? 'Dashboard statistics and completion metrics computed successfully.'
          : 'Dashboard statistics produced non-finite values.',
      details: { metricKeys: Object.keys(metrics).length, invalidValues: bad.length },
      ...(bad.length > 0
        ? {
            suggestedFix: 'Rebuild derived dashboard statistics from stored reminders.',
            fixId: 'fix.rebuildDashboardStats',
          }
        : {}),
    });
  } catch (err) {
    return makeResult({
      id: 'dashboard.calculations',
      name: 'Dashboard calculations',
      category: 'dashboard',
      status: 'fail',
      explanation: 'Dashboard statistics threw while computing.',
      details: { error: err instanceof Error ? err.message : String(err) },
      suggestedFix: 'Repair derived dashboard statistics, then re-run diagnostics.',
      fixId: 'fix.rebuildDashboardStats',
    });
  }
};

const checkBackupSystem: DiagnosticCheck = () => {
  const store = loadDiagnosticsStore();
  let serialized = '';
  let error: string | undefined;
  try {
    // Uses the same serializer the export writes with, so this check covers the
    // real file body rather than a lookalike stringify.
    serialized = serializeBackup(createBackup());
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }

  const ok = !error && serialized.length > 0;
  const lastBackup = store.lastBackupAt ? Date.parse(store.lastBackupAt) : NaN;
  const daysSince = Number.isFinite(lastBackup) ? (Date.now() - lastBackup) / 86_400_000 : null;
  const stale = daysSince === null || daysSince > 30;

  const status: DiagnosticStatus = !ok ? 'fail' : stale ? 'warning' : 'pass';
  return makeResult({
    id: 'backup.system',
    name: 'Backup system',
    category: 'backup',
    status,
    explanation: !ok
      ? 'The backup serializer failed to produce a backup payload.'
      : daysSince === null
        ? 'The backup serializer works, but no backup has been created on this device yet.'
        : `The backup serializer works. Last backup was ${Math.floor(daysSince)} day(s) ago.`,
    details: {
      serializedBytes: serialized.length,
      lastBackupAt: store.lastBackupAt ?? 'never',
      daysSinceLastBackup: daysSince === null ? 'n/a' : Math.floor(daysSince),
      ...(error ? { error } : {}),
    },
    ...(!ok
      ? { suggestedFix: 'Export diagnostics and check for corrupted records before creating a backup.' }
      : stale
        ? { suggestedFix: 'Create a full backup from Settings → Backup & Restore Data.' }
        : {}),
  });
};

const checkRestoreSystem: DiagnosticCheck = () => {
  try {
    const backup = createBackup();
    const validation = validateBackup(serializeBackup(backup));
    return makeResult({
      id: 'restore.system',
      name: 'Restore system',
      category: 'backup',
      status: validation.valid ? 'pass' : 'fail',
      explanation: validation.valid
        ? 'A freshly generated backup passed the validator, so restore can read backups produced by this build.'
        : validation.error || 'A freshly generated backup failed validation.',
      details: {
        valid: validation.valid,
        remindersDetected: validation.summary?.remindersCount ?? 0,
        contactsDetected: validation.summary?.contactsCount ?? 0,
        warnings: validation.summary?.warnings.length ?? 0,
      },
      ...(validation.valid
        ? {}
        : { suggestedFix: 'Check for corrupted records, then re-run diagnostics.' }),
    });
  } catch (err) {
    return makeResult({
      id: 'restore.system',
      name: 'Restore system',
      category: 'backup',
      status: 'fail',
      explanation: 'The restore validator threw while checking a generated backup.',
      details: { error: err instanceof Error ? err.message : String(err) },
      suggestedFix: 'Export diagnostics and share them so the backup pipeline can be reviewed.',
    });
  }
};

/**
 * Reports which mechanism MindMesh will actually use to write a backup file on
 * this platform. A browser-only environment can hand the file to the download
 * manager but cannot confirm the write, so that reports as a warning.
 */
const checkBackupExportChannel: DiagnosticCheck = () => {
  const host = typeof window === 'undefined'
    ? null
    : (window as unknown as {
        MindMeshBackup?: { saveFile?: unknown };
        showSaveFilePicker?: unknown;
      });

  const android = typeof host?.MindMeshBackup?.saveFile === 'function';
  const fileAccess = typeof host?.showSaveFilePicker === 'function';
  const canDownload =
    typeof document !== 'undefined' &&
    typeof window !== 'undefined' &&
    typeof (window.URL?.createObjectURL) === 'function';

  const channel = android
    ? 'android-document-writer'
    : fileAccess
      ? 'file-system-access'
      : canDownload
        ? 'browser-download'
        : 'unavailable';

  const status: DiagnosticStatus = android || fileAccess ? 'pass' : canDownload ? 'warning' : 'fail';

  return makeResult({
    id: 'backup.exportChannel',
    name: 'Backup export destination',
    category: 'backup',
    status,
    explanation:
      status === 'pass'
        ? 'MindMesh can write a backup file and confirm the write completed.'
        : status === 'warning'
          ? 'MindMesh can start a browser download, but cannot confirm that the file was written. If no file appears, use “Copy backup JSON”.'
          : 'No way to save a backup file is available in this environment.',
    details: { channel, androidBridge: android, fileSystemAccess: fileAccess, downloadSupported: canDownload },
    ...(status === 'pass'
      ? {}
      : {
          suggestedFix:
            status === 'warning'
              ? 'Check your browser download settings, or copy the backup JSON manually from Settings → Backup & Restore Data.'
              : 'Open MindMesh in a browser that supports downloads.',
        }),
  });
};

const checkAppearanceConfig: DiagnosticCheck = ({ state }) => {
  const normalized = normalizeAppearance(state.appearance);
  const knownPreset = APPEARANCE_PRESETS.some((preset) => preset.id === normalized.themeId);
  const matchesStored = Boolean(state.appearance);

  const status: DiagnosticStatus = !matchesStored ? 'warning' : knownPreset ? 'pass' : 'warning';
  return makeResult({
    id: 'appearance.config',
    name: 'Theme & customisation',
    category: 'appearance',
    status,
    explanation: !matchesStored
      ? 'No appearance settings are stored, so defaults are being used.'
      : knownPreset
        ? `Appearance configuration is valid (theme "${normalized.themeId}").`
        : `Appearance theme "${normalized.themeId}" is not a known preset and was normalised.`,
    details: {
      themeId: normalized.themeId,
      background: normalized.background.kind,
      matrixEnabled: normalized.matrix.enabled,
      knownPreset,
      presetIds: APPEARANCE_PRESETS.map((preset) => preset.id),
    },
    ...(!matchesStored || !knownPreset
      ? {
          suggestedFix: 'Repair missing default settings to restore a valid appearance configuration.',
          fixId: 'fix.repairDefaults',
        }
      : {}),
  });
};

const checkNavigation: DiagnosticCheck = ({ state }) => {
  const slices: { name: string; ok: boolean }[] = [
    { name: 'reminders', ok: Array.isArray(state.reminders) && Array.isArray(state.categories) },
    { name: 'contacts', ok: Array.isArray(state.contacts) && Array.isArray(state.contactCategories) },
    { name: 'money', ok: Boolean(state.money) && Array.isArray(state.money?.directDebits ?? []) },
    { name: 'dashboard', ok: Array.isArray(state.reminders) },
  ];
  const broken = slices.filter((slice) => !slice.ok).map((slice) => slice.name);

  return makeResult({
    id: 'navigation.routes',
    name: 'Navigation destinations',
    category: 'navigation',
    status: broken.length === 0 ? 'pass' : 'warning',
    explanation:
      broken.length === 0
        ? 'Every navigation destination can be prepared from stored state.'
        : `These destinations could not be prepared from stored state: ${broken.join(', ')}.`,
    details: { destinations: slices.map((slice) => `${slice.name}:${slice.ok ? 'ok' : 'unavailable'}`) },
    ...(broken.length > 0
      ? {
          suggestedFix: 'Repair missing default settings so each destination has valid backing data.',
          fixId: 'fix.repairDefaults',
        }
      : {}),
  });
};

const checkPlatformInfo: DiagnosticCheck = () => {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const win = typeof window !== 'undefined' ? window : undefined;

  return makeResult({
    id: 'platform.info',
    name: 'Platform & OS information',
    category: 'platform',
    status: 'pass',
    explanation: 'Platform information available to the app was collected.',
    details: {
      userAgent: (nav?.userAgent || 'unknown').slice(0, 220),
      platform: nav?.platform || 'unknown',
      language: nav?.language || 'unknown',
      timezone: (() => {
        try {
          return Intl.DateTimeFormat().resolvedOptions().timeZone || 'unknown';
        } catch {
          return 'unknown';
        }
      })(),
      screen: win ? `${win.screen?.width ?? 0}x${win.screen?.height ?? 0}` : 'unknown',
      devicePixelRatio: win?.devicePixelRatio ?? 'unknown',
      hardwareConcurrency: nav?.hardwareConcurrency ?? 'unknown',
      touchPoints: nav?.maxTouchPoints ?? 0,
      standalone: win ? Boolean((win as unknown as { __mindmeshStandalone?: boolean }).__mindmeshStandalone) : false,
    },
  });
};

const checkServiceWorker: DiagnosticCheck = () => {
  const hasWindow = typeof window !== 'undefined';
  const nav = hasWindow ? navigator : undefined;
  const supported = Boolean(nav && 'serviceWorker' in nav);
  const active = supported ? Boolean(nav?.serviceWorker?.controller) : false;

  return makeResult({
    id: 'pwa.serviceWorker',
    name: 'Service worker status',
    category: 'platform',
    status: supported ? (active ? 'pass' : 'unknown') : 'unknown',
    explanation: !supported
      ? 'Service workers are not supported in this environment.'
      : active
        ? 'A service worker is controlling this page.'
        : 'Service workers are supported but none is controlling this page (normal for the Android WebView build).',
    details: { supported, active },
  });
};

const checkPwaInstall: DiagnosticCheck = () => {
  let installed = false;
  let displayMode = 'unknown';
  try {
    if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
      installed = window.matchMedia('(display-mode: standalone)').matches;
      displayMode = installed ? 'standalone' : 'browser';
    }
  } catch {
    displayMode = 'unknown';
  }
  const isAndroidNative = getNotificationEnvironment().platform === 'android-native';

  return makeResult({
    id: 'pwa.installed',
    name: 'PWA installation status',
    category: 'platform',
    status: 'pass',
    explanation: isAndroidNative
      ? 'MindMesh is running inside the Android application.'
      : installed
        ? 'MindMesh is installed and running as a standalone app.'
        : 'MindMesh is running as a normal browser page.',
    details: { installed, displayMode, androidApplication: isAndroidNative },
  });
};

const checkNetwork: DiagnosticCheck = () => {
  const online = typeof navigator !== 'undefined' && typeof navigator.onLine === 'boolean' ? navigator.onLine : true;
  const connection = (navigator as unknown as { connection?: { effectiveType?: string } })?.connection;

  return makeResult({
    id: 'network.connectivity',
    name: 'Internet connectivity',
    category: 'network',
    status: online ? 'pass' : 'warning',
    explanation: online
      ? 'A network connection is available.'
      : 'This device appears to be offline. MindMesh keeps working from local data and catches up notifications when it returns.',
    details: {
      online,
      effectiveType: connection?.effectiveType ?? 'unknown',
    },
  });
};

const checkStorageQuota: DiagnosticCheck = async () => {
  const storage = (navigator as unknown as {
    storage?: { estimate?: () => Promise<{ usage?: number; quota?: number }> };
  })?.storage;

  if (!storage?.estimate) {
    return makeResult({
      id: 'storage.quota',
      name: 'Available storage',
      category: 'storage',
      status: 'unknown',
      explanation: 'This platform does not expose storage usage information.',
    });
  }

  try {
    const estimate = await storage.estimate();
    const usage = estimate.usage ?? 0;
    const quota = estimate.quota ?? 0;
    const ratio = quota > 0 ? usage / quota : 0;
    const status: DiagnosticStatus = ratio > 0.9 ? 'fail' : ratio > 0.75 ? 'warning' : 'pass';

    return makeResult({
      id: 'storage.quota',
      name: 'Available storage',
      category: 'storage',
      status,
      explanation:
        status === 'pass'
          ? `Storage usage is healthy (${Math.round(ratio * 100)}% of the available quota).`
          : `Storage usage is high (${Math.round(ratio * 100)}% of the available quota).`,
      details: {
        usageBytes: usage,
        quotaBytes: quota,
        percentUsed: Math.round(ratio * 100),
      },
      ...(status === 'pass'
        ? {}
        : { suggestedFix: 'Export a backup and remove unused attachments or old data to free space.' }),
    });
  } catch (err) {
    return makeResult({
      id: 'storage.quota',
      name: 'Available storage',
      category: 'storage',
      status: 'unknown',
      explanation: 'Storage usage could not be read on this platform or context.',
      details: { error: err instanceof Error ? err.message : String(err) },
    });
  }
};

const checkLoggingHealth: DiagnosticCheck = () => {
  const logs = getLogs();
  const retention = getLogRetention();
  const healthy = isLoggingHealthy();
  const overBudget = logs.length > retention.maxEntries;

  const status: DiagnosticStatus = !healthy ? 'warning' : overBudget ? 'warning' : 'pass';
  return makeResult({
    id: 'logging.health',
    name: 'Diagnostic logging',
    category: 'app',
    status,
    explanation: !healthy
      ? 'The diagnostic log store reported a write failure; logging continues in memory only.'
      : overBudget
        ? `The retained log is over its ${retention.maxEntries}-entry budget.`
        : `${logs.length} log entries retained (limit ${retention.maxEntries}).`,
    details: {
      entries: logs.length,
      maxEntries: retention.maxEntries,
      maxBytes: retention.maxBytes,
      retentionDays: retention.retentionDays,
      errors: logs.filter((entry) => entry.level === 'ERROR' || entry.level === 'CRITICAL').length,
      warnings: logs.filter((entry) => entry.level === 'WARNING').length,
      healthy,
    },
    ...(overBudget
      ? {
          suggestedFix: 'Prune old diagnostic log entries to stay within the retention budget.',
          fixId: 'fix.pruneDiagnosticLogs',
        }
      : {}),
  });
};

const checkLastError: DiagnosticCheck = () => {
  const store = loadDiagnosticsStore();
  const lastError: StoredErrorRecord | undefined = store.lastError;
  if (!lastError) {
    return makeResult({
      id: 'app.lastError',
      name: 'Last application error',
      category: 'app',
      status: 'pass',
      explanation: 'No application errors have been recorded.',
      details: { crashesRecorded: store.crashes.length },
    });
  }

  const at = Date.parse(lastError.at);
  const hoursAgo = Number.isFinite(at) ? (Date.now() - at) / 3_600_000 : null;
  const recent = hoursAgo !== null && hoursAgo < 24;

  return makeResult({
    id: 'app.lastError',
    name: 'Last application error',
    category: 'app',
    status: recent ? 'warning' : 'pass',
    explanation: recent
      ? `An error was recorded ${Math.floor(hoursAgo)} hour(s) ago in the ${lastError.subsystem} subsystem.`
      : `The most recent recorded error was more than a day ago (${lastError.subsystem}).`,
    details: {
      message: lastError.message.slice(0, 200),
      subsystem: lastError.subsystem,
      level: lastError.level,
      at: lastError.at,
      crashesRecorded: store.crashes.length,
    },
    ...(recent
      ? { suggestedFix: 'Review the diagnostic log for the failing subsystem and export a report if it repeats.' }
      : {}),
  });
};

const checkLastStartup: DiagnosticCheck = () => {
  const store = loadDiagnosticsStore();
  return makeResult({
    id: 'app.lastStartup',
    name: 'Last successful startup',
    category: 'app',
    status: store.lastStartupAt ? 'pass' : 'warning',
    explanation: store.lastStartupAt
      ? `MindMesh last started successfully at ${store.lastStartupAt}.`
      : 'No previous successful startup has been recorded yet.',
    details: {
      lastStartupAt: store.lastStartupAt ?? 'never',
      warnings: store.lastStartupSummary?.warnings ?? 0,
      failures: store.lastStartupSummary?.failed ?? 0,
    },
  });
};

/* ------------------------------------------------------------------ *
 * Deep-only consistency checks
 * ------------------------------------------------------------------ */

const checkNodePositions: DiagnosticCheck = ({ state }) => {
  const positions: NodePositionMap = state.nodePositions || {};
  const known = new Set<string>(['root']);
  state.categories.forEach((c) => known.add(c.id));
  state.reminders.forEach((r) => {
    known.add(r.id);
    r.subtasks?.forEach((s) => known.add(s.id));
  });

  const orphans = Object.keys(positions).filter((nodeId) => !known.has(nodeId));
  return makeResult({
    id: 'deep.nodePositions',
    name: 'Manual layout positions',
    category: 'storage',
    status: orphans.length === 0 ? 'pass' : 'warning',
    explanation:
      orphans.length === 0
        ? 'All stored layout positions map to existing mesh nodes.'
        : `${orphans.length} stored layout position(s) reference nodes that no longer exist.`,
    details: { total: Object.keys(positions).length, orphans: orphans.slice(0, 10) },
    ...(orphans.length > 0
      ? {
          suggestedFix: 'Remove orphaned layout positions (only saved node coordinates are removed).',
          fixId: 'fix.removeOrphanedNodePositions',
        }
      : {}),
  });
};

const checkContactLinks: DiagnosticCheck = ({ state }) => {
  const contactIds = new Set((state.contacts || []).map((c) => c.id));
  const dangling = (state.reminders || []).filter(
    (r) => r.linkedContactId && !contactIds.has(r.linkedContactId)
  );
  return makeResult({
    id: 'deep.contactLinks',
    name: 'Reminder ↔ contact links',
    category: 'references',
    status: dangling.length === 0 ? 'pass' : 'warning',
    explanation:
      dangling.length === 0
        ? 'All reminder-to-contact links resolve to existing contacts.'
        : `${dangling.length} reminder(s) reference a contact that no longer exists.`,
    details: { contacts: contactIds.size, danglingLinks: dangling.length },
    ...(dangling.length > 0
      ? {
          suggestedFix:
            'Remove references to deleted contacts. Reminders are never modified or deleted; only the broken pointer is cleared.',
          fixId: 'fix.clearDanglingContactLinks',
        }
      : {}),
  });
};

const checkBillLinks: DiagnosticCheck = ({ state }) => {
  const billIds = new Set((state.money?.directDebits || []).map((b) => b.id));
  const extraIds = new Set((state.money?.extraIncomeList || []).map((e) => e.id));
  const danglingBills = (state.reminders || []).filter((r) => r.linkedBillId && !billIds.has(r.linkedBillId));
  const danglingExtra = (state.reminders || []).filter(
    (r) => r.linkedExtraIncomeId && !extraIds.has(r.linkedExtraIncomeId)
  );
  const total = danglingBills.length + danglingExtra.length;

  return makeResult({
    id: 'deep.financialLinks',
    name: 'Reminder ↔ financial links',
    category: 'references',
    status: total === 0 ? 'pass' : 'warning',
    explanation:
      total === 0
        ? 'All reminder-to-bill and reminder-to-income links resolve.'
        : `${total} reminder(s) reference direct debits or income entries that no longer exist.`,
    details: {
      directDebits: billIds.size,
      extraIncome: extraIds.size,
      danglingBillLinks: danglingBills.length,
      danglingIncomeLinks: danglingExtra.length,
    },
    ...(total > 0
      ? {
          suggestedFix: 'Clear broken financial links (records themselves are untouched).',
          fixId: 'fix.clearDanglingFinancialLinks',
        }
      : {}),
  });
};

const checkSubtaskOwnership: DiagnosticCheck = ({ state }) => {
  let mismatched = 0;
  for (const reminder of state.reminders || []) {
    for (const subtask of reminder.subtasks || []) {
      if (subtask.reminderId !== reminder.id) mismatched += 1;
    }
  }
  return makeResult({
    id: 'deep.subtaskOwnership',
    name: 'Subtask ownership',
    category: 'reminders',
    status: mismatched === 0 ? 'pass' : 'warning',
    explanation:
      mismatched === 0
        ? 'Every subtask is owned by its parent reminder.'
        : `${mismatched} subtask(s) carry a reminder id that does not match their parent.`,
    details: { mismatched },
    ...(mismatched > 0
      ? {
          suggestedFix: 'Rebuild derived reminder metadata so subtask ownership matches the parent reminder.',
          fixId: 'fix.rebuildReminderMetadata',
        }
      : {}),
  });
};

const checkDuplicateRecordIds: DiagnosticCheck = ({ state }) => {
  const duplicates: string[] = [];
  const collect = (ids: string[], label: string) => {
    const seen = new Set<string>();
    for (const id of ids) {
      if (seen.has(id)) duplicates.push(`${label}:${id}`);
      seen.add(id);
    }
  };

  collect((state.reminders || []).map((r) => r.id), 'reminder');
  collect((state.categories || []).map((c) => c.id), 'category');
  collect((state.contacts || []).map((c) => c.id), 'contact');
  collect((state.money?.directDebits || []).map((b) => b.id), 'bill');
  collect((state.money?.extraIncomeList || []).map((e) => e.id), 'income');

  return makeResult({
    id: 'deep.duplicateIds',
    name: 'Duplicate record identifiers',
    category: 'storage',
    status: duplicates.length === 0 ? 'pass' : 'fail',
    explanation:
      duplicates.length === 0
        ? 'No duplicate record identifiers were found.'
        : `${duplicates.length} duplicate identifier(s) found, which can break links between records.`,
    details: { duplicates: duplicates.slice(0, 10) },
    ...(duplicates.length > 0
      ? {
          suggestedFix:
            'Create a backup first, then remove duplicated records. This is never done automatically.',
          fixId: 'fix.removeDuplicatedRecords',
          userDataAtRisk: true,
        }
      : {}),
  });
};

const checkMoneyTimeline: DiagnosticCheck = ({ state }) => {
  if (!state.money) {
    return makeResult({
      id: 'deep.moneyTimeline',
      name: 'Money timeline',
      category: 'money',
      status: 'unknown',
      explanation: 'No Money Management data is stored, so the timeline was not built.',
    });
  }

  try {
    const today = formatDateIso(new Date());
    const items = getUpcomingMoneyTimeline(state.money, today, 30);
    return makeResult({
      id: 'deep.moneyTimeline',
      name: 'Money timeline',
      category: 'money',
      status: Array.isArray(items) ? 'pass' : 'fail',
      explanation: Array.isArray(items)
        ? `Upcoming money timeline built with ${items.length} item(s) over the next 30 days.`
        : 'The money timeline could not be built.',
      details: { itemCount: Array.isArray(items) ? items.length : -1 },
    });
  } catch (err) {
    return makeResult({
      id: 'deep.moneyTimeline',
      name: 'Money timeline',
      category: 'money',
      status: 'fail',
      explanation: 'Building the upcoming money timeline threw.',
      details: { error: err instanceof Error ? err.message : String(err) },
      suggestedFix: 'Check direct debit recurrence rules, then re-run deep diagnostics.',
    });
  }
};

const checkRoutineSafety: DiagnosticCheck = () => {
  const routineReport = diagnoseRoutines();
  const issues = routineReport.invalidSessions.length + routineReport.missingLinks.length + routineReport.quarantined.length;
  const status: DiagnosticStatus = routineReport.quarantined.length > 0 || routineReport.invalidSessions.length > 0 ? 'fail' : issues > 0 ? 'warning' : 'pass';
  return makeResult({
    id: 'routines.safety',
    name: 'Routine data safety',
    category: 'routines',
    status,
    explanation: issues === 0
      ? `Routine definitions are healthy; ${routineReport.scheduleRegistration.scheduled} schedule registration(s) and ${routineReport.trash.count} trashed record(s) checked.`
      : `${routineReport.invalidSessions.length} invalid session(s), ${routineReport.missingLinks.length} broken link(s), and ${routineReport.quarantined.length} quarantined record(s) need attention.`,
    details: routineReport as unknown as Record<string, unknown>,
    suggestedFix: issues > 0 ? 'Open Routine Diagnostics to rebuild schedules, clear stale sessions, repair links, or inspect quarantined records.' : undefined,
    fixId: issues > 0 ? 'fix.repairRoutineSafety' : undefined,
  });
};

/* ------------------------------------------------------------------ *
 * Runner
 * ------------------------------------------------------------------ */

const QUICK_CHECKS: DiagnosticCheck[] = [
  checkAppStartup,
  checkAppVersions,
  checkLastStartup,
  checkLastError,
  checkStorageAvailable,
  checkStorageReadable,
  checkStateHydration,
  checkMigrationSchema,
  checkStorageQuota,
  checkLoggingHealth,
  checkReminderStorage,
  checkReminderDates,
  checkRecurrenceEngine,
  checkRecurrenceScheduling,
  checkNotificationPermission,
  checkNotificationService,
  checkNotificationScheduling,
  checkNotificationBackground,
  checkNotificationHistory,
  checkMoneyStorage,
  checkMoneyCalculations,
  checkDashboardCalculations,
  checkBackupSystem,
  checkBackupExportChannel,
  checkRestoreSystem,
  checkAppearanceConfig,
  checkNavigation,
  checkPlatformInfo,
  checkServiceWorker,
  checkPwaInstall,
  checkNetwork,
  checkRoutineSafety,
];

const DEEP_CHECKS: DiagnosticCheck[] = [
  checkNodePositions,
  checkContactLinks,
  checkBillLinks,
  checkSubtaskOwnership,
  checkDuplicateRecordIds,
  checkMoneyTimeline,
];

export async function runDiagnostics(mode: DiagnosticMode = 'quick'): Promise<DiagnosticReport> {
  const state = loadAllData();
  const ctx: DiagnosticsContext = { mode, state, now: Date.now() };
  const checks = mode === 'deep' ? [...QUICK_CHECKS, ...DEEP_CHECKS] : QUICK_CHECKS;

  const results: DiagnosticResult[] = [];
  for (const check of checks) {
    try {
      results.push(await check(ctx));
    } catch (err) {
      // A failed check must never take the diagnostics page down.
      results.push(
        makeResult({
          id: `unknown.${results.length}`,
          name: 'Diagnostic check',
          category: 'app',
          status: 'unknown',
          explanation: 'A diagnostic check threw while running.',
          details: { error: err instanceof Error ? err.message : String(err) },
        })
      );
    }
  }

  const report: DiagnosticReport = { summary: summarizeDiagnostics(results, mode), results };
  logger.info('Diagnostics', `Ran ${mode} diagnostics`, {
    passed: report.summary.passed,
    warnings: report.summary.warnings,
    failed: report.summary.failed,
    unknown: report.summary.unknown,
  });
  return report;
}

export interface StartupSelfCheckResult {
  summary: DiagnosticSummary;
  critical: DiagnosticResult[];
  /** Non-blocking warning message for the UI banner. */
  bannerMessage?: string;
}

const STARTUP_CHECK_DELAY_MS = 1500;

/**
 * Lightweight startup health check. Runs off the critical path so it can never
 * noticeably delay launch, and only raises a banner for genuine problems.
 */
export async function runStartupSelfCheck(): Promise<StartupSelfCheckResult> {
  await new Promise((resolve) => setTimeout(resolve, STARTUP_CHECK_DELAY_MS));
  const report = await runDiagnostics('quick');
  const critical = report.results.filter((result) => result.status === 'fail');

  const bannerMessage =
    critical.length > 0
      ? `MindMesh detected ${critical.length} system issue${critical.length === 1 ? '' : 's'}.`
      : undefined;

  return { summary: report.summary, critical, bannerMessage };
}

export interface DiagnosticsReportOptions {
  includeAppData?: boolean;
  logs?: LogEntry[];
}

/** Builds a privacy-safe, human-readable diagnostics report. */
export function buildDiagnosticsReportText(
  report: DiagnosticReport,
  options: DiagnosticsReportOptions = {}
): string {
  const store = loadDiagnosticsStore();
  const env = getNotificationEnvironment();
  const logs = options.logs ?? getLogs();
  const recentErrors = logs.filter((entry) => entry.level === 'ERROR' || entry.level === 'CRITICAL').slice(0, 10);

  const lines: string[] = [];
  const push = (line = '') => lines.push(line);

  push('MindMesh Diagnostics Report');
  push('===========================');
  push(`Generated: ${new Date().toISOString()}`);
  push();

  push('-- Build --');
  push(`App Version: ${APP_VERSION}`);
  push(`Build Version: ${BUILD_VERSION}`);
  push(`Schema Version: ${CURRENT_STORAGE_VERSION}`);
  push(`Backup Format Version: ${BACKUP_FORMAT_VERSION}`);
  push(`Platform: ${env.platform}`);
  push(`Notification Mode: ${env.schedulingMode}`);
  push(`User Agent: ${(typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown').slice(0, 200)}`);
  push();

  push('-- Diagnostics Summary --');
  push(`Mode: ${report.summary.mode}`);
  push(`Overall: ${report.summary.overall.toUpperCase()}`);
  push(`Passed: ${report.summary.passed}`);
  push(`Warnings: ${report.summary.warnings}`);
  push(`Failed: ${report.summary.failed}`);
  push(`Unknown: ${report.summary.unknown}`);
  push(`Run at: ${report.summary.runAt}`);
  push(`Last successful startup: ${store.lastStartupAt ?? 'never'}`);
  push();

  const failures = report.results.filter((result) => result.status === 'fail');
  if (failures.length > 0) {
    push('-- Failed Checks --');
    for (const result of failures) {
      push(`[FAIL] ${result.name} (${result.id})`);
      push(`  ${result.explanation}`);
      if (result.suggestedFix) push(`  Suggested fix: ${result.suggestedFix}`);
    }
    push();
  }

  const warnings = report.results.filter((result) => result.status === 'warning');
  if (warnings.length > 0) {
    push('-- Warnings --');
    for (const result of warnings) {
      push(`[WARNING] ${result.name} (${result.id})`);
      push(`  ${result.explanation}`);
      if (result.suggestedFix) push(`  Suggested fix: ${result.suggestedFix}`);
    }
    push();
  }

  push('-- Recent Errors --');
  if (recentErrors.length === 0) {
    push('None recorded.');
  } else {
    for (const entry of recentErrors) {
      push(`[${entry.timestamp}] [${entry.subsystem}] ${entry.message}`);
    }
  }
  push();

  push('-- Recent System Logs --');
  const recent = logs.slice(0, 40);
  if (recent.length === 0) {
    push('None recorded.');
  } else {
    for (const entry of recent) {
      const details =
        entry.details && Object.keys(entry.details).length > 0 ? ` ${JSON.stringify(entry.details)}` : '';
      push(`${entry.timestamp} ${entry.level} [${entry.subsystem}] ${entry.message}${details}`);
    }
  }
  push();

  push('-- Storage Information --');
  const storageCheck = report.results.find((result) => result.id === 'storage.quota');
  const hydration = report.results.find((result) => result.id === 'storage.hydration');
  push(`Storage quota: ${JSON.stringify(storageCheck?.details ?? {})}`);
  push(`State: ${JSON.stringify(hydration?.details ?? {})}`);
  push();

  push('-- Notification Information --');
  push(`Permission: ${env.permission}`);
  push(`Supported: ${env.supported}`);
  push(`Background supported: ${env.backgroundSupported}`);
  push(`Pending: ${getPendingNotificationCount(loadAllData().notificationHistory || [])}`);
  push(`Missed: ${getMissedNotificationCount(loadAllData().notificationHistory || [])}`);
  push();

  push('-- Backup Information --');
  push(`Last backup: ${store.lastBackupAt ?? 'never'}`);
  push(`Last restore: ${store.lastRestoreAt ?? 'never'}`);
  push();

  if (options.includeAppData) {
    push('-- Application Data (explicitly included) --');
    const state = loadAllData();
    push(`Categories: ${state.categories.length}`);
    push(`Active reminders: ${state.reminders.filter((r) => !r.completed).length}`);
    push(`Completed reminders: ${state.reminders.filter((r) => r.completed).length}`);
    push(`Contacts: ${(state.contacts || []).length}`);
    push(`Direct debits: ${(state.money?.directDebits || []).length}`);
  } else {
    push('-- Application Data --');
    push('Excluded (privacy-safe default). Reminder titles, notes, contacts and financial records are not exported.');
  }

  return lines.join('\n');
}

/** Full diagnostics report as JSON, aligned with the text report's content. */
export function buildDiagnosticsReportJson(
  report: DiagnosticReport,
  options: DiagnosticsReportOptions = {}
): string {
  const includeAppData = Boolean(options.includeAppData);
  const store = loadDiagnosticsStore();
  const env = getNotificationEnvironment();
  const state = loadAllData();

  return JSON.stringify(
    {
      report: 'MindMesh Diagnostics Report',
      generatedAt: new Date().toISOString(),
      build: {
        appVersion: APP_VERSION,
        buildVersion: BUILD_VERSION,
        schemaVersion: CURRENT_STORAGE_VERSION,
        backupFormatVersion: BACKUP_FORMAT_VERSION,
      },
      platform: {
        notificationPlatform: env.platform,
        schedulingMode: env.schedulingMode,
        notificationPermission: env.permission,
        backgroundSupported: env.backgroundSupported,
        userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown').slice(0, 200),
      },
      summary: report.summary,
      failed: report.results.filter((result) => result.status === 'fail'),
      warnings: report.results.filter((result) => result.status === 'warning'),
      allResults: report.results,
      logs: (options.logs ?? getLogs()).slice(0, 200),
      storage: report.results.find((result) => result.id === 'storage.hydration')?.details ?? {},
      notifications: {
        permission: env.permission,
        pending: getPendingNotificationCount(state.notificationHistory || []),
        missed: getMissedNotificationCount(state.notificationHistory || []),
      },
      backups: {
        lastBackupAt: store.lastBackupAt ?? null,
        lastRestoreAt: store.lastRestoreAt ?? null,
      },
      applicationData: includeAppData
        ? {
            categories: state.categories.length,
            activeReminders: state.reminders.filter((r) => !r.completed).length,
            completedReminders: state.reminders.filter((r) => r.completed).length,
            contacts: (state.contacts || []).length,
            directDebits: (state.money?.directDebits || []).length,
          }
        : 'excluded (privacy-safe default)',
    },
    null,
    2
  );
}

export { getDefaultAppearance };
