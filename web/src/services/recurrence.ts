import { Reminder, RecurrenceRule } from '../types';
import { logger } from './logger';

const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * Formats a user-friendly label for a recurrence rule.
 */
export function formatRecurrenceLabel(rule?: RecurrenceRule): string {
  if (!rule || rule.frequency === 'none') {
    return 'Does not repeat';
  }

  const interval = rule.interval && rule.interval > 1 ? rule.interval : 1;

  switch (rule.frequency) {
    case 'daily':
      return interval === 1 ? 'Daily' : `Every ${interval} days`;

    case 'weekly': {
      let daysText = '';
      if (rule.daysOfWeek && rule.daysOfWeek.length > 0 && rule.daysOfWeek.length < 7) {
        daysText = ' on ' + rule.daysOfWeek.map((d) => DAYS_SHORT[d]).join(', ');
      }
      return interval === 1 ? `Weekly${daysText}` : `Every ${interval} weeks${daysText}`;
    }

    case 'monthly':
      return interval === 1 ? 'Monthly' : `Every ${interval} months`;

    case 'custom': {
      const unit = rule.unit || 'day';
      const unitLabel = interval === 1 ? unit : `${unit}s`;
      let daysText = '';
      if (unit === 'week' && rule.daysOfWeek && rule.daysOfWeek.length > 0) {
        daysText = ' on ' + rule.daysOfWeek.map((d) => DAYS_SHORT[d]).join(', ');
      }
      return `Every ${interval} ${unitLabel}${daysText}`;
    }

    default:
      return 'Repeats';
  }
}

/**
 * Formats a date to YYYY-MM-DD
 */
export function formatDateIso(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Parses YYYY-MM-DD safely into a local Date
 */
export function parseIsoDate(isoString?: string): Date {
  if (!isoString) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }
  const parts = isoString.split('-');
  if (parts.length === 3) {
    const year = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10) - 1;
    const day = parseInt(parts[2], 10);
    return new Date(year, month, day);
  }
  const fallback = new Date(isoString);
  return isNaN(fallback.getTime()) ? new Date() : fallback;
}

/**
 * Computes the next due date for a recurring reminder.
 */
export function computeNextDueDate(reminder: Reminder): string {
  const rule = reminder.recurrence;
  if (!rule || rule.frequency === 'none') {
    return reminder.dueDate || formatDateIso(new Date());
  }

  const baseDate = reminder.dueDate ? parseIsoDate(reminder.dueDate) : new Date();
  baseDate.setHours(0, 0, 0, 0);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // If base date is significantly in the past, anchor calculation so next occurrence is in the future
  const effectiveBase = baseDate.getTime() < today.getTime() ? today : baseDate;
  const interval = Math.max(1, rule.interval || 1);

  const nextDate = new Date(effectiveBase);

  if (rule.frequency === 'daily') {
    nextDate.setDate(nextDate.getDate() + interval);
  } else if (rule.frequency === 'weekly') {
    if (rule.daysOfWeek && rule.daysOfWeek.length > 0) {
      // Find next day in the selected daysOfWeek
      const sortedDays = [...rule.daysOfWeek].sort((a, b) => a - b);
      const currentDay = nextDate.getDay();

      // Look for a day later in the current week
      const nextDayInWeek = sortedDays.find((d) => d > currentDay);
      if (nextDayInWeek !== undefined && interval === 1) {
        nextDate.setDate(nextDate.getDate() + (nextDayInWeek - currentDay));
      } else {
        // Move forward by interval weeks and pick the first day
        const daysUntilFirst = (7 - currentDay + sortedDays[0]) % 7;
        const totalDaysForward = daysUntilFirst + (interval - 1) * 7;
        nextDate.setDate(nextDate.getDate() + (totalDaysForward === 0 ? 7 * interval : totalDaysForward));
      }
    } else {
      nextDate.setDate(nextDate.getDate() + interval * 7);
    }
  } else if (rule.frequency === 'monthly') {
    const currentDayOfMonth = nextDate.getDate();
    nextDate.setMonth(nextDate.getMonth() + interval);
    // Handle month-end clamping (e.g. 31st)
    if (nextDate.getDate() !== currentDayOfMonth) {
      nextDate.setDate(0); // last day of previous month
    }
  } else if (rule.frequency === 'custom') {
    const unit = rule.unit || 'day';
    if (unit === 'day') {
      nextDate.setDate(nextDate.getDate() + interval);
    } else if (unit === 'week') {
      nextDate.setDate(nextDate.getDate() + interval * 7);
    } else if (unit === 'month') {
      const dayOfMonth = nextDate.getDate();
      nextDate.setMonth(nextDate.getMonth() + interval);
      if (nextDate.getDate() !== dayOfMonth) {
        nextDate.setDate(0);
      }
    }
  }

  const resultIso = formatDateIso(nextDate);
  logger.debug('Recurrence', 'Computed next occurrence', {
    seriesId: reminder.recurringSeriesId || reminder.id,
    previousDate: reminder.dueDate,
    nextDate: resultIso,
  });

  return resultIso;
}

/**
 * Handles completion transition for both recurring and non-recurring reminders.
 */
export function handleReminderCompletion(
  targetId: string,
  reminders: Reminder[]
): Reminder[] {
  const reminder = reminders.find((r) => r.id === targetId);
  if (!reminder) return reminders;

  const nowIso = new Date().toISOString();
  const rule = reminder.recurrence;
  const isRecurring = rule && rule.frequency !== 'none';

  if (!isRecurring) {
    // Standard non-recurring reminder completion toggle
    const nextCompleted = !reminder.completed;
    return reminders.map((r) =>
      r.id === targetId
        ? {
            ...r,
            completed: nextCompleted,
            completedAt: nextCompleted ? nowIso : undefined,
          }
        : r
    );
  }

  // --- Recurring Reminder Completion ---
  // If user uncompletes an already completed recurring historical entry:
  if (reminder.completed) {
    return reminders.map((r) =>
      r.id === targetId ? { ...r, completed: false, completedAt: undefined } : r
    );
  }

  const currentCount = reminder.occurrenceCount || 1;
  const maxOccurrences = rule.endAfterOccurrences;
  const hasReachedMaxOccurrences = maxOccurrences && currentCount >= maxOccurrences;

  const nextDueDate = computeNextDueDate(reminder);
  const isPastEndDate = rule.endDate ? nextDueDate > rule.endDate : false;

  const shouldSpawnNext = !hasReachedMaxOccurrences && !isPastEndDate;

  // 1. Completed historical record
  const completedOccurrence: Reminder = {
    ...reminder,
    id: `${reminder.recurringSeriesId || reminder.id}-done-${Date.now()}`,
    recurringSeriesId: reminder.recurringSeriesId || reminder.id,
    completed: true,
    completedAt: nowIso,
    subtasks: reminder.subtasks.map((s) => ({
      ...s,
      completed: true,
      completedAt: s.completedAt || nowIso,
    })),
  };

  if (!shouldSpawnNext) {
    // End of recurring cycle: simply complete this item
    logger.info('Recurrence', 'Recurring reminder reached end of recurrence series');
    return reminders.map((r) => (r.id === targetId ? completedOccurrence : r));
  }

  // 2. Next active occurrence in the series
  const nextActiveOccurrence: Reminder = {
    ...reminder,
    id: reminder.id, // preserve the main node ID for stability in active mesh
    recurringSeriesId: reminder.recurringSeriesId || reminder.id,
    occurrenceCount: currentCount + 1,
    dueDate: nextDueDate,
    dueTime: reminder.dueTime,
    completed: false,
    completedAt: undefined,
    // Reset subtasks for the new active cycle
    subtasks: reminder.subtasks.map((s, idx) => ({
      id: `sub-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      reminderId: reminder.id,
      title: s.title,
      completed: false,
      createdAt: nowIso,
    })),
  };

  logger.info('Recurrence', 'Spawned next recurring occurrence', {
    seriesId: reminder.recurringSeriesId || reminder.id,
    occurrenceNumber: nextActiveOccurrence.occurrenceCount,
    nextDueDate,
  });

  // Replace current active reminder with the updated next occurrence,
  // and append the completed occurrence for historical tracking in Completed view.
  return [
    ...reminders.map((r) => (r.id === targetId ? nextActiveOccurrence : r)),
    completedOccurrence,
  ];
}
