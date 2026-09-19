import { Category, Reminder, NodePositionMap, NodePosition, MindMeshStorageData } from '../types';
import { INITIAL_CATEGORIES, INITIAL_REMINDERS } from '../utils/sampleData';
import { logger } from './logger';

export const CURRENT_STORAGE_VERSION = 2;
const STORAGE_KEY_V2 = 'mindmesh_state_v2';
const LEGACY_CATEGORIES_KEY = 'mindmesh_categories_v1';
const LEGACY_REMINDERS_KEY = 'mindmesh_reminders_v1';
const NODE_POSITIONS_KEY = 'mindmesh_positions_v1';

function getDefaultState(): MindMeshStorageData {
  return {
    version: CURRENT_STORAGE_VERSION,
    categories: INITIAL_CATEGORIES,
    reminders: INITIAL_REMINDERS,
    nodePositions: {},
    lastUpdated: new Date().toISOString(),
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

    logger.info('Storage', 'Migrating legacy v1 storage to v2 schema');

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
    };

    saveAllData(migrated);
    return migrated;
  } catch (err) {
    logger.error('Storage', 'Failed during legacy storage migration', err);
    return null;
  }
}

/**
 * Loads entire persisted MindMesh state with safe fallbacks.
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

    const categories = Array.isArray(parsed.categories) && parsed.categories.length > 0
      ? parsed.categories
      : INITIAL_CATEGORIES;

    const reminders = Array.isArray(parsed.reminders)
      ? parsed.reminders
      : INITIAL_REMINDERS;

    const nodePositions = parsed.nodePositions && typeof parsed.nodePositions === 'object'
      ? parsed.nodePositions
      : {};

    logger.debug('Storage', 'State hydrated successfully', {
      categoryCount: categories.length,
      reminderCount: reminders.length,
      positionCount: Object.keys(nodePositions).length,
    });

    return {
      version: parsed.version || CURRENT_STORAGE_VERSION,
      categories,
      reminders,
      nodePositions,
      lastUpdated: parsed.lastUpdated || new Date().toISOString(),
    };
  } catch (e) {
    logger.error('Storage', 'Error reading storage, restoring safe default state', e);
    return getDefaultState();
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
 * Clears all reminders and manual positions, keeping categories
 */
export function clearAllData(): MindMeshStorageData {
  const current = loadAllData();
  const resetState: MindMeshStorageData = {
    version: CURRENT_STORAGE_VERSION,
    categories: current.categories,
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
      categories: parsed.categories,
      reminders: parsed.reminders,
      nodePositions: parsed.nodePositions && typeof parsed.nodePositions === 'object' ? parsed.nodePositions : {},
      lastUpdated: new Date().toISOString(),
    };
    saveAllData(state);
    return true;
  } catch (e) {
    logger.error('Storage', 'Failed to import JSON data', e);
    return false;
  }
}
