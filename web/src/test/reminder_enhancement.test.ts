import { describe, expect, it, vi, afterEach } from 'vitest';
import { enhanceReminderText } from '../services/reminderAi';
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

afterEach(() => vi.restoreAllMocks());

describe('reminder AI adapter', () => {
  it('returns server text without exposing provider details to the editor', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ text: 'Book the service and ask about brakes.' }), { status: 200 })));
    await expect(enhanceReminderText({ operation: 'enhance-description', title: reminder.title })).resolves.toBe('Book the service and ask about brakes.');
  });

  it('reports unavailable AI without breaking the normal workflow', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
    await expect(enhanceReminderText({ operation: 'generate-summary', title: reminder.title })).rejects.toMatchObject({ code: 'unavailable' });
  });

  it('supports cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      return new Response('{}', { status: 200 });
    }));
    await expect(enhanceReminderText({ operation: 'generate-summary', title: reminder.title }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
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
