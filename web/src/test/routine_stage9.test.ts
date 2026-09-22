import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyRoutine, createRoutineStep } from '../types/routine';
import { diagnoseRoutines, purgeExpiredRoutineTrash, restoreRoutineVersion, setRoutineTrashRetentionDays } from '../services/routineSafety';
import { loadAllData, loadRoutineQuarantine, saveAllData, saveRoutines } from '../services/storage';

function routine(id = 'routine-stage9') {
  const step = createRoutineStep({ id: `${id}-step`, routineId: id, title: 'One safe step' });
  return createEmptyRoutine({ id, name: 'Stage 9 routine', categoryId: 'cat-health', steps: [step] });
}

describe('Routine Builder Stage 9 diagnostics and data safety', () => {
  beforeEach(() => localStorage.clear());

  it('persists malformed records in a separate quarantine without hiding valid routines', () => {
    const state = loadAllData();
    saveAllData({ ...state, routines: [routine(), { id: 'bad-routine', name: 'Corrupt' }] as never });

    const hydrated = loadAllData();
    expect(hydrated.routines?.map((item) => item.id)).toEqual(['routine-stage9']);
    expect(loadRoutineQuarantine()).toEqual([{ id: 'bad-routine', reason: 'Routine requires id, name, and categoryId', raw: { id: 'bad-routine', name: 'Corrupt' } }]);
    expect(diagnoseRoutines().quarantined).toHaveLength(1);
  });

  it('purges only expired trash after explicit confirmation', () => {
    const old = { ...routine('old-trash'), trashedAt: '2020-01-01T00:00:00.000Z', status: 'archived' as const };
    const recent = { ...routine('recent-trash'), trashedAt: new Date().toISOString(), status: 'archived' as const };
    saveRoutines([old, recent]);
    setRoutineTrashRetentionDays(30);

    expect(purgeExpiredRoutineTrash(false)).toEqual({ removed: 0, skipped: 1 });
    expect(loadAllData().routines).toHaveLength(2);
    expect(purgeExpiredRoutineTrash(true)).toEqual({ removed: 1, skipped: 0 });
    expect(loadAllData().routines?.map((item) => item.id)).toEqual(['recent-trash']);
  });

  it('restores a prior version through a new version snapshot', () => {
    const original = routine();
    const edited = { ...original, name: 'Edited routine', version: 2, versionHistory: [{ id: 'v1', routineId: original.id, version: 1, createdAt: '2026-01-01T00:00:00.000Z', name: original.name, steps: original.steps }] };
    saveRoutines([edited]);

    const restored = restoreRoutineVersion(original.id, 'v1');
    expect(restored?.name).toBe(original.name);
    expect(restored?.version).toBe(3);
    expect(restored?.versionHistory[restored.versionHistory.length - 1]?.reason).toBe('Before restoring a previous version');
  });
});
