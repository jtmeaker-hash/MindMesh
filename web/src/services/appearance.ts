import {
  APPEARANCE_VERSION,
  AppearanceSettings,
  AppearanceThemeId,
  BackgroundImageFit,
  BackgroundImagePosition,
  BackgroundKind,
  ConnectionColorMode,
  ConnectionColorPalette,
  MatrixSettings,
  NodeColorMode,
  NodeColorPalette,
  ResolvedNodeTheme,
  UISurfaceMode,
} from '../types/appearance';

export const BACKGROUND_DEFAULT_COLOR = '#080B12';

const HEX_PATTERN = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;

const DEFAULT_NODE_COLORS: NodeColorPalette = {
  root: '#6366f1',
  category: '#06b6d4',
  reminder: '#3b82f6',
  subtask: '#0ea5e9',
  completed: '#38bdf8',
  selected: '#ffffff',
  hover: '#a5b4fc',
};

const DEFAULT_CONNECTION_COLORS: ConnectionColorPalette = {
  branch: '#6366f1',
  reminder: '#3b82f6',
  subtask: '#0ea5e9',
  completed: '#475569',
};

const DEFAULT_MATRIX: MatrixSettings = {
  enabled: false,
  color: '#22c55e',
  fontSize: 16,
  speed: 1,
  opacity: 0.35,
  density: 0.75,
};

export function getDefaultAppearance(): AppearanceSettings {
  return {
    version: APPEARANCE_VERSION,
    themeId: 'default',
    nodeColorMode: 'category',
    connectionColorMode: 'inherit',
    nodeColors: { ...DEFAULT_NODE_COLORS },
    connectionColors: { ...DEFAULT_CONNECTION_COLORS },
    surfaceMode: 'auto',
    background: {
      kind: 'default',
      color: BACKGROUND_DEFAULT_COLOR,
      dim: 0.25,
      image: {
        fit: 'cover',
        position: 'center',
        opacity: 0.85,
        blur: 0,
      },
      voidAnimated: true,
    },
    matrix: { ...DEFAULT_MATRIX },
    showGrid: true,
    gridColor: 'rgba(99, 102, 241, 0.15)',
  };
}

// ==================== PRESET THEMES ====================

export interface AppearanceThemePreset {
  id: Exclude<AppearanceThemeId, 'custom'>;
  name: string;
  description: string;
  nodeColors: NodeColorPalette;
  connectionColors: ConnectionColorPalette;
  backgroundKind: BackgroundKind;
  matrixEnabled: boolean;
  gridColor: string;
}

export const APPEARANCE_PRESETS: AppearanceThemePreset[] = [
  {
    id: 'default',
    name: 'MindMesh',
    description: 'The original indigo shell with per-category node colours.',
    nodeColors: { ...DEFAULT_NODE_COLORS },
    connectionColors: { ...DEFAULT_CONNECTION_COLORS },
    backgroundKind: 'default',
    matrixEnabled: false,
    gridColor: 'rgba(99, 102, 241, 0.15)',
  },
  {
    id: 'aqua',
    name: 'Aqua',
    description: 'Deep water darkness with cyan nodes and currents.',
    nodeColors: {
      root: '#22d3ee',
      category: '#06b6d4',
      reminder: '#0ea5e9',
      subtask: '#67e8f9',
      completed: '#14b8a6',
      selected: '#e0f2fe',
      hover: '#a5f3fc',
    },
    connectionColors: {
      branch: '#22d3ee',
      reminder: '#38bdf8',
      subtask: '#7dd3fc',
      completed: '#2dd4bf',
    },
    backgroundKind: 'default',
    matrixEnabled: false,
    gridColor: 'rgba(34, 211, 238, 0.18)',
  },
  {
    id: 'orange',
    name: 'Orange',
    description: 'Charcoal night with amber and ember nodes.',
    nodeColors: {
      root: '#fb923c',
      category: '#f97316',
      reminder: '#f59e0b',
      subtask: '#fdba74',
      completed: '#fbbf24',
      selected: '#fff7ed',
      hover: '#fed7aa',
    },
    connectionColors: {
      branch: '#fb923c',
      reminder: '#f59e0b',
      subtask: '#fdba74',
      completed: '#fbbf24',
    },
    backgroundKind: 'default',
    matrixEnabled: false,
    gridColor: 'rgba(251, 146, 60, 0.16)',
  },
  {
    id: 'matrix',
    name: 'Matrix',
    description: 'Pure black with Matrix-green nodes and drifting code rain.',
    nodeColors: {
      root: '#00ff41',
      category: '#22c55e',
      reminder: '#4ade80',
      subtask: '#86efac',
      completed: '#15803d',
      selected: '#d1fae5',
      hover: '#bbf7d0',
    },
    connectionColors: {
      branch: '#00ff41',
      reminder: '#22c55e',
      subtask: '#4ade80',
      completed: '#15803d',
    },
    backgroundKind: 'black',
    matrixEnabled: true,
    gridColor: 'rgba(0, 255, 65, 0.14)',
  },
];

export function getPreset(id: AppearanceThemeId): AppearanceThemePreset | undefined {
  return APPEARANCE_PRESETS.find((p) => p.id === id);
}

/**
 * Applies a preset on top of the current appearance, keeping the user's
 * background image and code-rain preferences unless the preset itself defines them.
 */
export function applyPreset(current: AppearanceSettings, id: AppearanceThemeId): AppearanceSettings {
  if (id === 'custom') {
    return { ...current, themeId: 'custom' };
  }

  const preset = getPreset(id);
  if (!preset) return current;

  const isDefault = id === 'default';

  return {
    ...current,
    themeId: id,
    nodeColors: { ...preset.nodeColors },
    connectionColors: { ...preset.connectionColors },
    nodeColorMode: isDefault ? 'category' : 'custom',
    connectionColorMode: isDefault ? 'inherit' : 'custom',
    gridColor: preset.gridColor,
    background: {
      ...current.background,
      // Presets only own the background kind when the user is not using a photo.
      kind: current.background.kind === 'image' && !isDefault ? current.background.kind : preset.backgroundKind,
    },
    matrix: {
      ...current.matrix,
      enabled: preset.matrixEnabled ? true : current.matrix.enabled,
      color: preset.matrixEnabled ? preset.nodeColors.root : current.matrix.color,
    },
  };
}

// ==================== COLOUR HELPERS ====================

interface Rgb {
  r: number;
  g: number;
  b: number;
}

export function parseHexColor(color: string): Rgb | null {
  if (!color || typeof color !== 'string') return null;
  let hex = color.trim();
  if (!HEX_PATTERN.test(hex)) return null;
  hex = hex.slice(1);
  if (hex.length === 3) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }
  const value = parseInt(hex, 16);
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

export function relativeLuminance(color: string): number {
  const rgb = parseHexColor(color);
  if (!rgb) return 0;
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** Picks a readable foreground for any accent/surface colour. */
export function getReadableTextColor(background: string, light = '#f8fafc', dark = '#0b1220'): string {
  const rgb = parseHexColor(background);
  if (!rgb) return light;
  return relativeLuminance(background) > 0.5 ? dark : light;
}

export function withAlpha(color: string, alpha: number): string {
  const rgb = parseHexColor(color);
  if (!rgb) return color;
  const clamped = Math.max(0, Math.min(1, alpha));
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${clamped})`;
}

export function mixColors(a: string, b: string, ratio = 0.5): string {
  const rgbA = parseHexColor(a);
  const rgbB = parseHexColor(b);
  if (!rgbA || !rgbB) return a;
  const t = Math.max(0, Math.min(1, ratio));
  const channel = (x: number, y: number) => Math.round(x + (y - x) * t);
  const r = channel(rgbA.r, rgbB.r);
  const g = channel(rgbA.g, rgbB.g);
  const bl = channel(rgbA.b, rgbB.b);
  return `#${[r, g, bl].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

// ==================== THEME RESOLUTION ====================

/** True when the app shell should switch to a light chrome (text, gradients, panels). */
export function isLightBackground(appearance: AppearanceSettings): boolean {
  if (appearance.surfaceMode === 'light') return true;
  if (appearance.surfaceMode === 'dark') return false;
  return appearance.background.kind === 'white';
}

export interface ChromeTheme {
  isLight: boolean;
  accent: string;
  text: string;
  mutedText: string;
  softText: string;
  headerGradient: string;
  bottomGradient: string;
  titleGradient: string;
  panelBg: string;
  panelBorder: string;
}

export function getChromeTheme(appearance: AppearanceSettings): ChromeTheme {
  const isLight = isLightBackground(appearance);
  const accent = appearance.nodeColors.root || DEFAULT_NODE_COLORS.root;

  if (isLight) {
    return {
      isLight,
      accent,
      text: '#0f172a',
      mutedText: '#64748b',
      softText: '#475569',
      headerGradient: 'linear-gradient(180deg, rgba(255,255,255,0.94) 0%, rgba(255,255,255,0.55) 75%, transparent 100%)',
      bottomGradient: 'linear-gradient(0deg, rgba(255,255,255,0.96) 0%, rgba(255,255,255,0.7) 70%, transparent 100%)',
      titleGradient: `linear-gradient(135deg, #0f172a 40%, ${accent} 100%)`,
      panelBg: 'rgba(255, 255, 255, 0.92)',
      panelBorder: 'rgba(15, 23, 42, 0.12)',
    };
  }

  return {
    isLight,
    accent,
    text: '#f8fafc',
    mutedText: '#64748b',
    softText: '#94a3b8',
    headerGradient: 'linear-gradient(180deg, rgba(8,11,18,0.92) 0%, rgba(8,11,18,0.4) 75%, transparent 100%)',
    bottomGradient: 'linear-gradient(0deg, rgba(8,11,18,0.96) 0%, rgba(8,11,18,0.7) 70%, transparent 100%)',
    titleGradient: `linear-gradient(135deg, #ffffff 40%, ${accent} 100%)`,
    panelBg: 'rgba(15, 23, 42, 0.85)',
    panelBorder: 'rgba(255, 255, 255, 0.12)',
  };
}

/** Resolves the full palette a single graph node should render with. */
export function resolveNodeTheme(appearance: AppearanceSettings, accent: string): ResolvedNodeTheme {
  const isLight = isLightBackground(appearance);

  const surface = isLight ? '#ffffff' : '#141d2f';
  const surfaceAlt = isLight ? '#f1f5f9' : '#101827';
  const text = getReadableTextColor(surface, '#f8fafc', '#0f172a');
  const mutedText = isLight ? '#64748b' : '#94a3b8';

  return {
    accent,
    surface,
    surfaceAlt,
    text,
    mutedText,
    border: withAlpha(accent, isLight ? 0.55 : 0.65),
  };
}

/** Accent colour used for a node type when custom palette mode is active. */
export function accentForNodeType(
  appearance: AppearanceSettings,
  type: 'root' | 'category' | 'reminder' | 'subtask',
  options: { completed?: boolean; isFocused?: boolean } = {},
): string {
  const palette = appearance.nodeColors;
  if (options.isFocused) return palette.selected || DEFAULT_NODE_COLORS.selected;
  if (options.completed) return palette.completed;
  if (type === 'root') return palette.root;
  if (type === 'category') return palette.category;
  if (type === 'reminder') return palette.reminder;
  return palette.subtask;
}

// ==================== NORMALISATION ====================

function pickEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function pickColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_PATTERN.test(value.trim()) ? value.trim() : fallback;
}

function pickGridColor(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value.trim();
  if (HEX_PATTERN.test(trimmed) || /^rgba?\([\d\s.,%]+\)$/.test(trimmed)) return trimmed;
  return fallback;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(min, Math.min(max, num));
}

function pickBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function pickDataUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  return /^data:image\/(png|jpe?g|webp|gif|avif);base64,/.test(value) ? value : undefined;
}

/**
 * Coerces any unknown input (older storage, hand-edited backup, corrupt JSON)
 * into a fully valid AppearanceSettings object. Never throws.
 */
export function normalizeAppearance(raw: unknown): AppearanceSettings {
  const defaults = getDefaultAppearance();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults;

  const source = raw as Record<string, unknown>;
  const rawNodes = (source.nodeColors && typeof source.nodeColors === 'object' ? source.nodeColors : {}) as Record<string, unknown>;
  const rawLines = (source.connectionColors && typeof source.connectionColors === 'object' ? source.connectionColors : {}) as Record<string, unknown>;
  const rawBg = (source.background && typeof source.background === 'object' ? source.background : {}) as Record<string, unknown>;
  const rawImage = (rawBg.image && typeof rawBg.image === 'object' ? rawBg.image : {}) as Record<string, unknown>;
  const rawMatrix = (source.matrix && typeof source.matrix === 'object' ? source.matrix : {}) as Record<string, unknown>;

  const backgroundKinds: BackgroundKind[] = ['default', 'black', 'white', 'void', 'image'];
  const imageFit: BackgroundImageFit[] = ['cover', 'contain'];
  const imagePosition: BackgroundImagePosition[] = ['center', 'top', 'bottom', 'left', 'right'];
  const themeIds: AppearanceThemeId[] = ['default', 'aqua', 'orange', 'matrix', 'custom'];

  const dataUrl = pickDataUrl(rawImage.dataUrl);
  const requestedKind = pickEnum(rawBg.kind, backgroundKinds, defaults.background.kind);

  return {
    version: APPEARANCE_VERSION,
    themeId: pickEnum(source.themeId, themeIds, defaults.themeId),
    nodeColorMode: pickEnum<NodeColorMode>(source.nodeColorMode, ['category', 'custom'], defaults.nodeColorMode),
    connectionColorMode: pickEnum<ConnectionColorMode>(
      source.connectionColorMode,
      ['inherit', 'custom'],
      defaults.connectionColorMode,
    ),
    surfaceMode: pickEnum<UISurfaceMode>(source.surfaceMode, ['auto', 'dark', 'light'], defaults.surfaceMode),
    nodeColors: {
      root: pickColor(rawNodes.root, defaults.nodeColors.root),
      category: pickColor(rawNodes.category, defaults.nodeColors.category),
      reminder: pickColor(rawNodes.reminder, defaults.nodeColors.reminder),
      subtask: pickColor(rawNodes.subtask, defaults.nodeColors.subtask),
      completed: pickColor(rawNodes.completed, defaults.nodeColors.completed),
      selected: pickColor(rawNodes.selected, defaults.nodeColors.selected),
      hover: pickColor(rawNodes.hover, defaults.nodeColors.hover),
    },
    connectionColors: {
      branch: pickColor(rawLines.branch, defaults.connectionColors.branch),
      reminder: pickColor(rawLines.reminder, defaults.connectionColors.reminder),
      subtask: pickColor(rawLines.subtask, defaults.connectionColors.subtask),
      completed: pickColor(rawLines.completed, defaults.connectionColors.completed),
    },
    background: {
      // Gracefully fall back when the stored image data is missing or invalid
      kind: requestedKind === 'image' && !dataUrl ? defaults.background.kind : requestedKind,
      color: pickColor(rawBg.color, defaults.background.color),
      dim: clampNumber(rawBg.dim, 0, 0.9, defaults.background.dim),
      voidAnimated: pickBoolean(rawBg.voidAnimated, defaults.background.voidAnimated),
      image: {
        dataUrl,
        fit: pickEnum(rawImage.fit, imageFit, defaults.background.image.fit),
        position: pickEnum(rawImage.position, imagePosition, defaults.background.image.position),
        opacity: clampNumber(rawImage.opacity, 0.05, 1, defaults.background.image.opacity),
        blur: clampNumber(rawImage.blur, 0, 24, defaults.background.image.blur),
      },
    },
    matrix: {
      enabled: pickBoolean(rawMatrix.enabled, defaults.matrix.enabled),
      color: pickColor(rawMatrix.color, defaults.matrix.color),
      fontSize: Math.round(clampNumber(rawMatrix.fontSize, 10, 30, defaults.matrix.fontSize)),
      speed: clampNumber(rawMatrix.speed, 0.25, 3, defaults.matrix.speed),
      opacity: clampNumber(rawMatrix.opacity, 0.05, 1, defaults.matrix.opacity),
      density: clampNumber(rawMatrix.density, 0.05, 1, defaults.matrix.density),
    },
    showGrid: pickBoolean(source.showGrid, defaults.showGrid),
    gridColor: pickGridColor(source.gridColor, defaults.gridColor),
  };
}

export function appearancesMatch(a: AppearanceSettings, b: AppearanceSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
