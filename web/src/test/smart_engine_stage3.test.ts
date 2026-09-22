import { describe, expect, it } from 'vitest';
import { Category, Reminder } from '../types';
import { enhanceReminderTextLocally } from '../services/reminderAi';
import { createSmartEngine } from '../services/smartEngine';
import {
  createCategoryProposal,
  createEditReminderProposal,
  createIntelligentReminderProposal,
  createSubcategoryProposal,
  suggestCategory,
  suggestSubtasks,
  summarizeReminder,
  toReminderGraphSummaryFacts,
} from '../services/reminderIntelligence';

const categories: Category[] = [
  { id: 'car', name: 'Car', color: '#06b6d4', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'health', name: 'Health', color: '#22c55e', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'money', name: 'Money', color: '#f59e0b', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'vehicle-care', name: 'Vehicle Care', color: '#06b6d4', parentCategoryId: 'car', createdAt: '2026-01-01T00:00:00.000Z' },
];
const reminder: Reminder = {
  id: 'r1', categoryId: 'car', title: 'Service car', description: 'Book the scheduled service.',
  summary: 'Book service', dueDate: '2026-09-20', dueTime: '09:00', priority: 'medium', completed: false,
  createdAt: '2026-01-01T00:00:00.000Z', subtasks: [
    { id: 's1', reminderId: 'r1', title: 'Call mechanic', completed: true, createdAt: '2026-01-01T00:00:00.000Z' },
    { id: 's2', reminderId: 'r1', title: 'Arrange pickup', completed: false, createdAt: '2026-01-01T00:00:00.000Z' },
  ],
};

const referenceDate = new Date(2026, 8, 21, 9, 0, 0);

describe('MindMesh Smart Engine Stage 03 reminder intelligence', () => {
  it('enhances locally without fabricating details', () => {
    expect(enhanceReminderTextLocally({ operation: 'enhance-description', title: 'service car', description: 'ask about brakes' })).toBe('Service Car: ask about brakes.');
    expect(enhanceReminderTextLocally({ operation: 'enhance-description', title: 'service car' })).toContain('Complete service car.');
    expect(enhanceReminderTextLocally({ operation: 'enhance-description', title: 'service car' })).not.toMatch(/tomorrow|Josh|Sydney|\$\d/);
  });

  it('summarizes actual reminder facts and marks overdue state', () => {
    const result = summarizeReminder(reminder, categories, referenceDate);
    expect(result.overdue).toBe(true);
    expect(result.text).toContain('Book the scheduled service.');
    expect(result.text).toContain('Due 2026-09-20 at 09:00');
    expect(result.text).toContain('1/2 subtasks complete');
    expect(result.text).toContain('Overdue');
  });

  it('exposes structured graph facts without replacing the graph renderer', () => {
    const facts = toReminderGraphSummaryFacts(reminder, categories, referenceDate);
    expect(facts).toMatchObject({ id: 'r1', categoryName: 'Car', subtaskCount: 2, completedSubtaskCount: 1, overdue: true });
    expect(facts.summary).toBe('Book service');
  });

  it('matches exact categories before domain aliases', () => {
    expect(suggestCategory('Car', categories).category?.id).toBe('car');
    expect(suggestCategory('pay electricity bill', categories).category?.id).toBe('money');
    expect(suggestCategory('something unclear', categories).category).toBeUndefined();
  });

  it('returns optional deterministic subtasks only for known task types', () => {
    expect(suggestSubtasks('book car service').map((item) => item.title)).toEqual(['Book service', 'Check required service items', 'Arrange drop-off or pick-up']);
    expect(suggestSubtasks('sort that thing sometime')).toEqual([]);
  });

  it('adds category and optional subtask suggestions to a create proposal without writing', () => {
    const proposal = createIntelligentReminderProposal('Remind me to book car service next Friday', categories, referenceDate);
    expect(proposal.fields.categoryId.value).toBe('car');
    expect(proposal.fields.suggestedSubtasks.value).toHaveLength(3);
    expect(proposal.validation.canWrite).toBe(false);
  });

  it('creates a safe edit proposal only when one reminder is resolved', () => {
    const proposal = createEditReminderProposal('rename reminder r1 to Service brakes', [reminder], referenceDate);
    expect(proposal.reminderId).toBe('r1');
    expect(proposal.fields.title.value).toBe('Service brakes');
    expect(proposal.validation.canWrite).toBe(false);
  });

  it('keeps ambiguous edit identity from becoming a mutation', () => {
    const other = { ...reminder, id: 'r2', title: 'Service brakes' };
    const proposal = createEditReminderProposal('change the date for service', [reminder, other], referenceDate);
    expect(proposal.reminderId).toBeUndefined();
    expect(proposal.ambiguities[0].field).toBe('reminderId');
    expect(proposal.missingFields.map((field) => field.field)).toContain('change');
  });

  it('supports category creation proposals and requires a parent for subcategories', () => {
    expect(createCategoryProposal('create category Travel').name.value).toBe('Travel');
    const subcategory = createSubcategoryProposal('create subcategory Repairs under Car', categories);
    expect(subcategory.name.value).toBe('Repairs');
    expect(subcategory.parentCategoryId.value).toBe('car');
    expect(subcategory.validation.canWrite).toBe(false);
    expect(createSubcategoryProposal('create subcategory Repairs', categories).missingFields.map((field) => field.field)).toContain('parentCategoryId');
  });

  it('routes Stage 03 proposals through the existing local facade', () => {
    const engine = createSmartEngine({ contextProvider: { getCategories: () => categories, getSubcategories: () => categories }, reminders: [reminder] });
    expect(engine.interpret('assistant-command', 'rename reminder r1 to Service brakes').proposal?.type).toBe('edit-reminder');
    expect(engine.interpret('assistant-command', 'create category Travel').proposal?.type).toBe('create-category');
  });
});
