import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Category, Reminder } from '../types';
import { DirectDebit, MoneyState } from '../types/finance';
import { CreateReminderProposal, DEFAULT_SMART_ENGINE_SETTINGS } from '../types/smartEngine';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import {
  SmartAssistantSessionOptions,
  createSmartAssistantSession,
  defaultEntityIdFactory,
  isUncertain,
  reminderNotificationsFromCommand,
} from '../services/smartAssistant';

/**
 * Stage 07 coverage: the assistant layer is the only place in the Smart Engine
 * that is allowed to touch app data, and only ever *after* an explicit
 * confirmation. These tests pin the preview/no-write boundary down.
 */

const referenceDate = new Date(2026, 8, 21, 9, 0, 0); // 2026-09-21 (a Monday)

const categories: Category[] = [
  { id: 'car', name: 'Car', color: '#06b6d4', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'work', name: 'Work', color: '#38bdf8', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'work-admin', name: 'Admin', color: '#38bdf8', parentCategoryId: 'work', createdAt: '2026-01-01T00:00:00.000Z' },
];

const reminders: Reminder[] = [
  {
    id: 'r-dentist', categoryId: 'work', title: 'Dentist appointment', dueDate: '2026-09-18',
    dueTime: '09:00', priority: 'medium', completed: false, createdAt: '2026-01-01T00:00:00.000Z', subtasks: [],
  },
  {
    id: 'r-netflix', categoryId: 'work', title: 'Netflix payment', dueDate: '2026-10-16',
    priority: 'medium', completed: false, createdAt: '2026-01-01T00:00:00.000Z', subtasks: [],
  },
];

const moneyState: MoneyState = getDefaultMoneyState();

const saveReminder = vi.fn();
const saveCategory = vi.fn();
const saveDirectDebit = vi.fn();

function createSession(overrides: Partial<SmartAssistantSessionOptions> = {}) {
  return createSmartAssistantSession({
    settings: DEFAULT_SMART_ENGINE_SETTINGS,
    categories,
    reminders,
    moneyState,
    contacts: [],
    referenceDate,
    handlers: { saveReminder, saveCategory, saveDirectDebit },
    createId: (prefix: string) => `${prefix}-1`,
    now: () => '2026-09-21T09:00:00.000Z',
    ...overrides,
  });
}

describe('MindMesh Smart Assistant Stage 07', () => {
  beforeEach(() => {
    saveReminder.mockReset();
    saveCategory.mockReset();
    saveDirectDebit.mockReset();
  });

  it('previews a natural-language reminder without writing anything', () => {
    const session = createSession();
    const result = session.interpret('Remind me to service the car next Friday');

    expect(result.operation).toBe('assistant-command');
    expect(result.proposal?.type).toBe('create-reminder');
    // Nothing has been written just by interpreting the command.
    expect(saveReminder).not.toHaveBeenCalled();
    expect(saveCategory).not.toHaveBeenCalled();
    expect(saveDirectDebit).not.toHaveBeenCalled();

    const rows = session.preview(result);
    const value = (field: string) => rows.find((row) => row.field === field)?.value;
    expect(value('title')).toBe('service the car');
    expect(value('dueDate')).toBe('2026-09-25');
    expect(value('categoryId')).toBe('Car');
    expect(value('suggestedSubtasks')).toBe('Book service, Check required service items, Arrange drop-off or pick-up');

    // A fully matched reminder needs no extra answers.
    expect(session.resolutionPrompts(result)).toEqual([]);
  });

  it('writes a reminder only after confirmation, mapped onto the existing Reminder model', () => {
    const session = createSession();
    const result = session.interpret('Remind me to service the car next Friday');

    const outcome = session.confirm(result);
    expect(outcome.success).toBe(true);
    expect(outcome.entityId).toBe('rem-1');
    expect(outcome.actionType).toBe('create-reminder');
    expect(saveReminder).toHaveBeenCalledTimes(1);

    const reminder = saveReminder.mock.calls[0][0] as Reminder;
    expect(reminder.id).toBe('rem-1');
    expect(reminder.categoryId).toBe('car');
    expect(reminder.title).toBe('service the car');
    expect(reminder.dueDate).toBe('2026-09-25');
    expect(reminder.completed).toBe(false);
    expect(reminder.priority).toBe('medium');
    expect(reminder.createdAt).toBe('2026-09-21T09:00:00.000Z');
    expect(reminder.subtasks.map((step) => step.title)).toEqual([
      'Book service',
      'Check required service items',
      'Arrange drop-off or pick-up',
    ]);
    expect(reminder.subtasks.every((step) => step.reminderId === 'rem-1')).toBe(true);
  });

  it('never writes the same proposal twice, even from a later session', () => {
    const completedProposalIds = new Set<string>();
    const first = createSession({ completedProposalIds });
    const result = first.interpret('Remind me to service the car next Friday');
    expect(first.confirm(result).success).toBe(true);

    const second = createSession({ completedProposalIds });
    const repeat = second.confirm(result);
    expect(repeat.success).toBe(false);
    expect(repeat.duplicate).toBe(true);
    expect(saveReminder).toHaveBeenCalledTimes(1);
  });

  it('asks for the category instead of guessing when nothing matched', () => {
    const session = createSession();
    const result = session.interpret('Remind me to call the plumber tomorrow');
    const proposal = result.proposal as CreateReminderProposal;

    expect(proposal.type).toBe('create-reminder');
    expect(proposal.fields.categoryId?.value).toBeUndefined();

    // The unmatched category is shown as an open question, not silently invented.
    const rows = session.preview(result);
    expect(rows.find((row) => row.field === 'categoryId')?.value).toBe('Ask to choose');
    expect(rows.find((row) => row.field === 'categoryId')?.uncertain).toBe(true);

    const prompts = session.resolutionPrompts(result);
    const categoryPrompt = prompts.find((prompt) => prompt.field === 'categoryId');
    expect(categoryPrompt?.required).toBe(true);
    expect(categoryPrompt?.options.map((option) => option.value)).toContain('work');

    const blocked = session.confirm(result);
    expect(blocked.success).toBe(false);
    expect(blocked.message).toMatch(/Category/);
    expect(saveReminder).not.toHaveBeenCalled();

    // Answering the question is what unlocks the write.
    const resolved = session.resolve(result, { categoryId: 'work' });
    expect(session.resolutionPrompts(resolved).some((prompt) => prompt.field === 'categoryId')).toBe(false);
    expect(session.confirm(resolved).success).toBe(true);

    const reminder = saveReminder.mock.calls[0][0] as Reminder;
    expect(reminder.categoryId).toBe('work');
    expect(reminder.title).toBe('call the plumber');
    expect(reminder.dueDate).toBe('2026-09-22');
  });

  it('lists each missing or ambiguous field once as a confirmation prompt', () => {
    const session = createSession();
    const result = session.interpret('Remind me to call the plumber tomorrow');
    const fields = session.resolutionPrompts(result).map((prompt) => prompt.field);
    expect(new Set(fields).size).toBe(fields.length);
  });

  it('keeps the existing reminder when applying an edit proposal', () => {
    const session = createSession();
    const result = session.interpret('Move my dentist reminder to Thursday');
    expect(result.proposal?.type).toBe('edit-reminder');
    expect(saveReminder).not.toHaveBeenCalled();

    const outcome = session.confirm(result);
    expect(outcome.success).toBe(true);
    expect(outcome.entityId).toBe('r-dentist');
    expect(saveReminder).toHaveBeenCalledTimes(1);

    const updated = saveReminder.mock.calls[0][0] as Reminder;
    expect(updated.id).toBe('r-dentist');
    expect(updated.title).toBe('Dentist appointment');
    expect(updated.dueDate).toBeDefined();
    expect(new Date(`${updated.dueDate}T00:00:00`).getDay()).toBe(4); // Thursday
  });

  it('maps a recurring bill onto the existing DirectDebit model after confirmation', () => {
    const session = createSession();
    const result = session.interpret('Netflix is $25.99 every month on the 16th');
    expect(result.proposal?.type).toBe('create-direct-debit');

    const rows = session.preview(result);
    const value = (field: string) => rows.find((row) => row.field === field)?.value;
    expect(value('title')).toBe('Netflix');
    expect(value('amount')).toMatch(/25\.99/);
    expect(value('frequency')).toBe('Monthly');
    expect(value('nextPaymentDate')).toBe('2026-10-16');

    // A known merchant is matched to an existing category, but a payment date that
    // was derived from "the 16th" is still confirmed rather than assumed.
    expect(value('categoryId')).toBe('Subscriptions');
    const prompts = session.resolutionPrompts(result).map((prompt) => prompt.field);
    expect(prompts).toContain('nextPaymentDate');
    expect(prompts).not.toContain('categoryId');

    const blocked = session.confirm(result);
    expect(blocked.success).toBe(false);
    expect(saveDirectDebit).not.toHaveBeenCalled();

    const resolved = session.resolve(result, { nextPaymentDate: '2026-10-16' });
    expect(session.confirm(resolved).success).toBe(true);

    const debit = saveDirectDebit.mock.calls[0][0] as DirectDebit;
    expect(debit.id).toBe('debit-1');
    expect(debit.title).toBe('Netflix');
    expect(debit.amount).toBe(25.99);
    expect(debit.categoryId).toBe('bcat-sub');
    expect(debit.frequency).toBe('monthly');
    expect(debit.recurrenceConfig).toEqual({ interval: 1 });
    expect(debit.nextPaymentDate).toBe('2026-10-16');
    expect(debit.active).toBe(true);
    expect(saveDirectDebit.mock.calls[0][1]).toBeUndefined();
  });

  it('asks for a bill category when no existing category matches', () => {
    const session = createSession();
    const result = session.interpret('Boat storage bill is $45 monthly on the 5th');
    expect(result.proposal?.type).toBe('create-direct-debit');

    expect(session.preview(result).find((row) => row.field === 'categoryId')?.value).toBe('Ask to choose');
    expect(session.resolutionPrompts(result).map((prompt) => prompt.field)).toContain('categoryId');

    expect(session.confirm(result).success).toBe(false);
    expect(saveDirectDebit).not.toHaveBeenCalled();

    const resolved = session.resolve(result, { categoryId: 'bcat-other', nextPaymentDate: '2026-10-05' });
    expect(session.confirm(resolved).success).toBe(true);
    expect((saveDirectDebit.mock.calls[0][0] as DirectDebit).categoryId).toBe('bcat-other');
  });

  it('links an existing reminder to a bill without cloning it', () => {
    const session = createSession();
    const result = session.interpret('Netflix is $25.99 every month on the 16th');
    const resolved = session.resolve(result, {
      categoryId: 'bcat-sub',
      nextPaymentDate: '2026-10-16',
      linkedReminderId: 'r-netflix',
    });

    expect(session.preview(resolved).find((row) => row.field === 'linkedReminderId')?.value).toBe('Netflix payment');
    expect(session.confirm(resolved).success).toBe(true);

    const [debit, linkedReminder] = saveDirectDebit.mock.calls[0] as [DirectDebit, Reminder | undefined];
    expect(debit.linkedReminderId).toBe('r-netflix');
    // The real stored reminder is handed over, so the existing link logic runs.
    expect(linkedReminder?.id).toBe('r-netflix');
    expect(linkedReminder?.title).toBe('Netflix payment');
  });

  it('creates categories and subcategories through the existing category write path', () => {
    const session = createSession();

    const categoryResult = session.interpret('Create a category called Errands');
    expect(categoryResult.proposal?.type).toBe('create-category');
    expect(session.confirm(categoryResult).success).toBe(true);
    const category = saveCategory.mock.calls[0][0] as Category;
    expect(category.name).toBe('Errands');
    expect(category.parentCategoryId).toBeNull();
    expect(category.id).toBe('cat-1');
    expect(category.color).toMatch(/^#/);

    const subcategoryResult = session.interpret('Add Tyres under Car');
    expect(subcategoryResult.proposal?.type).toBe('create-subcategory');
    expect(session.confirm(subcategoryResult).success).toBe(true);
    const subcategory = saveCategory.mock.calls[1][0] as Category;
    expect(subcategory.name).toBe('Tyres');
    expect(subcategory.parentCategoryId).toBe('car');
  });

  it('asks for the parent category when it cannot be recognised', () => {
    const session = createSession();
    const result = session.interpret('Add Tyres under Vehicles');

    const prompts = session.resolutionPrompts(result);
    expect(prompts.find((prompt) => prompt.field === 'parentCategoryId')?.required).toBe(true);
    expect(session.confirm(result).success).toBe(false);
    expect(saveCategory).not.toHaveBeenCalled();

    const resolved = session.resolve(result, { parentCategoryId: 'work' });
    expect(session.confirm(resolved).success).toBe(true);
    expect((saveCategory.mock.calls[0][0] as Category).parentCategoryId).toBe('work');
  });

  it('refuses to write when Smart Assistance is turned off', () => {
    const session = createSession({ settings: { ...DEFAULT_SMART_ENGINE_SETTINGS, enabled: false } });
    const result = session.interpret('Remind me to service the car next Friday');

    expect(result.status).toBe('unknown');
    expect(result.proposal).toBeUndefined();
    expect(session.preview(result)).toEqual([]);

    const outcome = session.confirm(result);
    expect(outcome.success).toBe(false);
    expect(outcome.message).toMatch(/turned off/i);
    expect(saveReminder).not.toHaveBeenCalled();
  });

  it('makes no network request while interpreting, previewing or confirming', () => {
    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => {
      throw new Error('Smart Assistance must never reach the network');
    });
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const session = createSession();
      const result = session.interpret('Remind me to service the car next Friday');
      session.preview(result);
      session.resolutionPrompts(result);
      expect(session.confirm(result).success).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(saveReminder).toHaveBeenCalledTimes(1);
  });

  it('converts reminder notification wording into the existing notification settings', () => {
    expect(reminderNotificationsFromCommand('Remind me to pay the rego next Friday, notify me 2 days before')).toEqual({
      enabled: true,
      notifyAtDueTime: false,
      advanceMinutes: [2880],
    });
    expect(reminderNotificationsFromCommand('Remind me 1 week before the car service')).toEqual({
      enabled: true,
      notifyAtDueTime: false,
      advanceMinutes: [10080],
    });
    expect(reminderNotificationsFromCommand('Remind me to water the plants')).toBeUndefined();
    expect(reminderNotificationsFromCommand(undefined)).toBeUndefined();

    // The confirmed reminder carries the parsed offset into the existing shape.
    const session = createSession();
    const result = session.interpret('Remind me to service the car next Friday, notify me 2 days before');
    expect(session.preview(result).find((row) => row.field === 'notificationSettings')?.value).toBe('2 days before');
    expect(session.confirm(result).success).toBe(true);
    const reminder = saveReminder.mock.calls[0][0] as Reminder;
    expect(reminder.notifications).toEqual({ enabled: true, notifyAtDueTime: false, advanceMinutes: [2880] });
  });

  it('treats low-confidence and absent confidence as uncertain', () => {
    expect(isUncertain({ score: 0.98, reason: 'exact-match' })).toBe(false);
    expect(isUncertain({ score: 0.95, reason: 'ambiguous' })).toBe(true);
    expect(isUncertain({ score: 0.5, reason: 'derived' })).toBe(true);
    expect(isUncertain(undefined)).toBe(true);
  });

  it('generates entity ids through the existing id factory contract', () => {
    expect(defaultEntityIdFactory('rem')).toMatch(/^rem-/);
    expect(defaultEntityIdFactory('debit')).toMatch(/^debit-/);
  });
});
