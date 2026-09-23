import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Home, RotateCcw, ZoomIn, ZoomOut, Crosshair } from 'lucide-react';
import { Edge, Node, Position } from '@xyflow/react';
import { MeshNodeData, AppearanceSettings } from '../../types';
import { RootNode } from '../nodes/RootNode';
import { CategoryNode } from '../nodes/CategoryNode';
import { ReminderNode } from '../nodes/ReminderNode';
import { SubtaskNode } from '../nodes/SubtaskNode';

interface SpatialGraphProps {
  nodes: Node<MeshNodeData>[];
  edges: Edge[];
  appearance: AppearanceSettings;
  onEmptyClick?: () => void;
  onNodePositionChange?: (nodeId: string, x: number, y: number) => void;
  /** Node the user has navigated to. Changing it animates the camera toward it. */
  focusNodeId?: string | null;
  /** Keeps the graph's highlight in sync with the app's selection state. */
  selectedNodeId?: string | null;
}

type Point3 = { x: number; y: number; z: number };
export type SpatialCamera = { target: Point3; yaw: number; pitch: number; distance: number };
type ProjectedPoint = Point3 & { screenX: number; screenY: number; scale: number; depth: number };
type PointerMode = 'orbit' | 'pan';
type NodeComponent = React.ComponentType<Record<string, unknown>>;

const NODE_COMPONENTS: Record<string, NodeComponent> = {
  rootNode: RootNode as unknown as NodeComponent,
  categoryNode: CategoryNode as unknown as NodeComponent,
  reminderNode: ReminderNode as unknown as NodeComponent,
  subtaskNode: SubtaskNode as unknown as NodeComponent,
};

function depthForNode(node: Node<MeshNodeData>, index: number): number {
  const base = node.data.type === 'root' ? 0 : node.data.type === 'category' ? 105 : node.data.type === 'reminder' ? 235 : 350;
  const hash = Array.from(node.id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return base + ((hash + index * 37) % 120) - 60;
}

function worldPoint(node: Node<MeshNodeData>, index: number): Point3 {
  return { x: node.position.x, y: node.position.y, z: depthForNode(node, index) };
}

export function projectSpatialPoint(point: Point3, camera: SpatialCamera, width: number, height: number, focal: number): ProjectedPoint {
  const dx = point.x - camera.target.x;
  const dy = point.y - camera.target.y;
  const dz = point.z - camera.target.z;
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const yawX = dx * cosYaw - dz * sinYaw;
  const yawZ = dx * sinYaw + dz * cosYaw;
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  const pitchY = dy * cosPitch - yawZ * sinPitch;
  const cameraZ = dy * sinPitch + yawZ * cosPitch;
  const depth = Math.max(30, camera.distance - cameraZ);
  const scale = focal / depth;
  return { ...point, screenX: width / 2 + yawX * scale, screenY: height / 2 + pitchY * scale, scale, depth };
}

/** Only safety limits remain: no target or orbit-area restriction is imposed. */
export function clampSpatialCamera(camera: SpatialCamera): SpatialCamera {
  const pitchLimit = Math.PI / 2 - 0.015;
  return {
    target: {
      x: Number.isFinite(camera.target.x) ? camera.target.x : 0,
      y: Number.isFinite(camera.target.y) ? camera.target.y : 0,
      z: Number.isFinite(camera.target.z) ? camera.target.z : 0,
    },
    yaw: Number.isFinite(camera.yaw) ? camera.yaw : 0,
    pitch: Math.max(-pitchLimit, Math.min(pitchLimit, Number.isFinite(camera.pitch) ? camera.pitch : 0)),
    distance: Math.max(90, Math.min(50_000, Number.isFinite(camera.distance) ? camera.distance : 1200)),
  };
}

function defaultCamera(): SpatialCamera {
  return { target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0.04, distance: 1180 };
}

export const SpatialGraph: React.FC<SpatialGraphProps> = ({ nodes, edges, appearance, onEmptyClick, onNodePositionChange, focusNodeId, selectedNodeId }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const pointerModesRef = useRef(new Map<number, PointerMode>());
  const cameraRef = useRef<SpatialCamera>(defaultCamera());
  const animationRef = useRef<number>(0);
  const publishFrameRef = useRef<number>(0);
  const gestureRef = useRef<{ centerX: number; centerY: number; distance: number } | null>(null);
  const initialHomeDoneRef = useRef(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [camera, setCamera] = useState<SpatialCamera>(defaultCamera);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [draggedPositions, setDraggedPositions] = useState<Record<string, { x: number; y: number }>>({});
  const nodeDragRef = useRef<{ id: string; startX: number; startY: number; originX: number; originY: number; moved: boolean; active: boolean; timer?: number } | null>(null);
  const suppressNodeClickRef = useRef(false);
  // Latest world points, readable from effects without re-running them whenever
  // a reminder or node position changes (which must never move the camera).
  const nodePointsRef = useRef<Map<string, Point3>>(new Map());
  const nodesRef = useRef<Node<MeshNodeData>[]>([]);
  const focusNodeRef = useRef<(nodeId: string) => void>(() => undefined);

  const focal = Math.max(260, Math.min(size.width, size.height) * 1.05);
  const nodePoints = useMemo(() => {
    const map = new Map<string, Point3>();
    nodes.forEach((node, index) => {
      const override = draggedPositions[node.id];
      map.set(node.id, worldPoint(override ? { ...node, position: override } : node, index));
    });
    return map;
  }, [draggedPositions, nodes]);

  nodePointsRef.current = nodePoints;
  nodesRef.current = nodes;

  const projected = useMemo(() => {
    const result = new Map<string, ProjectedPoint>();
    nodes.forEach((node) => {
      const point = nodePoints.get(node.id);
      if (point) result.set(node.id, projectSpatialPoint(point, camera, size.width, size.height, focal));
    });
    return result;
  }, [camera, focal, nodePoints, nodes, size.height, size.width]);

  const publishCamera = useCallback(() => {
    if (publishFrameRef.current) return;
    publishFrameRef.current = requestAnimationFrame(() => {
      publishFrameRef.current = 0;
      setCamera({ ...cameraRef.current, target: { ...cameraRef.current.target } });
    });
  }, []);

  const updateCamera = useCallback((updater: (current: SpatialCamera) => SpatialCamera) => {
    cancelAnimationFrame(animationRef.current);
    cameraRef.current = clampSpatialCamera(updater(cameraRef.current));
    publishCamera();
  }, [publishCamera]);

  const cameraForOverview = useCallback((): SpatialCamera => {
    if (nodes.length === 0) return defaultCamera();
    const points = nodes.map((node, index) => worldPoint(node, index));
    const minX = Math.min(...points.map((point) => point.x));
    const maxX = Math.max(...points.map((point) => point.x));
    const minY = Math.min(...points.map((point) => point.y));
    const maxY = Math.max(...points.map((point) => point.y));
    const minZ = Math.min(...points.map((point) => point.z));
    const maxZ = Math.max(...points.map((point) => point.z));
    const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 520);
    return clampSpatialCamera({
      target: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
      yaw: 0,
      pitch: 0.04,
      // Overview only, and deliberately capped: a big world should be explored by
      // travelling through it, not shrunk until every node is a speck.
      distance: Math.max(900, Math.min(3200, span * 1.05 + 480)),
    });
  }, [nodes]);

  const animateCamera = useCallback((next: SpatialCamera) => {
    cancelAnimationFrame(animationRef.current);
    const from = { ...cameraRef.current, target: { ...cameraRef.current.target } };
    const duration = appearance.threeD.animationIntensity === 0 ? 0 : 460;
    // The animation clock is anchored to the first animation frame rather than
    // performance.now(), so the interpolation can never receive a timestamp that
    // predates the start (which would overshoot to absurd coordinates).
    let startedAt: number | null = null;
    const tick = (now: number) => {
      if (startedAt === null) startedAt = now;
      const progress = duration === 0 ? 1 : Math.min(1, Math.max(0, (now - startedAt) / duration));
      const eased = 1 - Math.pow(1 - progress, 3);
      cameraRef.current = clampSpatialCamera({
        target: {
          x: from.target.x + (next.target.x - from.target.x) * eased,
          y: from.target.y + (next.target.y - from.target.y) * eased,
          z: from.target.z + (next.target.z - from.target.z) * eased,
        },
        yaw: from.yaw + (next.yaw - from.yaw) * eased,
        pitch: from.pitch + (next.pitch - from.pitch) * eased,
        distance: from.distance + (next.distance - from.distance) * eased,
      });
      publishCamera();
      if (progress < 1) animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
  }, [appearance.threeD.animationIntensity, publishCamera]);

  const resetCamera = useCallback(() => animateCamera(cameraForOverview()), [animateCamera, cameraForOverview]);

  const focusNode = useCallback((nodeId: string) => {
    const point = nodePointsRef.current.get(nodeId);
    if (!point) return;
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    const distance = node?.data.type === 'root' ? 1180 : node?.data.type === 'category' ? 860 : node?.data.type === 'reminder' ? 680 : 540;
    // Focus is a one-off camera trip. The target becomes the new orbit centre and
    // free exploration resumes the moment the animation finishes.
    animateCamera(clampSpatialCamera({ target: { ...point, z: point.z * 0.7 }, yaw: cameraRef.current.yaw, pitch: 0.18, distance }));
  }, [animateCamera]);

  focusNodeRef.current = focusNode;

  // Navigation focus: only runs when the app selects a *new* node, so selecting
  // the already-focused node (or ordinary data/position updates) never moves the
  // camera. The graph generates the focus helper itself so this cannot loop.
  useEffect(() => {
    if (!focusNodeId) return;
    focusNodeRef.current(focusNodeId);
  }, [focusNodeId]);

  // Keep the highlight aligned with the app-level selection without hijacking
  // the camera; SpatialGraph still owns the highlight for standalone use.
  useEffect(() => {
    setSelectedId(selectedNodeId ?? null);
  }, [selectedNodeId]);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize({ width: Math.max(1, rect.width), height: Math.max(1, rect.height) });
    };
    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : undefined;
    observer?.observe(element);
    update();
    return () => observer?.disconnect();
  }, []);

  // One overview fit when this graph surface is first opened; later data changes
  // never change the camera unless the user explicitly presses Home or Focus.
  useEffect(() => {
    if (!initialHomeDoneRef.current && nodes.length > 0 && size.width > 1 && size.height > 1) {
      initialHomeDoneRef.current = true;
      cameraRef.current = cameraForOverview();
      publishCamera();
    }
  }, [cameraForOverview, nodes.length, publishCamera, size.height, size.width]);

  useEffect(() => {
    const handleHome = () => resetCamera();
    window.addEventListener('mindmesh-spatial-home', handleHome);
    return () => window.removeEventListener('mindmesh-spatial-home', handleHome);
  }, [resetCamera]);

  useEffect(() => () => {
    cancelAnimationFrame(animationRef.current);
    cancelAnimationFrame(publishFrameRef.current);
    pointersRef.current.clear();
    pointerModesRef.current.clear();
  }, []);

  const beginTwoPointerGesture = () => {
    const values = Array.from(pointersRef.current.values());
    if (values.length < 2) return;
    const centerX = values.reduce((sum, point) => sum + point.x, 0) / values.length;
    const centerY = values.reduce((sum, point) => sum + point.y, 0) / values.length;
    const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
    gestureRef.current = { centerX, centerY, distance };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget && (event.button === 0 || event.pointerType === 'touch')) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pointerModesRef.current.set(event.pointerId, event.button === 1 || event.button === 2 ? 'pan' : 'orbit');
    if (pointersRef.current.size >= 2) beginTwoPointerGesture();
    setIsInteracting(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;

    if (pointers.size >= 2) {
      const values = Array.from(pointers.values());
      const centerX = values.reduce((sum, point) => sum + point.x, 0) / values.length;
      const centerY = values.reduce((sum, point) => sum + point.y, 0) / values.length;
      const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
      const previousGesture = gestureRef.current;
      if (previousGesture) {
        const panScale = Math.max(0.7, cameraRef.current.distance / focal);
        const pinchDelta = distance - previousGesture.distance;
        updateCamera((current) => ({
          ...current,
          target: {
            ...current.target,
            x: current.target.x - (centerX - previousGesture.centerX) * panScale,
            y: current.target.y - (centerY - previousGesture.centerY) * panScale,
          },
          distance: current.distance - pinchDelta * 1.65 * appearance.threeD.zoomSensitivity,
        }));
      }
      gestureRef.current = { centerX, centerY, distance };
      return;
    }

    const mode = pointerModesRef.current.get(event.pointerId) ?? 'orbit';
    if (mode === 'pan') {
      const panScale = Math.max(0.7, cameraRef.current.distance / focal);
      updateCamera((current) => ({ ...current, target: { ...current.target, x: current.target.x - dx * panScale, y: current.target.y - dy * panScale } }));
      return;
    }

    if (appearance.threeD.graphRotation) {
      const direction = appearance.threeD.invertRotation ? -1 : 1;
      const sensitivity = 0.006 * appearance.threeD.cameraSensitivity;
      updateCamera((current) => ({ ...current, yaw: current.yaw + dx * sensitivity * direction, pitch: current.pitch + dy * sensitivity * direction }));
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    pointerModesRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
    if (pointersRef.current.size === 0) setIsInteracting(false);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    updateCamera((current) => ({ ...current, distance: current.distance + event.deltaY * 1.2 * appearance.threeD.zoomSensitivity }));
  };

  const zoom = (amount: number) => updateCamera((current) => ({ ...current, distance: current.distance + amount }));

  const visibleNodeIds = useMemo(() => {
    const visible = new Set<string>();
    nodes.forEach((node) => {
      const point = projected.get(node.id);
      if (!point) return;
      const hideDistantSubtask = node.data.type === 'subtask' && (camera.distance > 14_000 || point.scale < 0.045);
      const hideDistantReminder = node.data.type === 'reminder' && (camera.distance > 24_000 || point.scale < 0.06);
      if (!hideDistantSubtask && !hideDistantReminder) visible.add(node.id);
    });
    return visible;
  }, [camera.distance, nodes, projected]);

  const renderedNodes = nodes.filter((node) => visibleNodeIds.has(node.id)).sort((a, b) => (projected.get(b.id)?.depth ?? 0) - (projected.get(a.id)?.depth ?? 0));

  return (
    <div
      ref={viewportRef}
      className="mm-spatial-graph"
      data-testid="spatial-graph"
      data-spatial-active="true"
      data-camera-yaw={camera.yaw}
      data-camera-pitch={camera.pitch}
      data-camera-distance={camera.distance}
      data-camera-target-x={camera.target.x}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={handleWheel}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          setSelectedId(null);
          onEmptyClick?.();
        }
      }}
      style={{ '--mm-spatial-focal': `${focal}px` } as React.CSSProperties}
    >
      <svg className="mm-spatial-connections" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
        {edges.map((edge) => {
          const source = projected.get(edge.source);
          const target = projected.get(edge.target);
          if (!source || !target || !visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) return null;
          const selectedPath = selectedId === edge.source || selectedId === edge.target;
          const stroke = typeof edge.style?.stroke === 'string' ? edge.style.stroke : '#64748b';
          const opacity = selectedId && !selectedPath ? 0.12 : Number(edge.style?.strokeOpacity ?? 0.55) * (source.scale + target.scale) * 0.9;
          return <line key={edge.id} x1={source.screenX} y1={source.screenY} x2={target.screenX} y2={target.screenY} stroke={stroke} strokeWidth={selectedPath ? 3.5 : Number(edge.style?.strokeWidth ?? 1.5) * Math.max(0.7, (source.scale + target.scale) / 1.6)} strokeOpacity={opacity} strokeLinecap="round" className={edge.animated || selectedPath ? 'mm-spatial-edge mm-spatial-edge--active' : 'mm-spatial-edge'} />;
        })}
      </svg>

      <div className="mm-spatial-stars" aria-hidden="true" />
      {renderedNodes.map((node) => {
        const point = projected.get(node.id);
        const Component = NODE_COMPONENTS[node.type || ''];
        if (!point || !Component) return null;
        const visibleScale = Math.max(0.42, Math.min(1.28, point.scale * 1.55));
        const isSelected = selectedId === node.id;
        const isDimmed = Boolean(selectedId && !isSelected && node.data.type !== 'root');
        return (
          <div
            key={node.id}
            className={`mm-spatial-node${isSelected ? ' mm-spatial-node--selected' : ''}`}
            data-node-id={node.id}
            data-depth={Math.round(point.z)}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.preventDefault();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              const isTouch = event.pointerType === 'touch';
              const drag: NonNullable<typeof nodeDragRef.current> = { id: node.id, startX: event.clientX, startY: event.clientY, originX: node.position.x, originY: node.position.y, moved: false, active: !isTouch };
              nodeDragRef.current = drag;
              if (isTouch) drag.timer = window.setTimeout(() => { if (nodeDragRef.current === drag) drag.active = true; }, 280);
            }}
            onPointerMove={(event) => {
              const drag = nodeDragRef.current;
              if (!drag || drag.id !== node.id) return;
              event.stopPropagation();
              const point = projected.get(node.id);
              if (!point || !drag.active) return;
              const dx = event.clientX - drag.startX;
              const dy = event.clientY - drag.startY;
              if (Math.hypot(dx, dy) < 4 && !drag.moved) return;
              drag.moved = true;
              setDraggedPositions((previous) => ({ ...previous, [node.id]: { x: drag.originX + dx / Math.max(point.scale, 0.001), y: drag.originY + dy / Math.max(point.scale, 0.001) } }));
            }}
            onPointerUp={(event) => {
              const drag = nodeDragRef.current;
              if (!drag || drag.id !== node.id) return;
              event.stopPropagation();
              if (drag.timer) window.clearTimeout(drag.timer);
              if (drag.moved) {
                suppressNodeClickRef.current = true;
                const position = draggedPositions[node.id];
                if (position) onNodePositionChange?.(node.id, position.x, position.y);
                setDraggedPositions((previous) => { const next = { ...previous }; delete next[node.id]; return next; });
              }
              nodeDragRef.current = null;
            }}
            onPointerCancel={(event) => {
              event.stopPropagation();
              const drag = nodeDragRef.current;
              if (drag?.timer) window.clearTimeout(drag.timer);
              nodeDragRef.current = null;
              setDraggedPositions((previous) => { const next = { ...previous }; delete next[node.id]; return next; });
            }}
            onClick={() => {
              if (suppressNodeClickRef.current) { suppressNodeClickRef.current = false; return; }
              setSelectedId(node.id);
              node.data.onNodeClick?.(node.id, node.data.type);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={{ left: point.screenX, top: point.screenY, zIndex: Math.round(2000 - point.depth), opacity: isDimmed ? 0.28 : Math.max(0.58, Math.min(1, 1.15 - point.depth / 2100)), filter: point.depth > 1250 ? 'saturate(0.72)' : undefined, transform: `translate(-50%, -50%) scale(${visibleScale})` }}
          >
            <Component id={node.id} type={node.type} data={node.data} selected={isSelected} dragging={Boolean(nodeDragRef.current?.id === node.id && nodeDragRef.current.active)} zIndex={node.zIndex} xPos={node.position.x} yPos={node.position.y} sourcePosition={Position.Bottom} targetPosition={Position.Top} isConnectable={false} />
          </div>
        );
      })}

      <div className="mm-spatial-hud" aria-label="3D graph controls">
        <div className="mm-spatial-breadcrumb">
          <span className="mm-spatial-compass">◎</span>
          <span>{selectedId ? nodes.find((node) => node.id === selectedId)?.data.label : 'MindMesh network'}</span>
          {isInteracting && <small>exploring</small>}
        </div>
        <div className="mm-spatial-actions">
          <button type="button" onClick={resetCamera} aria-label="Home view" title="Home view"><Home size={15} /></button>
          <button type="button" onClick={() => zoom(-180)} aria-label="Zoom in" title="Zoom in"><ZoomIn size={15} /></button>
          <button type="button" onClick={() => zoom(180)} aria-label="Zoom out" title="Zoom out"><ZoomOut size={15} /></button>
          {selectedId && <button type="button" onClick={() => focusNode(selectedId)} aria-label="Focus selected node" title="Focus selected node"><Crosshair size={14} /></button>}
          <button type="button" onClick={resetCamera} aria-label="Reset camera" title="Reset camera"><RotateCcw size={14} /></button>
        </div>
        <div className="mm-spatial-help">Empty drag: orbit · right/middle drag: pan · two fingers: pan/pinch · wheel: dolly</div>
      </div>
    </div>
  );
};

SpatialGraph.displayName = 'SpatialGraph';
