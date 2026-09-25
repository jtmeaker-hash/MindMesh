import { describe, expect, it } from 'vitest';
import { enhanceReminderTextLocally, reminderAiRequest } from '../services/reminderAi';
import { generateActiveMesh } from '../utils/layout';
import { upsertReminder } from '../services/reminders';
import { Category, Reminder } from '../types';

const category: Category = { id: 'cat-1', name: 'Car', color: '#06b6d4', createdAt: '2026-01-01T00:00:00.000Z' };
const reminder: Reminder = {
  id: 'rem-1', categoryId: category.id, title: 'Service car',
  description: 'Book the scheduled service and ask about the brakes.',
  summary: 'Book service + check brakes', priority: 'medium', completed: false,
  createdAt: '2026-01-01T00:00:00.000Z', subtasks: [],
};

describe('local reminder enhancement adapter', () => {
  it('keeps the editor request shape and creates deterministic local text', () => {
    const request = reminderAiRequest(reminder, 'enhance-description');
    expect(enhanceReminderTextLocally(request)).toBe('Service Car: Book the scheduled service and ask about the brakes.');
  });

  it('generates summaries only from text already supplied', () => {
    expect(enhanceReminderTextLocally({
      operation: 'generate-summary',
      title: reminder.title,
      description: 'Book the scheduled service. Ask about the brakes.',
    })).toBe('Book the scheduled service');
    expect(enhanceReminderTextLocally({ operation: 'generate-summary', title: reminder.title })).toBe(reminder.title);
  });
});

describe('reminder persistence semantics', () => {
  it('updates an edited reminder by ID instead of creating a duplicate', () => {
    const edited = { ...reminder, summary: 'Updated summary' };
    const result = upsertReminder([reminder], edited);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(reminder.id);
    expect(result[0].summary).toBe('Updated summary');
  });
});

describe('reminder graph summary', () => {
  it('keeps title and exposes a compact summary, with a clean fallback', () => {
    const withSummary = generateActiveMesh([category], [reminder]).nodes.find((node) => node.id === reminder.id);
    expect(withSummary?.data.label).toBe('Service car');
    expect(withSummary?.data.summary).toBe('Book service + check brakes');

    const withoutSummary = generateActiveMesh([category], [{ ...reminder, summary: undefined }]).nodes.find((node) => node.id === reminder.id);
    expect(withoutSummary?.data.summary).toBeUndefined();
  });
});
