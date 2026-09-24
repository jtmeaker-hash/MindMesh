/**
 * Level-of-detail, zoom-aware connection treatment and screen-space connection
 * routing for the spatial mesh.
 *
 * These are deliberately pure helpers with no React and no camera state: the
 * renderer feeds them projected screen positions, and tests can assert the
 * readability rules directly.
 */

/** Half-extents of each node kind in world units, used for framing and clipping. */
export const NODE_HALF: Record<string, { x: number; y: number }> = {
  root: { x: 52, y: 52 },
  category: { x: 39, y: 39 },
  reminder: { x: 83, y: 50 },
  subtask: { x: 65, y: 21 },
};

export function nodeHalfExtent(type: string): { x: number; y: number } {
  return NODE_HALF[type] ?? NODE_HALF.reminder;
}

/**
 * Detail tiers for the mesh. A node that has been projected down to a handful of
 * pixels cannot show a label or its metadata without smearing into its
 * neighbours, so at far zoom levels the renderer drops that content and keeps the
 * node itself - its shape, its colour and its icon - readable instead.
 *
 * Level of detail never changes a node's size in graph space and never applies
 * any inverse-camera scaling: it only decides how much *content* is drawn inside
 * a node whose projected size is already small.
 */
export type GraphDetailLevel = 'full' | 'compact' | 'minimal';

/** Mean projected node height (px) below which secondary metadata is dropped. */
export const LOD_COMPACT_HEIGHT = 34;
/** Mean projected node height (px) below which labels are dropped entirely. */
export const LOD_MINIMAL_HEIGHT = 16;

export function resolveGraphDetailLevel(meanScreenHeight: number): GraphDetailLevel {
  if (!Number.isFinite(meanScreenHeight) || meanScreenHeight < LOD_MINIMAL_HEIGHT) return 'minimal';
  if (meanScreenHeight < LOD_COMPACT_HEIGHT) return 'compact';
  return 'full';
}

/** Projected on-screen height of a node drawn at its true world-space size. */
export function nodeScreenHeight(type: string, scale: number): number {
  return nodeHalfExtent(type).y * 2 * scale;
}

/**
 * Mean projected on-screen height of a set of visible nodes. This is the input to
 * level of detail: it falls as the camera pulls back, and rises as it moves in.
 * Returns null when there is nothing visible to measure.
 */
export function meanNodeScreenHeight(
  visible: Array<{ type: string; scale: number }>,
): number | null {
  if (visible.length === 0) return null;
  let sum = 0;
  for (const node of visible) sum += nodeScreenHeight(node.type, node.scale);
  return sum / visible.length;
}

/**
 * Edge intensity follows the camera: further away (smaller projected scale) means
 * thinner, dimmer lines so a dense graph does not turn into one solid mass. The
 * floor keeps existing relationships visible rather than letting them disappear.
 */
export function connectionZoomFade(meanScale: number): number {
  const safe = Number.isFinite(meanScale) ? Math.max(0, meanScale) : 0;
  return Math.max(0.4, Math.min(1, 0.45 + safe * 0.95));
}

/**
 * Stroke thickness multiplier at the current zoom. Lines get thinner as the
 * camera pulls back and never grow thick enough to swallow small nodes.
 */
export function connectionWidthScale(meanScale: number): number {
  const safe = Number.isFinite(meanScale) ? Math.max(0, meanScale) : 0;
  return Math.max(0.6, Math.min(1.6, 0.55 + safe * 0.85));
}

/**
 * Automatic de-cluttering: as the number of on-screen connections grows, every
 * non-focused line loses intensity. It never hides a relationship - it only
 * stops hundreds of lines from fusing into a single bright slab.
 */
export function connectionDensityDamp(visibleEdgeCount: number): number {
  const count = Number.isFinite(visibleEdgeCount) ? Math.max(0, visibleEdgeCount) : 0;
  return Math.max(0.4, Math.min(1, 1 - Math.max(0, count - 60) / 900));
}

// ---- Connection routing (keeps lines off unrelated nodes) -------------------

export interface ScreenObstacle {
  id: string;
  x: number;
  y: number;
  radius: number;
}

/**
 * Bucketed index of projected node positions. Routing a line only has to look at
 * the buckets it crosses, so connection routing stays cheap even with hundreds
 * of nodes on screen.
 */
export interface ScreenGrid {
  query(from: { x: number; y: number }, to: { x: number; y: number }): ScreenObstacle[];
}

export const SCREEN_GRID_CELL = 140;

export function buildScreenGrid(obstacles: ScreenObstacle[], cell = SCREEN_GRID_CELL): ScreenGrid {
  const buckets = new Map<string, ScreenObstacle[]>();
  const keyFor = (x: number, y: number) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  for (const obstacle of obstacles) {
    const key = keyFor(obstacle.x, obstacle.y);
    const bucket = buckets.get(key);
    if (bucket) bucket.push(obstacle);
    else buckets.set(key, [obstacle]);
  }
  return {
    query(from, to) {
      const found = new Map<string, ScreenObstacle>();
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      const length = Math.hypot(dx, dy);
      const steps = Math.max(1, Math.ceil(length / (cell / 2)));
      for (let step = 0; step <= steps; step += 1) {
        const t = step / steps;
        const bucket = buckets.get(keyFor(from.x + dx * t, from.y + dy * t));
        if (!bucket) continue;
        for (const obstacle of bucket) found.set(obstacle.id, obstacle);
      }
      return Array.from(found.values());
    },
  };
}

/**
 * Routes one connection. A straight segment is used unless it would cut through
 * an unrelated node, in which case the line is bowed around that node as a
 * quadratic curve - relationships stay visible without drawing over other nodes.
 */
export function routeConnection(
  from: { x: number; y: number },
  to: { x: number; y: number },
  obstacles: ScreenObstacle[],
  clearance = 10,
): { bowed: boolean; path: string } {
  const straight = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length < 1 || obstacles.length === 0) return { bowed: false, path: straight };
  const ux = dx / length;
  const uy = dy / length;
  let bestOffset = 0;
  let bestSign = 1;
  for (const obstacle of obstacles) {
    const relX = obstacle.x - from.x;
    const relY = obstacle.y - from.y;
    const along = relX * ux + relY * uy;
    // Only nodes between the endpoints can actually be in the way; the end nodes
    // of the connection are excluded by the caller.
    if (along <= clearance || along >= length - clearance) continue;
    const signedPerp = -relX * uy + relY * ux;
    const distance = Math.abs(signedPerp);
    const needed = obstacle.radius + clearance;
    if (distance >= needed) continue;
    const offset = needed - distance;
    if (offset > bestOffset) {
      bestOffset = offset;
      // Bow to the opposite side of the obstruction.
      bestSign = signedPerp >= 0 ? -1 : 1;
    }
  }
  if (bestOffset <= 0) return { bowed: false, path: straight };
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  // A quadratic curve only reaches half of its control offset at the midpoint,
  // so the control point travels twice as far as the required bow.
  const bow = bestOffset * 2;
  const controlX = midX - uy * bow * bestSign;
  const controlY = midY + ux * bow * bestSign;
  return { bowed: true, path: `M ${from.x} ${from.y} Q ${controlX} ${controlY} ${to.x} ${to.y}` };
}

/** Router cost ceiling: beyond this the graph uses straight lines to stay fast. */
export const ROUTING_MAX_OBSTACLES = 360;
export const ROUTING_MAX_EDGES = 700;
