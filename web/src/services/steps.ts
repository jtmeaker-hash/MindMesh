import { MeshNodeData, Reminder, Step } from '../types';

/**
 * Steps are a strict sequential process.
 *
 * This module owns every rule that makes Steps different from the independent
 * Subtask checklist:
 *  - Steps are completed in order; only the first incomplete Step is actionable.
 *  - Completing a Step is refused unless every earlier Step is already complete.
 *  - Reverting a Step to incomplete also returns every later Step to incomplete.
 *  - Reordering Steps re-validates the sequence, resetting completion from the
 *    first position where a completed Step would follow an incomplete Step.
 *
 * These functions are pure so the same rules apply whether a Step is toggled from
 * the editor, from the detail view, or programmatically elsewhere. Nothing here
 * touches Subtasks.
 */

let stepSequence = 0;
const STEP_ID_PREFIX = 'step';

/** Stable, collision-resistant Step identifier. Never derived from array index. */
export function generateStepId(): string {
  stepSequence += 1;
  return `${STEP_ID_PREFIX}-${Date.now().toString(36)}-${stepSequence.toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Coerces one persisted/partial Step into a complete, safe Step. Returns null
 * only when there is nothing usable at all (no id and no title).
 */
export function normalizeStep(input: unknown, reminderId: string, fallbackOrder: number): Step | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Partial<Step> & Record<string, unknown>;
  const id = isNonEmptyString(raw.id) ? raw.id.trim() : generateStepId();
  const title = isNonEmptyString(raw.title) ? raw.title.trim() : '';
  if (!id && !title) return null;

  const createdAt = isNonEmptyString(raw.createdAt) ? raw.createdAt : new Date().toISOString();
  const completed = raw.completed === true;
  const order =
    typeof raw.order === 'number' && Number.isFinite(raw.order) ? raw.order : fallbackOrder;

  return {
    id,
    reminderId: isNonEmptyString(raw.reminderId) ? raw.reminderId : reminderId,
    title: title || 'Untitled step',
    description: isNonEmptyString(raw.description) ? raw.description : undefined,
    order,
    completed,
    completedAt: completed
      ? isNonEmptyString(raw.completedAt)
        ? raw.completedAt
        : createdAt
      : undefined,
    createdAt,
    updatedAt: isNonEmptyString(raw.updatedAt) ? raw.updatedAt : createdAt,
  };
}

/**
 * Normalizes a persisted Step array. Identity (`id`) and order are preserved when
 * valid; missing ids are generated and missing order values are filled in. This
 * deliberately does NOT repair the completion sequence, so Diagnostics can still
 * observe and repair an invalid stored sequence.
 */
export function normalizeSteps(input: unknown, reminderId: string): Step[] {
  if (!Array.isArray(input)) return [];
  const steps: Step[] = [];
  input.forEach((entry, index) => {
    const step = normalizeStep(entry, reminderId, index);
    if (step) steps.push(step);
  });
  // Stable sort by explicit order while preserving the stored order for ties, so
  // duplicate ordering is left visible to Diagnostics instead of being hidden.
  return steps
    .map((step, index) => ({ step, index }))
    .sort((a, b) => a.step.order - b.step.order || a.index - b.index)
    .map(({ step }) => step);
}

/** Every later Step returns to incomplete once an earlier Step is reverted. */
function resetCompletionFrom(steps: Step[], fromIndex: number, nowIso: string): Step[] {
  return steps.map((step, index) => {
    if (index < fromIndex) return step;
    if (!step.completed) return step;
    return { ...step, completed: false, completedAt: undefined, updatedAt: nowIso };
  });
}

/**
 * Guarantees the sequential invariant: no completed Step may follow an incomplete
 * one. Completion is reset from the first violated position onward; no Step data
 * is deleted.
 */
export function enforceSequentialCompletion(steps: Step[], nowIso = new Date().toISOString()): Step[] {
  let locked = false;
  let changed = false;
  const next = steps.map((step) => {
    if (locked && step.completed) {
      changed = true;
      return { ...step, completed: false, completedAt: undefined, updatedAt: nowIso };
    }
    if (!step.completed) locked = true;
    return step;
  });
  return changed ? next : steps;
}

/** Assigns `order = index`, giving a dense, duplicate-free sequence. */
export function reindexSteps(steps: Step[]): Step[] {
  return steps.map((step, index) => (step.order === index ? step : { ...step, order: index }));
}

/** Index of the current active Step (the first incomplete Step), or length. */
export function getCurrentStepIndex(steps: Step[]): number {
  const index = steps.findIndex((step) => !step.completed);
  return index < 0 ? steps.length : index;
}

export interface StepProgress {
  total: number;
  completed: number;
  remaining: number;
  /** 1-based number of the current Step, or 0 when every Step is complete. */
  currentNumber: number;
  currentStepId?: string;
  allComplete: boolean;
}

export function getStepProgress(steps: Step[]): StepProgress {
  const total = steps.length;
  const completed = steps.filter((step) => step.completed).length;
  const currentIndex = getCurrentStepIndex(steps);
  return {
    total,
    completed,
    remaining: total - completed,
    currentNumber: currentIndex < total ? currentIndex + 1 : 0,
    currentStepId: currentIndex < total ? steps[currentIndex]?.id : undefined,
    allComplete: total > 0 && completed === total,
  };
}

/**
 * Compact Step metadata for a reminder graph node. Returns the "no steps" shape
 * when the Steps system is disabled, so the node never shows stale progress.
 */
export function stepNodeFields(
  reminder: Reminder,
): Pick<MeshNodeData, 'hasSteps' | 'stepCount' | 'completedStepCount' | 'currentStepNumber'> {
  const steps = reminder.steps ?? [];
  const enabled =
    reminder.enableSteps === true || (reminder.enableSteps === undefined && steps.length > 0);
  if (!enabled || steps.length === 0) {
    return { hasSteps: false, stepCount: 0, completedStepCount: 0, currentStepNumber: 0 };
  }
  const progress = getStepProgress(steps);
  return {
    hasSteps: true,
    stepCount: progress.total,
    completedStepCount: progress.completed,
    currentStepNumber: progress.currentNumber,
  };
}

/** True when every Step before `index` is complete (so this Step is actionable). */
export function isStepActionable(steps: Step[], index: number): boolean {
  if (index < 0 || index >= steps.length) return false;
  for (let i = 0; i < index; i += 1) {
    if (!steps[i].completed) return false;
  }
  return true;
}

export function areAllStepsComplete(steps: Step[]): boolean {
  return steps.length > 0 && steps.every((step) => step.completed);
}

export type StepToggleResult = {
  steps: Step[];
  changed: boolean;
  /** Present when `changed` is false. */
  reason?: 'not-found' | 'locked' | 'already-complete';
  /** True when this toggle completed the final remaining Step. */
  allComplete: boolean;
};

/**
 * Toggles one Step with sequential enforcement.
 *
 * Completing is only permitted when every earlier Step is already complete; the
 * refusal happens here in logic, not merely by disabling a button. Reverting
 * cascades: the Step and every later Step become incomplete.
 */
export function toggleStep(
  steps: Step[],
  stepId: string,
  nowIso = new Date().toISOString(),
): StepToggleResult {
  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) return { steps, changed: false, reason: 'not-found', allComplete: false };

  const target = steps[index];
  if (!target.completed) {
    if (!isStepActionable(steps, index)) {
      return { steps, changed: false, reason: 'locked', allComplete: false };
    }
    const next = reindexSteps(
      steps.map((step, i) =>
        i === index ? { ...step, completed: true, completedAt: nowIso, updatedAt: nowIso } : step,
      ),
    );
    return { steps: next, changed: true, allComplete: areAllStepsComplete(next) };
  }

  // Reverting: reset this Step and every following Step.
  const reset = enqueueSequentialReset(steps, index, nowIso);
  const next = reindexSteps(reset);
  return { steps: next, changed: true, allComplete: areAllStepsComplete(next) };
}

function enqueueSequentialReset(steps: Step[], fromIndex: number, nowIso: string): Step[] {
  const cleared = steps.map((step, index) => {
    if (index !== fromIndex) return step;
    return { ...step, completed: false, completedAt: undefined, updatedAt: nowIso };
  });
  return resetCompletionFrom(cleared, fromIndex, nowIso);
}

export function addStep(
  steps: Step[],
  input: { title: string; description?: string },
  reminderId: string,
  nowIso = new Date().toISOString(),
): Step[] {
  const title = input.title.trim();
  if (!title) return steps;
  const step: Step = {
    id: generateStepId(),
    reminderId,
    title,
    description: input.description?.trim() || undefined,
    order: steps.length,
    completed: false,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  return reindexSteps([...steps, step]);
}

export function updateStep(
  steps: Step[],
  stepId: string,
  patch: { title?: string; description?: string },
  nowIso = new Date().toISOString(),
): Step[] {
  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) return steps;
  const title = patch.title === undefined ? steps[index].title : patch.title.trim() || steps[index].title;
  const description =
    patch.description === undefined ? steps[index].description : patch.description.trim() || undefined;
  const next = steps.map((step, i) =>
    i === index ? { ...step, title, description, updatedAt: nowIso } : step,
  );
  return reindexSteps(next);
}

export function deleteStep(steps: Step[], stepId: string): Step[] {
  const next = steps.filter((step) => step.id !== stepId);
  if (next.length === steps.length) return steps;
  return reindexSteps(next);
}

/**
 * Moves a Step to a new position, then re-validates the completion sequence so a
 * reorder can never produce a completed Step after an incomplete one.
 */
export function reorderSteps(steps: Step[], fromIndex: number, toIndex: number): Step[] {
  if (fromIndex < 0 || fromIndex >= steps.length) return steps;
  const clamped = Math.max(0, Math.min(steps.length - 1, toIndex));
  if (fromIndex === clamped) return steps;
  const next = [...steps];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(clamped, 0, moved);
  return reindexSteps(enforceSequentialCompletion(next));
}

/** Reorders by Step id (used by the editor's up/down controls). */
export function moveStep(steps: Step[], stepId: string, offset: number): Step[] {
  const index = steps.findIndex((step) => step.id === stepId);
  if (index < 0) return steps;
  return reorderSteps(steps, index, index + offset);
}

export interface StepSequenceIssue {
  kind:
    | 'missing-id'
    | 'duplicate-order'
    | 'completed-after-incomplete'
    | 'ownership-mismatch'
    | 'invalid-active';
  reminderId: string;
  stepId?: string;
  detail: string;
}

/**
 * Read-only structural validation. Mirrors what Diagnostics surfaces so the same
 * rules drive both the UI and the diagnostics check.
 */
export function validateStepSequence(reminder: Reminder): StepSequenceIssue[] {
  const steps = reminder.steps ?? [];
  const issues: StepSequenceIssue[] = [];
  const seenIds = new Set<string>();

  const ordered = [...steps];
  let locked = false;
  ordered.forEach((step, index) => {
    if (!isNonEmptyString(step.id)) {
      issues.push({ kind: 'missing-id', reminderId: reminder.id, detail: `Step at position ${index + 1} has no id.` });
    } else if (seenIds.has(step.id)) {
      issues.push({ kind: 'missing-id', reminderId: reminder.id, stepId: step.id, detail: 'Duplicate Step id.' });
    } else {
      seenIds.add(step.id);
    }

    if (step.reminderId !== reminder.id) {
      issues.push({
        kind: 'ownership-mismatch',
        reminderId: reminder.id,
        stepId: step.id,
        detail: 'Step reminderId does not match its parent reminder.',
      });
    }

    if (locked && step.completed) {
      issues.push({
        kind: 'completed-after-incomplete',
        reminderId: reminder.id,
        stepId: step.id,
        detail: 'A completed Step follows an incomplete Step.',
      });
    }
    if (!step.completed) locked = true;
  });

  const orders = steps.map((step) => step.order);
  const uniqueOrders = new Set(orders);
  if (uniqueOrders.size !== orders.length) {
    issues.push({ kind: 'duplicate-order', reminderId: reminder.id, detail: 'Two or more Steps share the same order.' });
  }

  const currentIndex = getCurrentStepIndex(steps);
  if (currentIndex < steps.length && steps[currentIndex].completed) {
    issues.push({
      kind: 'invalid-active',
      reminderId: reminder.id,
      detail: 'The active Step resolved to a completed Step.',
    });
  }

  return issues;
}
