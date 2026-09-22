import { describe, expect, it } from 'vitest';
import { createEmptyRoutine, createRoutineStep } from '../types/routine';
import {
  canTriggerRoutine,
  completeRoutineStep,
  expireRoutineSession,
  getEligibleRoutineSteps,
  getNextRoutineOccurrence,
  getRoutineOccurrencesForDate,
  isRoutineScheduledOn,
  startRoutineStepTimer,
  addRoutineStepTime,
  getRoutineTimerRemainingMs,
  reorderTodayRoutineIds,
  skipRoutineStep,
  startRoutine,
} from '../services/routineEngine';

const routineFixture = (overrides: Record<string, unknown> = {}) => {
  const routineId = 'routine-engine';
  const first = createRoutineStep({ id: 'step-one', routineId, title: 'First', order: 0 });
  const second = createRoutineStep({ id: 'step-two', routineId, title: 'Second', order: 1, dependencyIds: ['step-one'] });
  return createEmptyRoutine({
    id: routineId,
    name: 'Engine routine',
    categoryId: 'cat',
    steps: [first, second],
    status: 'active',
    schedule: { recurrence: { frequency: 'daily', interval: 1 }, startDate: '2026-09-22', startTime: '08:00', timesPerDay: ['08:00', '18:00'] },
    ...overrides,
  });
};

describe('Routine scheduling and execution engine', () => {
  it('supports daily, selected weekday, and multiple daily occurrences', () => {
    const daily = routineFixture();
    expect(isRoutineScheduledOn(daily, '2026-09-23')).toBe(true);
    expect(getRoutineOccurrencesForDate(daily, '2026-09-23')).toHaveLength(2);
    const weekly = routineFixture({ schedule: { recurrence: { frequency: 'weekly', interval: 1, daysOfWeek: [1] }, startDate: '2026-09-21' } });
    expect(isRoutineScheduledOn(weekly, '2026-09-28')).toBe(true);
    expect(isRoutineScheduledOn(weekly, '2026-09-29')).toBe(false);
  });

  it('finds the next occurrence and respects exceptions and end dates', () => {
    const routine = routineFixture({ schedule: { recurrence: { frequency: 'daily', interval: 1 }, startDate: '2026-09-22', endDate: '2026-09-23', exceptions: ['2026-09-22'] } });
    expect(getNextRoutineOccurrence(routine, new Date('2026-09-22T07:00:00'))?.date).toBe('2026-09-23');
    expect(getNextRoutineOccurrence(routine, new Date('2026-09-24T07:00:00'))).toBeUndefined();
  });

  it('persists sequential progress and blocks dependencies', () => {
    const routine = routineFixture();
    const started = startRoutine(routine, { now: new Date('2026-09-22T08:00:00') });
    expect(started.activeSession?.currentStepId).toBe('step-one');
    expect(getEligibleRoutineSteps(started).map((step) => step.id)).toEqual(['step-one']);
    expect(() => completeRoutineStep(started, 'step-two')).toThrow(/dependencies/);
    const afterFirst = completeRoutineStep(started, 'step-one', { now: new Date('2026-09-22T08:05:00') });
    expect(afterFirst.activeSession?.currentStepId).toBe('step-two');
    const completed = completeRoutineStep(afterFirst, 'step-two', { now: new Date('2026-09-22T08:10:00') });
    expect(completed.activeSession?.status).toBe('completed');
    expect(completed.stats.completionCount).toBe(1);
  });

  it('records skips and applies overdue or failed expiry', () => {
    const skipped = skipRoutineStep(startRoutine(routineFixture(), { now: new Date('2026-09-22T08:00:00') }), 'step-one', 'Low energy');
    expect(skipped.stats.skipCount).toBe(1);
    const overdue = expireRoutineSession(startRoutine(routineFixture(), { now: new Date('2026-09-22T08:00:00') }), { now: new Date('2026-09-22T10:00:00') });
    expect(overdue.occurrences[0].status).toBe('overdue');
    const failed = expireRoutineSession(startRoutine(routineFixture({ expiryBehaviour: 'failed' }), { now: new Date('2026-09-22T08:00:00') }), { now: new Date('2026-09-22T10:00:00') });
    expect(failed.occurrences[0].status).toBe('failed');
  });

  it('persists step timers and extends them without losing the session', () => {
    const started = startRoutine(routineFixture(), { now: new Date('2026-09-22T08:00:00') });
    const timed = startRoutineStepTimer(started, 'step-one', 5, { now: new Date('2026-09-22T08:00:00') });
    expect(getRoutineTimerRemainingMs(timed, new Date('2026-09-22T08:04:00'))).toBe(60_000);
    const extended = addRoutineStepTime(timed, 5, { now: new Date('2026-09-22T08:04:00') });
    expect(getRoutineTimerRemainingMs(extended, new Date('2026-09-22T08:04:00'))).toBe(360_000);
  });

  it('prevents trigger cycles and supports temporary Today ordering', () => {
    const a = routineFixture({ id: 'a', steps: [createRoutineStep({ id: 'a-step', routineId: 'a', title: 'to b', order: 0, links: { routineId: 'b' } })] });
    const b = routineFixture({ id: 'b', steps: [createRoutineStep({ id: 'b-step', routineId: 'b', title: 'to a', order: 0, links: { routineId: 'a' } })] });
    expect(canTriggerRoutine([a, b], 'a', 'b')).toBe(false);
    expect(reorderTodayRoutineIds(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
  });
});
