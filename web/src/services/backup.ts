import { MindMeshStorageData, Reminder } from '../types';
import {
  MindMeshBackupFile,
  MindMeshBackupData,
  RestoreSummary,
  BackupValidationResult,
} from '../types/backup';
import {
  loadAllData,
  saveAllData,
  resetMindMeshEntirely,
  inspectStorageReadability,
  saveLastImportedNodePositions,
  CURRENT_STORAGE_VERSION,
} from './storage';
import { getDefaultAppearance, normalizeAppearance } from './appearance';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { INITIAL_CONTACTS, INITIAL_CONTACT_CATEGORIES, INITIAL_CONTACT_RELATIONSHIPS } from '../utils/sampleContactData';
import { INITIAL_CATEGORIES } from '../utils/sampleData';
import { normalizeCategories } from './categories';
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationHistoryEntry,
  normalizeNotificationHistory,
  normalizeNotificationSettings,
} from '../types/notifications';
import {
  DiagnosticsHistoryEntry,
  DiagnosticPreferences,
  LogEntry,
  normalizeDiagnosticPreferences,
} from '../types/diagnostics';
import { loadDiagnosticPreferences, saveDiagnosticPreferences } from './storage';
import { loadDiagnosticsStore, recordBackup, recordRestore } from './diagnosticsStore';
import { getLogs } from './logging';
import { logger } from './logger';
import { normalizeRoutines } from '../types/routine';
import { normalizeSmartEngineSettings } from '../types/smartEngine';
import { normalizeNodePositions } from './nodePositions';

export const BACKUP_FORMAT_VERSION = 3;
export const APP_VERSION = '1.4.0';

/**
 * Creates a complete full backup of MindMesh user-persisted data and configuration.
 */
export function createBackup(): MindMeshBackupFile {
  // loadAllData() falls back to sample defaults on a read failure. Exported data
  // must never silently be those defaults, so fail loudly before collecting it.
  const readability = inspectStorageReadability();
  if (!readability.accessible) {
    throw new Error(
      'MindMesh could not read its local storage, so a backup cannot be trusted. Check that storage is enabled for this app and try again.'
    );
  }
  if (readability.hasPayload && !readability.readable) {
    throw new Error(
      'Your saved MindMesh data could not be read, so exporting now would produce an empty backup. Restore an earlier backup or run Diagnostics first.'
    );
  }

  const state: MindMeshStorageData = loadAllData();
  const notificationSettings = normalizeNotificationSettings(state.notifications);
  const diagnosticPreferences: DiagnosticPreferences = loadDiagnosticPreferences();

  const backupData: MindMeshBackupData = {
    categories: state.categories || [],
    reminders: state.reminders || [],
    routines: state.routines || [],
    nodePositions: state.nodePositions || {},
    money: state.money || getDefaultMoneyState(),
    contacts: state.contacts || INITIAL_CONTACTS,
    contactCategories: state.contactCategories || INITIAL_CONTACT_CATEGORIES,
    contactRelationships: state.contactRelationships || INITIAL_CONTACT_RELATIONSHIPS,
    appearance: normalizeAppearance(state.appearance),
    notifications: notificationSettings,
    notificationHistory: normalizeNotificationHistory(
      state.notificationHistory,
      notificationSettings.historyLimit
    ),
    smartEngineSettings: normalizeSmartEngineSettings(state.smartEngineSettings),
    preferences: state.preferences || { theme: 'dark' },
    diagnostics: buildDiagnosticsBackupSection(diagnosticPreferences),
    statistics: {
      totalCompletedCount: (state.reminders || []).filter((r) => r.completed).length,
      createdAt: new Date().toISOString(),
    },
  };

  const backupFile: MindMeshBackupFile = {
    backupVersion: BACKUP_FORMAT_VERSION,
    appVersion: APP_VERSION,
    appName: 'MindMesh',
    createdAt: new Date().toISOString(),
    schemaVersion: CURRENT_STORAGE_VERSION,
    data: backupData,
  };

  logger.info('BackupService', 'Created full MindMesh backup payload', {
    reminders: backupData.reminders.length,
    contacts: backupData.contacts.length,
    categories: backupData.categories.length,
    diagnosticLogsIncluded: Boolean(backupData.diagnostics?.logs?.length),
  });

  recordBackup();

  return backupFile;
}

/**
 * Diagnostics always contribute their preferences; logs are opt-in so a default
 * backup stays privacy-safe.
 */
function buildDiagnosticsBackupSection(preferences: DiagnosticPreferences): {
  preferences: DiagnosticPreferences;
  logs?: LogEntry[];
  history?: DiagnosticsHistoryEntry[];
} {
  const section: {
    preferences: DiagnosticPreferences;
    logs?: LogEntry[];
    history?: DiagnosticsHistoryEntry[];
  } = { preferences };

  if (preferences.includeDiagnosticLogs) {
    section.logs = getLogs();
    section.history = loadDiagnosticsStore().history;
  }

  return section;
}

/**
 * Generates formatted default filename for export: mindmesh-backup-YYYY-MM-DD-HHMMSS.json
 */
export function generateBackupFilename(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const mins = pad(date.getMinutes());
  const secs = pad(date.getSeconds());

  return `mindmesh-backup-${year}-${month}-${day}-${hours}${mins}${secs}.json`;
}

/**
 * Validates any imported backup JSON structure, types, versions, and integrity.
 */
export function validateBackup(jsonContent: string): BackupValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (err) {
    return {
      valid: false,
      error: `Invalid JSON syntax: ${err instanceof Error ? err.message : 'Parse error'}`,
    };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return {
      valid: false,
      error: 'Invalid backup format: root payload must be an object',
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Check backupVersion
  if (typeof obj.backupVersion !== 'number') {
    return {
      valid: false,
      error: 'Invalid backup file: missing or invalid backupVersion property',
    };
  }

  // Reject unsupported future backup versions safely
  if (obj.backupVersion > BACKUP_FORMAT_VERSION) {
    return {
      valid: false,
      error: `Unsupported future backup format version (${obj.backupVersion}). Please update MindMesh to restore this file.`,
    };
  }

  if (obj.backupVersion < 1) {
    return {
      valid: false,
      error: `Invalid backupVersion (${obj.backupVersion})`,
    };
  }

  // Check data payload
  if (!obj.data || typeof obj.data !== 'object' || Array.isArray(obj.data)) {
    return {
      valid: false,
      error: 'Invalid backup structure: missing data payload',
    };
  }

  const data = obj.data as Record<string, unknown>;
  const warnings: string[] = [];

  // Check categories & reminders arrays
  if (!Array.isArray(data.categories)) {
    return {
      valid: false,
      error: 'Corrupted backup: categories must be a valid array',
    };
  }

  if (!Array.isArray(data.reminders)) {
    return {
      valid: false,
      error: 'Corrupted backup: reminders must be a valid array',
    };
  }

  if (data.routines !== undefined && !Array.isArray(data.routines)) {
    return {
      valid: false,
      error: 'Corrupted backup: routines must be a valid array when present',
    };
  }

  if (Array.isArray(data.routines)) {
    const routineResult = normalizeRoutines(data.routines);
    if (routineResult.quarantined.length > 0) {
      warnings.push(`${routineResult.quarantined.length} malformed routine record(s) will be quarantined during restore.`);
    }
  }

  // Sanity check reminders records & duplicate IDs
  const reminderIds = new Set<string>();
  for (const rem of data.reminders) {
    if (!rem || typeof rem !== 'object') {
      return {
        valid: false,
        error: 'Malformed reminder record detected in backup',
      };
    }
    const r = rem as Record<string, unknown>;
    if (typeof r.id !== 'string' || !r.id.trim()) {
      return {
        valid: false,
        error: 'Reminder record has invalid or missing ID',
      };
    }
    if (reminderIds.has(r.id)) {
      warnings.push(`Duplicate reminder ID detected: ${r.id}`);
    } else {
      reminderIds.add(r.id);
    }
    if (typeof r.title !== 'string') {
      return {
        valid: false,
        error: `Reminder "${r.id}" has invalid title property`,
      };
    }
  }

  // Check contacts if present
  let contactsCount = 0;
  if (data.contacts !== undefined) {
    if (!Array.isArray(data.contacts)) {
      return {
        valid: false,
        error: 'Invalid contacts list in backup',
      };
    }
    const contactIds = new Set<string>();
    for (const c of data.contacts) {
      if (!c || typeof c !== 'object') {
        return {
          valid: false,
          error: 'Malformed contact record in backup',
        };
      }
      const ct = c as Record<string, unknown>;
      if (typeof ct.id !== 'string' || !ct.id.trim()) {
        return {
          valid: false,
          error: 'Contact record has invalid or missing ID',
        };
      }
      if (contactIds.has(ct.id)) {
        warnings.push(`Duplicate contact ID detected: ${ct.id}`);
      } else {
        contactIds.add(ct.id);
      }
      if (typeof ct.fullName !== 'string' || !ct.fullName.trim()) {
        return {
          valid: false,
          error: `Contact "${ct.id}" is missing a valid fullName`,
        };
      }
    }
    contactsCount = data.contacts.length;
  }

  // Money stats
  let directDebitsCount = 0;
  let extraIncomeCount = 0;
  let tipsCount = 0;
  let shiftsCount = 0;
  let hasMoneyConfig = false;

  if (data.money && typeof data.money === 'object') {
    const money = data.money as Record<string, unknown>;
    if (Array.isArray(money.directDebits)) directDebitsCount = money.directDebits.length;
    if (Array.isArray(money.extraIncomeList)) extraIncomeCount = money.extraIncomeList.length;
    if (Array.isArray(money.tipEntries)) tipsCount = money.tipEntries.length;
    if (Array.isArray(money.shifts)) shiftsCount = money.shifts.length;
    if (money.incomeConfig) hasMoneyConfig = true;
  }

  // Appearance / visual customisation (sanitised, never fatal)
  let hasAppearance = false;
  let appearanceTheme: string | undefined;
  if (data.appearance !== undefined) {
    if (data.appearance && typeof data.appearance === 'object' && !Array.isArray(data.appearance)) {
      const normalized = normalizeAppearance(data.appearance);
      hasAppearance = true;
      appearanceTheme = normalized.themeId;
      if (!(
        typeof (data.appearance as Record<string, unknown>).themeId === 'string'
      )) {
        warnings.push('Appearance settings were missing a theme id; defaults will be applied.');
      }
    } else {
      warnings.push('Appearance settings in this backup were unreadable and will fall back to defaults.');
    }
  }

  // Notifications (sanitised, never fatal)
  let hasNotifications = false;
  if (data.notifications !== undefined) {
    if (data.notifications && typeof data.notifications === 'object' && !Array.isArray(data.notifications)) {
      hasNotifications = true;
    } else {
      warnings.push('Notification settings in this backup were unreadable and will fall back to defaults.');
    }
  }

  const notificationHistoryCount = Array.isArray(data.notificationHistory)
    ? data.notificationHistory.filter((entry) => Boolean(entry) && typeof entry === 'object').length
    : 0;
  const scheduledNotificationsCount = Array.isArray(data.notificationHistory)
    ? data.notificationHistory.filter(
        (entry) => Boolean(entry) && (entry.status === 'pending' || entry.status === 'snoozed')
      ).length
    : 0;
  if (data.notificationHistory !== undefined && !Array.isArray(data.notificationHistory)) {
    warnings.push('Notification history in this backup was unreadable and will be discarded.');
  }

  // Diagnostics (preferences always; logs only when the backup opted in)
  let diagnosticsPreferences: DiagnosticPreferences | undefined;
  let diagnosticLogCount = 0;
  if (data.diagnostics !== undefined) {
    if (data.diagnostics && typeof data.diagnostics === 'object' && !Array.isArray(data.diagnostics)) {
      const section = data.diagnostics as Record<string, unknown>;
      diagnosticsPreferences = normalizeDiagnosticPreferences(section.preferences);
      if (Array.isArray(section.logs)) diagnosticLogCount = section.logs.length;
    } else {
      warnings.push('Diagnostics settings in this backup were unreadable and will fall back to defaults.');
    }
  }

  const completedReminders = (data.reminders as Reminder[]).filter((r) => r.completed).length;

  const rawNodePositions = data.nodePositions;
  const readableNodePositions =
    Boolean(rawNodePositions) && typeof rawNodePositions === 'object' && !Array.isArray(rawNodePositions);
  const nodePositionsCount = readableNodePositions
    ? Object.keys(rawNodePositions as Record<string, unknown>).length
    : 0;
  if (rawNodePositions !== undefined && !readableNodePositions) {
    warnings.push('Node positions in this backup were unreadable and will fall back to the automatic layout.');
  }

  const summary: RestoreSummary = {
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : 'unknown',
    backupVersion: obj.backupVersion,
    schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1,
    categoriesCount: data.categories.length,
    remindersCount: data.reminders.length,
    completedRemindersCount: completedReminders,
    nodePositionsCount,
    contactsCount,
    directDebitsCount,
    extraIncomeCount,
    tipsCount,
    shiftsCount,
    hasMoneyConfig,
    hasAppearance,
    appearanceTheme,
    hasNotifications,
    notificationHistoryCount,
    scheduledNotificationsCount,
    hasDiagnosticLogs: diagnosticLogCount > 0,
    diagnosticLogCount,
    ...(diagnosticsPreferences ? { diagnosticsPreferences } : {}),
    routineCount: Array.isArray(data.routines) ? data.routines.length - normalizeRoutines(data.routines).quarantined.length : 0,
    activeRoutineCount: Array.isArray(data.routines) ? normalizeRoutines(data.routines).routines.filter((routine) => Boolean(routine.activeSession)).length : 0,
    routineHistoryCount: Array.isArray(data.routines) ? normalizeRoutines(data.routines).routines.reduce((count, routine) => count + routine.history.length, 0) : 0,
    warnings,
  };

  return {
    valid: true,
    summary,
    backupFile: obj as unknown as MindMeshBackupFile,
  };
}

/**
 * Migration pipeline: adapts older schema backups forward to CURRENT_STORAGE_VERSION.
 */
export function migrateBackup(backup: MindMeshBackupFile): MindMeshStorageData {
  const rawData = backup.data;
  const targetSchema = CURRENT_STORAGE_VERSION;

  // Clone data safely
  const categories = normalizeCategories(
    Array.isArray(rawData.categories) && rawData.categories.length > 0 ? rawData.categories : INITIAL_CATEGORIES
  );

  // Validate reminders and ensure all subtasks & clean properties
  const reminders: Reminder[] = (rawData.reminders || []).map((rem) => {
    return {
      ...rem,
      subtasks: Array.isArray(rem.subtasks) ? rem.subtasks : [],
      priority: rem.priority || 'medium',
      completed: Boolean(rem.completed),
      createdAt: rem.createdAt || new Date().toISOString(),
    };
  });

  const nodePositions = normalizeNodePositions(rawData.nodePositions);

  // Money state migration
  const defaultMoney = getDefaultMoneyState();
  const money = rawData.money && typeof rawData.money === 'object'
    ? {
        incomeConfig: rawData.money.incomeConfig || null,
        directDebits: Array.isArray(rawData.money.directDebits) ? rawData.money.directDebits : [],
        billCategories: Array.isArray(rawData.money.billCategories) && rawData.money.billCategories.length > 0
          ? rawData.money.billCategories
          : defaultMoney.billCategories,
        extraIncomeList: Array.isArray(rawData.money.extraIncomeList) ? rawData.money.extraIncomeList : [],
        extraIncomeCategories: Array.isArray(rawData.money.extraIncomeCategories) && rawData.money.extraIncomeCategories.length > 0
          ? rawData.money.extraIncomeCategories
          : defaultMoney.extraIncomeCategories,
        tipEntries: Array.isArray(rawData.money.tipEntries) ? rawData.money.tipEntries : [],
        shifts: Array.isArray(rawData.money.shifts) ? rawData.money.shifts : [],
        payCycleOverrides: rawData.money.payCycleOverrides && typeof rawData.money.payCycleOverrides === 'object'
          ? rawData.money.payCycleOverrides
          : {},
      }
    : defaultMoney;

  // Contacts migration: if backup has no contacts, seed defaults or empty
  const contacts = Array.isArray(rawData.contacts)
    ? rawData.contacts.map((contact) => ({ ...contact, importedFromDevice: contact.importedFromDevice ?? false }))
    : INITIAL_CONTACTS;

  const contactCategories = Array.isArray(rawData.contactCategories) && rawData.contactCategories.length > 0
    ? rawData.contactCategories
    : INITIAL_CONTACT_CATEGORIES;

  const contactRelationships = Array.isArray(rawData.contactRelationships) && rawData.contactRelationships.length > 0
    ? rawData.contactRelationships
    : INITIAL_CONTACT_RELATIONSHIPS;

  // Broken contact reference check: if reminder links to non-existent contact, clean reference
  const validContactIds = new Set(contacts.map((c) => c.id));
  const sanitizedReminders = reminders.map((r) => {
    if (r.linkedContactId && !validContactIds.has(r.linkedContactId)) {
      logger.warn('BackupService', `Cleaning missing contact link on reminder ${r.id}`, { missingId: r.linkedContactId });
      const copy = { ...r };
      delete copy.linkedContactId;
      return copy;
    }
    return r;
  });

  // Broken direct debit reference check
  const validBillIds = new Set(money.directDebits.map((b) => b.id));
  const fullySanitizedReminders = sanitizedReminders.map((r) => {
    if (r.linkedBillId && !validBillIds.has(r.linkedBillId)) {
      const copy = { ...r };
      delete copy.linkedBillId;
      return copy;
    }
    return r;
  });

  const preferences = rawData.preferences && typeof rawData.preferences === 'object'
    ? rawData.preferences
    : { theme: 'dark' };

  // Appearance: older backups have none, so fall back to app defaults
  const appearance = rawData.appearance
    ? normalizeAppearance(rawData.appearance)
    : getDefaultAppearance();

  // Notifications: schema v1 backups predate this, so default cleanly and keep
  // any per-reminder notification config that survived the reminder migration.
  const notifications = rawData.notifications
    ? normalizeNotificationSettings(rawData.notifications)
    : { ...DEFAULT_NOTIFICATION_SETTINGS };

  const notificationHistory: NotificationHistoryEntry[] = rawData.notificationHistory
    ? normalizeNotificationHistory(rawData.notificationHistory, notifications.historyLimit)
    : [];

  const smartEngineSettings = normalizeSmartEngineSettings(rawData.smartEngineSettings);

  // Diagnostics preferences ride along in preferences; logs are opt-in only.
  const diagnosticPreferences = normalizeDiagnosticPreferences(rawData.diagnostics?.preferences);
  const mergedPreferences = {
    ...(preferences as Record<string, unknown>),
    diagnostics: diagnosticPreferences,
  };

  return {
    version: targetSchema,
    categories,
    reminders: fullySanitizedReminders,
    routines: normalizeRoutines(rawData.routines).routines,
    nodePositions,
    money,
    contacts,
    contactCategories,
    contactRelationships,
    appearance,
    notifications,
    notificationHistory,
    smartEngineSettings,
    preferences: mergedPreferences,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Transactional restore execution.
 * Backs up in-memory snapshot before modifying state, rolls back if writing fails.
 */
export function restoreBackup(backupFile: MindMeshBackupFile): { success: boolean; state?: MindMeshStorageData; error?: string } {
  // Snapshot current state in memory
  let originalSnapshot: MindMeshStorageData;
  let safetySnapshot: MindMeshStorageData;
  try {
    originalSnapshot = loadAllData();
    // Clone and verify before migration so rollback does not depend on a mutable reference.
    safetySnapshot = JSON.parse(JSON.stringify(originalSnapshot)) as MindMeshStorageData;
    if (JSON.stringify(safetySnapshot) !== JSON.stringify(originalSnapshot)) throw new Error('Safety snapshot verification failed');
  } catch (err) {
    return {
      success: false,
      error: `Could not capture rollback snapshot: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  try {
    // Run migration & sanitization pipeline
    const migratedState = migrateBackup(backupFile);

    // Save to persistence
    saveAllData(migratedState);
    const verifiedState = loadAllData();
    const expectedRoutineIds = (migratedState.routines || []).map((routine) => routine.id).sort();
    const actualRoutineIds = (verifiedState.routines || []).map((routine) => routine.id).sort();
    if (JSON.stringify(expectedRoutineIds) !== JSON.stringify(actualRoutineIds)) {
      throw new Error('Restored Routine data could not be verified after persistence');
    }
    const expectedActiveSessions = (migratedState.routines || []).filter((routine) => routine.activeSession).length;
    const actualActiveSessions = (verifiedState.routines || []).filter((routine) => routine.activeSession).length;
    if (expectedActiveSessions !== actualActiveSessions) {
      throw new Error('Active Routine session recovery could not be verified after persistence');
    }

    // Every custom node position in the backup must survive the write unchanged.
    const expectedPositions = migratedState.nodePositions || {};
    const actualPositions = verifiedState.nodePositions || {};
    const expectedPositionIds = Object.keys(expectedPositions).sort();
    const actualPositionIds = Object.keys(actualPositions).sort();
    if (JSON.stringify(expectedPositionIds) !== JSON.stringify(actualPositionIds)) {
      throw new Error('Restored node positions could not be verified after persistence');
    }
    for (const nodeId of expectedPositionIds) {
      const expected = expectedPositions[nodeId];
      const restored = actualPositions[nodeId];
      if (!restored || restored.x !== expected.x || restored.y !== expected.y) {
        throw new Error(`Restored node position for "${nodeId}" could not be verified after persistence`);
      }
    }

    // Keep the imported layout recoverable after the live layout is reset later.
    saveLastImportedNodePositions(expectedPositions);

    const restoredDiagnosticsPreferences = backupFile.data.diagnostics?.preferences;
    if (restoredDiagnosticsPreferences) {
      try {
        saveDiagnosticPreferences(normalizeDiagnosticPreferences(restoredDiagnosticsPreferences));
      } catch (err) {
        logger.warn('BackupService', 'Could not persist diagnostics preferences from backup', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    logger.info('BackupService', 'Backup restored successfully', {
      remindersRestored: migratedState.reminders.length,
      contactsRestored: (migratedState.contacts || []).length,
      notificationHistoryRestored: (migratedState.notificationHistory || []).length,
    });

    recordRestore();

    return {
      success: true,
      state: migratedState,
    };
  } catch (err) {
    // Rollback safely
    logger.error('BackupService', 'Restoration encountered error; rolling back to snapshot', err);
    try {
      saveAllData(safetySnapshot);
    } catch (rbErr) {
      logger.error('BackupService', 'Critical error during rollback', rbErr);
    }

    return {
      success: false,
      error: `Restoration failed: ${err instanceof Error ? err.message : String(err)}. Original state preserved.`,
    };
  }
}

/* ------------------------------------------------------------------ *
 * Export pipeline
 *
 * The old implementation stringified the backup, handed a blob URL to an
 * anchor element and reported success immediately. That reports a save even
 * when nothing was written (WebView, sandboxed frames, blocked downloads),
 * which is exactly the "I never found the file" symptom.
 *
 * The pipeline below serialises through one place, then writes through the
 * strongest platform channel available and only reports success once the
 * write has actually completed.
 * ------------------------------------------------------------------ */

export type BackupExportMethod = 'android-document' | 'file-system-access' | 'browser-download';

export interface BackupExportResult {
  ok: boolean;
  filename: string;
  /** Serialized size of the backup in bytes. */
  bytes: number;
  method?: BackupExportMethod;
  /**
   * True when the platform performs the write itself (a browser download) and
   * MindMesh cannot observe the result, so the UI must not claim "saved".
   */
  unverified?: boolean;
  /** Set only when ok is false. */
  error?: string;
}

/** Android WebView bridge injected as `window.MindMeshBackup`. */
interface AndroidBackupBridge {
  isSupported?(): boolean;
  saveFile(requestId: string, filename: string, content: string): boolean;
}

/** Event sink the native bridge pushes its write result into. */
interface AndroidBackupEvents {
  onResult(requestId: string, ok: boolean, message: string): void;
}

interface BackupHostWindow {
  MindMeshBackup?: AndroidBackupBridge;
  MindMeshNativeBackupEvents?: AndroidBackupEvents;
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: { description?: string; accept: Record<string, string[]> }[];
  }) => Promise<{
    createWritable(): Promise<{
      write(data: string | Blob): Promise<void>;
      close(): Promise<void>;
      abort?(): Promise<void>;
    }>;
  }>;
}

/** How long to wait for the Android document picker before giving up. */
const ANDROID_PICKER_TIMEOUT_MS = 5 * 60 * 1000;

const androidPendingSaves = new Map<string, (ok: boolean, message: string) => void>();
let androidRequestSeq = 0;

function hostWindow(): BackupHostWindow | null {
  return typeof window === 'undefined' ? null : (window as unknown as BackupHostWindow);
}

/**
 * The Android bridge cannot accept a JS callback, so results come back through a
 * global the page installs. This runs on import so an event can never be lost to
 * a missing handler, and is idempotent.
 */
export function installNativeBackupEventBridge(): void {
  const host = hostWindow();
  if (!host || host.MindMeshNativeBackupEvents) return;
  host.MindMeshNativeBackupEvents = {
    onResult: (requestId: string, ok: boolean, message: string) => {
      const resolve = androidPendingSaves.get(requestId);
      if (!resolve) return;
      androidPendingSaves.delete(requestId);
      resolve(ok, message);
    },
  };
}

installNativeBackupEventBridge();

/**
 * Serialises the backup, then proves the result is parseable JSON. Single place
 * where a backup becomes a file body, so export can never write a half-built
 * object and never silently produces invalid JSON.
 */
export function serializeBackup(backupFile: MindMeshBackupFile): string {
  if (!backupFile || typeof backupFile !== 'object') {
    throw new Error('No backup payload was produced');
  }

  let json: string;
  try {
    json = JSON.stringify(backupFile, null, 2);
  } catch (err) {
    throw backupSerializationError(err);
  }

  if (typeof json !== 'string' || json.length === 0) {
    throw new Error('Backup serialization produced an empty file');
  }

  try {
    const roundTrip = JSON.parse(json) as unknown;
    if (!roundTrip || typeof roundTrip !== 'object' || Array.isArray(roundTrip)) {
      throw new Error('unexpected payload shape');
    }
  } catch {
    throw new Error('Backup serialization produced invalid JSON');
  }

  return json;
}

/** Wraps a serialization failure while preserving the original cause. */
function backupSerializationError(cause: unknown): Error {
  const detail = cause instanceof Error ? cause.message : String(cause);
  const error = new Error(`Backup data could not be serialized: ${detail}`);
  (error as Error & { cause?: unknown }).cause = cause;
  return error;
}

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return text.length;
}

/**
 * Legacy helper kept for callers that only need the browser download. It throws
 * if the browser refuses to start the download, so failures are never silent.
 */
export function downloadBackupFile(backupFile: MindMeshBackupFile, filename?: string): void {
  const json = serializeBackup(backupFile);
  const downloadName = filename || generateBackupFilename(new Date(backupFile.createdAt));
  triggerBrowserDownload(json, downloadName);
}

function triggerBrowserDownload(json: string, downloadName: string): void {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') {
    throw new Error('This environment cannot save files directly');
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = downloadName;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } finally {
    // Revoking immediately can cancel the download in some browsers.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
}

async function saveViaAndroidBridge(
  filename: string,
  json: string,
  bytes: number
): Promise<BackupExportResult> {
  const host = hostWindow();
  const bridge = host?.MindMeshBackup;
  if (!bridge || typeof bridge.saveFile !== 'function') {
    return { ok: false, filename, bytes, method: 'android-document', error: 'Android file saving is unavailable' };
  }

  installNativeBackupEventBridge();
  const requestId = `mindmesh-backup-${Date.now()}-${(androidRequestSeq += 1)}`;

  return new Promise<BackupExportResult>((resolve) => {
    const finish = (result: BackupExportResult) => {
      androidPendingSaves.delete(requestId);
      resolve(result);
    };

    const timer = setTimeout(() => {
      finish({
        ok: false,
        filename,
        bytes,
        method: 'android-document',
        error: 'The Android file picker did not respond. Please try again.',
      });
    }, ANDROID_PICKER_TIMEOUT_MS);

    androidPendingSaves.set(requestId, (ok, message) => {
      clearTimeout(timer);
      if (ok) {
        logger.info('BackupService', 'Backup written through the Android document writer', {
          filename,
          bytes,
        });
        finish({ ok: true, filename, bytes, method: 'android-document' });
      } else {
        logger.error('BackupService', 'Android backup write failed', message);
        finish({ ok: false, filename, bytes, method: 'android-document', error: message });
      }
    });

    try {
      const accepted = bridge.saveFile(requestId, filename, json);
      if (accepted === false) {
        clearTimeout(timer);
        finish({
          ok: false,
          filename,
          bytes,
          method: 'android-document',
          error: 'MindMesh could not open the Android save dialog',
        });
      }
    } catch (err) {
      clearTimeout(timer);
      const message = err instanceof Error ? err.message : String(err);
      logger.error('BackupService', 'Android backup bridge threw', err);
      finish({ ok: false, filename, bytes, method: 'android-document', error: message });
    }
  });
}

/**
 * How a save attempt ended. "dismissed" (the user closed the dialog) and
 * "unavailable" (the dialog never opened: sandboxed frame, denied permission)
 * are both recoverable — the caller falls back to a download. Only "failed"
 * means a write was attempted and did not complete.
 */
type SaverStatus = 'saved' | 'dismissed' | 'unavailable' | 'failed';

interface SaverAttempt {
  status: SaverStatus;
  error?: string;
}

async function attemptFileSystemAccessSave(filename: string, json: string, bytes: number): Promise<SaverAttempt> {
  const picker = hostWindow()?.showSaveFilePicker;
  if (typeof picker !== 'function') return { status: 'unavailable' };

  let handle: Awaited<ReturnType<NonNullable<BackupHostWindow['showSaveFilePicker']>>>;
  try {
    handle = await picker({
      suggestedName: filename,
      types: [{ description: 'MindMesh backup', accept: { 'application/json': ['.json'] } }],
    });
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const message = err instanceof Error ? err.message : String(err);
    if (name === 'AbortError') {
      logger.info('BackupService', 'Backup export cancelled by the user', { filename });
      return { status: 'dismissed' };
    }
    logger.warn('BackupService', 'The save dialog could not be opened; falling back to a download', {
      error: message,
    });
    return { status: 'unavailable', error: message };
  }

  // From here the user picked a destination, so any failure is a real failure.
  try {
    const writable = await handle.createWritable();
    await writable.write(json);
    await writable.close();
    logger.info('BackupService', 'Backup written to the user-selected file', { filename, bytes });
    return { status: 'saved' };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('BackupService', 'Writing the backup file failed', err);
    return { status: 'failed', error: `Could not write the backup file: ${message}` };
  }
}

/**
 * Exports a full backup to a real `.json` file.
 *
 * Resolution order:
 *  1. Android WebView document writer (a genuine save-location picker + write).
 *  2. File System Access API (a genuine save dialog the page can await).
 *  3. A browser download, which is reported as `unverified` because the page
 *     cannot observe whether the browser actually wrote the file.
 */
export async function exportBackup(
  backupFile: MindMeshBackupFile,
  filename?: string
): Promise<BackupExportResult> {
  const resolvedName = filename || generateBackupFilename(new Date(backupFile.createdAt));

  let json: string;
  try {
    json = serializeBackup(backupFile);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('BackupService', 'Backup JSON generation failed', err);
    return { ok: false, filename: resolvedName, bytes: 0, error: message };
  }

  const bytes = byteLength(json);
  logger.info('BackupService', 'Backup JSON generated', { filename: resolvedName, bytes });

  const host = hostWindow();
  if (host?.MindMeshBackup && typeof host.MindMeshBackup.saveFile === 'function') {
    return saveViaAndroidBridge(resolvedName, json, bytes);
  }

  if (typeof host?.showSaveFilePicker === 'function') {
    const attempt = await attemptFileSystemAccessSave(resolvedName, json, bytes);
    if (attempt.status === 'saved') {
      return { ok: true, filename: resolvedName, bytes, method: 'file-system-access' };
    }
    if (attempt.status === 'failed') {
      return { ok: false, filename: resolvedName, bytes, method: 'file-system-access', error: attempt.error };
    }
    // dismissed / unavailable: fall through to the download path below.
  }

  try {
    triggerBrowserDownload(json, resolvedName);
    logger.info('BackupService', 'Backup download handed to the browser', { filename: resolvedName, bytes });
    return { ok: true, filename: resolvedName, bytes, method: 'browser-download', unverified: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('BackupService', 'Backup download could not be started', err);
    return { ok: false, filename: resolvedName, bytes, error: message };
  }
}

/**
 * True when MindMesh is running inside an embedding frame. Sandboxed frames
 * block both save dialogs and downloads, which is the classic "I chose a
 * location but no file appeared" situation, so the UI can say so.
 */
export function isEmbeddedFrame(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    // A cross-origin parent throws on access, which itself means we are framed.
    return true;
  }
}

export { resetMindMeshEntirely };
