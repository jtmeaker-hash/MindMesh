import { Category, Reminder, NodePositionMap, NodePosition, MindMeshStorageData } from '../types';
import { MoneyState } from '../types/finance';
import { Contact } from '../types/contact';
import { AppearanceSettings } from '../types/appearance';
import {
  AppNotificationSettings,
  NotificationHistoryEntry,
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
  normalizeNotificationHistory,
} from '../types/notifications';
import { DiagnosticPreferences, normalizeDiagnosticPreferences } from '../types/diagnostics';
import { INITIAL_CATEGORIES, INITIAL_REMINDERS } from '../utils/sampleData';
import { normalizeCategories } from './categories';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { INITIAL_CONTACTS, INITIAL_CONTACT_CATEGORIES, INITIAL_CONTACT_RELATIONSHIPS } from '../utils/sampleContactData';
import { getDefaultAppearance, normalizeAppearance } from './appearance';
import { logger } from './logger';
import { normalizeRoutines, Routine } from '../types/routine';
import { DEFAULT_SMART_ENGINE_SETTINGS, normalizeSmartEngineSettings, SmartEngineSettings } from '../types/smartEngine';

export const CURRENT_STORAGE_VERSION = 9;
const STORAGE_KEY_V2 = 'mindmesh_state_v2';
const LEGACY_CATEGORIES_KEY = 'mindmesh_categories_v1';
const LEGACY_REMINDERS_KEY = 'mindmesh_reminders_v1';
const NODE_POSITIONS_KEY = 'mindmesh_positions_v1';
export const ROUTINE_QUARANTINE_KEY = 'mindmesh_routine_quarantine_v1';

export function getDefaultState(): MindMeshStorageData {
  return {
    version: CURRENT_STORAGE_VERSION,
    categories: INITIAL_CATEGORIES,
    reminders: INITIAL_REMINDERS,
    nodePositions: {},
    lastUpdated: new Date().toISOString(),
    money: getDefaultMoneyState(),
    contacts: INITIAL_CONTACTS,
    contactCategories: INITIAL_CONTACT_CATEGORIES,
    contactRelationships: INITIAL_CONTACT_RELATIONSHIPS,
    appearance: getDefaultAppearance(),
    notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
    notificationHistory: [],
    smartEngineSettings: { ...DEFAULT_SMART_ENGINE_SETTINGS, featureToggles: {} },
    routines: [],
    preferences: {
      theme: 'dark',
      defaultReminderPriority: 'medium',
      enableSound: false,
    },
  };
}

/**
 * Validates and safely migrates older storage formats if detected.
 */
function migrateLegacyStorage(): MindMeshStorageData | null {
  try {
    const rawLegacyCats = localStorage.getItem(LEGACY_CATEGORIES_KEY);
    const rawLegacyRems = localStorage.getItem(LEGACY_REMINDERS_KEY);
    const rawPositions = localStorage.getItem(NODE_POSITIONS_KEY);

    if (!rawLegacyCats && !rawLegacyRems) {
      return null;
    }

    logger.info('Storage', `Migrating legacy v1 storage to v${CURRENT_STORAGE_VERSION} schema`);

    let categories: Category[] = INITIAL_CATEGORIES;
    let reminders: Reminder[] = INITIAL_REMINDERS;
    let nodePositions: NodePositionMap = {};

    if (rawLegacyCats) {
      const parsedCats = JSON.parse(rawLegacyCats);
      if (Array.isArray(parsedCats) && parsedCats.length > 0) {
        categories = parsedCats;
      }
    }

    if (rawLegacyRems) {
      const parsedRems = JSON.parse(rawLegacyRems);
      if (Array.isArray(parsedRems)) {
        reminders = parsedRems;
      }
    }

    if (rawPositions) {
      const parsedPos = JSON.parse(rawPositions);
      if (typeof parsedPos === 'object' && parsedPos !== null) {
        nodePositions = parsedPos;
      }
    }

    const migrated: MindMeshStorageData = {
      version: CURRENT_STORAGE_VERSION,
      categories,
      reminders,
      nodePositions,
      lastUpdated: new Date().toISOString(),
      money: getDefaultMoneyState(),
      contacts: INITIAL_CONTACTS,
      contactCategories: INITIAL_CONTACT_CATEGORIES,
      contactRelationships: INITIAL_CONTACT_RELATIONSHIPS,
      appearance: getDefaultAppearance(),
      notifications: { ...DEFAULT_NOTIFICATION_SETTINGS },
      notificationHistory: [],
      routines: [],
      preferences: {
        theme: 'dark',
      },
    };

    saveAllData(migrated);
    return migrated;
  } catch (err) {
    logger.error('Storage', 'Failed during legacy storage migration', err);
    return null;
  }
}

/**
 * Loads entire persisted MindMesh state with safe fallbacks and schema migration.
 */
export function loadAllData(): MindMeshStorageData {
  try {
    const raw = localStorage.getItem(STORAGE_KEY_V2);
    if (!raw) {
      const migrated = migrateLegacyStorage();
      if (migrated) return migrated;

      const defaultState = getDefaultState();
      saveAllData(defaultState);
      return defaultState;
    }

    const parsed = JSON.parse(raw) as Partial<MindMeshStorageData>;

    // Sanity check of loaded schema
    if (!parsed || typeof parsed !== 'object') {
      logger.warn('Storage', 'Invalid storage payload, reverting to default');
      return getDefaultState();
    }

    const categories = normalizeCategories(
      Array.isArray(parsed.categories) && parsed.categories.length > 0 ? parsed.categories : INITIAL_CATEGORIES
    );

    const reminders = Array.isArray(parsed.reminders)
      ? parsed.reminders
      : INITIAL_REMINDERS;

    const nodePositions = parsed.nodePositions && typeof parsed.nodePositions === 'object'
      ? parsed.nodePositions
      : {};

    const defaultMoney = getDefaultMoneyState();
    const money: MoneyState = parsed.money && typeof parsed.money === 'object'
      ? {
          incomeConfig: parsed.money.incomeConfig || null,
          directDebits: Array.isArray(parsed.money.directDebits) ? parsed.money.directDebits : [],
          billCategories: Array.isArray(parsed.money.billCategories) && parsed.money.billCategories.length > 0
            ? parsed.money.billCategories
            : defaultMoney.billCategories,
          extraIncomeList: Array.isArray(parsed.money.extraIncomeList) ? parsed.money.extraIncomeList : [],
          extraIncomeCategories: Array.isArray(parsed.money.extraIncomeCategories) && parsed.money.extraIncomeCategories.length > 0
            ? parsed.money.extraIncomeCategories
            : defaultMoney.extraIncomeCategories,
          tipEntries: Array.isArray(parsed.money.tipEntries) ? parsed.money.tipEntries : [],
          shifts: Array.isArray(parsed.money.shifts) ? parsed.money.shifts : [],
          payCycleOverrides: parsed.money.payCycleOverrides && typeof parsed.money.payCycleOverrides === 'object'
            ? parsed.money.payCycleOverrides
            : {},
        }
      : defaultMoney;

    const contacts: Contact[] = Array.isArray(parsed.contacts)
      ? parsed.contacts.filter((contact): contact is Contact => Boolean(contact && typeof contact === 'object' && typeof contact.id === 'string' && typeof contact.fullName === 'string')).map((contact) => ({
          ...contact,
          phoneNumber: typeof contact.phoneNumber === 'string' ? contact.phoneNumber : '',
          relationship: typeof contact.relationship === 'string' ? contact.relationship : 'Other',
          importedFromDevice: contact.importedFromDevice === true,
          createdAt: contact.createdAt || new Date().toISOString(),
          updatedAt: contact.updatedAt || contact.createdAt || new Date().toISOString(),
        }))
      : INITIAL_CONTACTS;

    const contactCategories: string[] = Array.isArray(parsed.contactCategories) && parsed.contactCategories.length > 0
      ? parsed.contactCategories
      : INITIAL_CONTACT_CATEGORIES;

    const contactRelationships: string[] = Array.isArray(parsed.contactRelationships) && parsed.contactRelationships.length > 0
      ? parsed.contactRelationships
      : INITIAL_CONTACT_RELATIONSHIPS;

    const preferences: Record<string, unknown> = parsed.preferences && typeof parsed.preferences === 'object'
      ? parsed.preferences
      : { theme: 'dark' };

    const appearance: AppearanceSettings = normalizeAppearance(parsed.appearance);

    const notifications: AppNotificationSettings = normalizeNotificationSettings(parsed.notifications);

    const notificationHistory: NotificationHistoryEntry[] = normalizeNotificationHistory(
      parsed.notificationHistory,
      notifications.historyLimit
    );

    const smartEngineSettings: SmartEngineSettings = normalizeSmartEngineSettings(parsed.smartEngineSettings);

    const routineResult = normalizeRoutines(parsed.routines);
    // Only write quarantine evidence when malformed data is actually found. Clean
    // hydration must remain read-only so transactional write-failure tests and
    // normal app startup retain their existing persistence semantics.
    if (routineResult.quarantined.length > 0) {
      saveRoutineQuarantine(routineResult.quarantined);
      logger.warn('Storage', 'Quarantined malformed routine records during hydration', {
        quarantined: routineResult.quarantined.map((entry) => ({ id: entry.id, reason: entry.reason })),
      });
    }

    logger.debug('Storage', 'State hydrated successfully', {
      categoryCount: categories.length,
      reminderCount: reminders.length,
      positionCount: Object.keys(nodePositions).length,
      contactCount: contacts.length,
      pendingNotifications: notificationHistory.filter((entry) => entry.status === 'pending').length,
      routineCount: routineResult.routines.length,
      quarantinedRoutineCount: routineResult.quarantined.length,
    });

    return {
      version: CURRENT_STORAGE_VERSION,
      categories,
      reminders,
      nodePositions,
      lastUpdated: parsed.lastUpdated || new Date().toISOString(),
      money,
      contacts,
      contactCategories,
      contactRelationships,
      appearance,
      notifications,
      notificationHistory,
      smartEngineSettings,
      routines: routineResult.routines,
      preferences,
    };
  } catch (e) {
    logger.error('Storage', 'Error reading storage, restoring safe default state', e);
    return getDefaultState();
  }
}

export interface StorageReadability {
  /** False when localStorage itself could not be touched at all. */
  accessible: boolean;
  /** True when a payload is stored under the MindMesh key. */
  hasPayload: boolean;
  /** True when that payload parses as a JSON object. */
  readable: boolean;
  rawBytes: number;
}

/**
 * Checks whether the persisted payload can actually be read.
 *
 * `loadAllData` deliberately swallows read failures and falls back to sample
 * defaults so the UI always renders. A backup must not do that: exporting the
 * defaults over an unreadable store would look like a successful backup of an
 * empty installation and would quietly overwrite the user's real file.
 */
export function inspectStorageReadability(): StorageReadability {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY_V2);
  } catch (e) {
    logger.error('Storage', 'Local storage is not accessible for reading', e);
    return { accessible: false, hasPayload: false, readable: false, rawBytes: 0 };
  }

  if (!raw) {
    return { accessible: true, hasPayload: false, readable: false, rawBytes: 0 };
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    const readable = Boolean(parsed) && typeof parsed === 'object' && !Array.isArray(parsed);
    return { accessible: true, hasPayload: true, readable, rawBytes: raw.length };
  } catch (e) {
    logger.error('Storage', 'Stored MindMesh payload is not valid JSON', e);
    return { accessible: true, hasPayload: true, readable: false, rawBytes: raw.length };
  }
}

/**
 * Persists complete MindMesh state to local storage.
 */
export function saveAllData(data: MindMeshStorageData): void {
  try {
    const payload = JSON.stringify({
      ...data,
      version: CURRENT_STORAGE_VERSION,
      lastUpdated: new Date().toISOString(),
    });
    localStorage.setItem(STORAGE_KEY_V2, payload);
  } catch (e) {
    logger.error('Storage', 'Failed to save MindMesh storage data', e);
  }
}

/**
 * Contact-specific helper methods
 */
export function loadContacts(): Contact[] {
  const data = loadAllData();
  return data.contacts || INITIAL_CONTACTS;
}

export function saveContacts(contacts: Contact[]): void {
  const current = loadAllData();
  saveAllData({ ...current, contacts });
}

export function loadContactCategories(): string[] {
  const data = loadAllData();
  return data.contactCategories || INITIAL_CONTACT_CATEGORIES;
}

export function saveContactCategories(contactCategories: string[]): void {
  const current = loadAllData();
  saveAllData({ ...current, contactCategories });
}

export function loadContactRelationships(): string[] {
  const data = loadAllData();
  return data.contactRelationships || INITIAL_CONTACT_RELATIONSHIPS;
}

export function saveContactRelationships(contactRelationships: string[]): void {
  const current = loadAllData();
  saveAllData({ ...current, contactRelationships });
}

/**
 * Appearance / visual customisation helper methods
 */
export function loadAppearance(): AppearanceSettings {
  const data = loadAllData();
  return normalizeAppearance(data.appearance);
}

export function saveAppearance(appearance: AppearanceSettings): void {
  const current = loadAllData();
  saveAllData({ ...current, appearance });
}

/**
 * Notification settings & history helper methods
 */
export function loadNotificationSettings(): AppNotificationSettings {
  const data = loadAllData();
  return normalizeNotificationSettings(data.notifications);
}

export function saveNotificationSettings(notifications: AppNotificationSettings): void {
  const current = loadAllData();
  saveAllData({ ...current, notifications: normalizeNotificationSettings(notifications) });
}

export function loadNotificationHistory(): NotificationHistoryEntry[] {
  const data = loadAllData();
  const settings = normalizeNotificationSettings(data.notifications);
  return normalizeNotificationHistory(data.notificationHistory, settings.historyLimit);
}

export function saveNotificationHistory(history: NotificationHistoryEntry[]): void {
  const current = loadAllData();
  const settings = normalizeNotificationSettings(current.notifications);
  saveAllData({ ...current, notificationHistory: normalizeNotificationHistory(history, settings.historyLimit) });
}

/** Local Smart Engine settings are persisted as a normal state slice. */
export function loadSmartEngineSettings(): SmartEngineSettings {
  return normalizeSmartEngineSettings(loadAllData().smartEngineSettings);
}

export function saveSmartEngineSettings(settings: SmartEngineSettings): void {
  const current = loadAllData();
  saveAllData({ ...current, smartEngineSettings: normalizeSmartEngineSettings(settings) });
}

/**
 * Preferences helper methods
 */
export function loadPreferences(): Record<string, unknown> {
  const data = loadAllData();
  return data.preferences || { theme: 'dark' };
}

export function savePreferences(preferences: Record<string, unknown>): void {
  const current = loadAllData();
  saveAllData({ ...current, preferences });
}

/**
 * Diagnostics preferences live inside the normal preferences payload so they are
 * covered by the standard backup/restore path (unlike the log store itself).
 */
export function loadDiagnosticPreferences(): DiagnosticPreferences {
  const prefs = loadPreferences();
  return normalizeDiagnosticPreferences(prefs.diagnostics);
}

export function saveDiagnosticPreferences(diagnostics: DiagnosticPreferences): void {
  const current = loadAllData();
  const preferences = {
    ...(current.preferences || {}),
    diagnostics: normalizeDiagnosticPreferences(diagnostics),
  };
  saveAllData({ ...current, preferences });
}

/**
 * Money-specific helper methods
 */
export function loadMoneyState(): MoneyState {
  const data = loadAllData();
  return data.money || getDefaultMoneyState();
}

export function saveMoneyState(money: MoneyState): void {
  const current = loadAllData();
  saveAllData({ ...current, money });
}

/**
 * Category-specific helper methods
 */
export function loadCategories(): Category[] {
  return loadAllData().categories;
}

export function saveCategories(categories: Category[]): void {
  const current = loadAllData();
  saveAllData({ ...current, categories });
}

/**
 * Reminder-specific helper methods
 */
export function loadReminders(): Reminder[] {
  return loadAllData().reminders;
}

export function loadRoutines(): Routine[] {
  return loadAllData().routines || [];
}

export function loadRoutineQuarantine(): import('../types/routine').RoutineQuarantineEntry[] {
  try {
    const raw = localStorage.getItem(ROUTINE_QUARANTINE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is import('../types/routine').RoutineQuarantineEntry =>
      Boolean(entry && typeof entry === 'object' && typeof (entry as { id?: unknown }).id === 'string' && typeof (entry as { reason?: unknown }).reason === 'string')
    );
  } catch {
    return [];
  }
}

export function saveRoutineQuarantine(entries: import('../types/routine').RoutineQuarantineEntry[]): void {
  try {
    localStorage.setItem(ROUTINE_QUARANTINE_KEY, JSON.stringify(entries));
  } catch (error) {
    logger.error('Storage', 'Failed to persist Routine quarantine records', error);
  }
}

export function clearRoutineQuarantine(): void {
  try {
    localStorage.removeItem(ROUTINE_QUARANTINE_KEY);
  } catch (error) {
    logger.error('Storage', 'Failed to clear Routine quarantine records', error);
  }
}

export function saveRoutines(routines: Routine[]): void {
  const current = loadAllData();
  saveAllData({ ...current, routines });
}

export function saveReminders(reminders: Reminder[]): void {
  const current = loadAllData();
  saveAllData({ ...current, reminders });
}

/**
 * Node Positions helper methods
 */
export function loadNodePositions(): NodePositionMap {
  return loadAllData().nodePositions;
}

export function saveNodePositions(nodePositions: NodePositionMap): void {
  const current = loadAllData();
  saveAllData({ ...current, nodePositions });
  logger.debug('Storage', 'Saved node positions', { count: Object.keys(nodePositions).length });
}

export function saveSingleNodePosition(position: NodePosition): void {
  const current = loadAllData();
  const nextPositions: NodePositionMap = {
    ...current.nodePositions,
    [position.nodeId]: position,
  };
  saveAllData({ ...current, nodePositions: nextPositions });
}

export function removeNodePosition(nodeId: string): void {
  const current = loadAllData();
  if (current.nodePositions[nodeId]) {
    const nextPositions = { ...current.nodePositions };
    delete nextPositions[nodeId];
    saveAllData({ ...current, nodePositions: nextPositions });
  }
}

export function clearNodePositions(): void {
  const current = loadAllData();
  saveAllData({ ...current, nodePositions: {} });
  logger.info('Storage', 'Cleared all manual node positions');
}

/**
 * Resets state to sample initial data
 */
export function resetToSample(): MindMeshStorageData {
  const defaultState = getDefaultState();
  saveAllData(defaultState);
  logger.info('Storage', 'Reset database to initial sample dataset');
  return defaultState;
}

/**
 * Completely resets MindMesh (deletes all user data and resets to bare default state)
 */
export function resetMindMeshEntirely(): MindMeshStorageData {
  const freshState = getDefaultState();
  saveAllData(freshState);
  logger.info('Storage', 'MindMesh reset entirely to clean default state');
  return freshState;
}

/**
 * Clears all reminders and manual positions, keeping categories
 */
export function clearAllData(): MindMeshStorageData {
  const current = loadAllData();
  const resetState: MindMeshStorageData = {
    ...current,
    reminders: [],
    nodePositions: {},
    lastUpdated: new Date().toISOString(),
  };
  saveAllData(resetState);
  logger.info('Storage', 'Cleared reminders and node positions');
  return resetState;
}

/**
 * Export state to JSON string for backup / sync preparation
 */
export function exportStorageJson(): string {
  const data = loadAllData();
  return JSON.stringify(data, null, 2);
}

/**
 * Imports state from JSON string with validation
 */
export function importStorageJson(json: string): boolean {
  try {
    const parsed = JSON.parse(json);
    if (!parsed || !Array.isArray(parsed.categories) || !Array.isArray(parsed.reminders)) {
      throw new Error('Invalid schema format');
    }
    const state: MindMeshStorageData = {
      version: CURRENT_STORAGE_VERSION,
      categories: normalizeCategories(parsed.categories),
      reminders: parsed.reminders,
      nodePositions: parsed.nodePositions && typeof parsed.nodePositions === 'object' ? parsed.nodePositions : {},
      lastUpdated: new Date().toISOString(),
      money: parsed.money || getDefaultMoneyState(),
      contacts: Array.isArray(parsed.contacts) ? parsed.contacts.filter((contact: unknown): contact is Contact => Boolean(contact && typeof contact === 'object' && typeof (contact as Contact).id === 'string' && typeof (contact as Contact).fullName === 'string')).map((contact: Contact) => ({
        ...contact,
        phoneNumber: typeof contact.phoneNumber === 'string' ? contact.phoneNumber : '',
        relationship: typeof contact.relationship === 'string' ? contact.relationship : 'Other',
        importedFromDevice: contact.importedFromDevice === true,
        createdAt: contact.createdAt || new Date().toISOString(),
        updatedAt: contact.updatedAt || contact.createdAt || new Date().toISOString(),
      })) : INITIAL_CONTACTS,
      contactCategories: Array.isArray(parsed.contactCategories) ? parsed.contactCategories : INITIAL_CONTACT_CATEGORIES,
      contactRelationships: Array.isArray(parsed.contactRelationships) ? parsed.contactRelationships : INITIAL_CONTACT_RELATIONSHIPS,
      appearance: normalizeAppearance(parsed.appearance),
      notifications: normalizeNotificationSettings(parsed.notifications),
      notificationHistory: normalizeNotificationHistory(parsed.notificationHistory),
      smartEngineSettings: normalizeSmartEngineSettings(parsed.smartEngineSettings),
      routines: normalizeRoutines(parsed.routines).routines,
      preferences: parsed.preferences || {},
    };
    saveAllData(state);
    return true;
  } catch (e) {
    logger.error('Storage', 'Failed to import JSON data', e);
    return false;
  }
}
