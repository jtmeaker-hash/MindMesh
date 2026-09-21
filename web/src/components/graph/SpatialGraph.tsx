import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Home, RotateCcw, ZoomIn, ZoomOut } from 'lucide-react';
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
}

type Point3 = { x: number; y: number; z: number };
type Camera = { target: Point3; yaw: number; pitch: number; distance: number };
type ProjectedPoint = Point3 & { screenX: number; screenY: number; scale: number; depth: number };

type NodeComponent = React.ComponentType<Record<string, unknown>>;

const NODE_COMPONENTS: Record<string, NodeComponent> = {
  rootNode: RootNode as unknown as NodeComponent,
  categoryNode: CategoryNode as unknown as NodeComponent,
  reminderNode: ReminderNode as unknown as NodeComponent,
  subtaskNode: SubtaskNode as unknown as NodeComponent,
};

function depthForNode(node: Node<MeshNodeData>, index: number): number {
  const type = node.data.type;
  const base = type === 'root' ? 0 : type === 'category' ? 105 : type === 'reminder' ? 235 : 350;
  // Stable variation prevents a large branch from becoming a single flat wall.
  const hash = Array.from(node.id).reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return base + ((hash + index * 37) % 120) - 60;
}

function worldPoint(node: Node<MeshNodeData>, index: number): Point3 {
  return { x: node.position.x, y: node.position.y, z: depthForNode(node, index) };
}

function project(point: Point3, camera: Camera, width: number, height: number, focal: number): ProjectedPoint {
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
  const depth = Math.max(120, camera.distance - cameraZ);
  const scale = focal / depth;

  return {
    ...point,
    screenX: width / 2 + yawX * scale,
    screenY: height / 2 + pitchY * scale,
    scale,
    depth,
  };
}

function clampCamera(camera: Camera): Camera {
  return {
    target: {
      x: Math.max(-1400, Math.min(1400, camera.target.x)),
      y: Math.max(-1100, Math.min(1100, camera.target.y)),
      z: Math.max(-450, Math.min(650, camera.target.z)),
    },
    yaw: Math.max(-Math.PI * 0.95, Math.min(Math.PI * 0.95, camera.yaw)),
    pitch: Math.max(-0.85, Math.min(0.85, camera.pitch)),
    distance: Math.max(420, Math.min(1900, camera.distance)),
  };
}

function defaultCamera(): Camera {
  return { target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0.04, distance: 1180 };
}

export const SpatialGraph: React.FC<SpatialGraphProps> = ({ nodes, edges, appearance, onEmptyClick }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const cameraRef = useRef<Camera>(defaultCamera());
  const animationRef = useRef<number>(0);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [camera, setCamera] = useState<Camera>(defaultCamera);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);

  const focal = Math.max(260, Math.min(size.width, size.height) * 1.05);
  const nodePoints = useMemo(() => {
    const map = new Map<string, Point3>();
    nodes.forEach((node, index) => map.set(node.id, worldPoint(node, index)));
    return map;
  }, [nodes]);

  const projected = useMemo(() => {
    const result = new Map<string, ProjectedPoint>();
    nodes.forEach((node) => {
      const point = nodePoints.get(node.id);
      if (point) result.set(node.id, project(point, camera, size.width, size.height, focal));
    });
    return result;
  }, [camera, focal, nodePoints, nodes, size.height, size.width]);

  const animateCamera = useCallback((next: Camera) => {
    cancelAnimationFrame(animationRef.current);
    const from = cameraRef.current;
    const started = performance.now();
    const duration = appearance.threeD.animationIntensity === 0 ? 0 : 460;
    const tick = (now: number) => {
      const progress = duration === 0 ? 1 : Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value: Camera = {
        target: {
          x: from.target.x + (next.target.x - from.target.x) * eased,
          y: from.target.y + (next.target.y - from.target.y) * eased,
          z: from.target.z + (next.target.z - from.target.z) * eased,
        },
        yaw: from.yaw + (next.yaw - from.yaw) * eased,
        pitch: from.pitch + (next.pitch - from.pitch) * eased,
        distance: from.distance + (next.distance - from.distance) * eased,
      };
      cameraRef.current = value;
      setCamera(value);
      if (progress < 1) animationRef.current = requestAnimationFrame(tick);
    };
    animationRef.current = requestAnimationFrame(tick);
  }, [appearance.threeD.animationIntensity]);

  const focusNode = useCallback((nodeId: string | null) => {
    setSelectedId(nodeId);
    if (!nodeId) {
      animateCamera(defaultCamera());
      return;
    }
    const point = nodePoints.get(nodeId);
    if (!point) return;
    const node = nodes.find((entry) => entry.id === nodeId);
    const distance = node?.data.type === 'root' ? 1180 : node?.data.type === 'category' ? 820 : node?.data.type === 'reminder' ? 640 : 520;
    animateCamera(clampCamera({ target: { ...point, z: point.z * 0.7 }, yaw: cameraRef.current.yaw, pitch: 0.05, distance }));
  }, [animateCamera, nodePoints, nodes]);

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

  useEffect(() => {
    const handleHome = () => focusNode(null);
    window.addEventListener('mindmesh-spatial-home', handleHome);
    return () => window.removeEventListener('mindmesh-spatial-home', handleHome);
  }, [focusNode]);

  useEffect(() => () => cancelAnimationFrame(animationRef.current), []);

  const updateCamera = (updater: (current: Camera) => Camera) => {
    cancelAnimationFrame(animationRef.current);
    const next = clampCamera(updater(cameraRef.current));
    cameraRef.current = next;
    setCamera(next);
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    setIsInteracting(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const dx = event.clientX - previous.x;
    const dy = event.clientY - previous.y;
    const sensitivity = 0.0045 * appearance.threeD.cameraSensitivity;

    if (pointers.size >= 2) {
      const all = Array.from(pointers.values());
      const centerX = all.reduce((sum, point) => sum + point.x, 0) / all.length;
      const centerY = all.reduce((sum, point) => sum + point.y, 0) / all.length;
      const previousCenterX = centerX - dx / all.length;
      const previousCenterY = centerY - dy / all.length;
      const panScale = Math.max(0.7, cameraRef.current.distance / focal);
      updateCamera((current) => ({
        ...current,
        target: {
          ...current.target,
          x: current.target.x - (centerX - previousCenterX) * panScale,
          y: current.target.y - (centerY - previousCenterY) * panScale,
        },
        distance: current.distance,
      }));
      return;
    }

    if (appearance.threeD.graphRotation) {
      const direction = appearance.threeD.invertRotation ? -1 : 1;
      updateCamera((current) => ({
        ...current,
        yaw: current.yaw + dx * sensitivity * direction,
        pitch: current.pitch + dy * sensitivity * direction,
      }));
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size === 0) setIsInteracting(false);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    updateCamera((current) => ({
      ...current,
      distance: current.distance + event.deltaY * 0.8 * appearance.threeD.zoomSensitivity,
    }));
  };

  const resetCamera = () => focusNode(null);
  const zoom = (amount: number) => updateCamera((current) => ({ ...current, distance: current.distance + amount }));

  const visibleNodeIds = useMemo(() => {
    const visible = new Set<string>();
    nodes.forEach((node) => {
      const point = projected.get(node.id);
      if (!point) return;
      const hideDistantSubtask = node.data.type === 'subtask' && (camera.distance > 1450 || point.scale < 0.24);
      const hideDistantReminder = node.data.type === 'reminder' && camera.distance > 1780 && point.scale < 0.3;
      if (!hideDistantSubtask && !hideDistantReminder) visible.add(node.id);
    });
    return visible;
  }, [camera.distance, nodes, projected]);

  const renderedNodes = nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .sort((a, b) => {
      return (projected.get(b.id)?.depth ?? 0) - (projected.get(a.id)?.depth ?? 0);
    });

  return (
    <div
      ref={viewportRef}
      className="mm-spatial-graph"
      data-testid="spatial-graph"
      data-spatial-active="true"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
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
          return (
            <line
              key={edge.id}
              x1={source.screenX}
              y1={source.screenY}
              x2={target.screenX}
              y2={target.screenY}
              stroke={stroke}
              strokeWidth={selectedPath ? 3.5 : Number(edge.style?.strokeWidth ?? 1.5) * Math.max(0.7, (source.scale + target.scale) / 1.6)}
              strokeOpacity={opacity}
              strokeLinecap="round"
              className={edge.animated || selectedPath ? 'mm-spatial-edge mm-spatial-edge--active' : 'mm-spatial-edge'}
            />
          );
        })}
      </svg>

      <div className="mm-spatial-stars" aria-hidden="true" />
      {renderedNodes.map((node) => {
        const point = projected.get(node.id);
        const Component = NODE_COMPONENTS[node.type || ''];
        if (!point || !Component) return null;
        const visibleScale = Math.max(0.48, Math.min(1.28, point.scale * 1.55));
        const isSelected = selectedId === node.id;
        const isDimmed = Boolean(selectedId && !isSelected && node.data.type !== 'root');
        return (
          <div
            key={node.id}
            className={`mm-spatial-node${isSelected ? ' mm-spatial-node--selected' : ''}`}
            data-node-id={node.id}
            data-depth={Math.round(point.z)}
            onClick={() => {
              if (appearance.threeD.autoFocus) focusNode(node.id);
              else setSelectedId(node.id);
            }}
            onDoubleClick={(event) => {
              event.stopPropagation();
              focusNode(node.id);
            }}
            style={{
              left: point.screenX,
              top: point.screenY,
              zIndex: Math.round(2000 - point.depth),
              opacity: isDimmed ? 0.28 : Math.max(0.58, Math.min(1, 1.15 - point.depth / 2100)),
              filter: point.depth > 1250 ? 'saturate(0.72)' : undefined,
              transform: `translate(-50%, -50%) scale(${visibleScale})`,
            }}
          >
            <Component
              id={node.id}
              type={node.type}
              data={node.data}
              selected={isSelected}
              dragging={false}
              zIndex={node.zIndex}
              xPos={node.position.x}
              yPos={node.position.y}
              sourcePosition={Position.Bottom}
              targetPosition={Position.Top}
              isConnectable={false}
            />
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
          <button type="button" onClick={() => zoom(-120)} aria-label="Zoom in" title="Zoom in"><ZoomIn size={15} /></button>
          <button type="button" onClick={() => zoom(120)} aria-label="Zoom out" title="Zoom out"><ZoomOut size={15} /></button>
          <button type="button" onClick={resetCamera} aria-label="Reset camera" title="Reset camera"><RotateCcw size={14} /></button>
        </div>
        <div className="mm-spatial-help">Drag to orbit · two fingers to pan · pinch or wheel to travel</div>
      </div>
    </div>
  );
};

SpatialGraph.displayName = 'SpatialGraph';
