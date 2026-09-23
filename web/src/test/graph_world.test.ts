import { describe, expect, it } from 'vitest';
import { generateNestedActiveMesh } from '../utils/nestedLayout';
import { didNodeDrag, focusZoomForNodeType, nodeCentre, resolveNodeTap } from '../services/graphNavigation';
import { Category, NodePositionMap, Reminder } from '../types';

const now = new Date().toISOString();

/** Mirrors the layout engine's node sizes so overlap can be measured in world space. */
const SIZE: Record<string, { w: number; h: number }> = {
  rootNode: { w: 104, h: 104 },
  categoryNode: { w: 78, h: 78 },
  reminderNode: { w: 165, h: 100 },
  subtaskNode: { w: 130, h: 42 },
};

function makeCategory(id: string, parentCategoryId: string | null = null): Category {
  return { id, name: id, color: '#6366f1', createdAt: now, parentCategoryId };
}

function makeReminder(id: string, categoryId: string, subtaskCount = 0): Reminder {
  return {
    id,
    categoryId,
    title: id,
    priority: 'medium',
    completed: false,
    createdAt: now,
    subtasks: Array.from({ length: subtaskCount }, (_, index) => ({
      id: `${id}-sub-${index}`,
      reminderId: id,
      title: `${id} sub ${index}`,
      completed: false,
      createdAt: now,
    })),
  };
}

function buildLargeGraph() {
  const categories: Category[] = [makeCategory('big'), makeCategory('small')];
  const reminders: Reminder[] = [];
  for (let index = 0; index < 14; index += 1) {
    reminders.push(makeReminder(`big-${index}`, 'big', 2));
  }
  for (let index = 0; index < 2; index += 1) {
    reminders.push(makeReminder(`small-${index}`, 'small'));
  }
  return { categories, reminders };
}

function bounds(nodes: Array<{ position: { x: number; y: number } }>) {
  const xs = nodes.map((node) => node.position.x);
  const ys = nodes.map((node) => node.position.y);
  return {
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys),
  };
}

describe('expanded graph world', () => {
  it('lays a busy graph out across a large world instead of a screen-sized box', () => {
    const categories = Array.from({ length: 10 }, (_, index) => makeCategory(`cat-${index}`));
    const reminders: Reminder[] = [];
    categories.forEach((category, index) => {
      const count = index === 0 ? 12 : 3;
      for (let j = 0; j < count; j += 1) {
        reminders.push(makeReminder(`${category.id}-rem-${j}`, category.id));
      }
    });

    const { nodes } = generateNestedActiveMesh(categories, reminders, null, {});
    const span = bounds(nodes);

    expect(Math.max(span.width, span.height)).toBeGreaterThan(1800);
  });

  it('grows the branch radius as reminders are added rather than reusing one fixed radius', () => {
    const one = generateNestedActiveMesh(
      [makeCategory('a')],
      [makeReminder('a-1', 'a')],
      null,
      {},
    );
    const many = generateNestedActiveMesh(
      [makeCategory('a')],
      Array.from({ length: 14 }, (_, index) => makeReminder(`a-${index}`, 'a')),
      null,
      {},
    );

    const radius = (nodes: Array<{ id: string; position: { x: number; y: number } }>) => {
      const category = nodes.find((node) => node.id === 'a')!;
      return Math.hypot(category.position.x, category.position.y);
    };

    expect(radius(many.nodes)).toBeGreaterThan(radius(one.nodes) * 1.15);
    const manySpan = Math.max(bounds(many.nodes).width, bounds(many.nodes).height);
    const oneSpan = Math.max(bounds(one.nodes).width, bounds(one.nodes).height);
    expect(manySpan).toBeGreaterThan(oneSpan * 1.4);
  });

  it('keeps a minimum separation so no two auto-placed nodes overlap', () => {
    const categories = Array.from({ length: 8 }, (_, index) => makeCategory(`cat-${index}`));
    const reminders: Reminder[] = [];
    categories.forEach((category, index) => {
      for (let j = 0; j < 4 + index; j += 1) {
        reminders.push(makeReminder(`${category.id}-rem-${j}`, category.id, j % 3));
      }
    });

    const { nodes } = generateNestedActiveMesh(categories, reminders, null, {});

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const a = nodes[i];
        const b = nodes[j];
        const sa = SIZE[a.type ?? ''] ?? SIZE.reminderNode;
        const sb = SIZE[b.type ?? ''] ?? SIZE.reminderNode;
        const dx = Math.abs(a.position.x - b.position.x);
        const dy = Math.abs(a.position.y - b.position.y);
        const overlapping = dx < (sa.w + sb.w) / 2 - 1 && dy < (sa.h + sb.h) / 2 - 1;
        expect(overlapping, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('gives a large branch substantially more room than a small one', () => {
    const { nodes } = generateNestedActiveMesh(
      [makeCategory('big'), makeCategory('small')],
      [
        ...Array.from({ length: 14 }, (_, index) => makeReminder(`big-${index}`, 'big')),
        ...Array.from({ length: 2 }, (_, index) => makeReminder(`small-${index}`, 'small')),
      ],
      null,
      {},
    );

    const category = (id: string) => nodes.find((node) => node.id === id)!;
    const distanceFor = (categoryId: string) => {
      const origin = category(categoryId).position;
      const owned = nodes.filter((node) => node.type === 'reminderNode' && node.data.categoryId === categoryId);
      return owned.reduce((sum, node) => sum + Math.hypot(node.position.x - origin.x, node.position.y - origin.y), 0) / owned.length;
    };

    expect(distanceFor('big')).toBeGreaterThan(distanceFor('small') * 1.3);
  });

  it('preserves manual node positions and routes automatic nodes around them', () => {
    const { categories, reminders } = buildLargeGraph();
    const manual: NodePositionMap = {
      'small': { nodeId: 'small', x: 5200, y: -4300, manuallyPositioned: true },
    };

    const { nodes } = generateNestedActiveMesh(categories, reminders, null, {}, manual);
    const pinned = nodes.find((node) => node.id === 'small')!;
    expect(pinned.position).toEqual({ x: 5200, y: -4300 });

    const others = nodes.filter((node) => node.id !== 'small');
    const collisions = others.filter((node) => {
      const size = SIZE[node.type ?? ''] ?? SIZE.reminderNode;
      const dx = Math.abs(node.position.x - pinned.position.x);
      const dy = Math.abs(node.position.y - pinned.position.y);
      return dx < (size.w + SIZE.categoryNode.w) / 2 - 1 && dy < (size.h + SIZE.categoryNode.h) / 2 - 1;
    });
    expect(collisions).toEqual([]);
  });
});

describe('two-tap node navigation', () => {
  it('focuses on the first tap and opens only on the second tap of the same node', () => {
    expect(resolveNodeTap(null, 'car')).toBe('focus');
    expect(resolveNodeTap('car', 'car')).toBe('open');
  });

  it('moves focus instead of opening the previous node when a different node is tapped', () => {
    expect(resolveNodeTap('car', 'rego')).toBe('focus');
  });

  it('treats only a real movement as a drag, so a tap still navigates', () => {
    expect(didNodeDrag({ x: 100, y: 100 }, { x: 101, y: 100 })).toBe(false);
    expect(didNodeDrag({ x: 100, y: 100 }, { x: 160, y: 40 })).toBe(true);
  });

  it('chooses a readable zoom for each node type', () => {
    expect(focusZoomForNodeType('root')).toBeGreaterThan(0);
    expect(focusZoomForNodeType('subtask')).toBeGreaterThanOrEqual(focusZoomForNodeType('category'));
  });

  it('centres on the node rather than its top-left corner', () => {
    expect(nodeCentre({ x: 100, y: 50 }, { width: 80, height: 60 })).toEqual({ x: 140, y: 80 });
    expect(nodeCentre({ x: 100, y: 50 })).toEqual({ x: 100, y: 50 });
  });
});
