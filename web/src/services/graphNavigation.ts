import { MeshNodeData } from '../types';

/**
 * MindMesh node interaction intentionally uses two normal taps instead of a
 * double-tap gesture or a separate "jump to node" control:
 *
 *  - First tap on a node focuses the camera on it (navigation only).
 *  - Second tap on the already-focused node opens its existing options/details.
 *  - Tapping a different node moves the focus instead of opening the previous one.
 *
 * Drag gestures never reach this helper; the graph surfaces suppress the click
 * after a manual node move so a drag can never open a node's options.
 */
export type NodeTapAction = 'focus' | 'open';

export function resolveNodeTap(
  selectedNodeId: string | null | undefined,
  nodeId: string,
): NodeTapAction {
  return selectedNodeId === nodeId ? 'open' : 'focus';
}

const FOCUS_ZOOM: Record<MeshNodeData['type'], number> = {
  root: 1,
  category: 1.05,
  reminder: 1.3,
  subtask: 1.55,
};

/** A comfortable zoom level for viewing a focused node without over-zooming. */
export function focusZoomForNodeType(type: string): number {
  return FOCUS_ZOOM[type as MeshNodeData['type']] ?? 1.2;
}

/** Movement beyond this many world units counts as a drag, not a tap. */
export const DRAG_TAP_THRESHOLD = 4;

/**
 * Distinguishes a real node drag from a tap that barely moved, so releasing a
 * dragged node can never be treated as a navigation/focus tap.
 */
export function didNodeDrag(
  before: { x: number; y: number },
  after: { x: number; y: number },
  threshold = DRAG_TAP_THRESHOLD,
): boolean {
  return Math.hypot(after.x - before.x, after.y - before.y) > threshold;
}

/**
 * XYFlow stores each node's top-left corner. The camera should centre the node
 * itself, so the measured size is folded back in when it is available.
 */
export function nodeCentre(
  position: { x: number; y: number },
  size?: { width?: number; height?: number },
): { x: number; y: number } {
  return {
    x: position.x + (size?.width ?? 0) / 2,
    y: position.y + (size?.height ?? 0) / 2,
  };
}
