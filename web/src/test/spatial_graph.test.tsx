import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { getDefaultAppearance } from '../services/appearance';
import { resolveNodeTap } from '../services/graphNavigation';
import {
  cameraTransitionDuration,
  clampSpatialCamera,
  dollyCamera,
  frameBranchCamera,
  frameOverviewCamera,
  graphBoundsFromPoints,
  isRestorableCamera,
  orbitCamera,
  panCamera,
  projectSpatialPoint,
  resolveCameraLimits,
  resolveSecondaryNodeVisibility,
  resetSpatialCameraMemory,
  SpatialGraph,
  SpatialCamera,
  unprojectSpatialPoint,
} from '../components/graph/SpatialGraph';
import { AppearanceSettings, MeshNodeData } from '../types';
import { Edge, Node, ReactFlowProvider } from '@xyflow/react';
import { useState } from 'react';

const camera = (overrides: Partial<SpatialCamera> = {}): SpatialCamera => ({
  target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 1200, ...overrides,
});

const root: Node<MeshNodeData> = {
  id: 'root', type: 'rootNode', position: { x: 0, y: 0 }, data: {
    id: 'root', label: 'MindMesh', type: 'root', count: 1,
  },
};

const category: Node<MeshNodeData> = {
  id: 'cat-1', type: 'categoryNode', position: { x: 200, y: 0 }, data: {
    id: 'cat-1', label: 'Work', type: 'category',
  },
};

const reminder: Node<MeshNodeData> = {
  id: 'rem-1', type: 'reminderNode', position: { x: 420, y: 0 }, data: {
    id: 'rem-1', label: 'Rego Reminder', type: 'reminder',
  },
};

const subtask: Node<MeshNodeData> = {
  id: 'sub-1', type: 'subtaskNode', position: { x: 540, y: 0 }, data: {
    id: 'sub-1', label: 'Pay rego', type: 'subtask', reminderId: 'rem-1',
  },
};

const edges: Edge[] = [
  { id: 'e-root-cat', source: 'root', target: 'cat-1' },
  { id: 'e-cat-rem', source: 'cat-1', target: 'rem-1' },
  { id: 'e-rem-sub', source: 'rem-1', target: 'sub-1' },
];

const mesh: Node<MeshNodeData>[] = [root, category, reminder, subtask];

/** jsdom reports a 0x0 rect; real graph behaviour needs a real viewport. */
function withViewport(width: number, height: number) {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    () => ({ width, height, left: 0, top: 0, right: width, bottom: height, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect,
  );
}

function renderGraph(options: {
  nodes?: Node<MeshNodeData>[];
  edges?: Edge[];
  appearance?: AppearanceSettings;
  onNodePositionChange?: (nodeId: string, x: number, y: number) => void;
  onEmptyClick?: () => void;
  focusNodeId?: string | null;
  selectedNodeId?: string | null;
  surfaceKey?: string;
} = {}) {
  return render(
    <ReactFlowProvider>
      <SpatialGraph
        nodes={options.nodes ?? [root]}
        edges={options.edges ?? []}
        appearance={options.appearance ?? getDefaultAppearance()}
        onEmptyClick={options.onEmptyClick ?? vi.fn()}
        onNodePositionChange={options.onNodePositionChange}
        focusNodeId={options.focusNodeId}
        selectedNodeId={options.selectedNodeId}
        surfaceKey={options.surfaceKey}
      />
    </ReactFlowProvider>
  );
}

const attr = (element: HTMLElement, name: string) => Number(element.getAttribute(name));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The on-screen scale the graph applies to a node's fixed world-space box. The
 * node is never resized to compensate for the camera, so this number is the
 * projected perspective size of a constant-size object.
 */
function nodeScale(container: HTMLElement, nodeId: string): number {
  const element = container.querySelector(`[data-node-id="${nodeId}"]`) as HTMLElement | null;
  if (!element) return Number.NaN;
  const match = /scale\(\s*([-\d.]+)\s*\)/.exec(element.style.transform);
  return match ? Number(match[1]) : Number.NaN;
}

const relativeDifference = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

/** Drags across the empty graph with one finger (touch). */
function touchDrag(element: HTMLElement, options: { from?: [number, number]; to?: [number, number]; id?: number } = {}) {
  const [fromX, fromY] = options.from ?? [100, 100];
  const [toX, toY] = options.to ?? [190, 60];
  const pointerId = options.id ?? 1;
  fireEvent.pointerDown(element, { pointerId, pointerType: 'touch', button: 0, clientX: fromX, clientY: fromY });
  fireEvent.pointerMove(element, { pointerId, pointerType: 'touch', buttons: 1, clientX: toX, clientY: toY });
  fireEvent.pointerUp(element, { pointerId, pointerType: 'touch', clientX: toX, clientY: toY });
}

function tapGraph(element: HTMLElement, pointerId: number, x = 120, y = 120) {
  fireEvent.pointerDown(element, { pointerId, pointerType: 'touch', button: 0, clientX: x, clientY: y });
  fireEvent.pointerUp(element, { pointerId, pointerType: 'touch', clientX: x, clientY: y });
}

beforeEach(() => {
  resetSpatialCameraMemory();
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetSpatialCameraMemory();
});

// ============================================================================
// Pure camera maths
// ============================================================================

describe('camera safety limits', () => {
  it('keeps arbitrary pan targets and allows almost full vertical orbit', () => {
    const result = clampSpatialCamera(camera({ target: { x: 9000, y: -8000, z: 2400 }, yaw: Math.PI * 8, pitch: Math.PI / 2, distance: 40 }));
    expect(result.target).toEqual({ x: 9000, y: -8000, z: 2400 });
    expect(result.yaw).toBe(Math.PI * 8);
    expect(result.pitch).toBeLessThan(Math.PI / 2);
    expect(result.distance).toBe(90);
  });

  it('never imposes an artificial world box on the camera target', () => {
    const far = clampSpatialCamera(camera({ target: { x: 250_000, y: -180_000, z: 42_000 } }));
    expect(far.target).toEqual({ x: 250_000, y: -180_000, z: 42_000 });
  });
});

describe('dynamic graph bounds', () => {
  it('falls back to a sane volume for an empty graph', () => {
    expect(graphBoundsFromPoints([])).toEqual({ centre: { x: 0, y: 0, z: 0 }, radius: 520, span: 520 });
  });

  it('grows with the real spread of the nodes', () => {
    const small = graphBoundsFromPoints([{ x: 0, y: 0, z: 0 }, { x: 200, y: 0, z: 0 }]);
    const large = graphBoundsFromPoints([{ x: 0, y: 0, z: 0 }, { x: 40_000, y: -20_000, z: 800 }]);
    expect(large.span).toBeGreaterThan(small.span * 50);
    expect(small.centre.x).toBe(100);
    expect(large.radius).toBeGreaterThan(20_000);
  });
});

describe('dynamic camera distance limits', () => {
  it('adapts the minimum distance to the focused node size', () => {
    const bounds = graphBoundsFromPoints([{ x: 0, y: 0, z: 0 }]);
    expect(resolveCameraLimits('subtask', bounds).min).toBeLessThan(resolveCameraLimits('reminder', bounds).min);
    // A reminder is 165x100 world units, so the camera can never clip through it.
    expect(resolveCameraLimits('reminder', bounds).min).toBeGreaterThanOrEqual(130);
  });

  it('gives a large database far more zoom range than a small one', () => {
    const tiny = resolveCameraLimits(null, graphBoundsFromPoints([{ x: 0, y: 0, z: 0 }, { x: 600, y: 0, z: 0 }]));
    const huge = resolveCameraLimits(null, graphBoundsFromPoints([{ x: 0, y: 0, z: 0 }, { x: 90_000, y: 0, z: 0 }]));
    expect(tiny.max).toBeLessThan(huge.max);
    // Zooming out far enough to declutter must stay possible on big graphs.
    expect(huge.max).toBeGreaterThan(9_000);
  });
});

describe('camera gesture maths', () => {
  it('orbits without moving the focus point or the zoom', () => {
    const before = camera({ target: { x: 120, y: -40, z: 10 }, distance: 800 });
    const after = orbitCamera(before, 90, -40, { sensitivity: 1, invertX: false, invertY: false });
    expect(after.yaw).toBeCloseTo(90 * 0.006, 6);
    expect(after.pitch).toBeCloseTo(-40 * 0.006, 6);
    expect(after.target).toEqual(before.target);
    expect(after.distance).toBe(800);
  });

  it('honours inverted orbit axes independently', () => {
    const base = camera();
    expect(orbitCamera(base, 100, 0, { sensitivity: 1, invertX: true, invertY: false }).yaw).toBeLessThan(0);
    expect(orbitCamera(base, 0, 100, { sensitivity: 1, invertX: false, invertY: true }).pitch).toBeLessThan(0);
  });

  it('pans along the camera basis so a rotated graph still follows the finger', () => {
    const flat = panCamera(camera({ yaw: 0, pitch: 0 }), 100, 0, 1000);
    expect(flat.target.x).toBeLessThan(0);
    expect(flat.target.z).toBeCloseTo(0, 6);

    // Once the camera is yawed, a horizontal pan moves through x *and* z.
    const yawed = panCamera(camera({ yaw: Math.PI / 2, pitch: 0 }), 100, 0, 1000);
    expect(Math.abs(yawed.target.x)).toBeLessThan(1e-6);
    expect(Math.abs(yawed.target.z)).toBeGreaterThan(1);

    // Vertical panning keeps moving the world up/down on screen.
    const vertical = panCamera(camera({ yaw: 0.4, pitch: 0.3 }), 0, 100, 1000);
    expect(vertical.target.y).toBeLessThan(0);
  });

  it('scales zoom with the current distance so close inspection stays precise', () => {
    expect(dollyCamera(camera({ distance: 1200 }), 0.5).distance).toBe(600);
    expect(dollyCamera(camera({ distance: 12_000 }), 0.5).distance).toBe(6_000);
  });
});

describe('animated camera transitions', () => {
  const options = { animationIntensity: 0.8, reducedMotion: false };

  it('skips travel entirely for reduced motion', () => {
    expect(cameraTransitionDuration(camera(), camera({ distance: 200 }), { ...options, reducedMotion: true })).toBe(0);
    expect(cameraTransitionDuration(camera(), camera({ distance: 200 }), { ...options, animationIntensity: 0 })).toBe(0);
  });

  it('takes longer for distant nodes but always stays between 140 ms and 700 ms', () => {
    const near = cameraTransitionDuration(camera({ target: { x: 0, y: 0, z: 0 } }), camera({ target: { x: 120, y: 0, z: 0 } }), options);
    const far = cameraTransitionDuration(camera({ target: { x: 0, y: 0, z: 0 } }), camera({ target: { x: 40_000, y: 0, z: 0 }, distance: 5000 }), options);
    expect(near).toBeGreaterThanOrEqual(140);
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThanOrEqual(700);
  });
});

describe('smart node framing', () => {
  const viewport = { width: 900, height: 700 };
  const limits = { min: 90, max: 160_000 };
  const base = camera({ distance: 1200 });

  it('centres the node while keeping the branch in view', () => {
    const anchor = { x: 420, y: 0, z: 235 };
    const framed = frameBranchCamera(base, anchor, [anchor], 'reminder', viewport, 700, limits);
    expect(framed.target.x).toBeCloseTo(anchor.x, 6);
    expect(framed.target.z).toBeCloseTo(anchor.z, 6);
    // The bottom HUD band is accounted for by lifting the focus point.
    expect(framed.target.y).toBeGreaterThan(anchor.y);
  });

  it('frames a reminder together with its subtasks instead of zooming in tight', () => {
    const anchor = { x: 420, y: 0, z: 235 };
    const alone = frameBranchCamera(base, anchor, [anchor], 'reminder', viewport, 700, limits);
    const withSubtasks = frameBranchCamera(
      base,
      anchor,
      [anchor, { x: 620, y: 120, z: 350 }, { x: 620, y: -120, z: 350 }],
      'reminder',
      viewport,
      700,
      limits,
    );
    expect(withSubtasks.distance).toBeGreaterThan(alone.distance);
  });

  it('frames the root node as the broadest overview', () => {
    const bounds = graphBoundsFromPoints([
      { x: 0, y: 0, z: 0 },
      { x: 540, y: 0, z: 410 },
    ]);
    const overview = frameOverviewCamera(bounds, viewport, 700, limits);
    const single = frameBranchCamera(base, { x: 540, y: 0, z: 410 }, [{ x: 540, y: 0, z: 410 }], 'subtask', viewport, 700, limits);
    expect(overview.distance).toBeGreaterThan(single.distance);
  });

  it('never returns a distance outside the dynamic limits', () => {
    const tight = { min: 400, max: 500 };
    const framed = frameBranchCamera(base, { x: 0, y: 0, z: 0 }, [], 'root', viewport, 700, tight);
    expect(framed.distance).toBeGreaterThanOrEqual(400);
    expect(framed.distance).toBeLessThanOrEqual(500);
  });
});

describe('session camera memory', () => {
  const bounds = graphBoundsFromPoints([{ x: 0, y: 0, z: 0 }, { x: 400, y: 0, z: 0 }]);
  const points = new Map<string, { x: number; y: number; z: number }>([
    ['root', { x: 0, y: 0, z: 0 }],
    ['cat-1', { x: 400, y: 0, z: 105 }],
  ]);

  it('reuses a view whose focused node still exists', () => {
    expect(isRestorableCamera({ camera: camera({ target: { x: 400, y: 0, z: 105 } }), focusedNodeId: 'cat-1' }, points, bounds)).toBe(true);
  });

  it('rejects a view focused on a node that was deleted', () => {
    expect(isRestorableCamera({ camera: camera({ target: { x: 400, y: 0, z: 105 } }), focusedNodeId: 'gone' }, points, bounds)).toBe(false);
  });

  it('rejects an unfocused view left behind in empty space', () => {
    expect(isRestorableCamera({ camera: camera({ target: { x: 90_000, y: 0, z: 0 } }), focusedNodeId: null }, points, bounds)).toBe(false);
    expect(isRestorableCamera({ camera: camera({ target: { x: 120, y: 30, z: 0 } }), focusedNodeId: null }, points, bounds)).toBe(true);
  });
});

describe('screen-to-world node dragging', () => {
  it('unprojects a screen point back onto its own world plane', () => {
    const cam = camera({ yaw: 0.7, pitch: 0.35, distance: 1400, target: { x: 120, y: -60, z: 40 } });
    const point = { x: 500, y: -220, z: 90 };
    const width = 800;
    const height = 600;
    const f = 700;

    const projected = projectSpatialPoint(point, cam, width, height, f);
    const back = unprojectSpatialPoint(projected.screenX, projected.screenY, point.z, cam, width, height, f);

    expect(back).not.toBeNull();
    expect(back!.x).toBeCloseTo(point.x, 3);
    expect(back!.y).toBeCloseTo(point.y, 3);
  });

  it('keeps world coordinates unchanged while the camera zooms the same screen point', () => {
    const width = 900;
    const height = 700;
    const f = 650;
    const worldZ = 120;
    const near = camera({ distance: 900, target: { x: 50, y: 20, z: 0 } });
    const far = camera({ distance: 2600, target: { x: 50, y: 20, z: 0 } });
    const a = unprojectSpatialPoint(500, 350, worldZ, near, width, height, f);
    const b = unprojectSpatialPoint(500, 350, worldZ, far, width, height, f);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a!.x - b!.x)).toBeGreaterThan(1);
  });
});

// ============================================================================
// World-space node size (the camera moves, the nodes do not)
// ============================================================================

describe('fixed world-space node scaling', () => {
  it('draws a node at its true projected size: closer looks larger, further looks smaller', async () => {
    withViewport(900, 700);
    const { getByTestId, container } = renderGraph({ nodes: [root], edges: [], surfaceKey: 'world-size' });
    const graph = getByTestId('spatial-graph');

    // Wait for the opening fit to replace the pre-measurement default camera.
    await waitFor(() => expect(attr(graph, 'data-camera-distance')).not.toBe(1180));
    const framed = { scale: nodeScale(container, 'root'), distance: attr(graph, 'data-camera-distance') };
    expect(framed.scale).toBeGreaterThan(0);

    // Pull the camera back: the node keeps its size in graph space, so it must
    // cover less of the screen.
    fireEvent.wheel(graph, { deltaY: 800 });
    await waitFor(() => expect(nodeScale(container, 'root')).toBeLessThan(framed.scale));
    const far = { scale: nodeScale(container, 'root'), distance: attr(graph, 'data-camera-distance') };

    // A fixed world size means on-screen size is exactly focal / distance, so a
    // camera 3x further away renders the node 3x smaller. Any inverse camera
    // scaling would break this relationship.
    expect(relativeDifference(framed.distance / far.distance, far.scale / framed.scale)).toBeLessThan(0.02);

    // Move back in: the node visibly grows again.
    fireEvent.wheel(graph, { deltaY: -400 });
    await waitFor(() => expect(nodeScale(container, 'root')).toBeGreaterThan(far.scale * 1.5));
  });

  it('never caps a node to a constant screen size as the camera moves in close', async () => {
    withViewport(900, 700);
    const { getByTestId, container } = renderGraph({ nodes: [root], edges: [], surfaceKey: 'no-screen-size-cap' });
    const graph = getByTestId('spatial-graph');
    await waitFor(() => expect(attr(graph, 'data-camera-distance')).not.toBe(1180));

    const framed = nodeScale(container, 'root');
    fireEvent.wheel(graph, { deltaY: -600 });
    await waitFor(() => expect(nodeScale(container, 'root')).toBeGreaterThan(framed));
    const mid = nodeScale(container, 'root');

    fireEvent.wheel(graph, { deltaY: -900 });
    await waitFor(() => expect(nodeScale(container, 'root')).toBeGreaterThan(mid));

    // A zoom-compensated node would stop growing at its constant-screen-size
    // ceiling; a real one keeps filling the view as the camera arrives.
    expect(nodeScale(container, 'root')).toBeGreaterThan(2);
    expect(attr(graph, 'data-camera-distance')).toBeGreaterThanOrEqual(attr(graph, 'data-camera-min-distance'));
  });

  it('culls a node that is behind the camera instead of projecting it as a smear', () => {
    const cam = camera({ distance: 400, yaw: 0, pitch: 0 });
    const width = 900;
    const height = 700;
    const focal = 700;

    // 400 units of camera distance plus 200 units of travel toward the lens.
    const inFront = projectSpatialPoint({ x: 0, y: 0, z: -200 }, cam, width, height, focal);
    expect(inFront.visible).toBe(true);
    expect(inFront.scale).toBeCloseTo(focal / 600, 6);

    const behind = projectSpatialPoint({ x: 0, y: 0, z: 900 }, cam, width, height, focal);
    expect(behind.visible).toBe(false);
    // Culled nodes still report finite numbers so nothing downstream is NaN.
    expect(Number.isFinite(behind.scale)).toBe(true);
    expect(Number.isFinite(behind.screenX)).toBe(true);
    expect(Number.isFinite(behind.screenY)).toBe(true);
  });
});

// ============================================================================
// Touch camera behaviour
// ============================================================================

describe('Android-first touch camera', () => {
  it('orbits the network on a one-finger drag instead of panning or selecting', async () => {
    const onNodePositionChange = vi.fn();
    const { getByTestId } = renderGraph({ nodes: mesh, edges, onNodePositionChange });
    const graph = getByTestId('spatial-graph');
    const targetBefore = attr(graph, 'data-camera-target-x');

    touchDrag(graph, { from: [100, 100], to: [190, 60] });

    await waitFor(() => expect(attr(graph, 'data-camera-yaw')).toBeGreaterThan(0.3));
    expect(attr(graph, 'data-camera-pitch')).toBeLessThan(-0.1);
    // Orbiting must never translate the focus point or touch node data.
    expect(attr(graph, 'data-camera-target-x')).toBeCloseTo(targetBefore, 3);
    expect(onNodePositionChange).not.toHaveBeenCalled();
  });

  it('pinch-zooms around the current focus and two fingers pan through the graph', async () => {
    const { getByTestId } = renderGraph({ nodes: mesh, edges });
    const graph = getByTestId('spatial-graph');
    const distanceBefore = attr(graph, 'data-camera-distance');
    const targetBefore = attr(graph, 'data-camera-target-x');

    fireEvent.pointerDown(graph, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(graph, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(graph, { pointerId: 2, pointerType: 'touch', buttons: 1, clientX: 300, clientY: 140 });
    fireEvent.pointerUp(graph, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerUp(graph, { pointerId: 2, pointerType: 'touch', clientX: 300, clientY: 140 });

    await waitFor(() => expect(attr(graph, 'data-camera-distance')).toBeLessThan(distanceBefore * 0.75));
    // Two fingers also translate the focus, in all three axes when the camera is pitched.
    expect(attr(graph, 'data-camera-target-x')).not.toBeCloseTo(targetBefore, 3);
    expect(attr(graph, 'data-camera-target-y')).not.toBe(0);
    // ...and never orbit.
    expect(attr(graph, 'data-camera-yaw')).toBe(0);
  });

  it('can be configured to pan on one finger instead of orbiting', async () => {
    const appearance = getDefaultAppearance();
    const panned = { ...appearance, threeD: { ...appearance.threeD, graphRotation: false } };
    const { getByTestId } = renderGraph({ nodes: mesh, edges, appearance: panned });
    const graph = getByTestId('spatial-graph');

    touchDrag(graph, { from: [100, 100], to: [200, 140] });

    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).not.toBe(0));
    expect(attr(graph, 'data-camera-yaw')).toBe(0);
  });

  it('glides to a stop after release instead of sliding away', async () => {
    const appearance = getDefaultAppearance();
    const panned = { ...appearance, threeD: { ...appearance.threeD, graphRotation: false } };
    const { getByTestId } = renderGraph({ nodes: mesh, edges, appearance: panned });
    const graph = getByTestId('spatial-graph');

    fireEvent.pointerDown(graph, { pointerId: 9, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(graph, { pointerId: 9, pointerType: 'touch', buttons: 1, clientX: 300, clientY: 100 });
    fireEvent.pointerUp(graph, { pointerId: 9, pointerType: 'touch', clientX: 300, clientY: 100 });

    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).not.toBe(0));
    const afterRelease = attr(graph, 'data-camera-target-x');
    await sleep(500);
    const settled = attr(graph, 'data-camera-target-x');
    // Momentum is light and capped relative to the gesture, never a runaway slide.
    expect(Math.abs(settled - afterRelease)).toBeLessThan(300);
    await sleep(250);
    expect(attr(graph, 'data-camera-target-x')).toBe(settled);
    expect(graph.getAttribute('data-interaction-mode')).toBe('IDLE');
  });

  it('has no momentum at all when inertia is off or motion is reduced', async () => {
    const appearance = getDefaultAppearance();
    const still = {
      ...appearance,
      threeD: { ...appearance.threeD, graphRotation: false, cameraInertia: 0 },
    };
    const { getByTestId } = renderGraph({ nodes: mesh, edges, appearance: still });
    const graph = getByTestId('spatial-graph');

    fireEvent.pointerDown(graph, { pointerId: 4, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(graph, { pointerId: 4, pointerType: 'touch', buttons: 1, clientX: 320, clientY: 100 });
    fireEvent.pointerUp(graph, { pointerId: 4, pointerType: 'touch', clientX: 320, clientY: 100 });

    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).not.toBe(0));
    const afterRelease = attr(graph, 'data-camera-target-x');
    await sleep(300);
    expect(attr(graph, 'data-camera-target-x')).toBe(afterRelease);
  });

  it('keeps the wheel zoom inside the dynamic range of the current graph', async () => {
    const { getByTestId } = renderGraph({ nodes: [root], edges: [] });
    const graph = getByTestId('spatial-graph');
    const max = attr(graph, 'data-camera-max-distance');

    fireEvent.wheel(graph, { deltaY: 40_000 });
    await waitFor(() => expect(attr(graph, 'data-camera-distance')).toBeGreaterThan(1000));
    expect(attr(graph, 'data-camera-distance')).toBeLessThanOrEqual(max);
  });

  it('recentres on a double tap of empty space', async () => {
    const appearance = getDefaultAppearance();
    const panned = { ...appearance, threeD: { ...appearance.threeD, graphRotation: false } };
    const { getByTestId } = renderGraph({ nodes: mesh, edges, appearance: panned });
    const graph = getByTestId('spatial-graph');

    touchDrag(graph, { from: [100, 100], to: [240, 100], id: 5 });
    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).not.toBe(0));

    tapGraph(graph, 6);
    tapGraph(graph, 7);

    // Bounds centre of the mesh: root at 0 and subtask at 540.
    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).toBeCloseTo(270, 1), { timeout: 3000 });
  });

  it('returns Home to the overview of the whole graph', async () => {
    const { getByTestId, getByLabelText } = renderGraph({ nodes: mesh, edges, focusNodeId: 'sub-1' });
    const graph = getByTestId('spatial-graph');

    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).toBeCloseTo(540, 1), { timeout: 3000 });
    fireEvent.click(getByLabelText(/^Home/));
    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).toBeCloseTo(270, 1), { timeout: 3000 });
    expect(attr(graph, 'data-camera-yaw')).toBe(0);
  });

  it('keeps a node press clickable by not stealing pointer capture from it', () => {
    // Capturing on the canvas retargets the pointer sequence in real browsers,
    // which would move the tap's click off the node and break tap-to-focus.
    const capture = vi.fn();
    (HTMLElement.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture = capture;
    try {
      const { getByTestId, container } = renderGraph({ nodes: mesh, edges });
      const graph = getByTestId('spatial-graph');
      const node = container.querySelector('[data-node-id="rem-1"]') as HTMLElement;

      fireEvent.pointerDown(node, { pointerId: 71, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
      expect(capture).not.toHaveBeenCalled();
      fireEvent.pointerUp(node, { pointerId: 71, pointerType: 'touch', clientX: 100, clientY: 100 });

      // Background drags are still captured so they survive leaving the canvas.
      fireEvent.pointerDown(graph, { pointerId: 72, pointerType: 'touch', button: 0, clientX: 300, clientY: 300 });
      expect(capture).toHaveBeenCalledWith(72);
      fireEvent.pointerUp(graph, { pointerId: 72, pointerType: 'touch', clientX: 300, clientY: 300 });
    } finally {
      delete (HTMLElement.prototype as unknown as { setPointerCapture?: unknown }).setPointerCapture;
    }
  });

  it('leaves every touch gesture incapable of moving node coordinates', async () => {
    const onNodePositionChange = vi.fn();
    const { getByTestId } = renderGraph({ nodes: mesh, edges, onNodePositionChange });
    const graph = getByTestId('spatial-graph');

    touchDrag(graph, { from: [300, 300], to: [420, 260], id: 11 });
    fireEvent.pointerDown(graph, { pointerId: 12, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(graph, { pointerId: 13, pointerType: 'touch', button: 0, clientX: 200, clientY: 160 });
    fireEvent.pointerMove(graph, { pointerId: 13, pointerType: 'touch', buttons: 1, clientX: 260, clientY: 220 });
    fireEvent.pointerUp(graph, { pointerId: 12, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerUp(graph, { pointerId: 13, pointerType: 'touch', clientX: 260, clientY: 220 });

    await sleep(120);
    expect(onNodePositionChange).not.toHaveBeenCalled();
  });
});

// ============================================================================
// Node focus navigation
// ============================================================================

function FocusHarness({ nodes, edges }: { nodes: Node<MeshNodeData>[]; edges: Edge[] }) {
  const [focus, setFocus] = useState<string | null>(null);
  const [opened, setOpened] = useState<string[]>([]);
  const withClicks = nodes.map((node) => ({
    ...node,
    data: {
      ...node.data,
      onNodeClick: (nodeId: string) => {
        // Mirrors App.tsx: first tap focuses, second tap opens the node.
        if (resolveNodeTap(focus, nodeId) === 'open') {
          setOpened((previous) => [...previous, nodeId]);
          return;
        }
        setFocus(nodeId);
      },
    },
  }));
  return (
    <ReactFlowProvider>
      <SpatialGraph
        nodes={withClicks}
        edges={edges}
        appearance={getDefaultAppearance()}
        focusNodeId={focus}
        selectedNodeId={focus}
        surfaceKey={`harness-${opened.length}`}
      />
      <span data-testid="focused">{focus ?? ''}</span>
      <span data-testid="opened">{opened.join(',')}</span>
    </ReactFlowProvider>
  );
}

describe('two-tap node navigation', () => {
  it('flies the camera to a node on the first tap and opens options on the second', async () => {
    const { getByTestId, container } = render(<FocusHarness nodes={[root, reminder, subtask]} edges={[edges[2]]} />);
    const graph = getByTestId('spatial-graph');
    const node = () => container.querySelector('[data-node-id="rem-1"]') as HTMLElement;

    fireEvent.click(node());
    await waitFor(() => expect(getByTestId('focused').textContent).toBe('rem-1'));
    // The camera travels and settles on the node instead of teleporting there.
    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).toBeCloseTo(420, 1), { timeout: 3000 });
    expect(getByTestId('opened').textContent).toBe('');
    expect(graph.getAttribute('data-focused-node-id')).toBe('rem-1');

    fireEvent.click(node());
    await waitFor(() => expect(getByTestId('opened').textContent).toBe('rem-1'));
  });

  it('makes the focused node visibly larger as the camera travels to it', async () => {
    withViewport(900, 700);
    const { getByTestId, container } = render(<FocusHarness nodes={[root, reminder, subtask]} edges={[edges[2]]} />);
    const graph = getByTestId('spatial-graph');
    await waitFor(() => expect(attr(graph, 'data-camera-distance')).not.toBe(1180));
    const before = nodeScale(container, 'rem-1');

    fireEvent.click(container.querySelector('[data-node-id="rem-1"]') as HTMLElement);
    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).toBeCloseTo(420, 1), { timeout: 3000 });

    // Arriving at the node grows it on screen, and the camera stops at a
    // viewing distance instead of travelling through it.
    expect(nodeScale(container, 'rem-1')).toBeGreaterThan(before);
    expect(attr(graph, 'data-camera-distance')).toBeGreaterThanOrEqual(attr(graph, 'data-camera-min-distance'));
  });

  it('never opens options for a different node that was only focused', async () => {
    const { getByTestId, container } = render(<FocusHarness nodes={[root, reminder, subtask]} edges={[edges[2]]} />);
    const node = (id: string) => container.querySelector(`[data-node-id="${id}"]`) as HTMLElement;

    fireEvent.click(node('rem-1'));
    await waitFor(() => expect(getByTestId('focused').textContent).toBe('rem-1'));
    fireEvent.click(node('sub-1'));
    await waitFor(() => expect(getByTestId('focused').textContent).toBe('sub-1'));
    expect(getByTestId('opened').textContent).toBe('');
    expect(getByTestId('opened').textContent).not.toContain('rem-1');
  });

  it('hands control back to the user when a gesture interrupts a camera flight', async () => {
    const { getByTestId, container } = render(<FocusHarness nodes={[root, reminder]} edges={[]} />);
    const graph = getByTestId('spatial-graph');
    void container;

    fireEvent.click(container.querySelector('[data-node-id="rem-1"]') as HTMLElement);
    // Interrupt the travel immediately with a touch drag.
    touchDrag(graph, { from: [100, 100], to: [160, 130], id: 21 });

    await waitFor(() => expect(attr(graph, 'data-camera-yaw')).not.toBe(0));
    await sleep(400);
    // The interrupted flight no longer snaps the end position into place.
    expect(attr(graph, 'data-camera-target-x')).not.toBeCloseTo(420, 1);
  });
});

describe('explicit node repositioning', () => {
  it('orbits the camera — and never moves a node — when a drag starts on a node', async () => {
    const onNodePositionChange = vi.fn();
    const { getByTestId, container } = renderGraph({ nodes: mesh, edges, onNodePositionChange });
    const graph = getByTestId('spatial-graph');
    const node = container.querySelector('[data-node-id="rem-1"]') as HTMLElement;

    fireEvent.pointerDown(node, { pointerId: 8, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(node, { pointerId: 8, pointerType: 'touch', buttons: 1, clientX: 170, clientY: 120 });
    fireEvent.pointerUp(node, { pointerId: 8, pointerType: 'touch', clientX: 170, clientY: 120 });

    await waitFor(() => expect(attr(graph, 'data-camera-yaw')).not.toBe(0));
    expect(onNodePositionChange).not.toHaveBeenCalled();
  });

  it('repositions the node once Move mode is on, without moving the camera', async () => {
    const onNodePositionChange = vi.fn();
    const { getByTestId, getByLabelText, container } = renderGraph({ nodes: mesh, edges, onNodePositionChange });
    const graph = getByTestId('spatial-graph');
    const node = container.querySelector('[data-node-id="rem-1"]') as HTMLElement;

    fireEvent.click(getByLabelText('Toggle node move mode'));
    expect(graph.getAttribute('data-move-mode')).toBe('true');
    const distanceBefore = attr(graph, 'data-camera-distance');

    fireEvent.pointerDown(node, { pointerId: 31, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(node, { pointerId: 31, pointerType: 'touch', buttons: 1, clientX: 160, clientY: 130 });
    fireEvent.pointerUp(node, { pointerId: 31, pointerType: 'touch', clientX: 160, clientY: 130 });

    expect(onNodePositionChange).toHaveBeenCalledTimes(1);
    expect(onNodePositionChange.mock.calls[0][0]).toBe('rem-1');
    // Moving a node is never also a camera gesture.
    expect(attr(graph, 'data-camera-distance')).toBe(distanceBefore);
    expect(attr(graph, 'data-camera-yaw')).toBe(0);
    // The release must not be delivered as a tap/selection.
    fireEvent.click(node);
    expect(onNodePositionChange).toHaveBeenCalledTimes(1);
  });

  it('preserves the grab offset so the node never snaps under the finger', () => {
    const onNodePositionChange = vi.fn();
    const { getByLabelText, container } = renderGraph({ nodes: mesh, edges, onNodePositionChange });
    fireEvent.click(getByLabelText('Toggle node move mode'));
    const node = container.querySelector('[data-node-id="rem-1"]') as HTMLElement;

    // The press starts ~100 px away from the node: only the 8 px of movement may
    // be applied, so the node must stay near its own position (420, 0).
    fireEvent.pointerDown(node, { pointerId: 41, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(node, { pointerId: 41, pointerType: 'touch', buttons: 1, clientX: 108, clientY: 102 });
    fireEvent.pointerUp(node, { pointerId: 41, pointerType: 'touch', clientX: 108, clientY: 102 });

    expect(onNodePositionChange).toHaveBeenCalledTimes(1);
    const [, x, y] = onNodePositionChange.mock.calls[0];
    expect(Math.abs(x - 420)).toBeLessThan(60);
    expect(Math.abs(y)).toBeLessThan(60);
    // ...and the small movement was still applied.
    expect(Math.abs(x - 420) + Math.abs(y)).toBeGreaterThan(1);
  });

  it('treats a touch that never passes the drag threshold as a tap', async () => {
    const onNodePositionChange = vi.fn();
    const onNodeClick = vi.fn();
    const node = { ...reminder, data: { ...reminder.data, onNodeClick } };
    const { getByLabelText, container } = renderGraph({ nodes: [node], edges: [], onNodePositionChange });
    fireEvent.click(getByLabelText('Toggle node move mode'));

    const element = container.querySelector('[data-node-id="rem-1"]') as HTMLElement;
    fireEvent.pointerDown(element, { pointerId: 51, pointerType: 'touch', button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(element, { pointerId: 51, pointerType: 'touch', buttons: 1, clientX: 202, clientY: 201 });
    fireEvent.pointerUp(element, { pointerId: 51, pointerType: 'touch', clientX: 202, clientY: 201 });

    expect(onNodePositionChange).not.toHaveBeenCalled();
    fireEvent.click(element);
    expect(onNodeClick).toHaveBeenCalledWith('rem-1', 'reminder');
  });
});

// ============================================================================
// Camera stability against graph changes
// ============================================================================

describe('camera stability', () => {
  it('does not re-frame the graph when nodes are added or removed', async () => {
    withViewport(900, 700);
    const { getByTestId, rerender } = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={[root, category]} edges={[]} appearance={getDefaultAppearance()} surfaceKey="stability" />
      </ReactFlowProvider>
    );
    const graph = getByTestId('spatial-graph');
    await waitFor(() => expect(graph.getAttribute('data-camera-target-x')).not.toBe('0'));
    const before = {
      x: graph.getAttribute('data-camera-target-x'),
      distance: graph.getAttribute('data-camera-distance'),
      yaw: graph.getAttribute('data-camera-yaw'),
    };

    rerender(
      <ReactFlowProvider>
        <SpatialGraph nodes={[root, category, { ...reminder, position: { x: 480, y: 0 } }]} edges={[]} appearance={getDefaultAppearance()} surfaceKey="stability" />
      </ReactFlowProvider>
    );
    await sleep(80);
    expect(graph.getAttribute('data-camera-target-x')).toBe(before.x);
    expect(graph.getAttribute('data-camera-distance')).toBe(before.distance);
    expect(graph.getAttribute('data-camera-yaw')).toBe(before.yaw);
  });

  it('clears the focus and recentres safely when the focused node is deleted', async () => {
    const { getByTestId, rerender } = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={[root, reminder]} edges={[]} appearance={getDefaultAppearance()} focusNodeId="rem-1" selectedNodeId="rem-1" surfaceKey="deletion" />
      </ReactFlowProvider>
    );
    const graph = getByTestId('spatial-graph');
    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).toBeCloseTo(420, 1), { timeout: 3000 });
    expect(graph.getAttribute('data-focused-node-id')).toBe('rem-1');

    rerender(
      <ReactFlowProvider>
        <SpatialGraph nodes={[root]} edges={[]} appearance={getDefaultAppearance()} focusNodeId="rem-1" selectedNodeId="rem-1" surfaceKey="deletion" />
      </ReactFlowProvider>
    );

    await waitFor(() => expect(graph.getAttribute('data-focused-node-id')).toBe(''));
    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).toBeCloseTo(0, 1), { timeout: 3000 });
    expect(Number.isFinite(attr(graph, 'data-camera-distance'))).toBe(true);
  });

  it('restores the session camera view when the graph surface is reopened', async () => {
    withViewport(900, 700);
    const first = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={mesh} edges={edges} appearance={getDefaultAppearance()} surfaceKey="restore" />
      </ReactFlowProvider>
    );
    const graph = first.getByTestId('spatial-graph');
    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).not.toBe(0));
    touchDrag(graph, { from: [100, 100], to: [200, 140], id: 61 });
    await waitFor(() => expect(attr(graph, 'data-camera-yaw')).not.toBe(0));
    // Let the light glide finish so the snapshot is the settled view.
    await sleep(500);
    const saved = {
      yaw: attr(graph, 'data-camera-yaw'),
      distance: attr(graph, 'data-camera-distance'),
      targetX: attr(graph, 'data-camera-target-x'),
    };
    first.unmount();

    const second = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={mesh} edges={edges} appearance={getDefaultAppearance()} surfaceKey="restore" />
      </ReactFlowProvider>
    );
    const reopened = second.getByTestId('spatial-graph');
    await waitFor(() => expect(attr(reopened, 'data-camera-target-x')).toBeCloseTo(saved.targetX, 3));
    expect(attr(reopened, 'data-camera-yaw')).toBeCloseTo(saved.yaw, 5);
    expect(attr(reopened, 'data-camera-distance')).toBeCloseTo(saved.distance, 3);
    // The restored view is the saved one, not a fresh reset to the top-down default.
    expect(attr(reopened, 'data-camera-yaw')).not.toBe(0);
  });

  it('keeps a deeply nested branch navigable', async () => {
    withViewport(390, 780);
    const chain: Node<MeshNodeData>[] = Array.from({ length: 14 }, (_, index) => ({
      id: `deep-${index}`,
      type: 'subtaskNode',
      position: { x: index * 260, y: index * (index % 2 === 0 ? 180 : -180) },
      data: { id: `deep-${index}`, label: `Step ${index}`, type: 'subtask', reminderId: 'deep-0' },
    }));
    const chainEdges: Edge[] = chain.slice(1).map((node, index) => ({ id: `e-${index}`, source: chain[index].id, target: node.id }));

    const { getByTestId } = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={chain} edges={chainEdges} appearance={getDefaultAppearance()} focusNodeId="deep-13" surfaceKey="deep" />
      </ReactFlowProvider>
    );
    const graph = getByTestId('spatial-graph');

    const last = chain[13].position;
    await waitFor(() => expect(attr(graph, 'data-camera-target-x')).toBeCloseTo(last.x, 1), { timeout: 3000 });
    // Deep nodes are framed within the dynamic range, never clipped through.
    const distance = attr(graph, 'data-camera-distance');
    expect(distance).toBeGreaterThanOrEqual(attr(graph, 'data-camera-min-distance'));
    expect(distance).toBeLessThanOrEqual(attr(graph, 'data-camera-max-distance'));
  });

  it('survives an orientation change without losing the camera or the nodes', async () => {
    type Observer = { callback: () => void; trigger: () => void };
    const observers: Observer[] = [];
    const originalObserver = globalThis.ResizeObserver;
    class TestResizeObserver {
      callback: () => void;
      constructor(callback: () => void) {
        this.callback = callback;
        observers.push({ callback, trigger: () => callback() });
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    globalThis.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;

    try {
      withViewport(390, 780);
      const nodes = [root, category, reminder];
      const { getByTestId, container } = render(
        <ReactFlowProvider>
          <SpatialGraph nodes={nodes} edges={edges} appearance={getDefaultAppearance()} surfaceKey="orientation" />
        </ReactFlowProvider>
      );
      const graph = getByTestId('spatial-graph');
      await waitFor(() => expect(attr(graph, 'data-camera-target-x')).toBeCloseTo(210, 1));
      const before = {
        yaw: graph.getAttribute('data-camera-yaw'),
        distance: graph.getAttribute('data-camera-distance'),
      };

      // Rotate to landscape and let the observer fire.
      withViewport(780, 390);
      await waitFor(() => expect(observers.length).toBeGreaterThan(0));
      observers.forEach((observer) => observer.trigger());
      await sleep(120);

      expect(graph.getAttribute('data-camera-yaw')).toBe(before.yaw);
      expect(attr(graph, 'data-camera-distance')).toBeCloseTo(Number(before.distance), 3);
      expect(Number.isFinite(attr(graph, 'data-camera-target-y'))).toBe(true);
      // Nodes still project into the new viewport.
      expect(container.querySelector('[data-node-id="rem-1"]')).not.toBeNull();
    } finally {
      globalThis.ResizeObserver = originalObserver;
    }
  });

  it('frames a small and a very large graph correctly', async () => {
    withViewport(900, 700);
    const huge: Node<MeshNodeData>[] = Array.from({ length: 120 }, (_, index) => ({
      id: `n-${index}`,
      type: 'reminderNode',
      position: { x: index * 900, y: (index % 7) * 1200 },
      data: { id: `n-${index}`, label: `Node ${index}`, type: 'reminder' },
    }));

    const large = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={huge} edges={[]} appearance={getDefaultAppearance()} surfaceKey="large" />
      </ReactFlowProvider>
    );
    const largeGraph = large.getByTestId('spatial-graph');
    // Wait for the opening fit to replace the pre-measurement default camera.
    await waitFor(() => expect(attr(largeGraph, 'data-camera-distance')).not.toBe(1180));
    const largeDistance = attr(largeGraph, 'data-camera-distance');
    expect(attr(largeGraph, 'data-camera-max-distance')).toBeGreaterThan(largeDistance);
    large.unmount();

    const small = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={[root]} edges={[]} appearance={getDefaultAppearance()} surfaceKey="small" />
      </ReactFlowProvider>
    );
    const smallGraph = small.getByTestId('spatial-graph');
    await waitFor(() => expect(attr(smallGraph, 'data-camera-distance')).not.toBe(1180));
    // A big database needs much more zoom range than a single node.
    expect(largeDistance).toBeGreaterThan(attr(smallGraph, 'data-camera-distance'));
  });
});

// ============================================================================
// Hints and controls
// ============================================================================

describe('on-canvas gesture guide', () => {
  it('teaches the camera controls on first run', () => {
    const { getByTestId } = renderGraph();
    const legend = getByTestId('spatial-gesture-legend');
    expect(legend.textContent).toContain('Explore your MindMesh');
    expect(legend.textContent).toContain('Rotate around the network');
    expect(legend.textContent).toContain('Pinch');
    expect(legend.textContent).toContain('Move through the graph');
    expect(legend.textContent).toContain('Tap focused node again');
    expect(legend.textContent).toContain('Return to the centre of the graph');
    // The guide describes the corrected camera: nodes have a fixed size in the
    // mesh, so getting closer makes them larger instead of staying screen-sized.
    expect(legend.textContent).toContain('closer nodes grow, distant ones shrink');
    expect(legend.textContent).toContain('watch it grow as the camera arrives');
    expect(legend.textContent).toContain('Nodes keep their real size in the mesh');
    // No obsolete control advice survives.
    expect(legend.textContent).not.toMatch(/orbit the network|drag to orbit|jump to node/i);
    expect(legend.textContent).not.toMatch(/same size on screen|stay(s)? the same size|fixed screen size/i);
  });

  it('stays dismissed, records that choice, and reopens from the HUD', () => {
    const { getByTestId, queryByTestId, getByLabelText } = renderGraph();
    expect(queryByTestId('spatial-gesture-legend')).not.toBeNull();

    fireEvent.click(getByLabelText('Close gesture guide'));
    expect(queryByTestId('spatial-gesture-legend')).toBeNull();
    expect(localStorage.getItem('mindmesh_spatial_gesture_hint_seen')).toBe('1');

    fireEvent.click(getByLabelText('Toggle gesture guide'));
    expect(queryByTestId('spatial-gesture-legend')).not.toBeNull();
    expect(getByTestId('spatial-gesture-legend')).not.toBeNull();
  });

  it('never lets the guide or the HUD intercept a camera gesture', async () => {
    const { getByTestId } = renderGraph({ nodes: mesh, edges });
    const graph = getByTestId('spatial-graph');
    const legend = getByTestId('spatial-gesture-legend');
    const targetBefore = graph.getAttribute('data-camera-target-x');

    fireEvent.pointerDown(legend, { pointerId: 21, pointerType: 'touch', button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(legend, { pointerId: 21, pointerType: 'touch', buttons: 1, clientX: 120, clientY: 90 });
    fireEvent.pointerUp(legend, { pointerId: 21, pointerType: 'touch', clientX: 120, clientY: 90 });

    await sleep(60);
    expect(graph.getAttribute('data-camera-target-x')).toBe(targetBefore);
    expect(attr(graph, 'data-camera-yaw')).toBe(0);
  });

  it('shows the contextual node hint once, then remembers it was used', async () => {
    const { getByTestId, queryByTestId, container } = renderGraph({ nodes: [reminder], edges: [] });
    const node = container.querySelector('[data-node-id="rem-1"]') as HTMLElement;

    fireEvent.click(node);
    const hint = getByTestId('spatial-node-hint');
    expect(hint.textContent).toContain('Tap once to focus a node');
    expect(hint.textContent).toContain('Tap it again to open its options');

    // Using the second tap dismisses and persists it.
    fireEvent.click(node);
    expect(queryByTestId('spatial-node-hint')).toBeNull();
    expect(localStorage.getItem('mindmesh_spatial_node_hint_seen')).toBe('1');

    fireEvent.click(node);
    expect(queryByTestId('spatial-node-hint')).toBeNull();
  });
});

describe('zoomed-out secondary node visibility', () => {
  const visible = { reminders: false, subtasks: false };

  it('hides steps before reminders because they are the most granular nodes', () => {
    const mid = resolveSecondaryNodeVisibility(6_000, visible);
    expect(mid.subtasks).toBe(true);
    expect(mid.reminders).toBe(false);
  });

  it('uses a hysteresis band so a camera near the threshold cannot flicker', () => {
    expect(resolveSecondaryNodeVisibility(8_999, visible).reminders).toBe(false);
    const hidden = resolveSecondaryNodeVisibility(9_000, visible);
    expect(hidden.reminders).toBe(true);
    expect(resolveSecondaryNodeVisibility(7_500, hidden).reminders).toBe(true);
    expect(resolveSecondaryNodeVisibility(7_400, hidden).reminders).toBe(false);
  });

  it('declutters a large graph when the camera pulls back', async () => {
    withViewport(900, 700);
    const spread: Node<MeshNodeData>[] = [
      root,
      { ...category, position: { x: 20_000, y: 0 } },
      { ...reminder, position: { x: 42_000, y: 0 } },
      { ...subtask, position: { x: 58_000, y: 0 } },
    ];
    const { getByTestId, container } = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={spread} edges={edges} appearance={getDefaultAppearance()} surfaceKey="declutter" />
      </ReactFlowProvider>
    );
    const graph = getByTestId('spatial-graph');
    const node = (id: string) => container.querySelector(`[data-node-id="${id}"]`);

    fireEvent.wheel(graph, { deltaY: 20_000 });
    await waitFor(() => expect(graph.getAttribute('data-reminders-hidden')).toBe('true'));
    expect(graph.getAttribute('data-subtasks-hidden')).toBe('true');
    expect(node('rem-1')).toBeNull();
    // Primary nodes stay visible so the graph never disappears.
    expect(node('root')).not.toBeNull();
    expect(node('cat-1')).not.toBeNull();

    // Zooming back in restores the hidden nodes exactly (the camera stays in
    // front of them, so they project into the view instead of being culled).
    fireEvent.wheel(graph, { deltaY: -4_000 });
    await waitFor(() => expect(graph.getAttribute('data-reminders-hidden')).toBe('false'));
    expect(node('rem-1')).not.toBeNull();
  });
});
