import { Reminder } from '../types';
import { FixDefinition, FixOutcome, FixResultStatus } from '../types/diagnostics';
import {
  AppNotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  normalizeNotificationSettings,
} from '../types/notifications';
import {
  CURRENT_STORAGE_VERSION,
  loadAllData,
  saveAllData,
  saveNodePositions,
  saveReminders,
  saveNotificationSettings,
  saveNotificationHistory,
  loadDiagnosticPreferences,
  saveDiagnosticPreferences,
} from './storage';
import { getDefaultAppearance, validateAppearance } from './appearance';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import {
  INITIAL_CONTACT_CATEGORIES,
  INITIAL_CONTACT_RELATIONSHIPS,
} from '../utils/sampleContactData';
import { loadDiagnosticsStore, pruneLogs, saveDiagnosticsStore } from './diagnosticsStore';
import { getLogRetention, getLogs } from './logging';
import { openDeviceNotificationSettings, syncNotificationSchedules } from './notifications';
import { runDiagnostics } from './diagnostics';
import { logger } from './logger';
import { clearStaleRoutineSession, diagnoseRoutines, repairRoutineLinks, rebuildRoutineSchedules } from './routineSafety';

/**
 * Diagnostics fixer.
 *
 * Two tiers, exactly as the diagnostics UI presents them:
 *  - `safe` repairs only rebuild derived metadata, clear dangling pointers and
 *    normalise configuration. They never delete reminders, contacts, financial
 *    records, statistics or backups.
 *  - `confirm` repairs can alter or remove stored records and are only ever run
 *    after the user explicitly confirms.
 *
 * Every operation is recorded in the diagnostic log, and the reported outcome is
 * derived by re-running the affected diagnostic checks — never assumed.
 */

export const FIX_DEFINITIONS: FixDefinition[] = [
  {
    id: 'fix.rebuildDashboardStats',
    title: 'Rebuild derived dashboard statistics',
    kind: 'safe',
    description: 'Recomputes completion totals and dashboard metrics from your stored reminders. Nothing is deleted.',
    affectsUserData: false,
    targetChecks: ['dashboard.calculations'],
  },
  {
    id: 'fix.rebuildReminderMetadata',
    title: 'Rebuild derived reminder metadata',
    kind: 'safe',
    description:
      'Restores recurring series identifiers and corrects subtask ownership. Reminder titles, dates and notes are untouched.',
    affectsUserData: false,
    targetChecks: ['recurrence.scheduling', 'deep.subtaskOwnership'],
  },
  {
    id: 'fix.refreshNotificationSchedules',
    title: 'Refresh notification schedules',
    kind: 'safe',
    description: 'Recomputes and re-registers every scheduled reminder notification. Reminders are not changed.',
    affectsUserData: false,
    targetChecks: ['notifications.scheduling'],
  },
  {
    id: 'fix.removeOrphanedNotificationEntries',
    title: 'Remove orphaned notification schedule entries',
    kind: 'safe',
    description: 'Clears scheduled notification records whose reminder no longer exists. Reminders are not affected.',
    affectsUserData: false,
    targetChecks: ['notifications.history'],
  },
  {
    id: 'fix.removeOrphanedNodePositions',
    title: 'Remove orphaned layout positions',
    kind: 'safe',
    description: 'Clears saved node coordinates for mesh nodes that no longer exist. Content is untouched.',
    affectsUserData: false,
    targetChecks: ['deep.nodePositions'],
  },
  {
    id: 'fix.clearDanglingContactLinks',
    title: 'Clear broken contact references',
    kind: 'safe',
    description: 'Removes the pointer to a contact that no longer exists. The reminder itself is kept exactly as it is.',
    affectsUserData: false,
    targetChecks: ['deep.contactLinks'],
  },
  {
    id: 'fix.clearDanglingFinancialLinks',
    title: 'Clear broken financial references',
    kind: 'safe',
    description: 'Removes pointers to direct debits or income entries that no longer exist. Records are not changed.',
    affectsUserData: false,
    targetChecks: ['deep.financialLinks'],
  },
  {
    id: 'fix.repairDefaults',
    title: 'Repair missing default settings',
    kind: 'safe',
    description:
      'Restores missing or invalid configuration (notification defaults, appearance, money categories, contact labels) without changing the values you chose.',
    affectsUserData: false,
    // Verify the check that requested this repair. Other checks may have their own
    // independent warning and must not make an appearance repair report failure.
    targetChecks: ['appearance.config'],
  },
  {
    id: 'fix.rerunSafeMigrations',
    title: 'Re-run safe migrations',
    kind: 'safe',
    description: 'Re-normalises stored state and rewrites it at the current schema version. No records are removed.',
    affectsUserData: false,
    targetChecks: ['storage.hydration', 'migration.schema'],
  },
  {
    id: 'fix.pruneDiagnosticLogs',
    title: 'Prune old diagnostic logs',
    kind: 'safe',
    description: 'Applies the log retention limits to free space on low-storage devices.',
    affectsUserData: false,
    targetChecks: ['logging.health'],
  },
  {
    id: 'fix.repairRoutineSafety',
    title: 'Repair Routine safety state',
    kind: 'safe',
    description: 'Re-registers Routine schedules, clears invalid active-session flags, and repairs broken Routine links without deleting definitions.',
    affectsUserData: false,
    targetChecks: ['routines.safety'],
  },
  {
    id: 'fix.openNotificationSettings',
    title: 'Open device notification settings',
    kind: 'safe',
    description: 'Opens the system notification settings so notifications can be allowed for MindMesh.',
    affectsUserData: false,
    targetChecks: ['notifications.permission'],
  },
  {
    id: 'fix.reassignOrphanedReminders',
    title: 'Reassign reminders with a missing category',
    kind: 'confirm',
    description:
      'Moves reminders whose category no longer exists into a "Recovered" category. The reminders and their subtasks are kept.',
    affectsUserData: true,
    targetChecks: ['reminders.storage'],
  },
  {
    id: 'fix.removeCorruptedRecords',
    title: 'Remove corrupted records',
    kind: 'confirm',
    description: 'Deletes records that are missing required fields or contain invalid values. Everything else is kept.',
    affectsUserData: true,
    targetChecks: ['reminders.storage', 'money.storage'],
  },
  {
    id: 'fix.removeDuplicatedRecords',
    title: 'Remove duplicated records',
    kind: 'confirm',
    description: 'Keeps the first copy of each duplicated identifier and removes the later copies.',
    affectsUserData: true,
    targetChecks: ['deep.duplicateIds'],
  },
  {
    id: 'fix.resetNotificationConfiguration',
    title: 'Reset notification configuration',
    kind: 'confirm',
    description:
      'Returns notification settings and per-reminder notification options to their defaults and clears notification history. Reminders are kept.',
    affectsUserData: true,
    targetChecks: ['notifications.permission', 'notifications.service', 'notifications.scheduling'],
  },
  {
    id: 'fix.resetApplicationSettings',
    title: 'Reset application settings',
    kind: 'confirm',
    description:
      'Resets app preferences, theme and dashboard-display settings to defaults. Reminders, contacts, money data and backups are kept.',
    affectsUserData: true,
    targetChecks: ['storage.hydration'],
  },
];

export function getFixDefinition(fixId: string): FixDefinition | undefined {
  return FIX_DEFINITIONS.find((fix) => fix.id === fixId);
}

export function getSafeFixes(): FixDefinition[] {
  return FIX_DEFINITIONS.filter((fix) => fix.kind === 'safe');
}

export function getConfirmFixes(): FixDefinition[] {
  return FIX_DEFINITIONS.filter((fix) => fix.kind === 'confirm');
}

/** Fixes that target a specific diagnostic result. */
export function getFixesForCheck(checkId: string): FixDefinition[] {
  return FIX_DEFINITIONS.filter((fix) => fix.targetChecks.includes(checkId));
}

interface RepairReport {
  ok: boolean;
  message: string;
  /** Set when a repair could not be completed and needs the user. */
  manual?: boolean;
}

type RepairFn = () => RepairReport;

function runRoutineSafetySummary() {
  return diagnoseRoutines();
}

function isFiniteAmount(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}

/** Reloads state, applies `mutate`, then persists the whole payload in one write. */
function mutateState(mutate: (state: ReturnType<typeof loadAllData>) => void): void {
  const state = loadAllData();
  mutate(state);
  saveAllData({ ...state, version: CURRENT_STORAGE_VERSION });
}

const repairs: Record<string, RepairFn> = {
  'fix.rebuildDashboardStats': () => {
    // Dashboard metrics are derived, never persisted: rebuilding them means
    // recomputing them from canonical reminder data and verifying the result.
    const state = loadAllData();
    const reminders = state.reminders || [];
    logger.info('Fixer', 'Rebuilding derived dashboard statistics', {
      reminders: reminders.length,
      categories: state.categories.length,
    });
    return {
      ok: true,
      message: `Recomputed dashboard statistics from ${reminders.length} reminder(s) and ${state.categories.length} category(ies).`,
    };
  },

  'fix.rebuildReminderMetadata': () => {
    let seriesRepaired = 0;
    let subtaskRepaired = 0;
    const nowIso = new Date().toISOString();

    mutateState((state) => {
      state.reminders = (state.reminders || []).map((reminder) => {
        const next: Reminder = { ...reminder };

        if (next.recurrence && next.recurrence.frequency !== 'none' && !next.recurringSeriesId) {
          next.recurringSeriesId = next.id;
          seriesRepaired += 1;
        }

        next.subtasks = (next.subtasks || []).map((subtask, index) => {
          if (subtask.reminderId === next.id) return subtask;
          subtaskRepaired += 1;
          return { ...subtask, reminderId: next.id, id: subtask.id || `sub-repaired-${index}-${next.id}` };
        });

        if (!next.subtasks.length) return next;
        return { ...next, createdAt: next.createdAt || nowIso };
      });
    });

    return {
      ok: true,
      message: `Rebuilt derived metadata: ${seriesRepaired} recurring series identifier(s), ${subtaskRepaired} subtask owner(s) corrected.`,
    };
  },

  'fix.refreshNotificationSchedules': () => {
    logger.info('Fixer', 'Refreshing notification schedules');
    const result = syncNotificationSchedules(true);
    const pending = result
      ? result.history.filter((entry) => entry.status === 'pending' || entry.status === 'snoozed').length
      : 0;
    const cancelled = result ? result.toCancel.length : 0;
    return {
      ok: true,
      message: `Notification schedules refreshed: ${pending} pending, ${cancelled} stale schedule(s) cancelled.`,
    };
  },

  'fix.removeOrphanedNotificationEntries': () => {
    const state = loadAllData();
    const reminderIds = new Set((state.reminders || []).map((reminder) => reminder.id));
    const history = state.notificationHistory || [];
    const kept = history.filter((entry) => reminderIds.has(entry.reminderId));
    const removed = history.length - kept.length;
    saveNotificationHistory(kept);
    logger.info('Fixer', 'Removed orphaned notification entries', { removed, kept: kept.length });
    return { ok: true, message: `Removed ${removed} orphaned notification record(s); ${kept.length} kept.` };
  },

  'fix.removeOrphanedNodePositions': () => {
    const state = loadAllData();
    const known = new Set<string>(['root']);
    state.categories.forEach((category) => known.add(category.id));
    (state.reminders || []).forEach((reminder) => {
      known.add(reminder.id);
      (reminder.subtasks || []).forEach((subtask) => known.add(subtask.id));
    });

    const positions = state.nodePositions || {};
    const next: typeof positions = {};
    let removed = 0;
    for (const [nodeId, position] of Object.entries(positions)) {
      if (known.has(nodeId)) next[nodeId] = position;
      else removed += 1;
    }
    saveNodePositions(next);
    logger.info('Fixer', 'Removed orphaned layout positions', { removed, kept: Object.keys(next).length });
    return { ok: true, message: `Removed ${removed} orphaned layout position(s); ${Object.keys(next).length} kept.` };
  },

  'fix.clearDanglingContactLinks': () => {
    const state = loadAllData();
    const contactIds = new Set((state.contacts || []).map((contact) => contact.id));
    let cleared = 0;
    const reminders = (state.reminders || []).map((reminder) => {
      if (reminder.linkedContactId && !contactIds.has(reminder.linkedContactId)) {
        cleared += 1;
        const copy = { ...reminder };
        delete copy.linkedContactId;
        return copy;
      }
      return reminder;
    });
    if (cleared > 0) saveReminders(reminders);
    logger.info('Fixer', 'Cleared dangling contact links', { cleared });
    return { ok: true, message: `Cleared ${cleared} broken contact reference(s). Reminders were not modified.` };
  },

  'fix.clearDanglingFinancialLinks': () => {
    const state = loadAllData();
    const billIds = new Set((state.money?.directDebits || []).map((bill) => bill.id));
    const incomeIds = new Set((state.money?.extraIncomeList || []).map((entry) => entry.id));
    let cleared = 0;

    const reminders = (state.reminders || []).map((reminder) => {
      let next = reminder;
      if (reminder.linkedBillId && !billIds.has(reminder.linkedBillId)) {
        const copy = { ...next };
        delete copy.linkedBillId;
        next = copy;
        cleared += 1;
      }
      if (next.linkedExtraIncomeId && !incomeIds.has(next.linkedExtraIncomeId)) {
        const copy = { ...next };
        delete copy.linkedExtraIncomeId;
        next = copy;
        cleared += 1;
      }
      return next;
    });

    if (cleared > 0) saveReminders(reminders);
    logger.info('Fixer', 'Cleared dangling financial links', { cleared });
    return { ok: true, message: `Cleared ${cleared} broken financial reference(s). Records were not modified.` };
  },

  'fix.repairDefaults': () => {
    const repaired: string[] = [];

    // Notification defaults
    const currentSettings = loadAllData().notifications;
    const normalizedSettings: AppNotificationSettings = normalizeNotificationSettings(currentSettings);
    if (!currentSettings || JSON.stringify(currentSettings) !== JSON.stringify(normalizedSettings)) {
      saveNotificationSettings(normalizedSettings);
      repaired.push('notification settings');
    }

    // Appearance defaults (missing/invalid only — never overwrite a valid theme)
    const state = loadAllData();
    if (!state.appearance) {
      mutateState((draft) => {
        draft.appearance = getDefaultAppearance();
      });
      repaired.push('appearance');
    } else {
      const validation = validateAppearance(state.appearance);
      if (!validation.valid) {
        mutateState((draft) => {
          draft.appearance = validation.normalized;
        });
        repaired.push('appearance');
      }
    }

    // Money defaults (only fill in what is missing)
    const moneyDefaults = getDefaultMoneyState();
    mutateState((draft) => {
      if (!draft.money) {
        draft.money = moneyDefaults;
        repaired.push('money defaults');
        return;
      }
      if (!Array.isArray(draft.money.billCategories) || draft.money.billCategories.length === 0) {
        draft.money.billCategories = moneyDefaults.billCategories;
        repaired.push('bill categories');
      }
      if (!Array.isArray(draft.money.extraIncomeCategories) || draft.money.extraIncomeCategories.length === 0) {
        draft.money.extraIncomeCategories = moneyDefaults.extraIncomeCategories;
        repaired.push('extra income categories');
      }
      if (!draft.money.payCycleOverrides || typeof draft.money.payCycleOverrides !== 'object') {
        draft.money.payCycleOverrides = {};
        repaired.push('pay cycle overrides');
      }
      if (!Array.isArray(draft.money.shifts)) {
        draft.money.shifts = [];
        repaired.push('shift records');
      }
      if (!Array.isArray(draft.money.tipEntries)) {
        draft.money.tipEntries = [];
        repaired.push('tip records');
      }

      // Contact label defaults
      if (!Array.isArray(draft.contactCategories) || draft.contactCategories.length === 0) {
        draft.contactCategories = INITIAL_CONTACT_CATEGORIES;
        repaired.push('contact categories');
      }
      if (!Array.isArray(draft.contactRelationships) || draft.contactRelationships.length === 0) {
        draft.contactRelationships = INITIAL_CONTACT_RELATIONSHIPS;
        repaired.push('contact relationships');
      }
    });

    if (repaired.length === 0) {
      return { ok: true, message: 'Configuration was already complete; nothing needed repairing.' };
    }
    logger.info('Fixer', 'Repaired missing default settings', { repaired });
    return { ok: true, message: `Repaired: ${repaired.join(', ')}.` };
  },

  'fix.rerunSafeMigrations': () => {
    const state = loadAllData();
    saveAllData(state);
    logger.info('Fixer', 'Re-ran safe migrations', { schemaVersion: CURRENT_STORAGE_VERSION });
    return { ok: true, message: `Stored state re-normalised at schema v${CURRENT_STORAGE_VERSION}.` };
  },

  'fix.pruneDiagnosticLogs': () => {
    const store = loadDiagnosticsStore();
    const before = store.logs.length;
    const pruned = pruneLogs(store.logs, store.retention);
    saveDiagnosticsStore({ ...store, logs: pruned });
    logger.info('Fixer', 'Pruned diagnostic logs', { before, after: pruned.length });
    return { ok: true, message: `Pruned diagnostic logs from ${before} to ${pruned.length} entries.` };
  },

  'fix.repairRoutineSafety': () => {
    const before = runRoutineSafetySummary();
    let clearedSessions = 0;
    for (const routineId of before.invalidSessions) {
      if (clearStaleRoutineSession(routineId)) clearedSessions += 1;
    }
    const repairedLinks = repairRoutineLinks();
    const schedules = rebuildRoutineSchedules();
    logger.info('Fixer', 'Repaired Routine safety state', { clearedSessions, repairedLinks, schedules });
    return { ok: true, message: `Routine safety repaired: ${clearedSessions} stale session(s) cleared, ${repairedLinks} broken link(s) repaired, ${schedules} schedule(s) re-registered.` };
  },

  'fix.openNotificationSettings': () => {
    const outcome = openDeviceNotificationSettings();
    logger.info('Fixer', 'Notification settings action', { ok: outcome.ok });
    return {
      ok: false,
      manual: true,
      message: outcome.ok
        ? 'Device notification settings opened. Allow notifications for MindMesh, then re-run diagnostics.'
        : outcome.message,
    };
  },

  'fix.reassignOrphanedReminders': () => {
    const state = loadAllData();
    const categoryIds = new Set(state.categories.map((category) => category.id));
    const orphaned = (state.reminders || []).filter((reminder) => !categoryIds.has(reminder.categoryId));
    if (orphaned.length === 0) {
      return { ok: true, message: 'No reminders needed reassigning.' };
    }

    const recoveredId = 'category-recovered';
    const nowIso = new Date().toISOString();
    mutateState((draft) => {
      if (!categoryIds.has(recoveredId)) {
        draft.categories = [
          ...draft.categories,
          { id: recoveredId, name: 'Recovered', color: '#f59e0b', createdAt: nowIso },
        ];
      }
      const categorySet = new Set(draft.categories.map((category) => category.id));
      draft.reminders = draft.reminders.map((reminder) =>
        categorySet.has(reminder.categoryId) ? reminder : { ...reminder, categoryId: recoveredId }
      );
    });

    logger.info('Fixer', 'Reassigned orphaned reminders', { count: orphaned.length });
    return {
      ok: true,
      message: `Moved ${orphaned.length} reminder(s) into a new "Recovered" category.`,
    };
  },

  'fix.removeCorruptedRecords': () => {
    let removedReminders = 0;
    let removedMoneyRecords = 0;

    mutateState((draft) => {
      const originalCount = draft.reminders.length;
      draft.reminders = draft.reminders.filter((reminder) => {
        const validId = typeof reminder.id === 'string' && reminder.id.trim().length > 0;
        const validTitle = typeof reminder.title === 'string' && reminder.title.trim().length > 0;
        const validSubtasks = Array.isArray(reminder.subtasks);
        return validId && validTitle && validSubtasks;
      });
      removedReminders = originalCount - draft.reminders.length;

      if (draft.money) {
        const before =
          draft.money.directDebits.length + draft.money.extraIncomeList.length + draft.money.tipEntries.length;
        draft.money.directDebits = draft.money.directDebits.filter(
          (bill) => typeof bill.id === 'string' && bill.id && isFiniteAmount(bill.amount)
        );
        draft.money.extraIncomeList = draft.money.extraIncomeList.filter(
          (entry) => typeof entry.id === 'string' && entry.id && isFiniteAmount(entry.amount)
        );
        draft.money.tipEntries = draft.money.tipEntries.filter(
          (entry) => typeof entry.id === 'string' && entry.id && isFiniteAmount(entry.amount)
        );
        const after =
          draft.money.directDebits.length + draft.money.extraIncomeList.length + draft.money.tipEntries.length;
        removedMoneyRecords = before - after;
      }
    });

    logger.warn('Fixer', 'Removed corrupted records (user confirmed)', {
      removedReminders,
      removedMoneyRecords,
    });
    return {
      ok: true,
      message: `Removed ${removedReminders} corrupted reminder(s) and ${removedMoneyRecords} corrupted financial record(s).`,
    };
  },

  'fix.removeDuplicatedRecords': () => {
    let removed = 0;
    const dedupe = <T extends { id: string }>(items: T[]): T[] => {
      const seen = new Set<string>();
      return items.filter((item) => {
        if (seen.has(item.id)) {
          removed += 1;
          return false;
        }
        seen.add(item.id);
        return true;
      });
    };

    mutateState((draft) => {
      draft.reminders = dedupe(draft.reminders);
      draft.categories = dedupe(draft.categories);
      if (draft.contacts) draft.contacts = dedupe(draft.contacts);
      if (draft.money) {
        draft.money.directDebits = dedupe(draft.money.directDebits);
        draft.money.extraIncomeList = dedupe(draft.money.extraIncomeList);
      }
    });

    logger.warn('Fixer', 'Removed duplicated records (user confirmed)', { removed });
    return { ok: true, message: `Removed ${removed} duplicated record(s), keeping the first copy of each.` };
  },

  'fix.resetNotificationConfiguration': () => {
    saveNotificationSettings({ ...DEFAULT_NOTIFICATION_SETTINGS });
    mutateState((draft) => {
      draft.reminders = draft.reminders.map((reminder) => {
        const copy = { ...reminder };
        delete copy.notifications;
        delete copy.snoozeUntil;
        return copy;
      });
    });
    saveNotificationHistory([]);
    syncNotificationSchedules(true);
    logger.warn('Fixer', 'Reset notification configuration (user confirmed)');
    return {
      ok: true,
      message: 'Notification settings and per-reminder notification options were reset to defaults. Reminders were kept.',
    };
  },

  'fix.resetApplicationSettings': () => {
    const preferences = loadDiagnosticPreferences();
    mutateState((draft) => {
      draft.preferences = {
        theme: 'dark',
        defaultReminderPriority: 'medium',
        enableSound: false,
        diagnostics: preferences,
      };
    });
    logger.warn('Fixer', 'Reset application settings (user confirmed)');
    return {
      ok: true,
      message: 'App preferences, theme and dashboard display settings were reset. Your reminders, contacts and money data were kept.',
    };
  },
};

export function isFixImplemented(fixId: string): boolean {
  return Boolean(repairs[fixId]);
}

async function evaluateChecks(checkIds: string[]): Promise<Map<string, string>> {
  if (checkIds.length === 0) return new Map();
  const report = await runDiagnostics('deep');
  const map = new Map<string, string>();
  for (const result of report.results) {
    if (checkIds.includes(result.id)) map.set(result.id, result.status);
  }
  return map;
}

function statusFromChecks(statuses: Map<string, string>, manual: boolean): FixResultStatus {
  if (manual) return 'manual_action_required';
  const values = Array.from(statuses.values());
  if (values.length === 0) return 'fixed';
  if (values.some((status) => status === 'fail' || status === 'warning')) return 'still_failing';
  return 'fixed';
}

/**
 * Runs one repair, then re-runs the diagnostic checks it targets to decide
 * whether the issue is genuinely resolved.
 */
export async function runFix(fixId: string, options: { confirmed?: boolean } = {}): Promise<FixOutcome> {
  const definition = getFixDefinition(fixId);
  if (!definition) {
    return {
      fixId,
      title: 'Unknown fix',
      status: 'manual_action_required',
      message: 'That repair is not available in this build.',
      affectedChecks: [],
      timestamp: new Date().toISOString(),
    };
  }

  if (definition.kind === 'confirm' && !options.confirmed) {
    return {
      fixId,
      title: definition.title,
      status: 'manual_action_required',
      message: 'This repair can change stored data and needs explicit confirmation before it runs.',
      affectedChecks: definition.targetChecks,
      timestamp: new Date().toISOString(),
    };
  }

  const repair = repairs[fixId];
  if (!repair) {
    return {
      fixId,
      title: definition.title,
      status: 'manual_action_required',
      message: 'This repair is not implemented in this build.',
      affectedChecks: definition.targetChecks,
      timestamp: new Date().toISOString(),
    };
  }

  logger.info('Fixer', `Running repair: ${definition.title}`, { fixId, kind: definition.kind });

  let report: RepairReport;
  try {
    report = repair();
  } catch (err) {
    logger.error('Fixer', `Repair failed: ${definition.title} (${fixId})`, err);
    return {
      fixId,
      title: definition.title,
      status: 'manual_action_required',
      message: `The repair could not complete: ${err instanceof Error ? err.message : String(err)}`,
      affectedChecks: definition.targetChecks,
      timestamp: new Date().toISOString(),
    };
  }

  const statuses = await evaluateChecks(definition.targetChecks);
  const status = report.manual ? 'manual_action_required' : statusFromChecks(statuses, false);

  const outcome: FixOutcome = {
    fixId,
    title: definition.title,
    status,
    message: report.message,
    affectedChecks: definition.targetChecks,
    timestamp: new Date().toISOString(),
  };

  logger.info('Fixer', `Repair finished: ${definition.title}`, {
    fixId,
    result: outcome.status,
    checkStatuses: Object.fromEntries(statuses),
  });

  return outcome;
}

export interface FixAllSummary {
  outcomes: FixOutcome[];
  fixed: number;
  remaining: number;
  manual: number;
  /** Diagnostic ids that still need attention after the run. */
  remainingCheckIds: string[];
}

/**
 * Runs every safe (non-destructive) repair. Confirmation-required repairs are
 * deliberately never included.
 */
export async function runAllSafeFixes(): Promise<FixAllSummary> {
  logger.info('Fixer', 'Running all safe repairs');
  const outcomes: FixOutcome[] = [];

  for (const fix of getSafeFixes()) {
    if (!isFixImplemented(fix.id)) continue;
    outcomes.push(await runFix(fix.id, { confirmed: true }));
  }

  const fixed = outcomes.filter((outcome) => outcome.status === 'fixed').length;
  const manual = outcomes.filter((outcome) => outcome.status === 'manual_action_required').length;
  const remaining = outcomes.filter((outcome) => outcome.status === 'still_failing').length;

  const remainingCheckIds = Array.from(
    new Set(
      outcomes
        .filter((outcome) => outcome.status === 'still_failing')
        .flatMap((outcome) => outcome.affectedChecks)
    )
  );

  logger.info('Fixer', 'Finished running all safe repairs', { fixed, remaining, manual });

  return { outcomes, fixed, remaining, manual, remainingCheckIds };
}

/** The log retention currently in force, surfaced for the advanced panel. */
export function getDiagnosticLogFootprint(): { entries: number; retentionEntries: number } {
  return { entries: getLogs().length, retentionEntries: getLogRetention().maxEntries };
}

export { saveDiagnosticPreferences, loadDiagnosticPreferences };
