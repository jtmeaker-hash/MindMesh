import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, waitFor } from '@testing-library/react';
import { getDefaultAppearance } from '../services/appearance';
import { clampSpatialCamera, SpatialGraph, SpatialCamera } from '../components/graph/SpatialGraph';
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
