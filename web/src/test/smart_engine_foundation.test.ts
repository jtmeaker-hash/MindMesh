import { beforeEach, describe, expect, it } from 'vitest';
import { createBackup, migrateBackup, restoreBackup, serializeBackup } from '../services/backup';
import { createSmartEngine, DefaultSmartEngineActionValidator } from '../services/smartEngine';
import { loadAllData, loadSmartEngineSettings, saveAllData } from '../services/storage';
import { Category } from '../types';
import { CreateCategoryProposal, DEFAULT_SMART_ENGINE_SETTINGS } from '../types/smartEngine';

const categories: Category[] = [
  { id: 'work', name: 'Work', color: '#38bdf8', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'work-admin', name: 'Admin', color: '#38bdf8', parentCategoryId: 'work', createdAt: '2026-01-01T00:00:00.000Z' },
];

describe('MindMesh Smart Engine foundation', () => {
  beforeEach(() => localStorage.clear());

  it('initializes with safe local-only defaults', () => {
    const engine = createSmartEngine({ contextProvider: undefined });
    expect(engine.settings).toEqual(DEFAULT_SMART_ENGINE_SETTINGS);
    expect(engine.getContextProvider().getCategories()).toEqual([]);
  });

  it('returns Unknown for empty and not-yet-supported input instead of guessing', () => {
    const engine = createSmartEngine();
    expect(engine.interpret('create-reminder', '').status).toBe('unknown');
    const result = engine.interpret('create-reminder', 'remind me to do something someday');
    expect(result.status).toBe('unknown');
    expect(result.confidence.score).toBe(0);
    expect(result.proposal).toBeUndefined();
    expect(result.message).toContain('not implemented');
  });

  it('exposes exact app category context without creating a second repository', () => {
    const engine = createSmartEngine({
      contextProvider: {
        getCategories: () => categories,
        getSubcategories: (parentId) => categories.filter((category) => category.parentCategoryId === parentId),
      },
    });
    expect(engine.getContextProvider().getCategories()).toHaveLength(2);
    expect(engine.getContextProvider().getSubcategories('work').map((category) => category.name)).toEqual(['Admin']);
  });

  it('keeps write actions confirmation-gated and rejects low-confidence proposals', () => {
    const action: CreateCategoryProposal = {
      type: 'create-category',
      id: 'proposal-1',
      preview: 'Create category “Maybe”',
      name: { value: 'Maybe', confidence: { score: 0.55, reason: 'ambiguous' } },
      parentCategoryId: { value: null, confidence: { score: 0.55, reason: 'ambiguous' } },
      confidence: { score: 0.55, reason: 'ambiguous' },
      missingFields: [],
      ambiguities: [{ field: 'parentCategoryId', message: 'Parent category is unclear.' }],
      validation: { valid: false, canWrite: false, reasons: [] },
    };
    const engine = createSmartEngine();
    const validation = engine.validateProposal(action);
    expect(validation.valid).toBe(false);
    expect(validation.canWrite).toBe(false);
    expect(validation.reasons).toContain('Ambiguous fields require confirmation.');
    expect(validation.reasons).toContain('Confidence is below the write threshold.');
  });

  it('does not write user data while interpreting or validating', () => {
    const before = localStorage.getItem('mindmesh_state_v2');
    const engine = createSmartEngine();
    engine.interpret('edit-reminder', 'change the title');
    expect(engine.validateProposal({
      type: 'create-category',
      id: 'proposal-2',
      preview: 'Create category “X”',
      name: { value: 'X', confidence: { score: 0.95, reason: 'explicit-pattern' } },
      parentCategoryId: { value: null, confidence: { score: 0.95, reason: 'explicit-pattern' } },
      confidence: { score: 0.95, reason: 'explicit-pattern' },
      missingFields: [],
      ambiguities: [],
      validation: { valid: true, canWrite: false, reasons: [] },
    })).toBeDefined();
    expect(localStorage.getItem('mindmesh_state_v2')).toBe(before);
  });

  it('persists Smart Engine settings additively and round-trips them through full backup', () => {
    const state = loadAllData();
    saveAllData({
      ...state,
      smartEngineSettings: {
        ...DEFAULT_SMART_ENGINE_SETTINGS,
        featureToggles: { summaries: true },
        minimumConfidenceForSuggestions: 0.8,
      },
    });
    expect(loadSmartEngineSettings().minimumConfidenceForSuggestions).toBe(0.8);

    const backup = createBackup();
    expect(backup.data.smartEngineSettings?.featureToggles).toEqual({ summaries: true });
    localStorage.clear();
    expect(restoreBackup(backup).success).toBe(true);
    expect(loadSmartEngineSettings().featureToggles).toEqual({ summaries: true });
  });

  it('migrates older backups with safe Smart Engine defaults', () => {
    const base = loadAllData();
    const backup = createBackup();
    const legacy = JSON.parse(serializeBackup(backup)) as typeof backup;
    delete legacy.data.smartEngineSettings;
    const migrated = migrateBackup(legacy);
    expect(migrated.smartEngineSettings).toEqual(DEFAULT_SMART_ENGINE_SETTINGS);
    expect(migrated.reminders).toEqual(base.reminders);
  });

  it('normalizes hostile settings without enabling writes or invalid thresholds', () => {
    const engine = createSmartEngine({
      settings: {
        minimumConfidenceForSuggestions: 4,
        minimumConfidenceForWrites: -2,
        featureToggles: { summaries: true, invalid: 'yes' as never },
      },
    });
    expect(engine.settings.minimumConfidenceForSuggestions).toBe(1);
    expect(engine.settings.minimumConfidenceForWrites).toBe(0);
    expect(engine.settings.featureToggles).toEqual({ summaries: true });
    expect(new DefaultSmartEngineActionValidator()).toBeDefined();
  });
});
