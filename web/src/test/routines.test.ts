import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyRoutine, createRoutineStep, Routine } from '../types/routine';
import { loadAllData, loadRoutines, saveAllData, saveRoutines } from '../services/storage';
import {
  archiveRoutine,
  createRoutine,
  duplicateRoutine,
  permanentlyDeleteRoutine,
  recoverRoutineDraft,
  restoreRoutineFromTrash,
  saveRoutineDraft,
  trashRoutine,
} from '../services/routines';
import { createBackup, restoreBackup, serializeBackup, validateBackup } from '../services/backup';

const makeRoutine = (): Routine => {
  const routineId = 'routine-morning';
  const parent = createRoutineStep({ id: 'step-parent', routineId, title: 'Get ready', order: 0 });
  const child = createRoutineStep({ id: 'step-child', routineId, title: 'Drink water', parentStepId: parent.id, depth: 1, order: 0 });
  return createEmptyRoutine({
    id: routineId,
    name: 'Morning reset',
    categoryId: 'cat-health',
    status: 'active',
    steps: [parent, child],
    history: [{ id: 'history-1', routineId, event: 'completed', at: new Date().toISOString() }],
    stats: { completionCount: 4, skipCount: 2, overdueCount: 1, failedCount: 0, totalDurationMinutes: 80 },
    activeSession: {
      id: 'session-1',
      routineId,
      occurrenceId: 'occurrence-1',
      status: 'running',
      currentStepId: child.id,
      startedAt: new Date().toISOString(),
      completedStepIds: [],
      temporaryStepIds: [],
      updatedAt: new Date().toISOString(),
    },
  });
};

describe('Routine Builder Stage 1 foundation', () => {
  beforeEach(() => localStorage.clear());

  it('persists a nested routine tree through the existing state document', () => {
    const routine = makeRoutine();
    createRoutine(routine);

    const loaded = loadRoutines();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].steps.find((step) => step.id === 'step-child')?.parentStepId).toBe('step-parent');
    expect(loadAllData().version).toBe(9);
  });

  it('duplicates a routine with new ids and no history, stats, or active session', () => {
    createRoutine(makeRoutine());
    const copy = duplicateRoutine('routine-morning');

    expect(copy).toBeDefined();
    expect(copy?.id).not.toBe('routine-morning');
    expect(copy?.steps).toHaveLength(2);
    expect(copy?.steps[0].id).not.toBe('step-parent');
    expect(copy?.steps[1].parentStepId).toBe(copy?.steps[0].id);
    expect(copy?.history).toEqual([]);
    expect(copy?.activeSession).toBeUndefined();
    expect(copy?.stats).toEqual({ completionCount: 0, skipCount: 0, overdueCount: 0, failedCount: 0, totalDurationMinutes: 0 });
  });

  it('supports archive, trash, restore, and permanent deletion while retaining history', () => {
    createRoutine(makeRoutine());
    expect(archiveRoutine('routine-morning')?.status).toBe('archived');
    expect(trashRoutine('routine-morning')?.trashedAt).toBeDefined();
    expect(restoreRoutineFromTrash('routine-morning')?.trashedAt).toBeUndefined();
    expect(loadRoutines()[0].history).toHaveLength(1);
    expect(permanentlyDeleteRoutine('routine-morning')).toBe(true);
    expect(loadRoutines()).toHaveLength(0);
  });

  it('saves and recovers a real draft payload', () => {
    const routine = makeRoutine();
    createRoutine(routine);
    const edited = saveRoutineDraft({ ...routine, name: 'Unfinished morning' }, 'editor change');
    expect(edited.draftRecovery?.name).toBe('Unfinished morning');

    saveRoutines([{ ...edited, name: 'Autosave interrupted' }]);
    const recovered = recoverRoutineDraft('routine-morning');
    expect(recovered?.name).toBe('Unfinished morning');
    expect(recovered?.draftRecovery).toBeUndefined();
  });

  it('migrates a pre-Routine state payload without changing existing data', () => {
    const prior = loadAllData();
    saveAllData({ ...prior, version: 8, routines: undefined });
    const migrated = loadAllData();
    expect(migrated.version).toBe(9);
    expect(migrated.routines).toEqual([]);
    expect(migrated.categories.map((category) => category.id)).toEqual(prior.categories.map((category) => category.id));
    expect(migrated.reminders).toEqual(prior.reminders);
  });

  it('quarantines one malformed routine while retaining valid routines', () => {
    const valid = makeRoutine();
    const state = loadAllData();
    saveAllData({ ...state, routines: [valid, { id: 'bad-routine', name: 'Missing category' }] as never });

    const loaded = loadAllData();
    expect(loaded.routines?.map((routine) => routine.id)).toEqual(['routine-morning']);
  });

  it('round-trips routine data through full backup and remains compatible with old backups', () => {
    createRoutine(makeRoutine());
    const json = serializeBackup(createBackup());
    const validation = validateBackup(json);
    expect(validation.valid).toBe(true);
    expect(validation.backupFile?.data.routines).toHaveLength(1);

    localStorage.clear();
    expect(restoreBackup(validation.backupFile!).success).toBe(true);
    expect(loadRoutines()[0].name).toBe('Morning reset');

    const oldBackup = JSON.parse(json) as { data: Record<string, unknown> };
    delete oldBackup.data.routines;
    localStorage.clear();
    expect(restoreBackup(oldBackup as never).success).toBe(true);
    expect(loadRoutines()).toEqual([]);
  });
});
