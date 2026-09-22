import { Routine, RoutineHistoryEntry, normalizeRoutine } from '../types/routine';

export const ROUTINE_TRANSFER_VERSION = 1;

export interface RoutineExportFile {
  type: 'mindmesh-routine';
  transferVersion: number;
  exportedAt: string;
  routine: Routine;
}

export interface RoutineHistoryExportFile {
  type: 'mindmesh-routine-history';
  transferVersion: number;
  exportedAt: string;
  routineId: string;
  routineName: string;
  history: RoutineHistoryEntry[];
  occurrences: Routine['occurrences'];
  stats: Routine['stats'];
}

export type RoutineImportConflictKind = 'category' | 'reminder' | 'contact' | 'direct-debit' | 'routine-id';
export interface RoutineImportConflict {
  id: string;
  kind: RoutineImportConflictKind;
  referenceId: string;
  stepId?: string;
  message: string;
  resolution: 'keep' | 'unlink' | 'use-existing' | 'duplicate' | 'skip';
}

export interface RoutineImportReferenceSet {
  categories: Set<string>;
  reminders: Set<string>;
  contacts: Set<string>;
  directDebits: Set<string>;
  routineIds: Set<string>;
  fallbackCategoryId?: string;
}

export interface RoutineImportPreview {
  valid: boolean;
  routine?: Routine;
  conflicts: RoutineImportConflict[];
  warnings: string[];
  error?: string;
}

export interface RoutineImportDecisions {
  conflicts?: Record<string, RoutineImportConflict['resolution']>;
  fallbackCategoryId?: string;
  duplicateId?: string;
}

const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

export function routineExportFile(routine: Routine): RoutineExportFile {
  return { type: 'mindmesh-routine', transferVersion: ROUTINE_TRANSFER_VERSION, exportedAt: now(), routine };
}

export function serializeRoutineExport(routine: Routine): string {
  return JSON.stringify(routineExportFile(routine), null, 2);
}

export function serializeRoutineHistoryJson(routine: Routine): string {
  const payload: RoutineHistoryExportFile = {
    type: 'mindmesh-routine-history',
    transferVersion: ROUTINE_TRANSFER_VERSION,
    exportedAt: now(),
    routineId: routine.id,
    routineName: routine.name,
    history: routine.history,
    occurrences: routine.occurrences,
    stats: routine.stats,
  };
  return JSON.stringify(payload, null, 2);
}

function csvCell(value: unknown): string {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export function serializeRoutineHistoryCsv(routine: Routine): string {
  const rows: Array<Array<string | number>> = [['routineId', 'routineName', 'eventId', 'event', 'at', 'stepId', 'reason', 'durationMinutes']];
  routine.history.forEach((entry) => rows.push([
    routine.id, routine.name, entry.id, entry.event, entry.at, entry.stepId || '', entry.reason || '', entry.durationMinutes ?? '',
  ]));
  return rows.map((row) => row.map(csvCell).join(',')).join('\n');
}

export function serializeRoutineBulkExport(routines: Routine[]): string {
  return JSON.stringify({ type: 'mindmesh-routines', transferVersion: ROUTINE_TRANSFER_VERSION, exportedAt: now(), routines }, null, 2);
}

function addConflict(conflicts: RoutineImportConflict[], kind: RoutineImportConflictKind, referenceId: string, message: string, stepId?: string) {
  conflicts.push({ id: `${kind}:${stepId || 'routine'}:${referenceId}`, kind, referenceId, stepId, message, resolution: kind === 'routine-id' ? 'duplicate' : 'unlink' });
}

/** Parses a single routine export and reports every external reference before mutation. */
export function previewRoutineImport(json: string, references: RoutineImportReferenceSet): RoutineImportPreview {
  const parsed = parseJson(json) as Record<string, unknown> | undefined;
  const candidate = parsed?.type === 'mindmesh-routine' ? parsed.routine : parsed?.type === 'mindmesh-routines' ? (Array.isArray(parsed.routines) ? parsed.routines[0] : undefined) : parsed;
  if (!candidate) return { valid: false, conflicts: [], warnings: [], error: 'This is not a readable Routine export.' };

  let routine: Routine;
  try {
    routine = normalizeRoutine(candidate);
  } catch (error) {
    return { valid: false, conflicts: [], warnings: [], error: error instanceof Error ? error.message : 'Routine data is invalid.' };
  }

  const conflicts: RoutineImportConflict[] = [];
  const warnings: string[] = [];
  if (!references.categories.has(routine.categoryId)) {
    addConflict(conflicts, 'category', routine.categoryId, 'The routine category is not present in this MindMesh installation.');
  }
  if (references.routineIds.has(routine.id)) addConflict(conflicts, 'routine-id', routine.id, 'A routine with this ID already exists.');

  routine.steps.forEach((step) => {
    const links = step.links;
    if (!links) return;
    if (links.reminderId && !references.reminders.has(links.reminderId)) addConflict(conflicts, 'reminder', links.reminderId, `Step “${step.title}” links to a missing Reminder.`, step.id);
    if (links.contactId && !references.contacts.has(links.contactId)) addConflict(conflicts, 'contact', links.contactId, `Step “${step.title}” links to a missing Contact.`, step.id);
    if (links.directDebitId && !references.directDebits.has(links.directDebitId)) addConflict(conflicts, 'direct-debit', links.directDebitId, `Step “${step.title}” links to a missing Direct Debit.`, step.id);
    if (links.routineId && !references.routineIds.has(links.routineId)) addConflict(conflicts, 'routine-id', links.routineId, `Step “${step.title}” triggers a missing Routine.`, step.id);
  });
  if (routine.activeSession) warnings.push('This export contains an active session; its recovery state will be restored with the routine.');
  if (routine.versionHistory.length > 0) warnings.push(`${routine.versionHistory.length} version snapshot(s) are included.`);
  return { valid: true, routine, conflicts, warnings };
}

function freshIds(routine: Routine, newRoutineId: string): Routine {
  const stepIds = new Map(routine.steps.map((step) => [step.id, id('step')]));
  const steps = routine.steps.map((step) => ({ ...step, id: stepIds.get(step.id)!, routineId: newRoutineId, parentStepId: step.parentStepId ? stepIds.get(step.parentStepId) || null : null, dependencyIds: (step.dependencyIds || []).map((value) => stepIds.get(value) || value) }));
  return { ...routine, id: newRoutineId, name: `${routine.name} copy`, steps, activeSession: routine.activeSession ? { ...routine.activeSession, id: id('session'), routineId: newRoutineId, occurrenceId: id('occurrence'), currentStepId: routine.activeSession.currentStepId ? stepIds.get(routine.activeSession.currentStepId) : undefined, completedStepIds: routine.activeSession.completedStepIds.map((value) => stepIds.get(value) || value), temporaryStepIds: routine.activeSession.temporaryStepIds.map((value) => stepIds.get(value) || value), timerStepId: routine.activeSession.timerStepId ? stepIds.get(routine.activeSession.timerStepId) : undefined } : undefined, occurrences: routine.occurrences.map((occurrence) => ({ ...occurrence, id: id('occurrence'), routineId: newRoutineId, completedStepIds: occurrence.completedStepIds.map((value) => stepIds.get(value) || value), skippedStepIds: occurrence.skippedStepIds.map((value) => stepIds.get(value) || value) })), history: routine.history.map((entry) => ({ ...entry, id: id('history'), routineId: newRoutineId, occurrenceId: entry.occurrenceId ? id('occurrence') : undefined, stepId: entry.stepId ? stepIds.get(entry.stepId) : undefined })), versionHistory: routine.versionHistory.map((snapshot) => ({ ...snapshot, id: id('version'), routineId: newRoutineId, steps: steps.map((step) => ({ ...step })) })), createdAt: now(), updatedAt: now() };
}

/** Applies explicit conflict decisions. No missing linked record is silently mutated. */
export function applyRoutineImport(preview: RoutineImportPreview, decisions: RoutineImportDecisions = {}): Routine | null {
  if (!preview.valid || !preview.routine) return null;
  const selected = { ...preview.routine };
  const conflictMap = decisions.conflicts || {};
  const routineIdConflict = preview.conflicts.find((conflict) => conflict.kind === 'routine-id');
  const routine = routineIdConflict && (conflictMap[routineIdConflict.id] || routineIdConflict.resolution) === 'duplicate'
    ? freshIds(selected, decisions.duplicateId || id('routine'))
    : selected;
  const categoryConflict = preview.conflicts.find((conflict) => conflict.kind === 'category');
  if (categoryConflict && (conflictMap[categoryConflict.id] || categoryConflict.resolution) === 'use-existing') {
    const categoryId = decisions.fallbackCategoryId;
    if (!categoryId) return null;
    routine.categoryId = categoryId;
    routine.categoryIds = [categoryId];
  } else if (categoryConflict && (conflictMap[categoryConflict.id] || categoryConflict.resolution) === 'skip') return null;

  routine.steps = routine.steps.map((step) => {
    const links = step.links ? { ...step.links } : undefined;
    if (!links) return step;
    (['reminderId', 'contactId', 'directDebitId', 'routineId'] as const).forEach((field) => {
      const value = links[field];
      if (!value) return;
      const conflict = preview.conflicts.find((item) => item.stepId === step.id && item.referenceId === value);
      if (!conflict) return;
      const resolution = conflictMap[conflict.id] || conflict.resolution;
      if (resolution === 'unlink' || resolution === 'skip') delete links[field];
      if (resolution === 'keep') links.broken = true;
    });
    return { ...step, links };
  });
  return { ...routine, updatedAt: now() };
}
