import { describe, it, expect } from 'vitest';
import {
  generateActiveMesh,
  generateCompletedOverviewMesh,
  generateCompletedCategoryMesh,
} from '../utils/layout';
import { Category, Reminder, NodePositionMap } from '../types';
import { diagnoseHorizontalOverflow } from '../services/diagnostics';

describe('Document overflow diagnostics', () => {
  it('passes when document scroll width fits the viewport', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 360 });
    Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, value: 360 });
    expect(diagnoseHorizontalOverflow(document)?.overflow).toBe(0);
  });

  it('reports meaningful document overflow without changing layout', () => {
    Object.defineProperty(document.documentElement, 'clientWidth', { configurable: true, value: 320 });
    Object.defineProperty(document.documentElement, 'scrollWidth', { configurable: true, value: 372 });
    const offender = document.createElement('div');
    offender.dataset.testid = 'overflow-card';
    offender.getBoundingClientRect = () => ({ left: 0, right: 372, top: 0, bottom: 20, width: 372, height: 20, x: 0, y: 0, toJSON: () => ({}) });
    document.body.appendChild(offender);
    const report = diagnoseHorizontalOverflow(document);
    expect(report?.overflow).toBe(52);
    expect(report?.offenders).toContain('overflow-card');
    expect(offender.style.overflowX).toBe('');
    offender.remove();
  });
});

describe('Layout & Mesh Graph Generator', () => {
  const categories: Category[] = [
    { id: 'cat-work', name: 'Work', color: '#6366f1', icon: 'briefcase', createdAt: new Date().toISOString() },
    { id: 'cat-personal', name: 'Personal', color: '#ec4899', icon: 'heart', createdAt: new Date().toISOString() },
  ];

  const reminders: Reminder[] = [
    {
      id: 'rem-w1',
      categoryId: 'cat-work',
      title: 'Q3 Report',
      priority: 'high',
      completed: false,
      subtasks: [
        { id: 'sub-1', reminderId: 'rem-w1', title: 'Data gathering', completed: false, createdAt: new Date().toISOString() },
        { id: 'sub-2', reminderId: 'rem-w1', title: 'Charts', completed: true, createdAt: new Date().toISOString() },
      ],
      createdAt: new Date().toISOString(),
    },
    {
      id: 'rem-p1',
      categoryId: 'cat-personal',
      title: 'Grocery shopping',
      priority: 'medium',
      completed: true,
      completedAt: new Date().toISOString(),
      subtasks: [],
      createdAt: new Date().toISOString(),
    },
  ];

  describe('generateActiveMesh', () => {
    it('creates root node, category nodes, active reminder nodes and subtask nodes', () => {
      const { nodes, edges } = generateActiveMesh(categories, reminders);

      const root = nodes.find((n) => n.id === 'root');
      expect(root).toBeDefined();
      expect(root?.type).toBe('rootNode');

      const workCat = nodes.find((n) => n.id === 'cat-work');
      expect(workCat).toBeDefined();
      expect(workCat?.type).toBe('categoryNode');

      // Only active reminders should be in active mesh
      const remW1 = nodes.find((n) => n.id === 'rem-w1');
      expect(remW1).toBeDefined();
      expect(remW1?.type).toBe('reminderNode');

      const remP1 = nodes.find((n) => n.id === 'rem-p1');
      expect(remP1).toBeUndefined(); // Completed reminder omitted from active view

      // Subtasks of remW1
      const sub1 = nodes.find((n) => n.id === 'sub-1');
      expect(sub1).toBeDefined();
      expect(sub1?.type).toBe('subtaskNode');

      // Verify edges connect root -> category -> reminder -> subtasks
      expect(edges.some((e) => e.source === 'root' && e.target === 'cat-work')).toBe(true);
      expect(edges.some((e) => e.source === 'cat-work' && e.target === 'rem-w1')).toBe(true);
      expect(edges.some((e) => e.source === 'rem-w1' && e.target === 'sub-1')).toBe(true);
    });

    it('respects manual node positions when provided in NodePositionMap', () => {
      const manualPositions: NodePositionMap = {
        'cat-work': {
          nodeId: 'cat-work',
          x: 450,
          y: -300,
          manuallyPositioned: true,
          updatedAt: new Date().toISOString(),
        },
      };

      const { nodes } = generateActiveMesh(categories, reminders, null, undefined, manualPositions);
      const workNode = nodes.find((n) => n.id === 'cat-work');
      expect(workNode?.position).toEqual({ x: 450, y: -300 });
      expect(workNode?.data.manuallyPositioned).toBe(true);
    });
  });

  describe('generateCompletedOverviewMesh', () => {
    it('creates completed root node and category nodes with completed counts', () => {
      const { nodes } = generateCompletedOverviewMesh(categories, reminders);
      const compRoot = nodes.find((n) => n.id === 'completed-root');
      expect(compRoot).toBeDefined();
      expect(compRoot?.data.count).toBe(1);

      const personalCat = nodes.find((n) => n.id === 'cat-personal');
      expect(personalCat).toBeDefined();
      expect(personalCat?.data.completedCount).toBe(1);
    });
  });

  describe('generateCompletedCategoryMesh', () => {
    it('creates focused category mesh displaying only completed reminders', () => {
      const { nodes, edges } = generateCompletedCategoryMesh(categories[1], reminders);
      const catNode = nodes.find((n) => n.id === 'cat-personal');
      expect(catNode).toBeDefined();

      const compReminder = nodes.find((n) => n.id === 'rem-p1');
      expect(compReminder).toBeDefined();
      expect(edges.some((e) => e.source === 'cat-personal' && e.target === 'rem-p1')).toBe(true);
    });
  });
});
