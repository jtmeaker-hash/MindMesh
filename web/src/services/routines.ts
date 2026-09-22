import { logger } from './logger';
import {
  createEmptyRoutine,
  duplicateRoutine as duplicateRoutineModel,
  normalizeRoutines,
  Routine,
  RoutineDraftRecovery,
  RoutineStep,
  RoutineNormalizationResult,
} from '../types/routine';
import { loadRoutines, saveRoutines } from './storage';

const id = (prefix: string): string => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

function validateRoutine(routine: Routine): void {
  if (!routine.name.trim()) throw new Error('Routine name is required');
  if (!routine.categoryId.trim()) throw new Error('Routine category is required');
  if (!Array.isArray(routine.steps) || routine.steps.length === 0) {
    throw new Error('Routine requires at least one step');
  }
}

function replaceRoutine(routine: Routine): Routine[] {
  const routines = loadRoutines();
  const next = routines.some((item) => item.id === routine.id)
    ? routines.map((item) => item.id === routine.id ? routine : item)
    : [routine, ...routines];
  saveRoutines(next);
  return next;
}

export function loadRoutineNormalization(): RoutineNormalizationResult {
  const result = normalizeRoutines(loadRoutines());
  if (result.quarantined.length > 0) {
    logger.warn('Routines', 'Routine records were quarantined while loading', {
      routines: result.quarantined.map(({ id: routineId, reason }) => ({ id: routineId, reason })),
    });
  }
  return result;
}

export function createRoutine(routine: Routine): Routine {
  validateRoutine(routine);
  replaceRoutine(routine);
  return routine;
}

export function readRoutine(routineId: string): Routine | undefined {
  return loadRoutines().find((routine) => routine.id === routineId);
}

export function readRoutines(options: { includeArchived?: boolean; includeTrash?: boolean } = {}): Routine[] {
  return loadRoutines().filter((routine) => {
    if (routine.trashedAt && !options.includeTrash) return false;
    if (routine.archivedAt && !options.includeArchived) return false;
    return true;
  });
}

export function updateRoutine(routine: Routine): Routine {
  validateRoutine(routine);
  const timestamp = new Date().toISOString();
  const snapshot = {
    id: `${routine.id}-version-${routine.version}-${Date.now()}`,
    routineId: routine.id,
    version: routine.version,
    createdAt: timestamp,
    reason: 'Before edit',
    name: routine.name,
    description: routine.description,
    steps: routine.steps.map((step) => ({ ...step })),
  };
  const updated = {
    ...routine,
    version: routine.version + 1,
    versionHistory: [...(routine.versionHistory || []), snapshot].slice(-50),
    updatedAt: timestamp,
  };
  replaceRoutine(updated);
  return updated;
}

export function archiveRoutine(routineId: string): Routine | undefined {
  const routine = readRoutine(routineId);
  if (!routine) return undefined;
  const archived = { ...routine, status: 'archived' as const, archivedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  replaceRoutine(archived);
  return archived;
}

export function trashRoutine(routineId: string): Routine | undefined {
  const routine = readRoutine(routineId);
  if (!routine) return undefined;
  const trashed = { ...routine, status: 'archived' as const, trashedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  replaceRoutine(trashed);
  return trashed;
}

export function restoreRoutineFromTrash(routineId: string): Routine | undefined {
  const routine = readRoutine(routineId);
  if (!routine?.trashedAt) return routine;
  const restored = { ...routine, status: routine.archivedAt ? 'archived' as const : 'draft' as const, trashedAt: undefined, updatedAt: new Date().toISOString() };
  replaceRoutine(restored);
  return restored;
}

export function permanentlyDeleteRoutine(routineId: string): boolean {
  const routines = loadRoutines();
  const next = routines.filter((routine) => routine.id !== routineId);
  if (next.length === routines.length) return false;
  saveRoutines(next);
  return true;
}

export function duplicateRoutine(routineId: string): Routine | undefined {
  const source = readRoutine(routineId);
  if (!source) return undefined;
  const copy = duplicateRoutineModel(source, id('routine'), (_step, index) => id(`step-${index}`));
  replaceRoutine(copy);
  return copy;
}

export function saveRoutineDraft(routine: Routine, reason = 'auto-save'): Routine {
  const draftRecovery: RoutineDraftRecovery = {
    savedAt: new Date().toISOString(),
    reason,
    name: routine.name,
    description: routine.description,
    steps: routine.steps,
  };
  const updated = { ...routine, draftRecovery, updatedAt: new Date().toISOString() };
  replaceRoutine(updated);
  return updated;
}

export function recoverRoutineDraft(routineId: string): Routine | undefined {
  const routine = readRoutine(routineId);
  const draft = routine?.draftRecovery;
  if (!routine || !draft) return routine;
  const recovered = {
    ...routine,
    name: draft.name,
    description: draft.description,
    steps: draft.steps,
    draftRecovery: undefined,
    updatedAt: new Date().toISOString(),
  };
  replaceRoutine(recovered);
  return recovered;
}

export function addRoutineStep(routineId: string, step: RoutineStep): Routine | undefined {
  const routine = readRoutine(routineId);
  if (!routine) return undefined;
  const updated = updateRoutine({ ...routine, steps: [...routine.steps, { ...step, routineId }] });
  return updated;
}

export function promoteChildrenWhenRemovingStep(routineId: string, stepId: string): Routine | undefined {
  const routine = readRoutine(routineId);
  if (!routine) return undefined;
  const removed = routine.steps.find((step) => step.id === stepId);
  if (!removed) return routine;
  const updated = updateRoutine({
    ...routine,
    steps: routine.steps
      .filter((step) => step.id !== stepId)
      .map((step) => step.parentStepId === stepId ? { ...step, parentStepId: removed.parentStepId ?? null, depth: Math.max(0, step.depth - 1) } : step),
  });
  return updated;
}

export function createDraftRoutine(idValue: string, name: string, categoryId: string, steps: RoutineStep[]): Routine {
  return createEmptyRoutine({ id: idValue, name, categoryId, steps, status: 'draft' });
}
