import { describe, it, expect } from 'vitest';
import {
  formatRecurrenceLabel,
  computeNextDueDate,
  formatDateIso,
  parseIsoDate,
  handleReminderCompletion,
} from '../services/recurrence';
import { Reminder } from '../types';

describe('Recurrence Service', () => {
  describe('formatRecurrenceLabel', () => {
    it('returns "Does not repeat" when rule is undefined or frequency is none', () => {
      expect(formatRecurrenceLabel()).toBe('Does not repeat');
      expect(formatRecurrenceLabel({ frequency: 'none' })).toBe('Does not repeat');
    });

    it('formats standard daily, weekly, and monthly labels', () => {
      expect(formatRecurrenceLabel({ frequency: 'daily' })).toBe('Daily');
      expect(formatRecurrenceLabel({ frequency: 'weekly' })).toBe('Weekly');
      expect(formatRecurrenceLabel({ frequency: 'monthly' })).toBe('Monthly');
    });

    it('formats custom interval labels', () => {
      expect(
        formatRecurrenceLabel({
          frequency: 'custom',
          unit: 'day',
          interval: 3,
        })
      ).toBe('Every 3 days');

      expect(
        formatRecurrenceLabel({
          frequency: 'custom',
          unit: 'week',
          interval: 2,
        })
      ).toBe('Every 2 weeks');

      expect(
        formatRecurrenceLabel({
          frequency: 'custom',
          unit: 'month',
          interval: 6,
        })
      ).toBe('Every 6 months');
    });

    it('formats weekdays for weekly recurrence', () => {
      expect(
        formatRecurrenceLabel({
          frequency: 'weekly',
          daysOfWeek: [1, 3, 5],
        })
      ).toBe('Weekly on Mon, Wed, Fri');
    });
  });

  describe('formatDateIso and parseIsoDate', () => {
    it('formats date to YYYY-MM-DD', () => {
      const date = new Date(2026, 8, 19);
      expect(formatDateIso(date)).toBe('2026-09-19');
    });

    it('parses YYYY-MM-DD to Date', () => {
      const parsed = parseIsoDate('2026-09-19');
      expect(parsed.getFullYear()).toBe(2026);
      expect(parsed.getMonth()).toBe(8);
      expect(parsed.getDate()).toBe(19);
    });
  });

  describe('computeNextDueDate', () => {
    it('computes next day for daily recurrence', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const dueDateIso = formatDateIso(futureDate);

      const reminder: Reminder = {
        id: 'r1',
        categoryId: 'c1',
        title: 'Daily test',
        priority: 'medium',
        completed: false,
        dueDate: dueDateIso,
        subtasks: [],
        createdAt: new Date().toISOString(),
        recurrence: { frequency: 'daily', interval: 1 },
      };

      const nextIso = computeNextDueDate(reminder);
      const expected = new Date(futureDate);
      expected.setDate(expected.getDate() + 1);
      expect(nextIso).toBe(formatDateIso(expected));
    });

    it('computes next interval for multi-day recurrence', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const dueDateIso = formatDateIso(futureDate);

      const reminder: Reminder = {
        id: 'r2',
        categoryId: 'c1',
        title: 'Every 3 days',
        priority: 'medium',
        completed: false,
        dueDate: dueDateIso,
        subtasks: [],
        createdAt: new Date().toISOString(),
        recurrence: { frequency: 'daily', interval: 3 },
      };

      const nextIso = computeNextDueDate(reminder);
      const expected = new Date(futureDate);
      expected.setDate(expected.getDate() + 3);
      expect(nextIso).toBe(formatDateIso(expected));
    });

    it('computes next week for weekly recurrence', () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 10);
      const dueDateIso = formatDateIso(futureDate);

      const reminder: Reminder = {
        id: 'r3',
        categoryId: 'c1',
        title: 'Weekly check',
        priority: 'medium',
        completed: false,
        dueDate: dueDateIso,
        subtasks: [],
        createdAt: new Date().toISOString(),
        recurrence: { frequency: 'weekly', interval: 1 },
      };

      const nextIso = computeNextDueDate(reminder);
      const expected = new Date(futureDate);
      expected.setDate(expected.getDate() + 7);
      expect(nextIso).toBe(formatDateIso(expected));
    });
  });

  describe('handleReminderCompletion', () => {
    const sampleReminders: Reminder[] = [
      {
        id: 'rem-1',
        categoryId: 'cat-1',
        title: 'Single Task',
        priority: 'medium',
        completed: false,
        subtasks: [{ id: 'sub-1', reminderId: 'rem-1', title: 'Sub 1', completed: false, createdAt: new Date().toISOString() }],
        createdAt: new Date().toISOString(),
        recurrence: { frequency: 'none' },
      },
      {
        id: 'rem-2',
        categoryId: 'cat-1',
        title: 'Daily Habit',
        priority: 'high',
        completed: false,
        dueDate: formatDateIso(new Date()),
        subtasks: [{ id: 'sub-2', reminderId: 'rem-2', title: 'Check emails', completed: true, createdAt: new Date().toISOString() }],
        createdAt: new Date().toISOString(),
        recurrence: { frequency: 'daily', interval: 1 },
      },
    ];

    it('completes a non-recurring reminder without creating a duplicate', () => {
      const result = handleReminderCompletion('rem-1', sampleReminders);
      expect(result).toHaveLength(2);
      const completedRem = result.find((r) => r.id === 'rem-1');
      expect(completedRem?.completed).toBe(true);
      expect(completedRem?.completedAt).toBeDefined();
    });

    it('completes a recurring reminder by spawning next occurrence and adding completed record', () => {
      const result = handleReminderCompletion('rem-2', sampleReminders);
      // Returns updated active occurrence (same id, completed=false) plus appended completed occurrence
      expect(result).toHaveLength(3);

      const activeNext = result.find((r) => r.id === 'rem-2');
      expect(activeNext?.completed).toBe(false);
      expect(activeNext?.occurrenceCount).toBe(2);
      expect(activeNext?.subtasks[0].completed).toBe(false);

      const completedRecord = result.find((r) => r.id.includes('rem-2-done-'));
      expect(completedRecord).toBeDefined();
      expect(completedRecord?.completed).toBe(true);
      expect(completedRecord?.completedAt).toBeDefined();
    });
  });
});
