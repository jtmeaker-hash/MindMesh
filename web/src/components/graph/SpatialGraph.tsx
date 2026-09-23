import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Home, RotateCcw, ZoomIn, ZoomOut, Crosshair, HelpCircle, X } from 'lucide-react';
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
type NodeComponent = React.ComponentType<Record<string, unknown>>;

const NODE_COMPONENTS: Record<string, NodeComponent> = {
  rootNode: RootNode as unknown as NodeComponent,
  categoryNode: CategoryNode as unknown as NodeComponent,
  reminderNode: ReminderNode as unknown as NodeComponent,
  subtaskNode: SubtaskNode as unknown as NodeComponent,
};

/**
 * On-canvas gesture guide. It is shown once on first run so the touch model is
 * discoverable, then stays available from the HUD's help button.
 */
const GESTURE_HINT_STORAGE_KEY = 'mindmesh_spatial_gesture_hint_seen';

const SPATIAL_GESTURES: Array<{ glyph: string; label: string; hint: string }> = [
  { glyph: '\u2194', label: 'Drag empty space', hint: 'Pans the graph' },
  { glyph: '\u2921', label: 'Pinch with two fingers', hint: 'Zooms in and out' },
  { glyph: '\u21c4', label: 'Two-finger drag', hint: 'Pans while zooming' },
  { glyph: '\u25c9', label: 'Tap a node', hint: 'Selects it' },
  { glyph: '\u2725', label: 'Hold and drag a node', hint: 'Repositions it' },
];

function readGestureHintSeen(): boolean {
  try {
    return localStorage.getItem(GESTURE_HINT_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeGestureHintSeen(): void {
  try {
    localStorage.setItem(GESTURE_HINT_STORAGE_KEY, '1');
  } catch {
    // Non-fatal: the first-run hint simply reappears next session.
  }
}

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

/**
 * Exact inverse of `projectSpatialPoint` for a fixed world-z plane.
 *
 * Node dragging uses this so a grabbed node tracks the pointer in *world* space.
 * The previous implementation divided raw screen-pixel deltas by the node's
 * projected scale, which silently changed drag sensitivity as the node moved or
 * the camera zoomed, and drifted whenever the camera was yawed or pitched.
 *
 * Returns null when the camera ray runs parallel to the plane (nothing sane to
 * solve), so callers can simply skip the frame.
 */
export function unprojectSpatialPoint(
  screenX: number,
  screenY: number,
  worldZ: number,
  camera: SpatialCamera,
  width: number,
  height: number,
  focal: number,
): { x: number; y: number } | null {
  const u = (screenX - width / 2) / focal;
  const v = (screenY - height / 2) / focal;
  const dz = worldZ - camera.target.z;
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  // Camera-space ray is X = u*t, Y = v*t, Zc = distance - t. Rotating that ray
  // back into world space and pinning world z gives the single valid t.
  const denom = -sinYaw * u - cosYaw * (sinPitch * v + cosPitch);
  if (!Number.isFinite(denom) || Math.abs(denom) < 1e-6) return null;
  const t = (dz - cosYaw * cosPitch * camera.distance) / denom;
  if (!Number.isFinite(t)) return null;
  const x1 = u * t;
  const z1 = -sinPitch * v * t + cosPitch * (camera.distance - t);
  const dx = cosYaw * x1 + sinYaw * z1;
  const dy = (cosPitch * v - sinPitch) * t + sinPitch * camera.distance;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return { x: camera.target.x + dx, y: camera.target.y + dy };
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

/**
 * Zoomed-out decluttering. Reminders and steps are only *skipped while drawing*;
 * their data, saved state and positions are never touched, so zooming back in
 * restores them exactly. Primary nodes (root and categories) always render.
 */
export interface SecondaryNodeVisibility {
  reminders: boolean;
  subtasks: boolean;
}

// The "show again" distance sits inside the "hide" distance on purpose: the gap
// is a hysteresis band so a camera lingering near the boundary cannot flicker.
const SUBTASK_HIDE_DISTANCE = 5_200;
const SUBTASK_SHOW_DISTANCE = 4_200;
const REMINDER_HIDE_DISTANCE = 9_000;
const REMINDER_SHOW_DISTANCE = 7_400;

function secondaryNodeLatch(hidden: boolean, distance: number, hideAt: number, showAt: number): boolean {
  return hidden ? distance > showAt : distance >= hideAt;
}

/**
 * Pure, testable decision for which secondary node kinds stay visible at a given
 * camera distance. Takes the previous latch so the hysteresis band is honoured.
 */
export function resolveSecondaryNodeVisibility(
  distance: number,
  previous: SecondaryNodeVisibility,
): SecondaryNodeVisibility {
  const safeDistance = Number.isFinite(distance) ? distance : 0;
  return {
    reminders: secondaryNodeLatch(previous.reminders, safeDistance, REMINDER_HIDE_DISTANCE, REMINDER_SHOW_DISTANCE),
    subtasks: secondaryNodeLatch(previous.subtasks, safeDistance, SUBTASK_HIDE_DISTANCE, SUBTASK_SHOW_DISTANCE),
  };
}

/**
 * The interaction state machine. Exactly one mode is active at a time so a
 * single gesture can never move a node, pan the camera and select another node
 * simultaneously. Gesture intent is decided by where the pointer *started*.
 */
export type InteractionMode = 'IDLE' | 'NODE_PENDING' | 'NODE_DRAG' | 'CANVAS_PAN' | 'PINCH_ZOOM';

/** Screen pixels a pointer must travel before a node press becomes a drag. */
export const NODE_DRAG_THRESHOLD = 5;

type CanvasPointerMode = 'pan' | 'orbit';
type CanvasPointer = { x: number; y: number; mode: CanvasPointerMode };
type Rect = { left: number; top: number; width: number; height: number };

interface InteractionState {
  mode: InteractionMode;
  /** Pointer that owns the node drag. Other pointers are ignored until it ends. */
  pointerId: number | null;
  nodeId: string | null;
  startClientX: number;
  startClientY: number;
  /** World z of the fixed drag plane; never recomputed mid-drag. */
  planeZ: number;
  /** node world position - initial world intersection, so the node never jumps. */
  dragOffset: { x: number; y: number };
  /** Latest live world position, committed only on pointer-up. */
  position: { x: number; y: number } | null;
  rect: Rect;
  focal: number;
  camera: SpatialCamera;
}

function createIdleInteraction(): InteractionState {
  return {
    mode: 'IDLE',
    pointerId: null,
    nodeId: null,
    startClientX: 0,
    startClientY: 0,
    planeZ: 0,
    dragOffset: { x: 0, y: 0 },
    position: null,
    rect: { left: 0, top: 0, width: 1, height: 1 },
    focal: 260,
    camera: defaultCamera(),
  };
}

/** Pointer capture is best-effort: a missing/throwing implementation is fine. */
function capturePointer(element: Element | null, pointerId: number): void {
  try {
    (element as HTMLElement | null)?.setPointerCapture?.(pointerId);
  } catch {
    // Capture is an optimisation; the window-level cleanup still ends gestures.
  }
}

export const SpatialGraph: React.FC<SpatialGraphProps> = ({ nodes, edges, appearance, onEmptyClick, onNodePositionChange, focusNodeId, selectedNodeId }) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, CanvasPointer>());
  const cameraRef = useRef<SpatialCamera>(defaultCamera());
  const animationRef = useRef<number>(0);
  const publishFrameRef = useRef<number>(0);
  const gestureRef = useRef<{ centerX: number; centerY: number; distance: number } | null>(null);
  const initialHomeDoneRef = useRef(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [camera, setCamera] = useState<SpatialCamera>(defaultCamera);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  // First-run: open automatically until the user has dismissed the gesture guide.
  const [legendOpen, setLegendOpen] = useState(() => !readGestureHintSeen());
  const [hiddenSecondaryNodes, setHiddenSecondaryNodes] = useState<SecondaryNodeVisibility>({ reminders: false, subtasks: false });
  const [draggedPositions, setDraggedPositions] = useState<Record<string, { x: number; y: number }>>({});
  // The single source of truth for node/canvas gesture ownership.
  const interactionRef = useRef<InteractionState>(createIdleInteraction());
  // A completed drag must never be delivered as a click/select on release.
  const justDraggedRef = useRef<{ nodeId: string; at: number } | null>(null);
  // A canvas pan (touch) must not be mistaken for an empty-space tap afterwards.
  const canvasMovedRef = useRef(false);
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

  const beginTwoPointerGesture = () => {
    const values = Array.from(pointersRef.current.values());
    if (values.length < 2) return;
    const centerX = values.reduce((sum, point) => sum + point.x, 0) / values.length;
    const centerY = values.reduce((sum, point) => sum + point.y, 0) / values.length;
    const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
    gestureRef.current = { centerX, centerY, distance };
  };

  const readViewportRect = useCallback((): Rect => {
    const element = viewportRef.current;
    if (!element) return { left: 0, top: 0, width: 1, height: 1 };
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }, []);

  // ---- Node drag (owns its pointer exclusively) ---------------------------

  const beginNodeDrag = useCallback((event: React.PointerEvent<HTMLDivElement>, nodeId: string) => {
    if (interactionRef.current.mode !== 'IDLE') return;
    const point = nodePointsRef.current.get(nodeId);
    if (!point) return;
    const rect = readViewportRect();
    const dragFocal = Math.max(260, Math.min(rect.width, rect.height) * 1.05);
    // Snapshot the camera: it is frozen for the whole gesture, so the plane and
    // the screen-to-world mapping stay stable.
    const cameraSnapshot = { ...cameraRef.current, target: { ...cameraRef.current.target } };
    const world = unprojectSpatialPoint(
      event.clientX - rect.left,
      event.clientY - rect.top,
      point.z,
      cameraSnapshot,
      rect.width,
      rect.height,
      dragFocal,
    );
    if (!world) return;
    interactionRef.current = {
      mode: 'NODE_PENDING',
      pointerId: event.pointerId,
      nodeId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      planeZ: point.z,
      // Grabbing a node's edge must not teleport its centre under the finger.
      dragOffset: { x: point.x - world.x, y: point.y - world.y },
      position: null,
      rect,
      focal: dragFocal,
      camera: cameraSnapshot,
    };
  }, [readViewportRect]);

  const moveNodeDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const interaction = interactionRef.current;
    // Only the pointer that started the drag may move the node. A second finger
    // is ignored so the node can never jump to it.
    if (interaction.pointerId === null || interaction.pointerId !== event.pointerId) return;

    if (interaction.mode === 'NODE_PENDING') {
      const travelled = Math.hypot(event.clientX - interaction.startClientX, event.clientY - interaction.startClientY);
      if (travelled < NODE_DRAG_THRESHOLD) return;
      interaction.mode = 'NODE_DRAG';
    }
    if (interaction.mode !== 'NODE_DRAG' || !interaction.nodeId) return;

    const world = unprojectSpatialPoint(
      event.clientX - interaction.rect.left,
      event.clientY - interaction.rect.top,
      interaction.planeZ,
      interaction.camera,
      interaction.rect.width,
      interaction.rect.height,
      interaction.focal,
    );
    if (!world) return;
    const position = { x: world.x + interaction.dragOffset.x, y: world.y + interaction.dragOffset.y };
    interaction.position = position;
    const nodeId = interaction.nodeId;
    setDraggedPositions((previous) => ({ ...previous, [nodeId]: position }));
  }, []);

  const endNodeDrag = useCallback((pointerId?: number) => {
    const interaction = interactionRef.current;
    if (interaction.mode !== 'NODE_PENDING' && interaction.mode !== 'NODE_DRAG') return;
    if (pointerId !== undefined && interaction.pointerId !== null && pointerId !== interaction.pointerId) return;

    const nodeId = interaction.nodeId;
    const position = interaction.position;
    const dragged = interaction.mode === 'NODE_DRAG' && position !== null;
    interactionRef.current = createIdleInteraction();
    canvasMovedRef.current = false;

    if (!nodeId) return;
    if (dragged && position) {
      // Commit once, on release: no per-frame persistence writes.
      justDraggedRef.current = { nodeId, at: Date.now() };
      onNodePositionChange?.(nodeId, Math.round(position.x), Math.round(position.y));
    }
    setDraggedPositions((previous) => {
      if (!(nodeId in previous)) return previous;
      const next = { ...previous };
      delete next[nodeId];
      return next;
    });
  }, [onNodePositionChange]);

  // Safety net: an interrupted gesture (pointer released off-element, browser
  // touch cancel, window blur) must never leave the camera permanently frozen.
  useEffect(() => {
    const finish = (event: PointerEvent) => endNodeDrag(event.pointerId);
    const cancel = () => endNodeDrag();
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', cancel);
    };
  }, [endNodeDrag]);

  useEffect(() => () => {
    cancelAnimationFrame(animationRef.current);
    cancelAnimationFrame(publishFrameRef.current);
    pointersRef.current.clear();
    interactionRef.current = createIdleInteraction();
  }, []);

  // ---- Canvas gestures (pan / pinch-zoom only on touch) -------------------

  const closeLegend = useCallback(() => {
    setLegendOpen(false);
    writeGestureHintSeen();
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // A node gesture owns the interaction: the camera must not react to any
    // pointer until it finishes.
    if (interactionRef.current.mode === 'NODE_PENDING' || interactionRef.current.mode === 'NODE_DRAG') return;
    // Only the empty canvas starts a camera gesture; nodes, edges and HUD stop here.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    capturePointer(event.currentTarget, event.pointerId);

    // Touch never orbits: one finger pans, two fingers pinch+pan. A mouse keeps
    // the desktop behaviour (left drag orbits, middle/right drag pans).
    const mode: CanvasPointerMode = event.pointerType === 'touch' || event.button === 1 || event.button === 2 ? 'pan' : 'orbit';
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY, mode });
    if (pointersRef.current.size === 1) canvasMovedRef.current = false;
    if (pointersRef.current.size >= 2) beginTwoPointerGesture();
    setIsInteracting(true);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    // Freeze the camera for the duration of any node gesture.
    if (interactionRef.current.mode === 'NODE_PENDING' || interactionRef.current.mode === 'NODE_DRAG') return;
    const pointers = pointersRef.current;
    const entry = pointers.get(event.pointerId);
    if (!entry) return;
    const previousX = entry.x;
    const previousY = entry.y;
    entry.x = event.clientX;
    entry.y = event.clientY;
    const dx = event.clientX - previousX;
    const dy = event.clientY - previousY;
    if (dx !== 0 || dy !== 0) canvasMovedRef.current = true;

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

    if (entry.mode === 'pan') {
      const panScale = Math.max(0.7, cameraRef.current.distance / focal);
      updateCamera((current) => ({ ...current, target: { ...current.target, x: current.target.x - dx * panScale, y: current.target.y - dy * panScale } }));
      return;
    }

    // Orbit is intentionally desktop-only (mouse/pen). Touch can never reach here
    // because touch pointers are registered as 'pan'.
    if (entry.mode === 'orbit' && appearance.threeD.graphRotation) {
      const direction = appearance.threeD.invertRotation ? -1 : 1;
      const sensitivity = 0.006 * appearance.threeD.cameraSensitivity;
      updateCamera((current) => ({ ...current, yaw: current.yaw + dx * sensitivity * direction, pitch: current.pitch + dy * sensitivity * direction }));
    }
  };

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
    if (pointersRef.current.size === 0) setIsInteracting(false);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    updateCamera((current) => ({ ...current, distance: current.distance + event.deltaY * 1.2 * appearance.threeD.zoomSensitivity }));
  };

  const zoom = (amount: number) => updateCamera((current) => ({ ...current, distance: current.distance + amount }));

  // Recompute the zoom latches only when the camera distance changes, and keep
  // the previous object when nothing flipped so this never adds render churn.
  useEffect(() => {
    setHiddenSecondaryNodes((previous) => {
      const next = resolveSecondaryNodeVisibility(camera.distance, previous);
      return next.reminders === previous.reminders && next.subtasks === previous.subtasks ? previous : next;
    });
  }, [camera.distance]);

  const visibleNodeIds = useMemo(() => {
    const visible = new Set<string>();
    nodes.forEach((node) => {
      // Reaching this list already means the node projects on screen; the only
      // extra rule is the zoom-out declutter of reminders and steps.
      if (node.data.type === 'reminder' && hiddenSecondaryNodes.reminders) return;
      if (node.data.type === 'subtask' && hiddenSecondaryNodes.subtasks) return;
      visible.add(node.id);
    });
    return visible;
  }, [hiddenSecondaryNodes, nodes]);

  const renderedNodes = nodes.filter((node) => visibleNodeIds.has(node.id)).sort((a, b) => (projected.get(b.id)?.depth ?? 0) - (projected.get(a.id)?.depth ?? 0));

  const activeDrag = interactionRef.current;

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
      data-interaction-mode={activeDrag.mode}
      data-reminders-hidden={hiddenSecondaryNodes.reminders}
      data-subtasks-hidden={hiddenSecondaryNodes.subtasks}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handlePointerUp}
      onContextMenu={(event) => event.preventDefault()}
      onWheel={handleWheel}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        // A pan is not a tap: it must not clear the current selection.
        if (canvasMovedRef.current) { canvasMovedRef.current = false; return; }
        setSelectedId(null);
        onEmptyClick?.();
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
              // Another node drag or a canvas gesture owns the interaction already.
              if (interactionRef.current.mode !== 'IDLE') return;
              event.stopPropagation();
              event.preventDefault();
              capturePointer(event.currentTarget, event.pointerId);
              beginNodeDrag(event, node.id);
            }}
            onPointerMove={(event) => {
              const interaction = interactionRef.current;
              if (interaction.pointerId === null || interaction.pointerId !== event.pointerId) return;
              event.stopPropagation();
              moveNodeDrag(event);
            }}
            onPointerUp={(event) => {
              const interaction = interactionRef.current;
              if (interaction.pointerId === null || interaction.pointerId !== event.pointerId) return;
              event.stopPropagation();
              endNodeDrag(event.pointerId);
            }}
            onPointerCancel={(event) => {
              const interaction = interactionRef.current;
              if (interaction.pointerId === null || interaction.pointerId !== event.pointerId) return;
              event.stopPropagation();
              endNodeDrag(event.pointerId);
            }}
            onLostPointerCapture={(event) => {
              const interaction = interactionRef.current;
              if (interaction.pointerId === null || interaction.pointerId !== event.pointerId) return;
              endNodeDrag(event.pointerId);
            }}
            onClick={() => {
              const justDragged = justDraggedRef.current;
              if (justDragged && justDragged.nodeId === node.id && Date.now() - justDragged.at < 400) {
                justDraggedRef.current = null;
                return;
              }
              setSelectedId(node.id);
              node.data.onNodeClick?.(node.id, node.data.type);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={{ left: point.screenX, top: point.screenY, zIndex: Math.round(2000 - point.depth), opacity: isDimmed ? 0.28 : Math.max(0.58, Math.min(1, 1.15 - point.depth / 2100)), filter: point.depth > 1250 ? 'saturate(0.72)' : undefined, transform: `translate(-50%, -50%) scale(${visibleScale})` }}
          >
            <Component id={node.id} type={node.type} data={node.data} selected={isSelected} dragging={activeDrag.mode === 'NODE_DRAG' && activeDrag.nodeId === node.id} zIndex={node.zIndex} xPos={node.position.x} yPos={node.position.y} sourcePosition={Position.Bottom} targetPosition={Position.Top} isConnectable={false} />
          </div>
        );
      })}

      {legendOpen && (
        <div className="mm-spatial-legend" role="dialog" aria-label="Gesture guide" data-testid="spatial-gesture-legend">
          <div className="mm-spatial-legend-head">
            <span>Gestures</span>
            <button type="button" onClick={closeLegend} aria-label="Close gesture guide" title="Close"><X size={13} /></button>
          </div>
          <ul>
            {SPATIAL_GESTURES.map((gesture) => (
              <li key={gesture.label}>
                <span className="mm-spatial-legend-glyph" aria-hidden="true">{gesture.glyph}</span>
                <span className="mm-spatial-legend-copy">
                  <strong>{gesture.label}</strong>
                  <small>{gesture.hint}</small>
                </span>
              </li>
            ))}
          </ul>
          <div className="mm-spatial-legend-foot">Desktop: left-drag orbits · right-drag pans · scroll to dolly</div>
        </div>
      )}

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
          <button type="button" onClick={() => setLegendOpen((open) => !open)} aria-label="Toggle gesture guide" aria-pressed={legendOpen} title="Gesture guide"><HelpCircle size={15} /></button>
        </div>
        <div className="mm-spatial-help">Drag empty space: pan · two fingers: pinch &amp; pan · wheel: dolly</div>
      </div>
    </div>
  );
};

SpatialGraph.displayName = 'SpatialGraph';
