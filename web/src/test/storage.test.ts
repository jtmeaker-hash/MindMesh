import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadCategories,
  saveCategories,
  loadReminders,
  saveReminders,
  loadNodePositions,
  saveNodePositions,
  clearNodePositions,
  resetToSample,
  clearAllData,
} from '../utils/storage';
import { Category, Reminder, NodePositionMap } from '../types';

describe('Storage Utility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads default categories when storage is initially empty', () => {
    const cats = loadCategories();
    expect(cats.length).toBeGreaterThan(0);
    expect(cats[0]).toHaveProperty('id');
    expect(cats[0]).toHaveProperty('name');
  });

  it('saves and reloads custom categories accurately', () => {
    const customCats: Category[] = [
      { id: 'custom-1', name: 'Custom Cat', color: '#ff0000', createdAt: new Date().toISOString() },
    ];
    saveCategories(customCats);
    const loaded = loadCategories();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Custom Cat');
  });

  it('saves and reloads reminders with subtasks and recurrence', () => {
    const customReminders: Reminder[] = [
      {
        id: 'r-1',
        categoryId: 'c-1',
        title: 'Review PR',
        priority: 'high',
        completed: false,
        subtasks: [{ id: 's-1', reminderId: 'r-1', title: 'Check tests', completed: true, createdAt: new Date().toISOString() }],
        recurrence: { frequency: 'daily', interval: 1 },
        createdAt: new Date().toISOString(),
      },
    ];
    saveReminders(customReminders);
    const loaded = loadReminders();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].title).toBe('Review PR');
    expect(loaded[0].subtasks).toHaveLength(1);
    expect(loaded[0].recurrence?.frequency).toBe('daily');
  });

  it('persists and clears manual node positions correctly', () => {
    const positions: NodePositionMap = {
      'node-1': {
        nodeId: 'node-1',
        x: 120,
        y: -340,
        manuallyPositioned: true,
        updatedAt: new Date().toISOString(),
      },
    };
    saveNodePositions(positions);
    const loaded = loadNodePositions();
    expect(loaded['node-1']).toBeDefined();
    expect(loaded['node-1'].x).toBe(120);
    expect(loaded['node-1'].y).toBe(-340);

    clearNodePositions();
    const emptyLoaded = loadNodePositions();
    expect(Object.keys(emptyLoaded)).toHaveLength(0);
  });

  it('resets to sample dataset and provides pre-populated reminders and categories', () => {
    const { categories, reminders } = resetToSample();
    expect(categories.length).toBeGreaterThan(0);
    expect(reminders.length).toBeGreaterThan(0);

    const reloadedReminders = loadReminders();
    expect(reloadedReminders.length).toBe(reminders.length);
  });

  it('clears reminders while keeping categories intact', () => {
    resetToSample();
    expect(loadReminders().length).toBeGreaterThan(0);

    const { reminders } = clearAllData();
    expect(reminders).toHaveLength(0);
    expect(loadReminders()).toHaveLength(0);
    expect(loadCategories().length).toBeGreaterThan(0);
  });
});
