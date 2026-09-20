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
  CURRENT_STORAGE_VERSION,
} from './storage';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { INITIAL_CONTACTS, INITIAL_CONTACT_CATEGORIES, INITIAL_CONTACT_RELATIONSHIPS } from '../utils/sampleContactData';
import { INITIAL_CATEGORIES } from '../utils/sampleData';
import { logger } from './logger';

export const BACKUP_FORMAT_VERSION = 1;
export const APP_VERSION = '1.3.0';

/**
 * Creates a complete full backup of MindMesh user-persisted data and configuration.
 */
export function createBackup(): MindMeshBackupFile {
  const state: MindMeshStorageData = loadAllData();

  const backupData: MindMeshBackupData = {
    categories: state.categories || [],
    reminders: state.reminders || [],
    nodePositions: state.nodePositions || {},
    money: state.money || getDefaultMoneyState(),
    contacts: state.contacts || INITIAL_CONTACTS,
    contactCategories: state.contactCategories || INITIAL_CONTACT_CATEGORIES,
    contactRelationships: state.contactRelationships || INITIAL_CONTACT_RELATIONSHIPS,
    preferences: state.preferences || { theme: 'dark' },
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
  });

  return backupFile;
}

/**
 * Generates formatted default filename for export: MindMesh-Backup-YYYY-MM-DD-HHmm.json
 */
export function generateBackupFilename(date: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const mins = pad(date.getMinutes());

  return `MindMesh-Backup-${year}-${month}-${day}-${hours}${mins}.json`;
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

  const completedReminders = (data.reminders as Reminder[]).filter((r) => r.completed).length;

  const summary: RestoreSummary = {
    createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString(),
    appVersion: typeof obj.appVersion === 'string' ? obj.appVersion : 'unknown',
    backupVersion: obj.backupVersion,
    schemaVersion: typeof obj.schemaVersion === 'number' ? obj.schemaVersion : 1,
    categoriesCount: data.categories.length,
    remindersCount: data.reminders.length,
    completedRemindersCount: completedReminders,
    contactsCount,
    directDebitsCount,
    extraIncomeCount,
    tipsCount,
    shiftsCount,
    hasMoneyConfig,
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
  const categories = Array.isArray(rawData.categories) && rawData.categories.length > 0
    ? rawData.categories
    : INITIAL_CATEGORIES;

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

  const nodePositions = rawData.nodePositions && typeof rawData.nodePositions === 'object'
    ? rawData.nodePositions
    : {};

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
    ? rawData.contacts
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

  return {
    version: targetSchema,
    categories,
    reminders: fullySanitizedReminders,
    nodePositions,
    money,
    contacts,
    contactCategories,
    contactRelationships,
    preferences,
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
  try {
    originalSnapshot = loadAllData();
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

    logger.info('BackupService', 'Backup restored successfully', {
      remindersRestored: migratedState.reminders.length,
      contactsRestored: (migratedState.contacts || []).length,
    });

    return {
      success: true,
      state: migratedState,
    };
  } catch (err) {
    // Rollback safely
    logger.error('BackupService', 'Restoration encountered error; rolling back to snapshot', err);
    try {
      saveAllData(originalSnapshot);
    } catch (rbErr) {
      logger.error('BackupService', 'Critical error during rollback', rbErr);
    }

    return {
      success: false,
      error: `Restoration failed: ${err instanceof Error ? err.message : String(err)}. Original state preserved.`,
    };
  }
}

/**
 * Triggers browser download of backup file
 */
export function downloadBackupFile(backupFile: MindMeshBackupFile, filename?: string): void {
  const json = JSON.stringify(backupFile, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const downloadName = filename || generateBackupFilename(new Date(backupFile.createdAt));

  const a = document.createElement('a');
  a.href = url;
  a.download = downloadName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export { resetMindMeshEntirely };
