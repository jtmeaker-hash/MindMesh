import { describe, expect, it } from 'vitest';
import { createEmptyRoutine, createRoutineStep } from '../types/routine';
import { completeRoutineStep, getEligibleRoutineSteps, startRoutine, expireRoutineSession } from '../services/routineEngine';
import { updateRoutine } from '../services/routines';
import { loadRoutines, saveRoutines } from '../services/storage';

function fixture() {
  const routine = createEmptyRoutine({
    id: 'routine-stage12',
    name: 'Release check',
    categoryId: 'cat',
    status: 'active',
    steps: [
      createRoutineStep({ id: 'minimum', routineId: 'routine-stage12', title: 'Minimum action', order: 0, minimumVersion: true }),
      createRoutineStep({ id: 'extra', routineId: 'routine-stage12', title: 'Optional extra', order: 1, optional: true }),
    ],
  });
  return routine;
}

describe('Routine Builder Stage 12 final integration', () => {
  it('completes the minimum version without requiring optional follow-up work', () => {
    const started = startRoutine(fixture(), { now: new Date('2026-09-22T08:00:00') });
    expect(started.activeSession?.currentStepId).toBe('minimum');
    const completed = completeRoutineStep(started, undefined, { now: new Date('2026-09-22T08:05:00') });
    expect(completed.activeSession?.status).toBe('completed');
    expect(completed.occurrences[0].status).toBe('completed');
    expect(completed.history.some((entry) => entry.reason === 'minimum-completed')).toBe(true);
  });

  it('keeps sequential routines to one next action even without dependency edges', () => {
    const started = startRoutine(fixture(), { now: new Date('2026-09-22T08:00:00') });
    expect(getEligibleRoutineSteps(started).map((step) => step.id)).toEqual(['minimum']);
  });

  it('records the persisted pre-edit definition in version history', () => {
    const original = fixture();
    saveRoutines([original]);
    const edited = updateRoutine({ ...original, name: 'Edited release check' });
    expect(edited.name).toBe('Edited release check');
    expect(edited.versionHistory[edited.versionHistory.length - 1]?.name).toBe('Release check');
    const persisted = loadRoutines().find((routine) => routine.id === original.id);
    expect(persisted?.versionHistory[persisted.versionHistory.length - 1]?.name).toBe('Release check');
  });

  it('treats expired sessions as finished rather than runnable', () => {
    const started = startRoutine(fixture(), { now: new Date('2026-09-22T08:00:00') });
    const expired = expireRoutineSession(started, { now: new Date('2026-09-22T10:00:00') });
    expect(expired.activeSession?.status).toBe('expired');
    expect(expired.occurrences[0].status).toBe('overdue');
  });
});
