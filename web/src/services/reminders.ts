import { Reminder, Subtask } from '../types';
import { enforceSequentialCompletion, normalizeSteps } from './steps';

/** Updates an existing reminder in place by identity, or prepends a new reminder. */
export function upsertReminder(reminders: Reminder[], reminder: Reminder): Reminder[] {
  const index = reminders.findIndex((item) => item.id === reminder.id);
  if (index < 0) return [reminder, ...reminders];
  const next = [...reminders];
  next[index] = reminder;
  return next;
}

/**
 * Resolves the Subtask enable flag. Legacy reminders (stored before the toggle
 * existed) keep their current behaviour: the checklist is considered enabled
 * exactly when subtasks are present.
 */
export function resolveEnableSubtasks(reminder: Pick<Reminder, 'enableSubtasks' | 'subtasks'>): boolean {
  if (typeof reminder.enableSubtasks === 'boolean') return reminder.enableSubtasks;
  return (reminder.subtasks?.length ?? 0) > 0;
}

/** Resolves the Steps enable flag, defaulting to whether steps exist. */
export function resolveEnableSteps(reminder: Pick<Reminder, 'enableSteps' | 'steps'>): boolean {
  if (typeof reminder.enableSteps === 'boolean') return reminder.enableSteps;
  return (reminder.steps?.length ?? 0) > 0;
}

/**
 * Normalizes a reminder without discarding any data. Guarantees arrays for both
 * reminder systems, stable Step identifiers/ordering, and explicit enable flags
 * so Steps and Subtasks stay independent.
 */
export function normalizeReminder(reminder: Reminder): Reminder {
  const subtasks: Subtask[] = Array.isArray(reminder.subtasks) ? reminder.subtasks : [];
  // Steps always hydrate into a valid sequential state so no read/import path can
  // surface a completed Step after an incomplete one.
  const steps = enforceSequentialCompletion(normalizeSteps(reminder.steps, reminder.id));
  return {
    ...reminder,
    subtasks,
    steps,
    enableSubtasks:
      typeof reminder.enableSubtasks === 'boolean' ? reminder.enableSubtasks : subtasks.length > 0,
    enableSteps: typeof reminder.enableSteps === 'boolean' ? reminder.enableSteps : steps.length > 0,
  };
}

export function normalizeReminders(reminders: Reminder[] | undefined): Reminder[] {
  if (!Array.isArray(reminders)) return [];
  return reminders.map((reminder) => normalizeReminder(reminder));
}

/**
 * True when every required Step is complete. A reminder with Steps disabled, or
 * with no Steps, is vacuously satisfied so existing reminders keep working.
 */
export function areStepsSatisfied(reminder: Reminder): boolean {
  const steps = reminder.steps ?? [];
  if (!resolveEnableSteps(reminder)) return true;
  if (steps.length === 0) return true;
  return steps.every((step) => step.completed);
}

/**
 * Steps gate reminder completion: a reminder with incomplete Steps can never be
 * marked complete. Subtasks deliberately do not gate completion, preserving the
 * existing independent-checklist behaviour.
 */
export function canCompleteReminder(reminder: Reminder): boolean {
  return areStepsSatisfied(reminder);
}

/** Human-readable step progress such as `3 / 7 complete`. */
export function formatStepProgress(reminder: Reminder): string | null {
  const steps = reminder.steps ?? [];
  if (!resolveEnableSteps(reminder) || steps.length === 0) return null;
  const completed = steps.filter((step) => step.completed).length;
  return `${completed} / ${steps.length} complete`;
}
