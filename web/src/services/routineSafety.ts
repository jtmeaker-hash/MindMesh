import { Routine, RoutineVersionSnapshot, normalizeRoutines } from '../types/routine';
import { loadAllData, loadRoutineQuarantine, saveAllData, saveRoutines } from './storage';
import { getNativeNotificationDiagnostics, getNotificationEnvironment } from './notifications';
import { logger } from './logger';

export interface RoutineDiagnosticReport {
  notificationPermission: string;
  alarmCapability: string;
  scheduleRegistration: { scheduled: number; activeSessions: number; overdueSessions: number };
  invalidSessions: string[];
  missingLinks: { routineId: string; stepId: string; type: string; targetId: string }[];
  migration: { schemaVersion: number; quarantined: number };
  quarantined: { id: string; reason: string }[];
  recovery: { drafts: number; brokenLinks: number };
  trash: { count: number; expired: number };
}

const now = () => new Date().toISOString();

export function diagnoseRoutines(): RoutineDiagnosticReport {
  const state = loadAllData();
  const normalized = normalizeRoutines(state.routines);
  const routines = normalized.routines;
  const persistedQuarantine = loadRoutineQuarantine();
  const invalidSessions: string[] = [];
  const missingLinks: RoutineDiagnosticReport['missingLinks'] = [];
  const reminderIds = new Set(state.reminders.map((item) => item.id));
  const contactIds = new Set((state.contacts || []).map((item) => item.id));
  const billIds = new Set((state.money?.directDebits || []).map((item) => item.id));
  const routineIds = new Set(routines.map((item) => item.id));

  for (const routine of routines) {
    if (routine.activeSession) {
      const session = routine.activeSession;
      const occurrence = routine.occurrences.find((item) => item.id === session.occurrenceId);
      const stepExists = !session.currentStepId || routine.steps.some((step) => step.id === session.currentStepId);
      if (!occurrence || !stepExists || (session.status === 'running' && !session.startedAt)) invalidSessions.push(routine.id);
    }
    for (const step of routine.steps) {
      const links = step.links;
      if (!links) continue;
      const checks: [string, string | undefined, Set<string>][] = [
        ['reminder', links.reminderId, reminderIds],
        ['contact', links.contactId, contactIds],
        ['directDebit', links.directDebitId, billIds],
        ['routine', links.routineId, routineIds],
      ];
      for (const [type, targetId, ids] of checks) {
        if (targetId && !ids.has(targetId)) missingLinks.push({ routineId: routine.id, stepId: step.id, type, targetId });
      }
    }
  }

  const retentionDays = routineTrashRetentionDays();
  const cutoff = Date.now() - retentionDays * 86_400_000;
  const trashed = routines.filter((routine) => Boolean(routine.trashedAt));
  return {
    notificationPermission: getNotificationEnvironment().permission,
    alarmCapability: (() => {
      const native = getNativeNotificationDiagnostics();
      if (native) return native.exactAlarms ? 'available' : 'restricted';
      return getNotificationEnvironment().platform === 'browser' ? 'browser-timer-only' : 'unavailable';
    })(),
    scheduleRegistration: {
      scheduled: routines.filter((routine) => routine.notification.enabled && !routine.trashedAt).length,
      activeSessions: routines.filter((routine) => Boolean(routine.activeSession)).length,
      overdueSessions: routines.filter((routine) => routine.activeSession?.status === 'expired').length,
    },
    invalidSessions,
    missingLinks,
    migration: { schemaVersion: state.version, quarantined: persistedQuarantine.length },
    quarantined: persistedQuarantine.map(({ id, reason }) => ({ id, reason })),
    recovery: { drafts: routines.filter((routine) => Boolean(routine.draftRecovery)).length, brokenLinks: routines.filter((routine) => Boolean(routine.brokenLink)).length },
    trash: { count: trashed.length, expired: trashed.filter((routine) => Date.parse(routine.trashedAt || '') < cutoff).length },
  };
}

export function routineTrashRetentionDays(): number {
  const value = loadAllData().preferences?.routineTrashRetentionDays;
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(3650, Math.max(1, Math.round(value))) : 30;
}

export function setRoutineTrashRetentionDays(days: number): void {
  const state = loadAllData();
  state.preferences = { ...(state.preferences || {}), routineTrashRetentionDays: Math.min(3650, Math.max(1, Math.round(days))) };
  saveAllData(state);
}

export function purgeExpiredRoutineTrash(confirmDelete = false): { removed: number; skipped: number } {
  const state = loadAllData();
  const cutoff = Date.now() - routineTrashRetentionDays() * 86_400_000;
  const expired = (state.routines || []).filter((routine) => routine.trashedAt && Date.parse(routine.trashedAt) < cutoff);
  if (!confirmDelete) return { removed: 0, skipped: expired.length };
  saveRoutines((state.routines || []).filter((routine) => !routine.trashedAt || Date.parse(routine.trashedAt) >= cutoff));
  logger.info('Routines', 'Purged expired Routine trash after confirmation', { removed: expired.length });
  return { removed: expired.length, skipped: 0 };
}

export function clearStaleRoutineSession(routineId: string): Routine | undefined {
  const routines = loadAllData().routines || [];
  const routine = routines.find((item) => item.id === routineId);
  if (!routine?.activeSession) return routine;
  const next = { ...routine, activeSession: undefined, updatedAt: now() };
  saveRoutines(routines.map((item) => item.id === routineId ? next : item));
  logger.info('Routines', 'Cleared stale Routine session without deleting definition', { routineId });
  return next;
}

export function repairRoutineLinks(routineId?: string): number {
  const state = loadAllData();
  const report = diagnoseRoutines();
  const broken = report.missingLinks.filter((item) => !routineId || item.routineId === routineId);
  if (broken.length === 0) return 0;
  const byStep = new Map(broken.map((item) => [`${item.routineId}:${item.stepId}`, item]));
  const routines = (state.routines || []).map((routine) => ({
    ...routine,
    steps: routine.steps.map((step) => {
      const issue = byStep.get(`${routine.id}:${step.id}`);
      if (!issue || !step.links) return step;
      const links = { ...step.links } as typeof step.links;
      if (issue.type === 'reminder') delete links.reminderId;
      if (issue.type === 'contact') delete links.contactId;
      if (issue.type === 'directDebit') delete links.directDebitId;
      if (issue.type === 'routine') delete links.routineId;
      return { ...step, links: { ...links, broken: true, brokenReason: `Missing ${issue.type}: ${issue.targetId}` } };
    }),
    brokenLink: true,
    updatedAt: now(),
  }));
  saveRoutines(routines);
  logger.info('Routines', 'Repaired broken Routine links non-destructively', { count: broken.length });
  return broken.length;
}

export function restoreRoutineVersion(routineId: string, snapshotId: string): Routine | undefined {
  const state = loadAllData();
  const routine = (state.routines || []).find((item) => item.id === routineId);
  const snapshot = routine?.versionHistory.find((item) => item.id === snapshotId);
  if (!routine || !snapshot) return undefined;
  const restoreSnapshot: RoutineVersionSnapshot = {
    id: `${routineId}-restore-${Date.now()}`,
    routineId,
    version: routine.version,
    createdAt: now(),
    reason: 'Before restoring a previous version',
    name: routine.name,
    description: routine.description,
    steps: routine.steps,
  };
  const restored = { ...routine, name: snapshot.name, description: snapshot.description, steps: snapshot.steps, version: routine.version + 1, versionHistory: [...routine.versionHistory, restoreSnapshot], updatedAt: now() };
  saveRoutines((state.routines || []).map((item) => item.id === routineId ? restored : item));
  logger.info('Routines', 'Restored a prior Routine version', { routineId, snapshotId });
  return restored;
}

export function rebuildRoutineSchedules(): number {
  const routines = loadAllData().routines || [];
  const count = routines.filter((routine) => routine.notification.enabled && !routine.trashedAt).length;
  logger.info('Routines', 'Rebuilt Routine schedule registration request', { count });
  return count;
}
