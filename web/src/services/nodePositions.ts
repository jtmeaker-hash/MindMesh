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

/** Finds a nearby free slot without moving any existing node. */
export function findAvailablePosition(
  ideal: Point,
  occupied: Array<{ position: Point; size: Size }>,
  size: Size,
  spacing = 28,
): Point {
  const overlaps = (candidate: Point) => occupied.some(({ position: other, size: otherSize }) =>
    Math.abs(candidate.x - other.x) < (size.width + otherSize.width) / 2 + spacing &&
    Math.abs(candidate.y - other.y) < (size.height + otherSize.height) / 2 + spacing
  );
  if (!overlaps(ideal)) return { x: Math.round(ideal.x), y: Math.round(ideal.y) };

  for (let radius = 1; radius <= 12; radius += 1) {
    const step = Math.max(size.width, size.height) + spacing;
    const candidates: Point[] = [];
    for (let side = -radius; side <= radius; side += 1) {
      candidates.push({ x: ideal.x + side * step, y: ideal.y - radius * step });
      candidates.push({ x: ideal.x + side * step, y: ideal.y + radius * step });
      if (side !== -radius && side !== radius) {
        candidates.push({ x: ideal.x - radius * step, y: ideal.y + side * step });
        candidates.push({ x: ideal.x + radius * step, y: ideal.y + side * step });
      }
    }
    const free = candidates.find((candidate) => !overlaps(candidate));
    if (free) return { x: Math.round(free.x), y: Math.round(free.y) };
  }
  return { x: Math.round(ideal.x), y: Math.round(ideal.y) };
}
