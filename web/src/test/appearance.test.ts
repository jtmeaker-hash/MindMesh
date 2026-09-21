import { describe, it, expect, beforeEach } from 'vitest';
import {
  APPEARANCE_PRESETS,
  applyPreset,
  getChromeTheme,
  getDefaultAppearance,
  getReadableTextColor,
  isLightBackground,
  mixColors,
  normalizeAppearance,
  resolveNodeTheme,
  withAlpha,
} from '../services/appearance';
import {
  generateActiveMesh,
  generateCompletedCategoryMesh,
  generateCompletedOverviewMesh,
} from '../utils/layout';
import {
  loadAllData,
  loadAppearance,
  saveAllData,
  saveAppearance,
  CURRENT_STORAGE_VERSION,
} from '../services/storage';
import { createBackup, migrateBackup, validateBackup, restoreBackup } from '../services/backup';
import { Category, Reminder } from '../types';
import { AppearanceSettings } from '../types/appearance';

const categories: Category[] = [
  { id: 'cat-work', name: 'Work', color: '#ec4899', icon: 'briefcase', createdAt: new Date().toISOString() },
  { id: 'cat-home', name: 'Home', color: '#f59e0b', icon: 'home', createdAt: new Date().toISOString() },
];

const reminders: Reminder[] = [
  {
    id: 'rem-1',
    categoryId: 'cat-work',
    title: 'Ship the release',
    priority: 'high',
    completed: false,
    subtasks: [
      { id: 'sub-1', reminderId: 'rem-1', title: 'Write notes', completed: false, createdAt: new Date().toISOString() },
      { id: 'sub-2', reminderId: 'rem-1', title: 'Tag build', completed: true, createdAt: new Date().toISOString() },
    ],
    createdAt: new Date().toISOString(),
  },
  {
    id: 'rem-done',
    categoryId: 'cat-home',
    title: 'Pay rent',
    priority: 'medium',
    completed: true,
    completedAt: new Date().toISOString(),
    subtasks: [
      {
        id: 'sub-done-1',
        reminderId: 'rem-done',
        title: 'Transfer funds',
        completed: true,
        createdAt: new Date().toISOString(),
      },
    ],
    createdAt: new Date().toISOString(),
  },
];

describe('Appearance engine', () => {
  it('provides a default appearance that preserves the original MindMesh look', () => {
    const appearance = getDefaultAppearance();
    expect(appearance.themeId).toBe('default');
    expect(appearance.nodeColorMode).toBe('category');
    expect(appearance.connectionColorMode).toBe('inherit');
    expect(appearance.background.kind).toBe('default');
    expect(appearance.matrix.enabled).toBe(false);
    expect(appearance.threeD.level).toBe('medium');
    expect(appearance.threeD.perspective).toBe(900);

    const { nodes } = generateActiveMesh(categories, reminders, null, undefined, undefined, undefined, appearance);
    const categoryNode = nodes.find((n) => n.id === 'cat-work');
    expect(categoryNode?.data.color).toBe('#ec4899');
  });

  it('ships Aqua, Orange and Matrix presets with matching node + connection palettes', () => {
    const ids = APPEARANCE_PRESETS.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['aqua', 'orange', 'matrix']));

    const aqua = APPEARANCE_PRESETS.find((p) => p.id === 'aqua')!;
    expect(aqua.nodeColors.root).toBe('#22d3ee');
    expect(aqua.connectionColors.branch).toBe('#22d3ee');

    const matrix = APPEARANCE_PRESETS.find((p) => p.id === 'matrix')!;
    expect(matrix.nodeColors.root).toBe('#00ff41');
    expect(matrix.backgroundKind).toBe('black');
    expect(matrix.matrixEnabled).toBe(true);
  });

  it('applies presets without locking out individual customisation', () => {
    const base = getDefaultAppearance();
    const aqua = applyPreset(base, 'aqua');

    expect(aqua.themeId).toBe('aqua');
    expect(aqua.nodeColorMode).toBe('custom');
    expect(aqua.connectionColorMode).toBe('custom');
    expect(aqua.nodeColors.reminder).toBe('#0ea5e9');
    expect(aqua.background.kind).toBe('default');

    // Matrix preset turns the code rain on...
    const matrix = applyPreset(base, 'matrix');
    expect(matrix.matrix.enabled).toBe(true);
    expect(matrix.background.kind).toBe('black');

    // ...but the user can turn it back off without losing the palette
    const disabled: AppearanceSettings = { ...matrix, matrix: { ...matrix.matrix, enabled: false } };
    expect(disabled.matrix.enabled).toBe(false);
    expect(disabled.nodeColors.root).toBe('#00ff41');

    // Returning to the default preset restores per-category colours
    const restored = applyPreset(aqua, 'default');
    expect(restored.nodeColorMode).toBe('category');
    expect(restored.connectionColorMode).toBe('inherit');
  });

  it('keeps the imported background photo when applying a colour preset', () => {
    const withImage: AppearanceSettings = {
      ...getDefaultAppearance(),
      background: {
        ...getDefaultAppearance().background,
        kind: 'image',
        image: { ...getDefaultAppearance().background.image, dataUrl: 'data:image/png;base64,AAAA' },
      },
    };

    const aqua = applyPreset(withImage, 'aqua');
    expect(aqua.background.kind).toBe('image');
    expect(aqua.background.image.dataUrl).toBe('data:image/png;base64,AAAA');
  });

  it('normalises hostile or legacy input instead of throwing', () => {
    expect(normalizeAppearance(null).themeId).toBe('default');
    expect(normalizeAppearance('nope').background.kind).toBe('default');
    expect(normalizeAppearance([]).matrix.enabled).toBe(false);

    const sanitised = normalizeAppearance({
      themeId: 'not-a-theme',
      nodeColorMode: 'nonsense',
      nodeColors: { root: 'javascript:alert(1)', category: '#0ff' },
      connectionColors: { branch: 42 },
      surfaceMode: 'neon',
      background: {
        kind: 'image',
        dim: 12,
        image: { dataUrl: 'https://evil.example/x.png', fit: 'stretch', opacity: -3, blur: 900 },
      },
      matrix: { enabled: 'yes', speed: 99, opacity: 100, density: 0, fontSize: 2, color: 'red' },
      showGrid: 'maybe',
      gridColor: 'url(#x)',
    });

    expect(sanitised.themeId).toBe('default');
    expect(sanitised.nodeColorMode).toBe('category');
    expect(sanitised.nodeColors.root).toBe(getDefaultAppearance().nodeColors.root);
    expect(sanitised.nodeColors.category).toBe('#0ff');
    expect(sanitised.connectionColors.branch).toBe(getDefaultAppearance().connectionColors.branch);
    // 'image' with no usable data URL falls back to a real background
    expect(sanitised.background.kind).toBe('default');
    expect(sanitised.background.image.dataUrl).toBeUndefined();
    expect(sanitised.background.dim).toBeCloseTo(0.9);
    expect(sanitised.background.image.opacity).toBeCloseTo(0.05);
    expect(sanitised.background.image.blur).toBeCloseTo(24);
    expect(sanitised.matrix.enabled).toBe(false);
    expect(sanitised.matrix.speed).toBeCloseTo(3);
    expect(sanitised.matrix.opacity).toBeCloseTo(1);
    expect(sanitised.matrix.density).toBeCloseTo(0.05);
    expect(sanitised.matrix.fontSize).toBe(10);
    expect(sanitised.matrix.color).toBe(getDefaultAppearance().matrix.color);
    expect(sanitised.showGrid).toBe(true);
    expect(sanitised.threeD.level).toBe('medium');
    expect(sanitised.threeD.perspective).toBe(900);
  });

  it('computes readable text and contrast helpers', () => {
    expect(getReadableTextColor('#ffffff')).toBe('#0b1220');
    expect(getReadableTextColor('#000000')).toBe('#f8fafc');
    expect(withAlpha('#6366f1', 0.5)).toBe('rgba(99, 102, 241, 0.5)');
    expect(mixColors('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(getReadableTextColor('not-a-colour')).toBe('#f8fafc');
  });

  it('switches the app shell to light chrome on light backgrounds', () => {
    const dark = getDefaultAppearance();
    expect(isLightBackground(dark)).toBe(false);
    expect(getChromeTheme(dark).text).toBe('#f8fafc');

    const white: AppearanceSettings = {
      ...dark,
      background: { ...dark.background, kind: 'white' },
    };
    expect(isLightBackground(white)).toBe(true);
    expect(getChromeTheme(white).text).toBe('#0f172a');

    // Explicit override wins over the background kind
    const forcedDark: AppearanceSettings = { ...white, surfaceMode: 'dark' };
    expect(isLightBackground(forcedDark)).toBe(false);

    const darkImageForcedLight: AppearanceSettings = { ...dark, surfaceMode: 'light' };
    expect(isLightBackground(darkImageForcedLight)).toBe(true);
  });

  it('keeps node labels readable on light panels', () => {
    const appearance: AppearanceSettings = {
      ...getDefaultAppearance(),
      background: { ...getDefaultAppearance().background, kind: 'white' },
    };
    const theme = resolveNodeTheme(appearance, '#22d3ee');
    expect(theme.text).toBe('#0f172a');
    expect(theme.surface).toBe('#ffffff');
  });
});

describe('Appearance applied to the mesh graph', () => {
  const aqua: AppearanceSettings = applyPreset(getDefaultAppearance(), 'aqua');

  it('uses the custom palette for every node type and connection', () => {
    const { nodes, edges } = generateActiveMesh(categories, reminders, null, undefined, undefined, undefined, aqua);

    const root = nodes.find((n) => n.id === 'root');
    expect(root?.data.color).toBe('#22d3ee');

    const category = nodes.find((n) => n.id === 'cat-work');
    expect(category?.data.color).toBe('#06b6d4');

    const reminder = nodes.find((n) => n.id === 'rem-1');
    expect(reminder?.data.color).toBe('#0ea5e9');
    expect(typeof reminder?.data.textColor).toBe('string');

    const subtask = nodes.find((n) => n.id === 'sub-1');
    expect(subtask?.data.color).toBe('#67e8f9');

    const branchEdge = edges.find((e) => e.source === 'root' && e.target === 'cat-work');
    expect(branchEdge?.style?.stroke).toBe('#22d3ee');

    const reminderEdge = edges.find((e) => e.source === 'cat-work' && e.target === 'rem-1');
    expect(reminderEdge?.style?.stroke).toBe('#38bdf8');

    const subtaskEdge = edges.find((e) => e.source === 'rem-1' && e.target === 'sub-2');
    expect(subtaskEdge?.style?.stroke).toBe('#2dd4bf');
  });

  it('applies completed colours in the completed views', () => {
    const overview = generateCompletedOverviewMesh(categories, reminders, undefined, undefined, aqua);
    const catNode = overview.nodes.find((n) => n.id === 'cat-home');
    expect(catNode?.data.color).toBe('#14b8a6');

    const detail = generateCompletedCategoryMesh(categories[1], reminders, undefined, undefined, undefined, aqua);
    const completedReminder = detail.nodes.find((n) => n.id === 'rem-done');
    expect(completedReminder?.data.color).toBe('#14b8a6');

    expect(detail.edges.find((e) => e.target === 'rem-done')?.style?.stroke).toBe('#38bdf8');
    expect(detail.edges.find((e) => e.target === 'sub-done-1')?.style?.stroke).toBe('#2dd4bf');
  });

  it('still renders a graph when no appearance is supplied', () => {
    const { nodes, edges } = generateActiveMesh(categories, reminders);
    expect(nodes.length).toBeGreaterThan(0);
    expect(edges.length).toBeGreaterThan(0);
  });
});

describe('Appearance persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips appearance settings through local storage', () => {
    const matrix = applyPreset(getDefaultAppearance(), 'matrix');
    saveAppearance(matrix);

    const reloaded = loadAppearance();
    expect(reloaded.themeId).toBe('matrix');
    expect(reloaded.nodeColors.root).toBe('#00ff41');
    expect(reloaded.background.kind).toBe('black');
    expect(reloaded.matrix.enabled).toBe(true);
  });

  it('includes appearance in the persisted state payload and survives a reload', () => {
    const custom = applyPreset(getDefaultAppearance(), 'orange');
    saveAppearance(custom);

    const raw = localStorage.getItem('mindmesh_state_v2');
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).appearance.themeId).toBe('orange');

    const hydrated = loadAllData();
    expect(hydrated.version).toBe(CURRENT_STORAGE_VERSION);
    expect(hydrated.appearance?.nodeColors.root).toBe('#fb923c');
  });

  it('repairs corrupt appearance data found in storage', () => {
    const state = loadAllData();
    saveAllData({ ...state, appearance: { themeId: 'hacked', nodeColors: 'nope' } as unknown as AppearanceSettings });

    const repaired = loadAppearance();
    expect(repaired.themeId).toBe('default');
    expect(repaired.nodeColors.root).toBe(getDefaultAppearance().nodeColors.root);
  });
});

describe('Appearance in the backup system', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('captures appearance in a full backup and reports it in the summary', () => {
    saveAppearance(applyPreset(getDefaultAppearance(), 'matrix'));

    const backup = createBackup();
    expect(backup.data.appearance?.themeId).toBe('matrix');

    const validation = validateBackup(JSON.stringify(backup));
    expect(validation.valid).toBe(true);
    expect(validation.summary?.hasAppearance).toBe(true);
    expect(validation.summary?.appearanceTheme).toBe('matrix');
  });

  it('restores appearance together with the rest of the data', () => {
    saveAppearance(applyPreset(getDefaultAppearance(), 'aqua'));
    const backup = createBackup();

    // Wipe to defaults, then restore
    saveAppearance(getDefaultAppearance());
    expect(loadAppearance().themeId).toBe('default');

    const result = restoreBackup(backup);
    expect(result.success).toBe(true);
    expect(loadAppearance().themeId).toBe('aqua');
    expect(loadAppearance().nodeColors.subtask).toBe('#67e8f9');
  });

  it('migrates older backups that have no appearance section', () => {
    const legacyBackup = {
      backupVersion: 1,
      appVersion: '1.0.0',
      appName: 'MindMesh',
      createdAt: new Date().toISOString(),
      schemaVersion: 3,
      data: { categories, reminders, nodePositions: {} },
    };

    const validation = validateBackup(JSON.stringify(legacyBackup));
    expect(validation.valid).toBe(true);
    expect(validation.summary?.hasAppearance).toBe(false);

    const migrated = migrateBackup(validation.backupFile!);
    expect(migrated.appearance).toBeDefined();
    expect(migrated.appearance?.themeId).toBe('default');
    expect(migrated.version).toBe(CURRENT_STORAGE_VERSION);
  });

  it('falls back to defaults when a backup carries unreadable appearance data', () => {
    const broken = {
      backupVersion: 1,
      appVersion: '1.3.0',
      appName: 'MindMesh',
      createdAt: new Date().toISOString(),
      schemaVersion: CURRENT_STORAGE_VERSION,
      data: { categories, reminders, nodePositions: {}, appearance: 'not-an-object' },
    };

    const validation = validateBackup(JSON.stringify(broken));
    expect(validation.valid).toBe(true);
    expect(validation.summary?.hasAppearance).toBe(false);
    expect(validation.summary?.warnings.length).toBeGreaterThan(0);

    const migrated = migrateBackup(validation.backupFile!);
    expect(migrated.appearance?.themeId).toBe('default');
  });
});
