import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyRoutine, createRoutineStep } from '../types/routine';
import { analyzeRoutine, buildTodayPlan, calculateStreak, getRoutineGoalProgress, DEFAULT_ROUTINE_ANALYTICS_SETTINGS } from '../services/routineAnalytics';

beforeEach(() => localStorage.clear());

function sampleRoutine() {
  return createEmptyRoutine({
    id: 'routine-analytics', name: 'Morning', categoryId: 'cat-1',
    schedule: { recurrence: { frequency: 'daily' }, startDate: '2026-09-20', durationTargetMinutes: 10 },
    steps: [createRoutineStep({ id: 'step-a', routineId: 'routine-analytics', title: 'Start', order: 0 })],
    occurrences: [
      { id: 'occ-1', routineId: 'routine-analytics', scheduledFor: '2026-09-20T09:00:00', status: 'completed', completedStepIds: ['step-a'], skippedStepIds: [], completedAt: '2026-09-20T09:08:00', actualDurationMinutes: 8, expectedDurationMinutes: 10, createdAt: '2026-09-20T09:00:00' },
      { id: 'occ-2', routineId: 'routine-analytics', scheduledFor: '2026-09-21T09:00:00', status: 'overdue', completedStepIds: [], skippedStepIds: [], createdAt: '2026-09-21T09:00:00' },
    ],
    history: [
      { id: 'h-1', routineId: 'routine-analytics', stepId: 'step-a', event: 'completed', at: '2026-09-20T09:08:00', durationMinutes: 8 },
      { id: 'h-2', routineId: 'routine-analytics', stepId: 'step-a', event: 'skipped', at: '2026-09-21T09:00:00', reason: 'No time' },
    ],
  });
}

describe('Routine Stage 6 analytics', () => {
  it('aggregates completion, duration, skips, overdue state, and step stats', () => {
    const result = analyzeRoutine(sampleRoutine(), new Date('2026-09-19T00:00:00'), new Date('2026-09-22T23:59:59'));
    expect(result.completed).toBe(1);
    expect(result.skips).toBe(1);
    expect(result.overdue).toBe(1);
    expect(result.averageDurationMinutes).toBe(8);
    expect(result.stepStats['step-a'].skipRate).toBe(50);
  });

  it('supports a completed-day streak with configurable grace', () => {
    const routine = sampleRoutine();
    routine.history.push({ id: 'h-3', routineId: routine.id, event: 'completed', at: new Date().toISOString() });
    expect(calculateStreak(routine, { ...DEFAULT_ROUTINE_ANALYTICS_SETTINGS, graceDays: 1 })).toBeGreaterThanOrEqual(1);
  });

  it('computes goal progress and merges routines, reminders, and bills for Today', () => {
    const routine = { ...sampleRoutine(), schedule: { recurrence: { frequency: 'none' as const }, startDate: '2026-09-22', startTime: '08:00' } };
    const plan = buildTodayPlan([routine], [{ id: 'rem-1', categoryId: 'cat-1', title: 'Check inbox', dueDate: '2026-09-22', dueTime: '10:00', priority: 'medium', completed: false, createdAt: '', subtasks: [] }], [{ id: 'bill-1', title: 'Internet', amount: 20, categoryId: 'bill-cat', frequency: 'monthly', nextPaymentDate: '2026-09-22', active: true, createdAt: '', updatedAt: '' }], '2026-09-22');
    expect(plan.map((item) => item.type)).toEqual(['routine', 'reminder', 'bill']);
    const goals = getRoutineGoalProgress([routine], { ...DEFAULT_ROUTINE_ANALYTICS_SETTINGS, goalPerWeek: 1 }, new Date('2026-09-22T12:00:00'));
    expect(goals.weeklyCompleted).toBe(1);
    expect(goals.targetMet).toBe(true);
  });
});
