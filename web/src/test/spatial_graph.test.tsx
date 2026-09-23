import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { getDefaultAppearance } from '../services/appearance';
import {
  clampSpatialCamera,
  projectSpatialPoint,
  resolveSecondaryNodeVisibility,
  SpatialGraph,
  SpatialCamera,
  unprojectSpatialPoint,
} from '../components/graph/SpatialGraph';
import { MeshNodeData } from '../types';
import { Node, ReactFlowProvider } from '@xyflow/react';

const camera = (overrides: Partial<SpatialCamera> = {}): SpatialCamera => ({
  target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, distance: 1200, ...overrides,
});

const root: Node<MeshNodeData> = {
  id: 'root', type: 'rootNode', position: { x: 0, y: 0 }, data: {
    id: 'root', label: 'MindMesh', type: 'root', count: 1,
  },
};

function renderGraph() {
  return render(
    <ReactFlowProvider>
      <SpatialGraph
        nodes={[root]}
        edges={[]}
        appearance={getDefaultAppearance()}
        onEmptyClick={vi.fn()}
      />
    </ReactFlowProvider>
  );
}

describe('SpatialGraph free camera', () => {
  it('keeps arbitrary pan targets and allows almost full vertical orbit', () => {
    const result = clampSpatialCamera(camera({ target: { x: 9000, y: -8000, z: 2400 }, yaw: Math.PI * 8, pitch: Math.PI / 2, distance: 40 }));
    expect(result.target).toEqual({ x: 9000, y: -8000, z: 2400 });
    expect(result.yaw).toBe(Math.PI * 8);
    expect(result.pitch).toBeLessThan(Math.PI / 2);
    expect(result.distance).toBe(90);
  });

  it('orbits empty space without changing node position data', async () => {
    const { getByTestId } = renderGraph();
    const graph = getByTestId('spatial-graph');
    const before = root.position;

    fireEvent.pointerDown(graph, { pointerId: 1, pointerType: 'mouse', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(graph, { pointerId: 1, pointerType: 'mouse', buttons: 1, clientX: 240, clientY: 20 });
    fireEvent.pointerUp(graph, { pointerId: 1, pointerType: 'mouse', clientX: 240, clientY: 20 });

    await waitFor(() => expect(Number(graph.getAttribute('data-camera-yaw'))).not.toBe(0));
    expect(Number(graph.getAttribute('data-camera-pitch'))).not.toBe(0.04);
    expect(root.position).toEqual(before);
  });

  it('supports two-pointer pan and pinch without invoking node movement', async () => {
    const { getByTestId } = renderGraph();
    const graph = getByTestId('spatial-graph');
    const initialDistance = Number(graph.getAttribute('data-camera-distance'));

    fireEvent.pointerDown(graph, { pointerId: 1, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(graph, { pointerId: 2, pointerType: 'touch', button: 0, clientX: 200, clientY: 100 });
    fireEvent.pointerMove(graph, { pointerId: 2, pointerType: 'touch', buttons: 1, clientX: 260, clientY: 100 });
    fireEvent.pointerUp(graph, { pointerId: 1, pointerType: 'touch', clientX: 100, clientY: 100 });
    fireEvent.pointerUp(graph, { pointerId: 2, pointerType: 'touch', clientX: 260, clientY: 100 });

    await waitFor(() => expect(Number(graph.getAttribute('data-camera-distance'))).toBeLessThan(initialDistance));
    expect(Number(graph.getAttribute('data-camera-target-x'))).not.toBe(0);
  });

  it('travels to a distant node when the app focuses it, and keeps the camera there', async () => {
    const far: Node<MeshNodeData> = {
      id: 'rem-1', type: 'reminderNode', position: { x: 1200, y: -800 }, data: {
        id: 'rem-1', label: 'Rego Reminder', type: 'reminder',
      },
    };
    const { getByTestId, rerender } = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={[root, far]} edges={[]} appearance={getDefaultAppearance()} />
      </ReactFlowProvider>
    );
    const graph = getByTestId('spatial-graph');

    rerender(
      <ReactFlowProvider>
        <SpatialGraph nodes={[root, far]} edges={[]} appearance={getDefaultAppearance()} focusNodeId="rem-1" />
      </ReactFlowProvider>
    );

    // Wait for the focus animation to actually finish settling on the node.
    await waitFor(() => expect(Number(graph.getAttribute('data-camera-target-x'))).toBe(1200), { timeout: 3000 });
    const settled = graph.getAttribute('data-camera-target-x');

    // A normal data update must not re-run the focus trip or reset the camera.
    rerender(
      <ReactFlowProvider>
        <SpatialGraph
          nodes={[{ ...root }, { ...far, data: { ...far.data, label: 'Rego paid' } }]}
          edges={[]}
          appearance={getDefaultAppearance()}
          focusNodeId="rem-1"
        />
      </ReactFlowProvider>
    );
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(graph.getAttribute('data-camera-target-x')).toBe(settled);
  });

  it('stays freely orbitable after focusing a node', async () => {
    const far: Node<MeshNodeData> = {
      id: 'rem-1', type: 'reminderNode', position: { x: 1200, y: -800 }, data: {
        id: 'rem-1', label: 'Rego Reminder', type: 'reminder',
      },
    };
    const { getByTestId } = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={[root, far]} edges={[]} appearance={getDefaultAppearance()} focusNodeId="rem-1" />
      </ReactFlowProvider>
    );
    const graph = getByTestId('spatial-graph');
    await waitFor(() => expect(Number(graph.getAttribute('data-camera-target-x'))).toBe(1200), { timeout: 3000 });
    const yawBefore = Number(graph.getAttribute('data-camera-yaw'));

    fireEvent.pointerDown(graph, { pointerId: 7, pointerType: 'mouse', button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(graph, { pointerId: 7, pointerType: 'mouse', buttons: 1, clientX: 340, clientY: 260 });
    fireEvent.pointerUp(graph, { pointerId: 7, pointerType: 'mouse', clientX: 340, clientY: 260 });

    await waitFor(() => expect(Number(graph.getAttribute('data-camera-yaw'))).not.toBe(yawBefore));
  });

  it('hides reminders and steps while zoomed out, then brings them back on zoom in', async () => {
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
    const step: Node<MeshNodeData> = {
      id: 'sub-1', type: 'subtaskNode', position: { x: 540, y: 0 }, data: {
        id: 'sub-1', label: 'Pay rego', type: 'subtask', reminderId: 'rem-1',
      },
    };

    const { getByTestId, container } = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={[root, category, reminder, step]} edges={[]} appearance={getDefaultAppearance()} />
      </ReactFlowProvider>
    );
    const graph = getByTestId('spatial-graph');
    const node = (id: string) => container.querySelector(`[data-node-id="${id}"]`);

    // At normal zoom everything is on screen.
    expect(node('cat-1')).not.toBeNull();
    expect(node('rem-1')).not.toBeNull();
    expect(node('sub-1')).not.toBeNull();

    fireEvent.wheel(graph, { deltaY: 12_000 });
    await waitFor(() => expect(graph.getAttribute('data-reminders-hidden')).toBe('true'));
    expect(graph.getAttribute('data-subtasks-hidden')).toBe('true');
    // Reminders and steps are skipped, but primary nodes stay visible.
    expect(node('rem-1')).toBeNull();
    expect(node('sub-1')).toBeNull();
    expect(node('root')).not.toBeNull();
    expect(node('cat-1')).not.toBeNull();

    // Zooming back in restores the secondary nodes automatically.
    fireEvent.wheel(graph, { deltaY: -8_000 });
    await waitFor(() => expect(graph.getAttribute('data-reminders-hidden')).toBe('false'));
    fireEvent.wheel(graph, { deltaY: -1_500 });
    await waitFor(() => expect(graph.getAttribute('data-subtasks-hidden')).toBe('false'));
    expect(node('rem-1')).not.toBeNull();
    expect(node('sub-1')).not.toBeNull();
  });

  it('does not focus or move the camera just because a node is selected', () => {
    const onNodeClick = vi.fn();
    const node = { ...root, data: { ...root.data, onNodeClick } };
    const { getByTestId } = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={[node]} edges={[]} appearance={getDefaultAppearance()} />
      </ReactFlowProvider>
    );
    const graph = getByTestId('spatial-graph');
    const distance = graph.getAttribute('data-camera-distance');
    fireEvent.click(graph.querySelector('[data-node-id="root"]')!);

    expect(onNodeClick).toHaveBeenCalledWith('root', 'root');
    expect(graph.getAttribute('data-camera-distance')).toBe(distance);
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
    // The same pixel maps to a different world point as the camera dollies, which
    // is exactly why screen-pixel deltas must never be applied as world deltas.
    const near = camera({ distance: 900, target: { x: 50, y: 20, z: 0 } });
    const far = camera({ distance: 2600, target: { x: 50, y: 20, z: 0 } });
    const a = unprojectSpatialPoint(500, 350, worldZ, near, width, height, f);
    const b = unprojectSpatialPoint(500, 350, worldZ, far, width, height, f);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(Math.abs(a!.x - b!.x)).toBeGreaterThan(1);
  });

  it('drags a node without moving the camera and ignores the post-drag click', () => {
    const onNodePositionChange = vi.fn();
    const onNodeClick = vi.fn();
    const node = { ...root, data: { ...root.data, onNodeClick } };
    const { getByTestId, container } = render(
      <ReactFlowProvider>
        <SpatialGraph
          nodes={[node]}
          edges={[]}
          appearance={getDefaultAppearance()}
          onNodePositionChange={onNodePositionChange}
          onEmptyClick={vi.fn()}
        />
      </ReactFlowProvider>
    );
    const graph = getByTestId('spatial-graph');
    const element = container.querySelector('[data-node-id="root"]') as HTMLElement;
    const distanceBefore = graph.getAttribute('data-camera-distance');

    fireEvent.pointerDown(element, { pointerId: 9, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(element, { pointerId: 9, pointerType: 'touch', buttons: 1, clientX: 160, clientY: 130 });
    fireEvent.pointerUp(element, { pointerId: 9, pointerType: 'touch', clientX: 160, clientY: 130 });

    expect(onNodePositionChange).toHaveBeenCalledTimes(1);
    expect(onNodePositionChange.mock.calls[0][0]).toBe('root');
    // The camera must stay exactly where it was while a node is being positioned.
    expect(graph.getAttribute('data-camera-distance')).toBe(distanceBefore);
    expect(Number(graph.getAttribute('data-camera-yaw'))).toBe(0);

    // Releasing a dragged node must never be read as a select/click.
    fireEvent.click(element);
    expect(onNodeClick).not.toHaveBeenCalled();
    // ...but a genuine tap still navigates.
    fireEvent.click(element);
    expect(onNodeClick).toHaveBeenCalledWith('root', 'root');
  });

  it('treats a touch that never passes the threshold as a tap, not a drag', () => {
    const onNodePositionChange = vi.fn();
    const onNodeClick = vi.fn();
    const node = { ...root, data: { ...root.data, onNodeClick } };
    const { getByTestId, container } = render(
      <ReactFlowProvider>
        <SpatialGraph nodes={[node]} edges={[]} appearance={getDefaultAppearance()} onNodePositionChange={onNodePositionChange} onEmptyClick={vi.fn()} />
      </ReactFlowProvider>
    );
    const graph = getByTestId('spatial-graph');
    const element = container.querySelector('[data-node-id="root"]') as HTMLElement;
    const yawBefore = graph.getAttribute('data-camera-yaw');

    fireEvent.pointerDown(element, { pointerId: 11, pointerType: 'touch', button: 0, clientX: 200, clientY: 200 });
    fireEvent.pointerMove(element, { pointerId: 11, pointerType: 'touch', buttons: 1, clientX: 202, clientY: 201 });
    fireEvent.pointerUp(element, { pointerId: 11, pointerType: 'touch', clientX: 202, clientY: 201 });

    expect(onNodePositionChange).not.toHaveBeenCalled();
    expect(graph.getAttribute('data-camera-yaw')).toBe(yawBefore);
    fireEvent.click(element);
    expect(onNodeClick).toHaveBeenCalledWith('root', 'root');
  });
});

describe('touch camera controls', () => {
  it('pans on a one-finger touch drag instead of orbiting', async () => {
    const { getByTestId } = renderGraph();
    const graph = getByTestId('spatial-graph');

    fireEvent.pointerDown(graph, { pointerId: 3, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(graph, { pointerId: 3, pointerType: 'touch', buttons: 1, clientX: 200, clientY: 160 });
    fireEvent.pointerUp(graph, { pointerId: 3, pointerType: 'touch', clientX: 200, clientY: 160 });

    await waitFor(() => expect(Number(graph.getAttribute('data-camera-target-x'))).not.toBe(0));
    // Touch must never rotate the graph.
    expect(Number(graph.getAttribute('data-camera-yaw'))).toBe(0);
    expect(Number(graph.getAttribute('data-camera-pitch'))).toBeCloseTo(0.04, 5);
  });

  it('stops the camera immediately when the touch is released', async () => {
    const { getByTestId } = renderGraph();
    const graph = getByTestId('spatial-graph');

    fireEvent.pointerDown(graph, { pointerId: 4, pointerType: 'touch', button: 0, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(graph, { pointerId: 4, pointerType: 'touch', buttons: 1, clientX: 240, clientY: 140 });
    fireEvent.pointerUp(graph, { pointerId: 4, pointerType: 'touch', clientX: 240, clientY: 140 });
    await waitFor(() => expect(Number(graph.getAttribute('data-camera-target-x'))).not.toBe(0));
    const settled = graph.getAttribute('data-camera-target-x');

    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(graph.getAttribute('data-camera-target-x')).toBe(settled);
  });
});

describe('on-canvas gesture legend', () => {
  it('introduces the pan/pinch gestures on first run', () => {
    localStorage.clear();
    const { getByTestId } = renderGraph();
    const legend = getByTestId('spatial-gesture-legend');
    expect(legend.textContent).toContain('Drag empty space');
    expect(legend.textContent).toContain('Pinch with two fingers');
  });

  it('stays dismissed, records that choice, and reopens from the HUD', () => {
    localStorage.clear();
    const { getByTestId, queryByTestId, getByLabelText } = renderGraph();
    expect(queryByTestId('spatial-gesture-legend')).not.toBeNull();

    fireEvent.click(getByLabelText('Close gesture guide'));
    expect(queryByTestId('spatial-gesture-legend')).toBeNull();
    expect(localStorage.getItem('mindmesh_spatial_gesture_hint_seen')).toBe('1');

    fireEvent.click(getByLabelText('Toggle gesture guide'));
    expect(queryByTestId('spatial-gesture-legend')).not.toBeNull();
    expect(getByTestId('spatial-gesture-legend')).not.toBeNull();
  });

  it('does not pan the camera when the guide itself is touched', () => {
    localStorage.clear();
    const { getByTestId } = renderGraph();
    const graph = getByTestId('spatial-graph');
    const legend = getByTestId('spatial-gesture-legend');
    const targetBefore = graph.getAttribute('data-camera-target-x');

    fireEvent.pointerDown(legend, { pointerId: 21, pointerType: 'touch', button: 0, clientX: 50, clientY: 50 });
    fireEvent.pointerMove(legend, { pointerId: 21, pointerType: 'touch', buttons: 1, clientX: 120, clientY: 90 });
    fireEvent.pointerUp(legend, { pointerId: 21, pointerType: 'touch', clientX: 120, clientY: 90 });

    expect(graph.getAttribute('data-camera-target-x')).toBe(targetBefore);
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

    // Still hidden while inside the band, and only shown once fully back in.
    expect(resolveSecondaryNodeVisibility(7_500, hidden).reminders).toBe(true);
    expect(resolveSecondaryNodeVisibility(7_400, hidden).reminders).toBe(false);
  });
});
