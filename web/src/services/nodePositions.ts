import { NodePosition, NodePositionMap } from '../types';

const POSITION_LIMIT = 100_000;

function finiteCoordinate(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(-POSITION_LIMIT, Math.min(POSITION_LIMIT, value))
    : null;
}

/** Safely reads old and new position payloads without making malformed data manual. */
export function normalizeNodePositions(value: unknown): NodePositionMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result: NodePositionMap = {};
  for (const [nodeId, raw] of Object.entries(value)) {
    if (!raw || typeof raw !== 'object') continue;
    const entry = raw as Partial<NodePosition>;
    const x = finiteCoordinate(entry.x);
    const y = finiteCoordinate(entry.y);
    if (x === null || y === null) continue;
    result[nodeId] = {
      nodeId,
      x,
      y,
      // Old position records may not have this flag. They are safe to use as
      // manual overrides because they came from the user's position store.
      manuallyPositioned: entry.manuallyPositioned !== false,
      ...(typeof entry.updatedAt === 'string' ? { updatedAt: entry.updatedAt } : {}),
    };
  }
  return result;
}

export function commitNodePosition(
  previous: NodePositionMap,
  nodeId: string,
  x: number,
  y: number,
): NodePositionMap {
  const next = normalizeNodePositions(previous);
  const safeX = finiteCoordinate(x) ?? 0;
  const safeY = finiteCoordinate(y) ?? 0;
  next[nodeId] = {
    nodeId,
    x: Math.round(safeX),
    y: Math.round(safeY),
    manuallyPositioned: true,
    updatedAt: new Date().toISOString(),
  };
  return next;
}

export function resetNodePosition(previous: NodePositionMap, nodeId: string): NodePositionMap {
  const next = { ...normalizeNodePositions(previous) };
  delete next[nodeId];
  return next;
}

type Size = { width: number; height: number };
type Point = { x: number; y: number };

interface Placement {
  position: Point;
  size: Size;
}

/**
 * Expansion search. Candidates walk an outward golden-angle spiral, which packs
 * evenly in every direction instead of piling up on a few axes, so a crowded
 * branch grows into the world around it rather than stacking on top of itself.
 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_SEARCH_RINGS = 64;

/** Spatial hash cell size, in world units. */
const GRID_CELL = 200;
/**
 * Every entry is filed into the buckets covering its box grown by this margin,
 * which is at least as large as the biggest spacing any layout asks for. Queries
 * can therefore scan only the candidate's own neighbourhood.
 */
const GRID_MARGIN = 160;

function boxesOverlap(a: Point, aSize: Size, b: Point, bSize: Size, spacing: number): boolean {
  return (
    Math.abs(a.x - b.x) < (aSize.width + bSize.width) / 2 + spacing &&
    Math.abs(a.y - b.y) < (aSize.height + bSize.height) / 2 + spacing
  );
}

/**
 * A bucketed index of already-placed nodes. Keeps collision avoidance linear in
 * the size of the local neighbourhood instead of comparing every node with every
 * other node, which is what makes hundreds of reminders affordable.
 */
export class PlacementGrid {
  private readonly buckets = new Map<string, Placement[]>();
  private readonly entries: Placement[] = [];

  private static keys(minX: number, minY: number, maxX: number, maxY: number): string[] {
    const keys: string[] = [];
    const fromX = Math.floor(minX / GRID_CELL);
    const toX = Math.floor(maxX / GRID_CELL);
    const fromY = Math.floor(minY / GRID_CELL);
    const toY = Math.floor(maxY / GRID_CELL);
    for (let x = fromX; x <= toX; x += 1) {
      for (let y = fromY; y <= toY; y += 1) keys.push(`${x}:${y}`);
    }
    return keys;
  }

  get size(): number {
    return this.entries.length;
  }

  reserve(position: Point, size: Size): void {
    const entry: Placement = { position: { x: position.x, y: position.y }, size };
    this.entries.push(entry);
    const halfW = size.width / 2 + GRID_MARGIN;
    const halfH = size.height / 2 + GRID_MARGIN;
    for (const key of PlacementGrid.keys(position.x - halfW, position.y - halfH, position.x + halfW, position.y + halfH)) {
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(entry);
      else this.buckets.set(key, [entry]);
    }
  }

  /** True when a node of `size` would sit too close to anything already placed. */
  conflicts(position: Point, size: Size, spacing: number): boolean {
    const halfW = size.width / 2 + spacing;
    const halfH = size.height / 2 + spacing;
    const seen = new Set<Placement>();
    for (const key of PlacementGrid.keys(position.x - halfW, position.y - halfH, position.x + halfW, position.y + halfH)) {
      const bucket = this.buckets.get(key);
      if (!bucket) continue;
      for (const entry of bucket) {
        if (seen.has(entry)) continue;
        seen.add(entry);
        if (boxesOverlap(position, size, entry.position, entry.size, spacing)) return true;
      }
    }
    return false;
  }

  /** Scans outward from `ideal` and places the node into the first free slot. */
  place(ideal: Point, size: Size, spacing = 28): Point {
    const step = Math.max(size.width, size.height) + spacing;
    if (!this.conflicts(ideal, size, spacing)) {
      const position = { x: Math.round(ideal.x), y: Math.round(ideal.y) };
      this.reserve(position, size);
      return position;
    }
    for (let ring = 1; ring <= MAX_SEARCH_RINGS; ring += 1) {
      const radius = step * 0.9 * Math.sqrt(ring);
      const angle = ring * GOLDEN_ANGLE;
      const candidate = {
        x: ideal.x + radius * Math.cos(angle),
        y: ideal.y + radius * Math.sin(angle),
      };
      if (!this.conflicts(candidate, size, spacing)) {
        const position = { x: Math.round(candidate.x), y: Math.round(candidate.y) };
        this.reserve(position, size);
        return position;
      }
    }
    // Extremely crowded: still step out of the way rather than stacking, so no
    // two nodes are ever drawn in exactly the same place.
    const fallbackRadius = step * 0.9 * Math.sqrt(MAX_SEARCH_RINGS + 1);
    const fallbackAngle = (MAX_SEARCH_RINGS + 1) * GOLDEN_ANGLE;
    const position = {
      x: Math.round(ideal.x + fallbackRadius * Math.cos(fallbackAngle)),
      y: Math.round(ideal.y + fallbackRadius * Math.sin(fallbackAngle)),
    };
    this.reserve(position, size);
    return position;
  }
}

/** Builds a placement index pre-loaded with the nodes that must not move. */
export function createPlacementGrid(occupied: Placement[] = []): PlacementGrid {
  const grid = new PlacementGrid();
  for (const entry of occupied) grid.reserve(entry.position, entry.size);
  return grid;
}

/** Finds a nearby free slot without moving any existing node. */
export function findAvailablePosition(
  ideal: Point,
  occupied: Placement[],
  size: Size,
  spacing = 28,
): Point {
  const grid = createPlacementGrid(occupied);
  const step = Math.max(size.width, size.height) + spacing;
  if (!grid.conflicts(ideal, size, spacing)) {
    return { x: Math.round(ideal.x), y: Math.round(ideal.y) };
  }
  for (let ring = 1; ring <= MAX_SEARCH_RINGS; ring += 1) {
    const radius = step * 0.9 * Math.sqrt(ring);
    const angle = ring * GOLDEN_ANGLE;
    const candidate = {
      x: ideal.x + radius * Math.cos(angle),
      y: ideal.y + radius * Math.sin(angle),
    };
    if (!grid.conflicts(candidate, size, spacing)) {
      return { x: Math.round(candidate.x), y: Math.round(candidate.y) };
    }
  }
  const fallbackRadius = step * 0.9 * Math.sqrt(MAX_SEARCH_RINGS + 1);
  const fallbackAngle = (MAX_SEARCH_RINGS + 1) * GOLDEN_ANGLE;
  return {
    x: Math.round(ideal.x + fallbackRadius * Math.cos(fallbackAngle)),
    y: Math.round(ideal.y + fallbackRadius * Math.sin(fallbackAngle)),
  };
}
