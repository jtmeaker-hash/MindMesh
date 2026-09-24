import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Home, Move, X } from 'lucide-react';
import { Edge, Node, Position } from '@xyflow/react';
import { MeshNodeData, AppearanceSettings } from '../../types';
import { resolveConnectionRenderSettings } from '../../services/appearance';
import {
  buildScreenGrid,
  connectionDensityDamp,
  connectionWidthScale,
  connectionZoomFade,
  meanNodeScreenHeight,
  nodeHalfExtent,
  resolveGraphDetailLevel,
  routeConnection,
  ROUTING_MAX_EDGES,
  ROUTING_MAX_OBSTACLES,
  type ScreenObstacle,
} from '../../services/graphLod';
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
  /**
   * Keeps each graph surface's session camera memory separate (the Mesh view and
   * the Routine explore view remember different camera positions).
   */
  surfaceKey?: string;
}

type Point3 = { x: number; y: number; z: number };
export type SpatialCamera = { target: Point3; yaw: number; pitch: number; distance: number };
type ProjectedPoint = Point3 & { screenX: number; screenY: number; scale: number; depth: number; visible: boolean };
type NodeComponent = React.ComponentType<Record<string, unknown>>;

/** One connection, fully resolved into screen-space geometry and styling. */
interface RenderedConnection {
  id: string;
  path: string;
  stroke: string;
  strokeWidth: number;
  strokeOpacity: number;
  /** Background-separation halo opacity; 0 means no halo element is drawn. */
  casingOpacity: number;
  active: boolean;
}

const NODE_COMPONENTS: Record<string, NodeComponent> = {
  rootNode: RootNode as unknown as NodeComponent,
  categoryNode: CategoryNode as unknown as NodeComponent,
  reminderNode: ReminderNode as unknown as NodeComponent,
  subtaskNode: SubtaskNode as unknown as NodeComponent,
};

// ---- Camera tuning constants ------------------------------------------------

/** Radians of orbit per screen pixel at the default sensitivity. */
const ORBIT_RADIANS_PER_PIXEL = 0.006;
/** Multiplicative wheel dolly base; zooming scales with current distance so
    close inspection stays precise while long-range travel stays quick. */
const WHEEL_DOLLY_BASE = 1.0014;
const MIN_CAMERA_DISTANCE = 90;
const MAX_CAMERA_DISTANCE = 160_000;
const DEFAULT_PITCH = 0.04;
/** Comfortable pitch used when a branch is framed. */
const FOCUS_PITCH = 0.14;
/** Beyond this the view starts to feel upside-down, so focus framing eases it back. */
const DISORIENTING_PITCH = 0.62;
/** Screen space reserved for the bottom HUD / safe area when framing a branch. */
const HUD_RESERVED_PIXELS = 104;
/** Fraction of the viewport a framed branch is allowed to occupy. */
const FRAMING_PADDING = 0.84;
const PITCH_LIMIT = Math.PI / 2 - 0.015;

// Momentum is deliberately gentle: it is capped relative to the gesture that
// produced it, so a flick can never turn into an uncontrollable slide.
const MOMENTUM_DAMPING = 7.5; // 1/s
const MOMENTUM_MAX_SPEED = 2200; // px/s
const MOMENTUM_TRAVEL_FRACTION = 0.3; // never glide further than 30% of the drag

/**
 * On-canvas gesture guide. Shown once so the touch model is discoverable, then
 * reopenable from the HUD so the instructions never cover the graph.
 */
const GESTURE_HINT_STORAGE_KEY = 'mindmesh_spatial_gesture_hint_seen';
const NODE_HINT_STORAGE_KEY = 'mindmesh_spatial_node_hint_seen';

const SPATIAL_GESTURES: Array<{ glyph: string; label: string; hint: string }> = [
  { glyph: '\u27f3', label: 'Drag', hint: 'Rotate around the network' },
  { glyph: '\u2922', label: 'Pinch', hint: 'Zoom in and out — closer nodes grow, distant ones shrink' },
  { glyph: '\u26f6', label: 'Node size', hint: 'Nodes keep their real size in the mesh — getting closer makes them fill more of the view' },
  { glyph: '\u2725', label: 'Two-finger drag', hint: 'Move through the graph' },
  { glyph: '\u25c9', label: 'Tap node', hint: 'Focus that node, then watch it grow as the camera arrives' },
  { glyph: '\u22ee', label: 'Tap focused node again', hint: 'Open its options' },
  { glyph: '\u2302', label: 'Home', hint: 'Return to the centre of the graph' },
];

function readStoredFlag(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

function writeStoredFlag(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Non-fatal: the hint simply reappears next session.
  }
}

/**
 * World units in front of the camera that are still drawn. This is a real near
 * plane: nodes behind the camera are culled instead of being projected at a
 * fixed minimum depth, which would draw them as an enormous, meaningless smear
 * across the screen.
 */
const NEAR_PLANE = 60;

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
  // Distance in front of the camera. Everything the camera can actually see is
  // here; anything at or behind the near plane is behind the lens.
  const forward = camera.distance - cameraZ;
  const visible = forward > NEAR_PLANE;
  const depth = visible ? forward : NEAR_PLANE;
  // The projection is the whole story about size: a node's on-screen size is its
  // fixed world size divided by its distance from the camera. There is no
  // screen-space correction, so moving the camera closer always makes a node
  // bigger and pulling back always makes it smaller.
  const scale = focal / depth;
  return { ...point, screenX: width / 2 + yawX * scale, screenY: height / 2 + pitchY * scale, scale, depth, visible };
}

/**
 * Exact inverse of `projectSpatialPoint` for a fixed world-z plane, so a grabbed
 * node tracks the pointer in *world* space instead of applying raw screen-pixel
 * deltas as world deltas.
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

/** Only safety limits remain: no world bounds are imposed on the camera. */
export function clampSpatialCamera(camera: SpatialCamera): SpatialCamera {
  return {
    target: {
      x: Number.isFinite(camera.target.x) ? camera.target.x : 0,
      y: Number.isFinite(camera.target.y) ? camera.target.y : 0,
      z: Number.isFinite(camera.target.z) ? camera.target.z : 0,
    },
    yaw: Number.isFinite(camera.yaw) ? camera.yaw : 0,
    pitch: Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, Number.isFinite(camera.pitch) ? camera.pitch : 0)),
    distance: Math.max(MIN_CAMERA_DISTANCE, Math.min(MAX_CAMERA_DISTANCE, Number.isFinite(camera.distance) ? camera.distance : 1200)),
  };
}

function defaultCamera(): SpatialCamera {
  return { target: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: DEFAULT_PITCH, distance: 1180 };
}

// ---- Dynamic graph bounds (the camera's usable space grows with the data) ----

export interface GraphBounds {
  centre: Point3;
  /** Radius of a sphere containing every node, used for overview framing. */
  radius: number;
  /** Largest axis extent, used to scale the maximum zoom-out distance. */
  span: number;
}

export function graphBoundsFromPoints(points: Iterable<Point3>): GraphBounds {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  let count = 0;
  for (const point of points) {
    count += 1;
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    minZ = Math.min(minZ, point.z);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
    maxZ = Math.max(maxZ, point.z);
  }
  if (count === 0) {
    return { centre: { x: 0, y: 0, z: 0 }, radius: 520, span: 520 };
  }
  const centre = { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 };
  const radius = Math.max(
    260,
    Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2,
  );
  return { centre, radius, span: Math.max(maxX - minX, maxY - minY, maxZ - minZ, 480) };
}

export interface CameraLimits {
  min: number;
  max: number;
}

/**
 * Minimum distance adapts to the focused node so the camera never clips through
 * it; maximum distance adapts to the graph size so a large database needs far
 * more zoom range than a small one, without an artificially tight ceiling.
 */
export function resolveCameraLimits(focusedType: string | null, graph: GraphBounds): CameraLimits {
  const half = focusedType ? Math.max(nodeHalfExtent(focusedType).x, nodeHalfExtent(focusedType).y) : 0;
  const min = Math.max(MIN_CAMERA_DISTANCE, Math.round(half * 1.6));
  const max = Math.max(
    min * 2.5,
    Math.min(MAX_CAMERA_DISTANCE, Math.round(Math.max(3200, graph.span * 3))),
  );
  return { min, max };
}

export function clampCameraLimits(camera: SpatialCamera, limits: CameraLimits): SpatialCamera {
  return {
    ...camera,
    distance: Math.max(limits.min, Math.min(limits.max, camera.distance)),
  };
}

// ---- Camera gestures (pure, testable) --------------------------------------

export interface OrbitOptions {
  sensitivity: number;
  invertX: boolean;
  invertY: boolean;
}

/** One-finger drag: rotate the camera around its focus point. */
export function orbitCamera(camera: SpatialCamera, dxScreen: number, dyScreen: number, options: OrbitOptions): SpatialCamera {
  const step = ORBIT_RADIANS_PER_PIXEL * options.sensitivity;
  return clampSpatialCamera({
    ...camera,
    yaw: camera.yaw + dxScreen * step * (options.invertX ? -1 : 1),
    pitch: camera.pitch + dyScreen * step * (options.invertY ? -1 : 1),
  });
}

/**
 * Translate the focus point along the camera's own screen axes, so panning
 * always feels like pushing the network around the glass — even when the camera
 * is yawed or pitched. (The previous implementation only moved world x/y, which
 * drifted whenever the graph was rotated.)
 */
export function panCamera(camera: SpatialCamera, dxScreen: number, dyScreen: number, focal: number): SpatialCamera {
  const worldPerPixel = camera.distance / Math.max(1, focal);
  const cosYaw = Math.cos(camera.yaw);
  const sinYaw = Math.sin(camera.yaw);
  const cosPitch = Math.cos(camera.pitch);
  const sinPitch = Math.sin(camera.pitch);
  const mx = dxScreen * worldPerPixel;
  const my = dyScreen * worldPerPixel;
  // right / up are the world-space images of the camera's screen axes.
  const dx = cosYaw * mx - sinYaw * sinPitch * my;
  const dy = cosPitch * my;
  const dz = -sinYaw * mx - cosYaw * sinPitch * my;
  return clampSpatialCamera({
    ...camera,
    target: { x: camera.target.x - dx, y: camera.target.y - dy, z: camera.target.z - dz },
  });
}

/** Dolly along the focus axis. `factor < 1` zooms in, `> 1` zooms out. */
export function dollyCamera(camera: SpatialCamera, factor: number): SpatialCamera {
  const next = Number.isFinite(factor) && factor > 0 ? factor : 1;
  return clampSpatialCamera({ ...camera, distance: camera.distance * next });
}

/**
 * Smart node framing. Rather than centring a node and zooming in hard, the
 * camera is placed so the node *and* its immediate neighbours fit inside the
 * usable viewport, biased upward so the bottom HUD never covers the branch.
 */
export function frameBranchCamera(
  camera: SpatialCamera,
  anchor: Point3,
  group: Point3[],
  anchorType: string,
  viewport: { width: number; height: number },
  focal: number,
  limits: CameraLimits,
): SpatialCamera {
  const half = nodeHalfExtent(anchorType);
  const usableWidth = Math.max(180, viewport.width * FRAMING_PADDING);
  const usableHeight = Math.max(180, viewport.height * FRAMING_PADDING);
  let extentX = half.x;
  let extentY = half.y;
  for (const point of group) {
    extentX = Math.max(extentX, Math.abs(point.x - anchor.x) + half.x);
    extentY = Math.max(extentY, Math.abs(point.y - anchor.y) + half.y);
    // Depth spread also eats screen space once the camera pitches.
    extentY = Math.max(extentY, Math.abs(point.z - anchor.z) * 0.55);
  }
  const distance = Math.max(
    (2 * extentX * focal) / usableWidth,
    (2 * extentY * focal) / usableHeight,
  ) * 1.12;
  // Lift the focus point so the HUD band at the bottom stays clear of the node.
  const lift = (HUD_RESERVED_PIXELS / 2) * (distance / focal);
  const pitch = Math.abs(camera.pitch) > DISORIENTING_PITCH ? Math.sign(camera.pitch) * FOCUS_PITCH : camera.pitch;
  return clampCameraLimits(clampSpatialCamera({
    ...camera,
    target: { x: anchor.x, y: anchor.y + lift, z: anchor.z },
    distance,
    pitch,
  }), limits);
}

/** Broad overview used by Home and by focusing the root node. */
export function frameOverviewCamera(
  bounds: GraphBounds,
  viewport: { width: number; height: number },
  focal: number,
  limits: CameraLimits,
): SpatialCamera {
  const usableWidth = Math.max(180, viewport.width * (FRAMING_PADDING + 0.04));
  const usableHeight = Math.max(180, viewport.height * (FRAMING_PADDING - 0.06));
  const distance = Math.max(
    (2 * bounds.radius * focal) / usableWidth,
    (2 * bounds.radius * focal) / usableHeight,
  ) * 1.1;
  const lift = (HUD_RESERVED_PIXELS / 2) * (distance / focal);
  return clampCameraLimits(clampSpatialCamera({
    target: { x: bounds.centre.x, y: bounds.centre.y + lift, z: bounds.centre.z },
    yaw: 0,
    pitch: DEFAULT_PITCH,
    distance,
  }), limits);
}

export interface TransitionOptions {
  /** 0 disables travel animations entirely. */
  animationIntensity: number;
  reducedMotion: boolean;
}

/**
 * Node-to-node travel should read as movement through space, so duration scales
 * with how far the camera actually has to go — 250 ms for a neighbouring node,
 * a little longer across the graph, and never slow enough to feel like waiting.
 */
export function cameraTransitionDuration(from: SpatialCamera, to: SpatialCamera, options: TransitionOptions): number {
  if (options.reducedMotion || options.animationIntensity <= 0) return 0;
  const travel = Math.hypot(to.target.x - from.target.x, to.target.y - from.target.y, to.target.z - from.target.z);
  const dolly = Math.abs(Math.log2(to.distance / Math.max(1, from.distance)));
  const rotate = Math.abs(to.yaw - from.yaw) + Math.abs(to.pitch - from.pitch);
  const raw = 240 + travel * 0.32 + dolly * 240 + rotate * 300;
  const scaled = raw * (0.45 + 0.55 * Math.min(1, Math.max(0, options.animationIntensity)));
  return Math.round(Math.max(140, Math.min(700, scaled)));
}

// ---- Session camera memory --------------------------------------------------

interface CameraMemory {
  camera: SpatialCamera;
  focusedNodeId: string | null;
}

/**
 * Camera state is view state, never graph data: it lives outside the persisted
 * document so it can never reach reminder records or backups. It keeps the last
 * useful view for this session, and on a fresh start the graph safely frames
 * itself from the real node bounds.
 */
const cameraMemoryStore = new Map<string, CameraMemory>();

export function readSpatialCameraMemory(surfaceKey: string): CameraMemory | null {
  const memory = cameraMemoryStore.get(surfaceKey);
  if (!memory) return null;
  return { camera: { ...memory.camera, target: { ...memory.camera.target } }, focusedNodeId: memory.focusedNodeId };
}

export function writeSpatialCameraMemory(surfaceKey: string, memory: CameraMemory): void {
  cameraMemoryStore.set(surfaceKey, { camera: { ...memory.camera, target: { ...memory.camera.target } }, focusedNodeId: memory.focusedNodeId });
}

export function resetSpatialCameraMemory(surfaceKey?: string): void {
  if (surfaceKey === undefined) cameraMemoryStore.clear();
  else cameraMemoryStore.delete(surfaceKey);
}

/**
 * A restored camera is only reused when it still makes sense: the focused node
 * must still exist, and the view must still be looking at (near) the graph.
 * Otherwise the caller falls back to a safe overview instead of dropping the
 * user into empty space left behind by deleted nodes.
 */
export function isRestorableCamera(memory: CameraMemory, points: Map<string, Point3>, bounds: GraphBounds): boolean {
  if (memory.focusedNodeId) return points.has(memory.focusedNodeId);
  const reach = Math.max(1800, bounds.radius * 2.5);
  return Math.hypot(
    memory.camera.target.x - bounds.centre.x,
    memory.camera.target.y - bounds.centre.y,
    memory.camera.target.z - bounds.centre.z,
  ) <= reach;
}

// ---- Secondary node decluttering (unchanged behaviour) ----------------------

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
 * The interaction state machine. Exactly one mode is active at a time, so a
 * single gesture can never move a node, pan the camera and select another node
 * simultaneously. Gesture intent is decided by where the pointer *started*.
 */
export type InteractionMode = 'IDLE' | 'CAMERA_ORBIT' | 'CAMERA_PAN' | 'CAMERA_ZOOM' | 'NODE_PENDING' | 'NODE_DRAG';

/** Screen pixels a pointer must travel before a node press becomes a drag. */
export const NODE_DRAG_THRESHOLD = 5;

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

function isUiTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[data-spatial-ui]') !== null;
}

interface PointerSample {
  x: number;
  y: number;
  role: 'orbit' | 'pan';
}

interface Momentum {
  role: 'orbit' | 'pan';
  vx: number;
  vy: number;
  travelled: number;
  cap: number;
  lastTime: number;
}

interface CameraPrefs {
  cameraSensitivity: number;
  zoomSensitivity: number;
  invertX: boolean;
  invertY: boolean;
  graphRotation: boolean;
  inertia: number;
  reducedMotion: boolean;
  focal: number;
}

/** System-level reduced motion, observed live where the browser supports it. */
function useSystemReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    if (typeof query.addEventListener === 'function') {
      query.addEventListener('change', update);
      return () => query.removeEventListener('change', update);
    }
    return undefined;
  }, []);
  return reduced;
}

export const SpatialGraph: React.FC<SpatialGraphProps> = ({
  nodes,
  edges,
  appearance,
  onEmptyClick,
  onNodePositionChange,
  focusNodeId,
  selectedNodeId,
  surfaceKey = 'default',
}) => {
  const viewportRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef(new Map<number, PointerSample>());
  const cameraRef = useRef<SpatialCamera>(defaultCamera());
  const animationRef = useRef<number>(0);
  const publishFrameRef = useRef<number>(0);
  const momentumRef = useRef<Momentum | null>(null);
  const momentumFrameRef = useRef<number>(0);
  const gestureRef = useRef<{ centerX: number; centerY: number; distance: number } | null>(null);
  const dragRef = useRef({ vx: 0, vy: 0, distance: 0, lastTime: 0 });
  const multiPointerRef = useRef(false);
  const initialisedRef = useRef(false);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [camera, setCamera] = useState<SpatialCamera>(defaultCamera);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isInteracting, setIsInteracting] = useState(false);
  const [moveMode, setMoveMode] = useState(false);
  // First-run hints: open automatically until the user has used or dismissed them.
  const [legendOpen, setLegendOpen] = useState(() => !readStoredFlag(GESTURE_HINT_STORAGE_KEY));
  const [nodeHintOpen, setNodeHintOpen] = useState(false);
  const [hiddenSecondaryNodes, setHiddenSecondaryNodes] = useState<SecondaryNodeVisibility>({ reminders: false, subtasks: false });
  const [draggedPositions, setDraggedPositions] = useState<Record<string, { x: number; y: number }>>({});
  // Latest selection, readable from the unmount snapshot without re-running it.
  const selectedIdRef = useRef<string | null>(null);
  // The single source of truth for node/canvas gesture ownership.
  const interactionRef = useRef<InteractionState>(createIdleInteraction());
  // A completed drag must never be delivered as a click/select on release.
  const justDraggedRef = useRef<{ nodeId: string; at: number } | null>(null);
  // A camera drag must not be mistaken for an empty-space tap afterwards.
  const canvasMovedRef = useRef(false);
  const lastEmptyTapRef = useRef<{ at: number; x: number; y: number } | null>(null);
  // Latest world points, readable from effects without re-running them whenever
  // a reminder or node position changes (which must never move the camera).
  const nodePointsRef = useRef<Map<string, Point3>>(new Map());
  const nodesRef = useRef<Node<MeshNodeData>[]>([]);
  const edgesRef = useRef<Edge[]>([]);
  const limitsRef = useRef<CameraLimits>({ min: MIN_CAMERA_DISTANCE, max: MAX_CAMERA_DISTANCE });
  const prefsRef = useRef<CameraPrefs>({
    cameraSensitivity: 1,
    zoomSensitivity: 1,
    invertX: false,
    invertY: false,
    graphRotation: true,
    inertia: 0.2,
    reducedMotion: false,
    focal: 260,
  });
  const focusNodeRef = useRef<(nodeId: string) => void>(() => undefined);
  const resetCameraRef = useRef<() => void>(() => undefined);
  // Distinguishes "the focused node was deleted" from "the app selected a node
  // before the graph had loaded", so only the former triggers a safe recentre.
  const focusedNodeExistedRef = useRef(false);

  const systemReducedMotion = useSystemReducedMotion();
  const reducedMotion = appearance.threeD.reducedMotion === true || systemReducedMotion;

  const focal = Math.max(260, Math.min(size.width, size.height) * 1.05);
  const nodePoints = useMemo(() => {
    const map = new Map<string, Point3>();
    nodes.forEach((node, index) => {
      const override = draggedPositions[node.id];
      map.set(node.id, worldPoint(override ? { ...node, position: override } : node, index));
    });
    return map;
  }, [draggedPositions, nodes]);

  const graphBounds = useMemo(() => graphBoundsFromPoints(nodePoints.values()), [nodePoints]);
  const limits = useMemo(
    () => resolveCameraLimits(selectedId ? nodes.find((node) => node.id === selectedId)?.data.type ?? null : null, graphBounds),
    [graphBounds, nodes, selectedId],
  );

  nodePointsRef.current = nodePoints;
  nodesRef.current = nodes;
  edgesRef.current = edges;
  limitsRef.current = limits;
  prefsRef.current = {
    cameraSensitivity: appearance.threeD.cameraSensitivity,
    zoomSensitivity: appearance.threeD.zoomSensitivity,
    invertX: appearance.threeD.invertRotation,
    invertY: appearance.threeD.invertOrbitY === true,
    graphRotation: appearance.threeD.graphRotation,
    inertia: Math.max(0, Math.min(1, appearance.threeD.cameraInertia ?? 0.2)),
    reducedMotion,
    focal,
  };
  selectedIdRef.current = selectedId;

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

  /** Every camera write passes through here, so limits can never be bypassed. */
  const applyCamera = useCallback((next: SpatialCamera) => {
    cameraRef.current = clampCameraLimits(clampSpatialCamera(next), limitsRef.current);
    publishCamera();
  }, [publishCamera]);

  const stopCameraMotion = useCallback(() => {
    cancelAnimationFrame(animationRef.current);
    animationRef.current = 0;
    cancelAnimationFrame(momentumFrameRef.current);
    momentumFrameRef.current = 0;
    momentumRef.current = null;
  }, []);

  const saveCameraMemory = useCallback(() => {
    writeSpatialCameraMemory(surfaceKey, {
      camera: { ...cameraRef.current, target: { ...cameraRef.current.target } },
      focusedNodeId: selectedIdRef.current,
    });
  }, [surfaceKey]);

  const runMomentumFrame = useCallback((now: number) => {
    const momentum = momentumRef.current;
    if (!momentum) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - momentum.lastTime) / 1000));
    momentum.lastTime = now;
    const dx = momentum.vx * dt;
    const dy = momentum.vy * dt;
    momentum.travelled += Math.hypot(dx, dy);
    const decay = Math.exp(-MOMENTUM_DAMPING * dt);
    momentum.vx *= decay;
    momentum.vy *= decay;
    const current = cameraRef.current;
    const next = momentum.role === 'orbit'
      ? orbitCamera(current, dx, dy, { sensitivity: prefsRef.current.cameraSensitivity, invertX: prefsRef.current.invertX, invertY: prefsRef.current.invertY })
      : panCamera(current, dx, dy, prefsRef.current.focal);
    applyCamera(next);
    const speed = Math.hypot(momentum.vx, momentum.vy);
    if (momentum.travelled >= momentum.cap || speed < 40) {
      momentumRef.current = null;
      momentumFrameRef.current = 0;
      saveCameraMemory();
      return;
    }
    momentumFrameRef.current = requestAnimationFrame(runMomentumFrame);
  }, [applyCamera, saveCameraMemory]);

  const startMomentum = useCallback((role: 'orbit' | 'pan', vx: number, vy: number, dragDistance: number) => {
    const prefs = prefsRef.current;
    if (prefs.reducedMotion || prefs.inertia <= 0 || dragDistance < 6) return;
    const scale = 0.45 + 0.55 * prefs.inertia;
    const speed = Math.hypot(vx, vy);
    if (speed < 60) return;
    const capped = Math.min(MOMENTUM_MAX_SPEED * scale, speed);
    const ratio = capped / speed;
    momentumRef.current = {
      role,
      vx: vx * ratio,
      vy: vy * ratio,
      travelled: 0,
      cap: dragDistance * MOMENTUM_TRAVEL_FRACTION * scale,
      lastTime: typeof performance !== 'undefined' ? performance.now() : Date.now(),
    };
    cancelAnimationFrame(momentumFrameRef.current);
    momentumFrameRef.current = requestAnimationFrame(runMomentumFrame);
  }, [runMomentumFrame]);

  const transitionOptions = useMemo<TransitionOptions>(() => ({
    animationIntensity: appearance.threeD.animationIntensity,
    reducedMotion,
  }), [appearance.threeD.animationIntensity, reducedMotion]);

  /**
   * Animated camera travel. Always interruptible: any new gesture cancels it
   * through `stopCameraMotion` and takes control of the same camera state.
   */
  const animateCamera = useCallback((next: SpatialCamera, durationOverride?: number) => {
    const from = { ...cameraRef.current, target: { ...cameraRef.current.target } };
    const target = clampCameraLimits(clampSpatialCamera(next), limitsRef.current);
    const duration = durationOverride ?? cameraTransitionDuration(from, target, transitionOptions);
    cancelAnimationFrame(animationRef.current);
    animationRef.current = 0;
    if (duration <= 0) {
      applyCamera(target);
      saveCameraMemory();
      return;
    }
    // The animation clock is anchored to the first animation frame rather than
    // performance.now(), so the interpolation can never receive a timestamp that
    // predates the start (which would overshoot to absurd coordinates).
    let startedAt: number | null = null;
    const tick = (now: number) => {
      if (startedAt === null) startedAt = now;
      const progress = Math.min(1, Math.max(0, (now - startedAt) / duration));
      const eased = 1 - Math.pow(1 - progress, 3);
      applyCamera({
        target: {
          x: from.target.x + (target.target.x - from.target.x) * eased,
          y: from.target.y + (target.target.y - from.target.y) * eased,
          z: from.target.z + (target.target.z - from.target.z) * eased,
        },
        yaw: from.yaw + (target.yaw - from.yaw) * eased,
        pitch: from.pitch + (target.pitch - from.pitch) * eased,
        distance: from.distance + (target.distance - from.distance) * eased,
      });
      if (progress < 1) {
        animationRef.current = requestAnimationFrame(tick);
      } else {
        animationRef.current = 0;
        saveCameraMemory();
      }
    };
    animationRef.current = requestAnimationFrame(tick);
  }, [applyCamera, saveCameraMemory, transitionOptions]);

  const overviewCamera = useCallback(
    () => frameOverviewCamera(graphBoundsFromPoints(nodePointsRef.current.values()), size, focal, limitsRef.current),
    [focal, size],
  );

  /** Home / recentre: frame the whole graph from a stable orientation. */
  const resetCamera = useCallback(() => animateCamera(overviewCamera()), [animateCamera, overviewCamera]);
  resetCameraRef.current = resetCamera;

  const branchPoints = useCallback((nodeId: string): Point3[] => {
    const group: Point3[] = [];
    const own = nodePointsRef.current.get(nodeId);
    if (own) group.push(own);
    edgesRef.current.forEach((edge) => {
      const other = edge.source === nodeId ? edge.target : edge.target === nodeId ? edge.source : null;
      if (!other) return;
      const point = nodePointsRef.current.get(other);
      if (point) group.push(point);
    });
    return group;
  }, []);

  /**
   * Focus travel: frame the node together with the connected nodes around it so
   * its place in the branch stays obvious (Parent → reminder → subtasks).
   */
  const focusNode = useCallback((nodeId: string) => {
    const point = nodePointsRef.current.get(nodeId);
    if (!point) return;
    const node = nodesRef.current.find((entry) => entry.id === nodeId);
    const type = node?.data.type ?? 'reminder';
    const next = type === 'root'
      ? overviewCamera()
      : frameBranchCamera(cameraRef.current, point, branchPoints(nodeId), type, size, focal, limitsRef.current);
    focusedNodeExistedRef.current = true;
    animateCamera(next);
  }, [animateCamera, branchPoints, focal, overviewCamera, size]);

  focusNodeRef.current = focusNode;

  // Navigation focus: only runs when the app selects a *new* node, so ordinary
  // data/position updates never move the camera.
  useEffect(() => {
    if (!focusNodeId) return;
    focusNodeRef.current(focusNodeId);
  }, [focusNodeId]);

  // Keep the highlight aligned with the app-level selection without hijacking it.
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

  /**
   * One camera decision when this surface opens: continue this session's last
   * useful view when it is still valid, otherwise fit the real graph bounds.
   * Graph data changes never re-run this.
   */
  useEffect(() => {
    if (initialisedRef.current || nodes.length === 0 || size.width <= 1 || size.height <= 1) return;
    initialisedRef.current = true;
    const points = nodePointsRef.current;
    const bounds = graphBoundsFromPoints(points.values());
    const memory = readSpatialCameraMemory(surfaceKey);
    if (memory && isRestorableCamera(memory, points, bounds)) {
      cameraRef.current = clampCameraLimits(clampSpatialCamera(memory.camera), limitsRef.current);
      publishCamera();
      return;
    }
    const fallback = frameOverviewCamera(bounds, size, focal, limitsRef.current);
    cameraRef.current = fallback;
    publishCamera();
  }, [focal, nodes.length, publishCamera, size, surfaceKey]);

  useEffect(() => {
    const handleHome = () => resetCamera();
    window.addEventListener('mindmesh-spatial-home', handleHome);
    return () => window.removeEventListener('mindmesh-spatial-home', handleHome);
  }, [resetCamera]);

  // A deleted focused node must not leave the camera pointing at nothing, and a
  // graph that grew or shrank must not keep the camera outside its useful range.
  useEffect(() => {
    if (!selectedId || nodePoints.has(selectedId)) return;
    setSelectedId(null);
    if (focusedNodeExistedRef.current) {
      focusedNodeExistedRef.current = false;
      resetCameraRef.current();
    }
  }, [nodePoints, selectedId]);

  useEffect(() => {
    const clamped = clampCameraLimits(clampSpatialCamera(cameraRef.current), limits);
    if (clamped.distance !== cameraRef.current.distance) {
      cameraRef.current = clamped;
      publishCamera();
    }
  }, [limits, publishCamera]);

  const readViewportRect = useCallback((): Rect => {
    const element = viewportRef.current;
    if (!element) return { left: 0, top: 0, width: 1, height: 1 };
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
  }, []);

  // ---- Node repositioning (explicit Move mode only) ------------------------

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
    // Only the pointer that started the drag may move the node.
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
    const finish = (event: PointerEvent) => {
      if (interactionRef.current.mode === 'NODE_PENDING' || interactionRef.current.mode === 'NODE_DRAG') {
        endNodeDrag(event.pointerId);
      }
    };
    const cancelAll = () => {
      endNodeDrag();
      pointersRef.current.clear();
      gestureRef.current = null;
      setIsInteracting(false);
      stopCameraMotion();
      saveCameraMemory();
    };
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', finish);
    window.addEventListener('blur', cancelAll);
    return () => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      window.removeEventListener('blur', cancelAll);
    };
  }, [endNodeDrag, saveCameraMemory, stopCameraMotion]);

  useEffect(() => () => {
    cancelAnimationFrame(animationRef.current);
    cancelAnimationFrame(publishFrameRef.current);
    cancelAnimationFrame(momentumFrameRef.current);
    pointersRef.current.clear();
    interactionRef.current = createIdleInteraction();
    // Snapshot the last useful view for this session before the surface goes away.
    saveCameraMemory();
  }, [saveCameraMemory, surfaceKey]);

  // ---- Camera gestures (orbit / pinch / pan) -------------------------------

  const closeLegend = useCallback(() => {
    setLegendOpen(false);
    writeStoredFlag(GESTURE_HINT_STORAGE_KEY);
  }, []);

  const beginTwoPointerGesture = () => {
    const values = Array.from(pointersRef.current.values());
    if (values.length < 2) return;
    const centerX = values.reduce((sum, point) => sum + point.x, 0) / values.length;
    const centerY = values.reduce((sum, point) => sum + point.y, 0) / values.length;
    const distance = Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y);
    gestureRef.current = { centerX, centerY, distance: Math.max(1, distance) };
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    // HUD, legend and hint controls own their own pointers.
    if (isUiTarget(event.target)) return;
    // A node gesture owns the interaction until it finishes.
    if (interactionRef.current.mode === 'NODE_PENDING' || interactionRef.current.mode === 'NODE_DRAG') return;
    // Starting on a node must stay clickable (cancelling pointerdown can swallow
    // the tap), so only the empty canvas suppresses default browser behaviour.
    const startedOnNode = event.target instanceof Element && event.target.closest('[data-node-id]') !== null;
    if (!startedOnNode) event.preventDefault();
    // Any new touch hands control straight back to the user.
    stopCameraMotion();
    // Pointer capture retargets the pointer sequence, which would move the tap's
    // click away from the node it started on. Node presses therefore keep their
    // own target (touch already gets implicit capture) and simply bubble here,
    // while background drags are captured so they survive leaving the element.
    if (!startedOnNode) capturePointer(event.currentTarget, event.pointerId);

    const prefs = prefsRef.current;
    const wantsPan = event.pointerType !== 'touch' && (event.button === 1 || event.button === 2 || event.ctrlKey || event.metaKey);
    // Touch: one finger orbits, two fingers pinch + pan. Desktop keeps orbit on
    // left drag, pan on middle/right/modifier drag, dolly on the wheel.
    const role: 'orbit' | 'pan' = wantsPan || !prefs.graphRotation ? 'pan' : 'orbit';
    pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY, role });
    if (pointersRef.current.size === 1) {
      canvasMovedRef.current = false;
      multiPointerRef.current = false;
      const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
      dragRef.current = { vx: 0, vy: 0, distance: 0, lastTime: now };
    }
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
    if (dx === 0 && dy === 0) return;
    canvasMovedRef.current = true;
    const prefs = prefsRef.current;

    // Track a time-normalised, smoothed velocity so a light glide can follow the
    // gesture without a single jittery frame dictating it.
    const drag = dragRef.current;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const dt = Math.max(0.008, (now - drag.lastTime) / 1000);
    drag.lastTime = now;
    drag.distance += Math.hypot(dx, dy);
    drag.vx = drag.vx * 0.6 + (dx / dt) * 0.4;
    drag.vy = drag.vy * 0.6 + (dy / dt) * 0.4;

    if (pointers.size >= 2) {
      multiPointerRef.current = true;
      const values = Array.from(pointers.values());
      const centerX = values.reduce((sum, point) => sum + point.x, 0) / values.length;
      const centerY = values.reduce((sum, point) => sum + point.y, 0) / values.length;
      const distance = Math.max(1, Math.hypot(values[0].x - values[1].x, values[0].y - values[1].y));
      const previousGesture = gestureRef.current;
      if (previousGesture) {
        // Pinch is multiplicative, so zoom speed scales with the current
        // distance: precise up close, quick across a large graph.
        const panned = panCamera(cameraRef.current, centerX - previousGesture.centerX, centerY - previousGesture.centerY, prefs.focal);
        applyCamera(dollyCamera(panned, Math.pow(previousGesture.distance / distance, prefs.zoomSensitivity)));
      }
      gestureRef.current = { centerX, centerY, distance };
      return;
    }

    if (entry.role === 'pan') {
      applyCamera(panCamera(cameraRef.current, dx, dy, prefs.focal));
      return;
    }
    applyCamera(orbitCamera(cameraRef.current, dx, dy, {
      sensitivity: prefs.cameraSensitivity,
      invertX: prefs.invertX,
      invertY: prefs.invertY,
    }));
  };

  const recentreCamera = useCallback(() => {
    const focused = selectedIdRef.current;
    if (focused && nodePointsRef.current.has(focused)) {
      // Framing the branch the user is already in keeps them oriented; only a
      // user with no focus gets the full-graph recentre.
      focusNodeRef.current(focused);
      return;
    }
    resetCamera();
  }, [resetCamera]);

  const handlePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    const entry = pointersRef.current.get(event.pointerId);
    pointersRef.current.delete(event.pointerId);
    if (pointersRef.current.size < 2) gestureRef.current = null;
    if (pointersRef.current.size === 0) setIsInteracting(false);
    // A duplicate release (lost pointer capture after pointer-up) has nothing
    // left to finish and must never be mistaken for a tap.
    if (!entry) return;

    if (!canvasMovedRef.current) {
      // A camera tap: two quick taps recentre the view (branch first, then graph).
      const now = Date.now();
      const previousTap = lastEmptyTapRef.current;
      lastEmptyTapRef.current = { at: now, x: event.clientX, y: event.clientY };
      if (previousTap && now - previousTap.at < 350) {
        lastEmptyTapRef.current = null;
        recentreCamera();
      }
      return;
    }

    const drag = dragRef.current;
    const wasPinch = multiPointerRef.current;
    canvasMovedRef.current = false;
    // A pinch already ends deliberately at the user's chosen distance, so only
    // one-finger orbit/pan gestures carry momentum.
    if (wasPinch) return;
    startMomentum(entry.role, drag.vx, drag.vy, drag.distance);
  };

  const handleWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    event.preventDefault();
    stopCameraMotion();
    applyCamera(dollyCamera(cameraRef.current, Math.pow(WHEEL_DOLLY_BASE, event.deltaY * prefsRef.current.zoomSensitivity)));
  };

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
      if (node.data.type === 'reminder' && hiddenSecondaryNodes.reminders) return;
      if (node.data.type === 'subtask' && hiddenSecondaryNodes.subtasks) return;
      visible.add(node.id);
    });
    return visible;
  }, [hiddenSecondaryNodes, nodes]);

  // ---- Connection rendering ------------------------------------------------
  // Brightness/contrast are resolved once per appearance change and then applied
  // together with zoom-aware and density-aware de-cluttering.
  const connection = useMemo(() => resolveConnectionRenderSettings(appearance), [appearance]);

  const visibleEdges = useMemo(() => {
    const list: Array<{ edge: Edge; source: ProjectedPoint; target: ProjectedPoint }> = [];
    for (const edge of edges) {
      if (!visibleNodeIds.has(edge.source) || !visibleNodeIds.has(edge.target)) continue;
      const source = projected.get(edge.source);
      const target = projected.get(edge.target);
      if (!source || !target || !source.visible || !target.visible) continue;
      list.push({ edge, source, target });
    }
    return list;
  }, [edges, projected, visibleNodeIds]);

  /** Average projected scale of the visible connections, used for zoom LOD. */
  const meanConnectionScale = useMemo(() => {
    if (visibleEdges.length === 0) return focal / Math.max(1, camera.distance);
    let sum = 0;
    for (const entry of visibleEdges) sum += (entry.source.scale + entry.target.scale) / 2;
    return sum / visibleEdges.length;
  }, [camera.distance, focal, visibleEdges]);

  const screenObstacles = useMemo(() => {
    const list: ScreenObstacle[] = [];
    for (const node of nodes) {
      if (!visibleNodeIds.has(node.id)) continue;
      const point = projected.get(node.id);
      if (!point || !point.visible) continue;
      const half = nodeHalfExtent(node.data.type);
      list.push({ id: node.id, x: point.screenX, y: point.screenY, radius: Math.max(half.x, half.y) * point.scale + 4 });
    }
    return list;
  }, [nodes, projected, visibleNodeIds]);

  // Routing is a readability win, not a correctness requirement, so it is
  // skipped on graphs large enough for the extra work to be felt.
  const routingEnabled = visibleEdges.length <= ROUTING_MAX_EDGES && screenObstacles.length <= ROUTING_MAX_OBSTACLES;
  const screenGrid = useMemo(
    () => (routingEnabled ? buildScreenGrid(screenObstacles) : null),
    [routingEnabled, screenObstacles],
  );

  /**
   * Every drawable connection, resolved once per frame: geometry, routing,
   * brightness/contrast, zoom fade, density damping and selection emphasis.
   *
   * Resolving here (instead of inline in JSX) keeps the render body a simple
   * map and means the whole connection treatment can be reasoned about in one
   * place. A relationship is only ever dimmed or bowed - never removed.
   */
  const renderedConnections = useMemo<RenderedConnection[]>(() => {
    if (visibleEdges.length === 0) return [];
    const zoomFade = connectionZoomFade(meanConnectionScale);
    const widthScale = connectionWidthScale(meanConnectionScale);
    const density = connectionDensityDamp(visibleEdges.length);
    // A contrast halo needs an extra element per line, so it is only paid for on
    // graphs small enough that the router already runs.
    const casingOpacity = routingEnabled ? connection.casingOpacity : 0;
    const list: RenderedConnection[] = [];

    for (const { edge, source, target } of visibleEdges) {
      const isSelectedPath = selectedId === edge.source || selectedId === edge.target;
      const isBackgroundPath = Boolean(selectedId) && !isSelectedPath;
      const baseAlpha = Number(edge.style?.strokeOpacity ?? 0.55);
      const baseWidth = Number(edge.style?.strokeWidth ?? 1.5);
      const stroke = typeof edge.style?.stroke === 'string' ? edge.style.stroke : '#64748b';

      let alpha = connection.alpha(baseAlpha) * zoomFade * density;
      if (isBackgroundPath) alpha *= 0.4;
      // The focused node's own relationships stay the most legible thing on screen.
      if (isSelectedPath) alpha = Math.min(1, alpha * 1.5 + 0.3);

      const strokeWidth = Math.max(0.6, baseWidth * widthScale + connection.widthBonus) * (isSelectedPath ? 1.45 : 1);

      let path = `M ${source.screenX} ${source.screenY} L ${target.screenX} ${target.screenY}`;
      if (screenGrid) {
        // The two nodes a connection belongs to are never obstacles to itself.
        const obstacles = screenGrid
          .query(source, target)
          .filter((obstacle) => obstacle.id !== edge.source && obstacle.id !== edge.target);
        path = routeConnection(source, target, obstacles, Math.max(8, strokeWidth * 3)).path;
      }

      list.push({
        id: edge.id,
        path,
        stroke,
        strokeWidth,
        strokeOpacity: Math.max(0.05, Math.min(1, alpha)),
        casingOpacity: isBackgroundPath ? casingOpacity * 0.5 : casingOpacity,
        active: Boolean(edge.animated) || isSelectedPath,
      });
    }
    return list;
  }, [connection, meanConnectionScale, routingEnabled, screenGrid, selectedId, visibleEdges]);

  /*
   * Level of detail for the whole mesh, derived from how tall the visible nodes
   * actually project. Pulling the camera back simplifies each card (labels, then
   * metadata) so hundreds of nodes stay distinguishable instead of fusing into a
   * slab of text. Node size in graph space is never changed by this - only the
   * amount of content drawn inside an already-small node.
   */
  const detailLevel = useMemo(() => {
    const visible: Array<{ type: string; scale: number }> = [];
    for (const node of nodes) {
      const point = projected.get(node.id);
      if (!point || !point.visible) continue;
      visible.push({ type: node.data.type, scale: point.scale });
    }
    const meanHeight = meanNodeScreenHeight(visible);
    return resolveGraphDetailLevel(meanHeight ?? focal / Math.max(1, camera.distance) * 100);
  }, [camera.distance, focal, nodes, projected]);

  const renderedNodes = nodes
    .filter((node) => visibleNodeIds.has(node.id))
    .sort((a, b) => (projected.get(b.id)?.depth ?? 0) - (projected.get(a.id)?.depth ?? 0));

  const activeDrag = interactionRef.current;

  return (
    <div
      ref={viewportRef}
      className={`mm-spatial-graph${moveMode ? ' mm-spatial-graph--move' : ''}`}
      data-testid="spatial-graph"
      data-lod-level={detailLevel}
      data-spatial-active="true"
      data-camera-yaw={camera.yaw}
      data-camera-pitch={camera.pitch}
      data-camera-distance={camera.distance}
      data-camera-target-x={camera.target.x}
      data-camera-target-y={camera.target.y}
      data-camera-target-z={camera.target.z}
      data-camera-min-distance={limits.min}
      data-camera-max-distance={limits.max}
      data-focused-node-id={selectedId ?? ''}
      data-move-mode={moveMode}
      data-reduced-motion={reducedMotion}
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
        // A camera drag is not a tap: it must not clear the current selection.
        if (canvasMovedRef.current) { canvasMovedRef.current = false; return; }
        setNodeHintOpen(false);
        setSelectedId(null);
        onEmptyClick?.();
      }}
    >
      <svg className="mm-spatial-connections" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-hidden="true">
        {renderedConnections.map((line) => (
          <g key={line.id} data-connection-id={line.id}>
            {/* Background-aware halo so lines stay separated from the void glow,
                Matrix code rain and imported photos. */}
            {line.casingOpacity > 0 && (
              <path
                className="mm-spatial-edge-casing"
                d={line.path}
                fill="none"
                stroke={connection.casingColor}
                strokeWidth={line.strokeWidth + 2.4}
                strokeOpacity={line.casingOpacity}
                strokeLinecap="round"
              />
            )}
            <path
              className={line.active ? 'mm-spatial-edge mm-spatial-edge--active' : 'mm-spatial-edge'}
              d={line.path}
              fill="none"
              stroke={line.stroke}
              strokeWidth={line.strokeWidth}
              strokeOpacity={line.strokeOpacity}
              strokeLinecap="round"
            />
          </g>
        ))}
      </svg>

      <div className="mm-spatial-stars" aria-hidden="true" />
      {renderedNodes.map((node) => {
        const point = projected.get(node.id);
        const Component = NODE_COMPONENTS[node.type || ''];
        if (!point || !point.visible || !Component) return null;
        const isFocused = selectedId === node.id;
        // The node keeps its fixed size in graph space and is only *projected*:
        // zooming the camera in brings it closer and visibly larger, zooming out
        // makes it smaller. No inverse-zoom / constant-screen-size compensation
        // is applied to the node itself. Only the selection highlight (and the
        // card's own labels) may scale a little, and never against the camera.
        const nodeScale = point.scale * (isFocused ? 1.06 : 1); // world-space size
        // The focused node stays obviously highlighted without burying the rest
        // of the network: everything else keeps enough opacity for context.
        const isDimmed = Boolean(selectedId && !isFocused && node.data.type !== 'root');
        return (
          <div
            key={node.id}
            className={`mm-spatial-node${isFocused ? ' mm-spatial-node--focused' : ''}`}
            data-node-id={node.id}
            data-depth={Math.round(point.z)}
            data-node-focused={isFocused}
            onPointerDown={(event) => {
              // Node repositioning is an explicit action: outside Move mode a
              // drag on a node is a camera gesture like any other, so rotating
              // the network can never nudge node coordinates.
              if (!moveMode || !onNodePositionChange) return;
              if (interactionRef.current.mode !== 'IDLE') return;
              event.stopPropagation();
              event.preventDefault();
              stopCameraMotion();
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
              // Tap once = go to the node, tap the same node again = options.
              const repeatTap = selectedId === node.id;
              if (!readStoredFlag(NODE_HINT_STORAGE_KEY)) {
                if (repeatTap) {
                  setNodeHintOpen(false);
                  writeStoredFlag(NODE_HINT_STORAGE_KEY);
                } else {
                  setNodeHintOpen(true);
                }
              }
              setSelectedId(node.id);
              node.data.onNodeClick?.(node.id, node.data.type);
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
            style={{ left: point.screenX, top: point.screenY, zIndex: Math.round(2000 - point.depth), opacity: isDimmed ? 0.45 : Math.max(0.62, Math.min(1, 1.15 - point.depth / 2100)), filter: point.depth > 1250 ? 'saturate(0.72)' : undefined, transform: `translate(-50%, -50%) scale(${nodeScale})` }}
          >
            <Component id={node.id} type={node.type} data={node.data} selected={isFocused} dragging={activeDrag.mode === 'NODE_DRAG' && activeDrag.nodeId === node.id} zIndex={node.zIndex} xPos={node.position.x} yPos={node.position.y} sourcePosition={Position.Bottom} targetPosition={Position.Top} isConnectable={false} />
          </div>
        );
      })}

      {nodeHintOpen && (
        <div className="mm-spatial-hint" role="status" data-spatial-ui="true" data-testid="spatial-node-hint">
          Tap once to focus a node. Tap it again to open its options.
        </div>
      )}

      {legendOpen && (
        <div className="mm-spatial-legend" role="dialog" aria-label="Gesture guide" data-spatial-ui="true" data-testid="spatial-gesture-legend">
          <div className="mm-spatial-legend-head">
            <span>Explore your MindMesh</span>
            <button type="button" onClick={closeLegend} aria-label="Close gesture guide" title="Close"><X size={14} /></button>
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
          <div className="mm-spatial-legend-foot">
            Reposition a node: turn on Move, then drag that node.
            <br />
            Desktop: left-drag orbits · right-drag pans · scroll to zoom.
          </div>
        </div>
      )}

      <div className="mm-spatial-hud" data-spatial-ui="true" aria-label="3D graph controls">
        <div className="mm-spatial-breadcrumb">
          <span className="mm-spatial-compass">◎</span>
          <span>{selectedId ? nodes.find((node) => node.id === selectedId)?.data.label : 'MindMesh network'}</span>
          {moveMode && <small>move nodes</small>}
          {!moveMode && isInteracting && <small>exploring</small>}
        </div>
        <div className="mm-spatial-actions">
          <button type="button" onClick={resetCamera} aria-label="Home — return to the centre of the graph" title="Home — return to the centre"><Home size={16} /></button>
          {/* Only offered where repositioning is actually persisted. */}
          {onNodePositionChange && (
            <button
              type="button"
              onClick={() => setMoveMode((previous) => !previous)}
              aria-label="Toggle node move mode"
              aria-pressed={moveMode}
              title={moveMode ? 'Move mode on — drag a node to reposition it' : 'Move mode off — drag anywhere to rotate'}
              className={moveMode ? 'mm-spatial-action--active' : undefined}
            >
              <Move size={16} />
            </button>
          )}
          <button type="button" onClick={() => setLegendOpen((open) => !open)} aria-label="Toggle gesture guide" aria-pressed={legendOpen} title="Gesture guide"><HelpCircle size={16} /></button>
        </div>
        <div className="mm-spatial-help">Drag: rotate · Pinch: zoom · Two fingers: move · Tap: focus · Double-tap: centre</div>
      </div>
    </div>
  );
};

SpatialGraph.displayName = 'SpatialGraph';
