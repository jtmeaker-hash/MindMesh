import { describe, it, expect, beforeEach } from 'vitest';
import { Reminder, Step } from '../types';
import {
  addStep,
  areAllStepsComplete,
  deleteStep,
  enforceSequentialCompletion,
  getCurrentStepIndex,
  getStepProgress,
  isStepActionable,
  moveStep,
  normalizeSteps,
  reorderSteps,
  stepNodeFields,
  toggleStep,
  updateStep,
  validateStepSequence,
} from '../services/steps';
import {
  areStepsSatisfied,
  canCompleteReminder,
  normalizeReminder,
  resolveEnableSteps,
  resolveEnableSubtasks,
} from '../services/reminders';
import { handleReminderCompletion } from '../services/recurrence';
import { loadAllData, readStoredPayload, saveAllData } from '../services/storage';
import { createBackup, restoreBackup, validateBackup } from '../services/backup';
import { runDiagnostics } from '../services/diagnostics';
import { runFix } from '../services/fixer';

function makeStep(overrides: Partial<Step> = {}): Step {
  return {
    id: overrides.id ?? `step-${Math.random().toString(36).slice(2, 8)}`,
    reminderId: overrides.reminderId ?? 'rem-steps',
    title: overrides.title ?? 'Do a thing',
    description: overrides.description,
    order: overrides.order ?? 0,
    completed: overrides.completed ?? false,
    completedAt: overrides.completedAt,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00.000Z',
    updatedAt: overrides.updatedAt ?? '2026-01-01T00:00:00.000Z',
  };
}

function makeReminder(overrides: Partial<Reminder> = {}): Reminder {
  return {
    id: 'rem-steps',
    categoryId: 'cat-home',
    title: 'Cook meal',
    priority: 'medium',
    completed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    subtasks: [],
    ...overrides,
  };
}

describe('Steps: sequential completion rules', () => {
  it('keeps only the first incomplete Step actionable and refuses to complete a locked Step', () => {
    const steps = [
      makeStep({ id: 's1', order: 0, completed: true }),
      makeStep({ id: 's2', order: 1, completed: true }),
      makeStep({ id: 's3', order: 2, completed: false }),
      makeStep({ id: 's4', order: 3, completed: false }),
    ];

    expect(getCurrentStepIndex(steps)).toBe(2);
    expect(isStepActionable(steps, 2)).toBe(true);
    expect(isStepActionable(steps, 3)).toBe(false);

    // Completing a locked Step is refused in logic, not just in the UI.
    const refused = toggleStep(steps, 's4');
    expect(refused.changed).toBe(false);
    expect(refused.reason).toBe('locked');
    expect(refused.steps).toEqual(steps);

    const allowed = toggleStep(steps, 's3');
    expect(allowed.changed).toBe(true);
    expect(allowed.steps[2].completed).toBe(true);
    // Now s4 becomes the active Step.
    expect(getCurrentStepIndex(allowed.steps)).toBe(3);
  });

  it('cascades a revert: an un-completed Step returns every later Step to incomplete', () => {
    const steps = [
      makeStep({ id: 's1', order: 0, completed: true }),
      makeStep({ id: 's2', order: 1, completed: true }),
      makeStep({ id: 's3', order: 2, completed: true }),
      makeStep({ id: 's4', order: 3, completed: true }),
    ];

    const result = toggleStep(steps, 's2');
    expect(result.changed).toBe(true);
    expect(result.steps.map((s) => s.completed)).toEqual([true, false, false, false]);
    expect(getCurrentStepIndex(result.steps)).toBe(1);
    expect(result.steps[2].completedAt).toBeUndefined();
  });

  it('never allows a completed Step after an incomplete one when reordering', () => {
    const steps = [
      makeStep({ id: 's1', order: 0, completed: true }),
      makeStep({ id: 's2', order: 1, completed: true }),
      makeStep({ id: 's3', order: 2, completed: false }),
    ];

    // Move the incomplete Step to the front; completion then resets from there.
    const reordered = reorderSteps(steps, 2, 0);
    expect(reordered.map((s) => s.id)).toEqual(['s3', 's1', 's2']);
    expect(reordered.map((s) => s.completed)).toEqual([false, false, false]);
    expect(reordered.map((s) => s.order)).toEqual([0, 1, 2]);
  });

  it('reports progress and completion accurately', () => {
    const steps = [
      makeStep({ id: 's1', order: 0, completed: true }),
      makeStep({ id: 's2', order: 1, completed: false }),
      makeStep({ id: 's3', order: 2, completed: false }),
    ];
    const progress = getStepProgress(steps);
    expect(progress).toMatchObject({ total: 3, completed: 1, remaining: 2, currentNumber: 2, allComplete: false });
    expect(areAllStepsComplete(steps)).toBe(false);
    expect(areAllStepsComplete(steps.map((s) => ({ ...s, completed: true })))).toBe(true);
  });
});

describe('Steps: data model and normalization', () => {
  it('keeps stable ids and never uses the array index as the permanent id', () => {
    const raw = [
      { id: 'kept-id', title: 'Gather ingredients', order: 0, completed: false },
      { title: 'Prepare ingredients', order: 1, completed: false },
    ];
    const steps = normalizeSteps(raw, 'rem-x');
    expect(steps[0].id).toBe('kept-id');
    expect(steps[1].id).not.toBe('1');
    expect(steps[1].id).toBeTruthy();
    expect(steps.map((s) => s.title)).toEqual(['Gather ingredients', 'Prepare ingredients']);
  });

  it('normalizes Steps into a valid sequential state on load', () => {
    const invalid = [
      makeStep({ id: 'a', order: 0, completed: false }),
      makeStep({ id: 'b', order: 1, completed: true }),
    ];
    const enforced = enforceSequentialCompletion(invalid);
    expect(enforced[1].completed).toBe(false);
  });

  it('keeps Steps and Subtasks independent through enable flags', () => {
    const legacy = makeReminder({
      subtasks: [{ id: 'sub-1', reminderId: 'rem-steps', title: 'Milk', completed: false, createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    const normalized = normalizeReminder(legacy);
    // Legacy subtasks stay enabled; Steps stay disabled without any Step data.
    expect(resolveEnableSubtasks(normalized)).toBe(true);
    expect(resolveEnableSteps(normalized)).toBe(false);
    expect(normalized.steps).toEqual([]);

    // Enabling Steps does not enable Subtasks.
    const stepsOnly = normalizeReminder(
      makeReminder({ enableSteps: true, steps: [makeStep({ id: 'a', order: 0 })] }),
    );
    expect(resolveEnableSteps(stepsOnly)).toBe(true);
    expect(resolveEnableSubtasks(stepsOnly)).toBe(false);
    expect(stepsOnly.subtasks).toEqual([]);
  });

  it('validates structural Step issues without mutating anything', () => {
    const reminder = makeReminder({
      steps: [
        makeStep({ id: 'a', order: 0, completed: false }),
        makeStep({ id: 'b', order: 1, completed: true }),
        makeStep({ id: 'c', order: 1, completed: false }),
      ],
    });
    const issues = validateStepSequence(reminder);
    expect(issues.some((i) => i.kind === 'completed-after-incomplete')).toBe(true);
    expect(issues.some((i) => i.kind === 'duplicate-order')).toBe(true);
  });

  it('surfaces compact node progress only while Steps are enabled', () => {
    const reminder = makeReminder({
      enableSteps: true,
      steps: [makeStep({ id: 'a', order: 0, completed: true }), makeStep({ id: 'b', order: 1, completed: false })],
    });
    expect(stepNodeFields(reminder)).toMatchObject({
      hasSteps: true,
      stepCount: 2,
      completedStepCount: 1,
      currentStepNumber: 2,
    });
    expect(stepNodeFields(makeReminder()).hasSteps).toBe(false);
  });

  it('supports add, edit, delete and move operations', () => {
    let steps: Step[] = [];
    steps = addStep(steps, { title: 'One' }, 'rem-steps');
    steps = addStep(steps, { title: 'Two', description: 'second' }, 'rem-steps');
    expect(steps.map((s) => s.title)).toEqual(['One', 'Two']);
    expect(steps[1].description).toBe('second');

    steps = updateStep(steps, steps[0].id, { title: 'One updated' });
    expect(steps[0].title).toBe('One updated');

    steps = moveStep(steps, steps[1].id, -1);
    expect(steps.map((s) => s.title)).toEqual(['Two', 'One updated']);
    expect(steps.map((s) => s.order)).toEqual([0, 1]);

    steps = deleteStep(steps, steps[0].id);
    expect(steps).toHaveLength(1);
    expect(steps[0].order).toBe(0);
  });
});

describe('Steps: reminder completion and recurrence', () => {
  it('refuses to complete a reminder while Steps remain incomplete', () => {
    const reminder = makeReminder({
      enableSteps: true,
      steps: [makeStep({ id: 'a', order: 0, completed: true }), makeStep({ id: 'b', order: 1, completed: false })],
    });
    expect(canCompleteReminder(reminder)).toBe(false);
    expect(areStepsSatisfied(reminder)).toBe(false);

    const result = handleReminderCompletion('rem-steps', [reminder]);
    expect(result.find((r) => r.id === 'rem-steps')?.completed).toBe(false);
  });

  it('allows completion once every Step is complete', () => {
    const reminder = makeReminder({
      enableSteps: true,
      steps: [makeStep({ id: 'a', order: 0, completed: true }), makeStep({ id: 'b', order: 1, completed: true })],
    });
    const result = handleReminderCompletion('rem-steps', [reminder]);
    expect(result.find((r) => r.id === 'rem-steps')?.completed).toBe(true);
  });

  it('resets Steps for the next recurring occurrence and completes the historical record', () => {
    const reminder = makeReminder({
      enableSteps: true,
      recurrence: { frequency: 'daily', interval: 1 },
      subtasks: [],
      steps: [makeStep({ id: 'a', order: 0, completed: true }), makeStep({ id: 'b', order: 1, completed: true })],
    });

    const result = handleReminderCompletion('rem-steps', [reminder]);
    const active = result.find((r) => r.id === 'rem-steps');
    const historical = result.find((r) => r.completed);

    expect(active?.completed).toBe(false);
    expect(active?.steps?.every((s) => !s.completed)).toBe(true);
    // Steps get a fresh stable identity for the new cycle.
    expect(active?.steps?.map((s) => s.id)).not.toEqual(['a', 'b']);
    expect(historical?.steps?.every((s) => s.completed)).toBe(true);
  });
});

describe('Steps: persistence, backup and diagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('persists Steps and enable flags across a save/load cycle', () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      reminders: [
        makeReminder({
          id: 'rem-persist',
          enableSteps: true,
          enableSubtasks: false,
          steps: [
            makeStep({ id: 'p1', reminderId: 'rem-persist', order: 0, completed: true, title: 'Gather ingredients' }),
            makeStep({ id: 'p2', reminderId: 'rem-persist', order: 1, completed: false, title: 'Cook meal' }),
          ],
        }),
      ],
    });

    const loaded = loadAllData().reminders.find((r) => r.id === 'rem-persist');
    expect(loaded?.steps?.map((s) => s.id)).toEqual(['p1', 'p2']);
    expect(loaded?.enableSteps).toBe(true);
    expect(loaded?.enableSubtasks).toBe(false);
    expect(loaded?.completed).toBe(false);
  });

  it('loads legacy reminders without Steps normally', () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      reminders: [makeReminder({ id: 'rem-legacy', subtasks: [] })],
    });

    const loaded = loadAllData().reminders.find((r) => r.id === 'rem-legacy');
    expect(loaded).toBeDefined();
    expect(loaded?.steps).toEqual([]);
    expect(resolveEnableSteps(loaded!)).toBe(false);
  });

  it('round trips Steps through backup export and restore', () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      reminders: [
        makeReminder({
          id: 'rem-backup',
          enableSteps: true,
          steps: [
            makeStep({ id: 'b1', reminderId: 'rem-backup', order: 0, completed: true, title: 'Gather ingredients' }),
            makeStep({ id: 'b2', reminderId: 'rem-backup', order: 1, completed: false, title: 'Prepare ingredients' }),
          ],
        }),
      ],
    });

    const backup = createBackup();
    const validation = validateBackup(JSON.stringify(backup));
    expect(validation.valid).toBe(true);
    expect(validation.summary?.stepCount).toBe(2);

    localStorage.clear();
    const restored = restoreBackup(backup);
    expect(restored.success).toBe(true);

    const loaded = loadAllData().reminders.find((r) => r.id === 'rem-backup');
    expect(loaded?.steps?.map((s) => s.id)).toEqual(['b1', 'b2']);
    expect(loaded?.enableSteps).toBe(true);
  });

  it('detects an invalid stored Step sequence and repairs it without deleting Steps', async () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      reminders: [
        makeReminder({
          id: 'rem-broken',
          enableSteps: true,
          steps: [
            makeStep({ id: 'x1', reminderId: 'rem-broken', order: 0, completed: false, title: 'Gather ingredients' }),
            makeStep({ id: 'x2', reminderId: 'rem-broken', order: 1, completed: true, title: 'Cook meal' }),
          ],
        }),
      ],
    });

    const report = await runDiagnostics('deep');
    const check = report.results.find((r) => r.id === 'deep.stepIntegrity');
    expect(check).toBeDefined();
    expect(check?.status).not.toBe('pass');
    expect(check?.details?.issueCounts).toMatchObject({ 'completed-after-incomplete': 1 });

    const outcome = await runFix('fix.repairStepSequence', { confirmed: true });
    expect(outcome.status).toBe('fixed');

    // The raw persisted payload is now valid too, not only the hydrated view.
    const raw = readStoredPayload() as { reminders: Reminder[] };
    const repairedRaw = raw.reminders.find((r) => r.id === 'rem-broken');
    expect(repairedRaw?.steps?.map((s) => s.id)).toEqual(['x1', 'x2']);
    expect(repairedRaw?.steps?.every((s) => !s.completed)).toBe(true);

    const repaired = loadAllData().reminders.find((r) => r.id === 'rem-broken');
    // Content survives; only the invalid completion flag was reset.
    expect(repaired?.steps?.map((s) => s.id)).toEqual(['x1', 'x2']);
  });
});
