import { describe, expect, it } from 'vitest';
import {
  buildScreenGrid,
  connectionDensityDamp,
  connectionWidthScale,
  connectionZoomFade,
  LOD_COMPACT_HEIGHT,
  LOD_MINIMAL_HEIGHT,
  meanNodeScreenHeight,
  nodeHalfExtent,
  nodeScreenHeight,
  resolveGraphDetailLevel,
  routeConnection,
  type ScreenObstacle,
} from '../services/graphLod';

const obstacle = (id: string, x: number, y: number, radius: number): ScreenObstacle => ({ id, x, y, radius });

/** Midpoint of a quadratic curve, used to measure how far a line bows. */
function quadraticMidpoint(
  from: { x: number; y: number },
  control: { x: number; y: number },
  to: { x: number; y: number },
) {
  return {
    x: 0.25 * from.x + 0.5 * control.x + 0.25 * to.x,
    y: 0.25 * from.y + 0.5 * control.y + 0.25 * to.y,
  };
}

function parsePath(path: string) {
  const numbers = path.match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
  return numbers;
}

describe('graph node extents', () => {
  it('measures each node kind in fixed world units, never in screen units', () => {
    expect(nodeHalfExtent('root').y).toBeGreaterThan(nodeHalfExtent('category').y);
    expect(nodeHalfExtent('reminder').x).toBeGreaterThan(nodeHalfExtent('subtask').x);
    // An unknown kind falls back to a reminder-sized node instead of zero.
    expect(nodeHalfExtent('mystery')).toEqual(nodeHalfExtent('reminder'));
  });

  it('derives on-screen height purely from the projected camera scale', () => {
    const near = nodeScreenHeight('reminder', 1);
    const far = nodeScreenHeight('reminder', 0.25);
    // Fixed world size means screen height is linear in the projection scale:
    // moving the camera 4x further away renders the node 4x smaller.
    expect(near / far).toBeCloseTo(4, 6);
  });
});

describe('level of detail follows real projected node size', () => {
  it('keeps full detail while nodes are large and simplifies as they shrink', () => {
    expect(resolveGraphDetailLevel(LOD_COMPACT_HEIGHT)).toBe('full');
    expect(resolveGraphDetailLevel(LOD_COMPACT_HEIGHT - 0.1)).toBe('compact');
    expect(resolveGraphDetailLevel(LOD_MINIMAL_HEIGHT)).toBe('compact');
    expect(resolveGraphDetailLevel(LOD_MINIMAL_HEIGHT - 0.1)).toBe('minimal');
  });

  it('falls back to the simplest tier for missing measurements', () => {
    expect(resolveGraphDetailLevel(Number.NaN)).toBe('minimal');
  });

  it('averages the visible nodes and reports nothing for an empty view', () => {
    expect(meanNodeScreenHeight([])).toBeNull();
    const mean = meanNodeScreenHeight([
      { type: 'reminder', scale: 1 },
      { type: 'subtask', scale: 1 },
    ]);
    expect(mean).toBeCloseTo((nodeScreenHeight('reminder', 1) + nodeScreenHeight('subtask', 1)) / 2, 6);
  });

  it('only ever changes how much content is drawn, not the node geometry', () => {
    // The tier is a function of the projected size alone, so the same camera
    // distance can never resize a node - it can only drop its labels.
    const scale = 0.1;
    const tier = resolveGraphDetailLevel(meanNodeScreenHeight([{ type: 'reminder', scale }])!);
    expect(tier).toBe('minimal');
    expect(nodeScreenHeight('reminder', scale)).toBeGreaterThan(0);
  });
});

describe('zoom-aware connection treatment', () => {
  it('fades connections out as the camera pulls back but never removes them', () => {
    expect(connectionZoomFade(1)).toBeGreaterThan(connectionZoomFade(0.2));
    expect(connectionZoomFade(0)).toBeGreaterThanOrEqual(0.4);
    expect(connectionZoomFade(50)).toBeLessThanOrEqual(1);
  });

  it('thins connections when zoomed out and keeps them within a sane band', () => {
    expect(connectionWidthScale(1)).toBeGreaterThan(connectionWidthScale(0.1));
    expect(connectionWidthScale(0)).toBeGreaterThanOrEqual(0.6);
    expect(connectionWidthScale(50)).toBeLessThanOrEqual(1.6);
  });

  it('damps dense clusters without letting a relationship disappear', () => {
    expect(connectionDensityDamp(10)).toBe(1);
    expect(connectionDensityDamp(150)).toBeLessThan(connectionDensityDamp(60));
    expect(connectionDensityDamp(10_000)).toBeGreaterThanOrEqual(0.4);
    expect(connectionDensityDamp(Number.NaN)).toBe(1);
  });
});

describe('screen-space connection routing', () => {
  it('finds only the nodes near the line it is routing', () => {
    const grid = buildScreenGrid([obstacle('a', 0, 0, 20), obstacle('b', 1000, 0, 20)]);
    const found = grid.query({ x: 0, y: 0 }, { x: 100, y: 0 }).map((entry) => entry.id);
    expect(found).toContain('a');
    expect(found).not.toContain('b');
  });

  it('draws a straight line when nothing is in the way', () => {
    const route = routeConnection({ x: 0, y: 0 }, { x: 100, y: 0 }, []);
    expect(route.bowed).toBe(false);
    expect(route.path).toBe('M 0 0 L 100 0');
  });

  it('bows a connection around an unrelated node so it does not cut through it', () => {
    const blocker = obstacle('mid', 50, 0, 20);
    const route = routeConnection({ x: 0, y: 0 }, { x: 100, y: 0 }, [blocker], 10);
    expect(route.bowed).toBe(true);

    const [fromX, fromY, controlX, controlY, toX, toY] = parsePath(route.path);
    const mid = quadraticMidpoint({ x: fromX, y: fromY }, { x: controlX, y: controlY }, { x: toX, y: toY });
    // The bowed line clears the node by at least its radius plus clearance.
    expect(Math.hypot(mid.x - blocker.x, mid.y - blocker.y)).toBeGreaterThanOrEqual(blocker.radius + 10 - 1e-6);
    // ...and still connects the same two endpoints.
    expect(parsePath(route.path).slice(0, 2)).toEqual([0, 0]);
    expect(parsePath(route.path).slice(-2)).toEqual([100, 0]);
  });

  it('ignores nodes that are not between the two endpoints', () => {
    const beyond = routeConnection({ x: 0, y: 0 }, { x: 100, y: 0 }, [obstacle('past', 150, 0, 20)], 10);
    expect(beyond.bowed).toBe(false);

    const behindStart = routeConnection({ x: 0, y: 0 }, { x: 100, y: 0 }, [obstacle('before', -20, 0, 20)], 10);
    expect(behindStart.bowed).toBe(false);
  });

  it('leaves a clear line straight when an obstacle sits far to the side', () => {
    const route = routeConnection({ x: 0, y: 0 }, { x: 100, y: 0 }, [obstacle('side', 50, 200, 20)], 10);
    expect(route.bowed).toBe(false);
  });
});
