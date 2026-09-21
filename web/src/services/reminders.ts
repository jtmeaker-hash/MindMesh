import { Reminder } from '../types';

/** Updates an existing reminder in place by identity, or prepends a new reminder. */
export function upsertReminder(reminders: Reminder[], reminder: Reminder): Reminder[] {
  const index = reminders.findIndex((item) => item.id === reminder.id);
  if (index < 0) return [reminder, ...reminders];
  const next = [...reminders];
  next[index] = reminder;
  return next;
}
