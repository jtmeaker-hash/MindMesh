import { describe, expect, it } from 'vitest';
import { Category, Reminder } from '../types';
import {
  DEFAULT_SMART_ENGINE_SETTINGS,
  SmartEngineSettings,
  getSmartAssistanceFeatureDefinition,
  isSmartAssistanceFeatureEnabled,
} from '../types/smartEngine';
import { createSmartEngine, DefaultSmartEngineContextProvider } from '../services/smartEngine';
import { findCategoryMention, summarizeReminderScope } from '../services/reminderIntelligence';
import { ReminderScopeSummary } from '../services/reminderIntelligence';

/**
 * Stage 08 coverage: the reminder/graph summary capability that the assistant and
 * the declared `graph-summary` operation expose. Everything here is read-only.
 */

const referenceDate = new Date(2026, 8, 21, 9, 0, 0); // 2026-09-21

const categories: Category[] = [
  { id: 'car', name: 'Car', color: '#06b6d4', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'car-service', name: 'Vehicle Care', color: '#06b6d4', parentCategoryId: 'car', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'work', name: 'Work', color: '#38bdf8', createdAt: '2026-01-01T00:00:00.000Z' },
];

function reminder(overrides: Partial<Reminder> & Pick<Reminder, 'id' | 'categoryId' | 'title'>): Reminder {
  return {
    priority: 'medium',
    completed: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    subtasks: [],
    ...overrides,
  };
}

const reminders: Reminder[] = [
  reminder({
    id: 'r1', categoryId: 'car', title: 'Service car', dueDate: '2026-09-25',
    subtasks: [
      { id: 's1', reminderId: 'r1', title: 'Book service', completed: true, createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 's2', reminderId: 'r1', title: 'Drop off', completed: false, createdAt: '2026-01-01T00:00:00.000Z' },
    ],
  }),
  reminder({ id: 'r2', categoryId: 'car-service', title: 'Replace tyres', dueDate: '2026-09-18' }),
  reminder({ id: 'r3', categoryId: 'car', title: 'Pay rego', dueDate: '2026-08-01', completed: true, completedAt: '2026-08-02T00:00:00.000Z' }),
  reminder({ id: 'r4', categoryId: 'work', title: 'Team meeting', dueDate: '2026-09-22' }),
];

function createEngine(overrides: Parameters<typeof createSmartEngine>[0] = {}) {
  return createSmartEngine({
    // Categories reach the engine through the context provider, exactly like the app.
    contextProvider: new DefaultSmartEngineContextProvider(categories),
    reminders,
    referenceDate,
    ...overrides,
  });
}

describe('MindMesh Smart Engine Stage 08 — reminder & graph summaries', () => {
  it('summarises the whole network deterministically', () => {
    const summary = summarizeReminderScope(reminders, categories, { referenceDate });

    expect(summary.scope.label).toBe('All reminders');
    expect(summary.scope.categoryId).toBeUndefined();
    expect(summary.totals).toEqual({
      reminders: 4, active: 3, completed: 1, overdue: 1, subtasks: 2, completedSubtasks: 1,
    });
    // Ordered by due date so the graph view can rely on a stable sequence.
    expect(summary.nodes.map((node) => node.id)).toEqual(['r3', 'r2', 'r4', 'r1']);
    expect(summary.nextDue).toEqual({ date: '2026-09-18', title: 'Replace tyres' });
    expect(summary.text).toBe(
      'All reminders: 4 reminders, 3 active, 1 completed, 1 overdue. Next due 2026-09-18 (Replace tyres). Subtasks 1/2 complete.'
    );

    // Same input, same output.
    expect(summarizeReminderScope(reminders, categories, { referenceDate })).toEqual(summary);
  });

  it('includes subcategories when a parent branch is summarised', () => {
    const branch = summarizeReminderScope(reminders, categories, { categoryId: 'car', referenceDate });
    expect(branch.scope).toEqual({ categoryId: 'car', categoryName: 'Car', label: 'Car' });
    expect(branch.nodes.map((node) => node.id)).toEqual(['r3', 'r2', 'r1']);
    expect(branch.nodes.map((node) => node.categoryName)).toContain('Vehicle Care');
    expect(branch.totals.reminders).toBe(3);

    const leaf = summarizeReminderScope(reminders, categories, { categoryId: 'car-service', referenceDate });
    expect(leaf.nodes.map((node) => node.id)).toEqual(['r2']);
    expect(leaf.totals.reminders).toBe(1);
  });

  it('only finds categories the text really names', () => {
    expect(findCategoryMention('summarize my car branch', categories).category?.id).toBe('car');
    // Whole-word matching: a category called Work is not found inside "homework".
    expect(findCategoryMention('summarize my homework review', categories).name).toBeUndefined();

    const longer: Category[] = [
      ...categories,
      { id: 'car-ins', name: 'Car Insurance', color: '#10B981', createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    expect(findCategoryMention('summarize Car Insurance', longer).category?.id).toBe('car-ins');

    const ambiguous: Category[] = [
      { id: 'a1', name: 'Home', color: '#111111', createdAt: '2026-01-01T00:00:00.000Z' },
      { id: 'a2', name: 'Work', color: '#222222', createdAt: '2026-01-01T00:00:00.000Z' },
    ];
    const tie = findCategoryMention('summarize Home and Work', ambiguous);
    expect(tie.category).toBeUndefined();
    expect(tie.alternatives.map((category) => category.id)).toEqual(['a1', 'a2']);

    const unknown = findCategoryMention('summarize my Boat branch', categories);
    expect(unknown.name).toBe('Boat');
    expect(unknown.category).toBeUndefined();
  });

  it('answers the declared graph-summary operation with text and structured facts', () => {
    const result = createEngine().interpret('graph-summary', 'summarize my car reminders');
    const summary = result.value as ReminderScopeSummary;

    expect(result.operation).toBe('graph-summary');
    expect(result.status).toBe('ok');
    expect(result.proposal).toBeUndefined();
    expect(result.message).toMatch(/^Car:/);
    expect(summary.totals.reminders).toBe(3);
    expect(summary.nodes[0]).toMatchObject({
      id: 'r3', title: 'Pay rego', categoryId: 'car', categoryName: 'Car',
      completed: true, overdue: false, subtaskCount: 0,
    });
  });

  it('routes a natural-language summary request through the assistant', () => {
    const engine = createEngine();
    const result = engine.interpret('assistant-command', 'summarize my car branch');

    expect(result.operation).toBe('assistant-command');
    expect(result.status).toBe('ok');
    expect(result.message).toContain('Next due 2026-09-18');
    expect((result.value as ReminderScopeSummary).totals).toMatchObject({ reminders: 3, completed: 1, overdue: 1 });
    expect(engine.interpret('assistant-command', 'summarize my car branch').value).toEqual(result.value);
  });

  it('reports a category it cannot find instead of summarising everything', () => {
    const result = createEngine().interpret('assistant-command', 'summarize my Boat branch');

    expect(result.status).toBe('needs-confirmation');
    expect(result.value).toBeUndefined();
    expect(result.message).toMatch(/No category named “Boat”/);
    expect(result.ambiguities[0].field).toBe('categoryId');
    expect(result.ambiguities[0].options).toEqual(['Car', 'Work']);
  });

  it('is gated by its own Smart Assistance feature toggle', () => {
    const disabled: SmartEngineSettings = {
      ...DEFAULT_SMART_ENGINE_SETTINGS,
      featureToggles: { graphSummaries: false },
    };
    const result = createEngine({ settings: disabled }).interpret('graph-summary', 'summarize my car reminders');

    expect(result.status).toBe('unknown');
    expect(result.value).toBeUndefined();
    expect(result.message).toMatch(/turned off/);
  });

  it('is enabled by default and grouped with local context', () => {
    const definition = getSmartAssistanceFeatureDefinition('graphSummaries');
    expect(definition?.group).toBe('context');
    expect(definition?.defaultEnabled).toBe(true);
    expect(isSmartAssistanceFeatureEnabled(DEFAULT_SMART_ENGINE_SETTINGS, 'graphSummaries')).toBe(true);
  });

  it('reports an empty scope rather than inventing numbers', () => {
    const result = createEngine({ reminders: [] }).interpret('assistant-command', 'summarize my graph');

    expect(result.status).toBe('needs-confirmation');
    expect((result.value as ReminderScopeSummary).totals.reminders).toBe(0);
    expect(result.missingFields.map((field) => field.field)).toContain('reminders');
    expect(result.message).toContain('0 reminders');
  });

  it('leaves the existing dashboard summary routes untouched', () => {
    const engine = createEngine();
    const withValue = (value: unknown) => value as { insights?: unknown[] };

    // "summary of my tasks" deliberately stays on the dashboard route.
    const tasks = engine.interpret('assistant-command', 'summary of my tasks');
    expect(withValue(tasks.value).insights).toBeDefined();

    const doing = engine.interpret('assistant-command', 'how am i doing');
    expect(withValue(doing.value).insights).toBeDefined();

    const dashboard = engine.interpret('assistant-command', 'summarize my dashboard');
    expect(withValue(dashboard.value).insights).toBeDefined();
  });
});
