// ==================== APPEARANCE / VISUAL CUSTOMISATION MODELS ====================

export type AppearanceThemeId = 'default' | 'aqua' | 'orange' | 'matrix' | 'custom';

export type BackgroundKind = 'default' | 'black' | 'white' | 'void' | 'image';

/** Whether nodes keep their per-category colours or use the appearance palette */
export type NodeColorMode = 'category' | 'custom';

/** Whether edges follow their source node colour or a dedicated connection palette */
export type ConnectionColorMode = 'inherit' | 'custom';

/** Controls whether node panels render dark or light for contrast against the background */
export type UISurfaceMode = 'auto' | 'dark' | 'light';
export type ThreeDEffectsLevel = 'off' | 'low' | 'medium' | 'high';

/** Lightweight 3D treatment controls shared by the graph and app surfaces. */
export interface ThreeDSettings {
  level: ThreeDEffectsLevel;
  perspective: number;
  shadowIntensity: number;
  glowIntensity: number;
  animationIntensity: number;
  nodeDepth: number;
  connectionDepth: number;
  cardDepth: number;
  graphRotation: boolean;
  cameraSensitivity: number;
  zoomSensitivity: number;
  /** Inverts horizontal orbit (left/right drag). */
  invertRotation: boolean;
  connectionAnimationIntensity: number;
  /**
   * Kept for stored-data compatibility. Node focus travel is now core graph
   * navigation rather than an optional behaviour, so this is no longer exposed.
   */
  autoFocus: boolean;
  /** Light glide after an orbit/pan flick (0 disables momentum entirely). */
  cameraInertia: number;
  /** Inverts vertical orbit (up/down drag). */
  invertOrbitY: boolean;
  /** Shortens or removes camera travel animations, on top of the system setting. */
  reducedMotion: boolean;
}

export type BackgroundImageFit = 'cover' | 'contain';
export type BackgroundImagePosition = 'center' | 'top' | 'bottom' | 'left' | 'right';

export interface NodeColorPalette {
  root: string;
  category: string;
  reminder: string;
  subtask: string;
  completed: string;
  selected: string;
  hover: string;
}

export interface ConnectionColorPalette {
  branch: string;
  reminder: string;
  subtask: string;
  completed: string;
}

export interface BackgroundImageSettings {
  /** Base64 data URL kept inline so it survives storage + backups */
  dataUrl?: string;
  fit: BackgroundImageFit;
  position: BackgroundImagePosition;
  opacity: number; // 0 - 1
  blur: number; // px
}

export interface BackgroundSettings {
  kind: BackgroundKind;
  /** Base solid colour used by the "default" background kind */
  color: string;
  /** Darkening overlay strength applied above image/void layers (0 - 1) */
  dim: number;
  image: BackgroundImageSettings;
  /** Enables the slow atmospheric drift on the Void background */
  voidAnimated: boolean;
}

export interface MatrixSettings {
  enabled: boolean;
  color: string;
  fontSize: number;
  /** Animation speed multiplier (0.25 - 3) */
  speed: number;
  /** Overall layer opacity (0 - 1) */
  opacity: number;
  /** Fraction of columns that can hold an active stream (0.05 - 1) */
  density: number;
}

export interface AppearanceSettings {
  version: number;
  themeId: AppearanceThemeId;
  nodeColorMode: NodeColorMode;
  connectionColorMode: ConnectionColorMode;
  nodeColors: NodeColorPalette;
  connectionColors: ConnectionColorPalette;
  surfaceMode: UISurfaceMode;
  background: BackgroundSettings;
  matrix: MatrixSettings;
  threeD: ThreeDSettings;
  showGrid: boolean;
  gridColor: string;
}

/** Resolved colours handed to the graph renderer for a single node */
export interface ResolvedNodeTheme {
  accent: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  mutedText: string;
  border: string;
}

export const APPEARANCE_VERSION = 1;
