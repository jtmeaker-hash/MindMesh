import { beforeEach, describe, expect, it } from 'vitest';
import { PluginManager } from '../plugins/core/manager';
import { createEmptyRegistryState, type MindMeshHostAPI } from '../plugins/core/types';
import { registerBuiltinPlugins } from '../plugins/registerBuiltins';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { createDefaultVehicleState } from '../services/vehicleMaintenance';
import { createBackup, restoreBackup, serializeBackup, validateBackup } from '../services/backup';
import {
  MEDICATION_TRACKER_PLUGIN_ID,
  MEDICATION_TRACKER_MANIFEST,
  createMedicationTrackerPlugin,
} from '../plugins/medication-tracker';
import {
  computeFileIntegrity,
  computePackageIntegrity,
  validatePluginPackage,
  PLUGIN_PACKAGE_FORMAT_VERSION,
} from '../plugins/core/manifest';
import { createDefaultState, normalizeState, type MedicationState } from '../plugins/medication-tracker/model';
import {
  buildDesiredNotifications,
  computeDoseOccurrences,
  getAdherenceStats,
  getDoseStatus,
  getDosesForDay,
  getPrnTakenToday,
  estimateRemaining,
  isLowSupply,
  logDose,
} from '../plugins/medication-tracker/logic';
import { bindStorage, clear as clearStore, getState, peek, setState } from '../plugins/medication-tracker/store';

const ISO = '2026-01-01T00:00:00.000Z';

function makeHost(): MindMeshHostAPI {
  return {
    moneyState: getDefaultMoneyState(),
    onUpdateMoneyState: () => undefined,
    vehicleState: createDefaultVehicleState(),
    onUpdateVehicleState: () => undefined,
    reminders: [],
    categories: [],
    onUpdateReminders: () => undefined,
    onUpdateCategories: () => undefined,
    notificationSettings: { enabled: true, historyLimit: 50 } as MindMeshHostAPI['notificationSettings'],
    onOpenReminder: () => undefined,
    navigateToTab: () => undefined,
  };
}

function makeState(overrides: Partial<MedicationState> = {}): MedicationState {
  const base = createDefaultState();
  return {
    ...base,
    items: [
      {
        id: 'm1',
        name: 'Metformin',
        kind: 'medication',
        active: true,
        asNeeded: false,
        createdAt: ISO,
        updatedAt: ISO,
      },
    ],
    schedules: [],
    ...overrides,
  };
}

function schedule(overrides: Partial<MedicationState['schedules'][number]> = {}) {
  return {
    id: 's1',
    itemId: 'm1',
    frequency: 'specific_times' as const,
    times: ['08:00'],
    startDate: '2020-01-01',
    active: true,
    createdAt: ISO,
    updatedAt: ISO,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  bindStorage(null);
  clearStore();
});

describe('medication-tracker model', () => {
  it('drops orphaned schedules, dose events and supply without failing', () => {
    const normalized = normalizeState({
      items: [{ id: 'm1', name: 'X', kind: 'medication', active: true, asNeeded: false, createdAt: ISO, updatedAt: ISO }],
      schedules: [
        { id: 's1', itemId: 'm1', frequency: 'daily', times: ['08:00'], startDate: '2020-01-01', active: true, createdAt: ISO, updatedAt: ISO },
        { id: 's2', itemId: 'gone', frequency: 'daily', times: ['08:00'], startDate: '2020-01-01', active: true, createdAt: ISO, updatedAt: ISO },
      ],
      doseEvents: [
        { id: 'd1', itemId: 'm1', scheduleId: 's1', scheduledFor: ISO, status: 'taken', createdAt: ISO },
        { id: 'd2', itemId: 'gone', scheduledFor: ISO, status: 'taken', createdAt: ISO },
      ],
      supply: { m1: { quantity: 10, usedPerDose: 1 }, gone: { quantity: 4, usedPerDose: 1 } },
    });
    expect(normalized.schedules.map((s) => s.id)).toEqual(['s1']);
    expect(normalized.doseEvents.map((d) => d.id)).toEqual(['d1']);
    expect(Object.keys(normalized.supply)).toEqual(['m1']);
  });
});

describe('medication-tracker scheduling', () => {
  it('produces multiple times per day', () => {
    const state = makeState({ schedules: [schedule({ times: ['08:00', '20:00'] })] });
    const occurrences = computeDoseOccurrences(state, new Date(2026, 0, 5, 0, 0, 0), new Date(2026, 0, 5, 23, 59, 59));
    expect(occurrences.map((o) => o.time)).toEqual(['08:00', '20:00']);
  });

  it('produces an every-X-hours schedule', () => {
    const state = makeState({
      schedules: [schedule({ frequency: 'every_hours', intervalHours: 6, times: ['08:00'] })],
    });
    const occurrences = computeDoseOccurrences(state, new Date(2026, 0, 5, 0, 0, 0), new Date(2026, 0, 5, 23, 59, 59));
    // Anchored at the first dose time and stepping every 6h, wrapping through the day.
    expect(occurrences.map((o) => o.time)).toEqual(['02:00', '08:00', '14:00', '20:00']);
  });

  it('honours certain weekdays (weekly)', () => {
    // 2026-01-05 is a Monday.
    const state = makeState({ schedules: [schedule({ frequency: 'weekly', daysOfWeek: [1], times: ['09:00'] })] });
    const occurrences = computeDoseOccurrences(state, new Date(2026, 0, 4, 0, 0, 0), new Date(2026, 0, 11, 23, 59, 59));
    expect(occurrences).toHaveLength(1);
    expect(new Date(occurrences[0].scheduledFor).getDay()).toBe(1);
  });

  it('honours every-X-days', () => {
    const state = makeState({
      schedules: [schedule({ frequency: 'every_n_days', intervalDays: 2, times: ['09:00'], startDate: '2026-01-05' })],
    });
    const occurrences = computeDoseOccurrences(state, new Date(2026, 0, 5, 0, 0, 0), new Date(2026, 0, 8, 23, 59, 59));
    expect(occurrences.map((o) => new Date(o.scheduledFor).getDate())).toEqual([5, 7]);
  });

  it('honours a monthly schedule', () => {
    const state = makeState({ schedules: [schedule({ frequency: 'monthly', dayOfMonth: 10, times: ['09:00'] })] });
    const occurrences = computeDoseOccurrences(state, new Date(2026, 0, 1, 0, 0, 0), new Date(2026, 1, 28, 23, 59, 59));
    expect(occurrences.map((o) => new Date(o.scheduledFor).getMonth())).toEqual([0, 1]);
  });

  it('bounds a temporary course by its end date', () => {
    const state = makeState({
      schedules: [schedule({ frequency: 'course', times: ['09:00'], startDate: '2026-01-05', endDate: '2026-01-11' })],
    });
    const occurrences = computeDoseOccurrences(state, new Date(2026, 0, 1, 0, 0, 0), new Date(2026, 0, 20, 23, 59, 59));
    expect(occurrences).toHaveLength(7);
  });

  it('generates nothing for PRN schedules', () => {
    const state = makeState({ schedules: [schedule({ frequency: 'as_needed', times: [] })] });
    expect(computeDoseOccurrences(state, new Date(2026, 0, 5, 0, 0, 0), new Date(2026, 0, 6, 0, 0, 0))).toHaveLength(0);
  });
});

describe('medication-tracker status, PRN and adherence', () => {
  it('classifies upcoming, due and missed', () => {
    const state = makeState({ schedules: [schedule({ times: ['08:00', '20:00'] })] });
    const [morning, evening] = computeDoseOccurrences(state, new Date(2026, 0, 5, 0, 0, 0), new Date(2026, 0, 5, 23, 59, 59));
    const now = new Date(2026, 0, 5, 8, 30, 0);
    expect(getDoseStatus(morning, state, now).status).toBe('due');
    expect(getDoseStatus(evening, state, now).status).toBe('upcoming');
    expect(getDoseStatus(morning, state, new Date(2026, 0, 5, 10, 0, 0)).status).toBe('missed');
  });

  it('logs taken/skipped and computes adherence', () => {
    let state = makeState({ schedules: [schedule({ times: ['08:00'], startDate: '2026-01-05', endDate: '2026-01-07' })] });
    for (const day of [5, 6, 7]) {
      const [dose] = getDosesForDay(state, new Date(2026, 0, day, 9, 0, 0));
      state = logDose(state, { itemId: 'm1', scheduleId: 's1', scheduledFor: dose.scheduledFor, status: day === 6 ? 'skipped' : 'taken' });
    }
    const stats = getAdherenceStats(state, 7, new Date(2026, 0, 8, 9, 0, 0));
    expect(stats).toMatchObject({ expected: 3, taken: 2, skipped: 1, missed: 0 });
  });

  it('tracks PRN usage and a user-entered daily limit', () => {
    let state: MedicationState = {
      ...makeState({ schedules: [] }),
      items: [{ ...makeState().items[0], asNeeded: true, maxDaily: 2 }],
    };
    const now = new Date();
    for (let i = 0; i < 3; i += 1) {
      state = logDose(state, { itemId: 'm1', scheduledFor: new Date(now.getTime() - i * 60_000).toISOString(), status: 'taken' });
    }
    const taken = getPrnTakenToday(state, 'm1', now);
    expect(taken).toBe(3);
    expect(taken > (state.items[0].maxDaily ?? 0)).toBe(true);
  });
});

describe('medication-tracker supply & refills', () => {
  it('decrements supply per taken dose and flags low supply', () => {
    const item = makeState().items[0];
    const supply = { quantity: 10, unit: 'tablets' as const, asOf: '2026-01-05T00:00:00.000Z', usedPerDose: 1, refillThreshold: 9 };
    const events = [
      { id: 'd1', itemId: 'm1', scheduledFor: ISO, status: 'taken' as const, takenAt: '2026-01-05T08:00:00.000Z', createdAt: ISO },
      { id: 'd2', itemId: 'm1', scheduledFor: ISO, status: 'taken' as const, takenAt: '2026-01-04T08:00:00.000Z', createdAt: ISO },
    ];
    const remaining = estimateRemaining(item, supply, events);
    expect(remaining).toBe(9);
    expect(isLowSupply(supply, remaining)).toBe(true);
  });

  it('emits a refill notification at the threshold', () => {
    const state: MedicationState = {
      ...makeState({ schedules: [] }),
      supply: { m1: { quantity: 2, unit: 'tablets', asOf: ISO, usedPerDose: 1, refillThreshold: 3 } },
    };
    const jobs = buildDesiredNotifications(state, true, new Date(2026, 0, 5, 8, 0, 0));
    expect(jobs.map((job) => job.id.startsWith('refill:'))).toContain(true);
  });
});

describe('medication-tracker notifications', () => {
  it('schedules upcoming doses and skips taken ones', () => {
    let state = makeState({ schedules: [schedule({ times: ['08:00'] })] });
    const now = new Date(2026, 0, 5, 6, 30, 0);
    const today = new Date(2026, 0, 5, 8, 0, 0).toISOString();
    expect(buildDesiredNotifications(state, true, now).some((job) => job.cycleKey === today)).toBe(true);

    state = logDose(state, { itemId: 'm1', scheduleId: 's1', scheduledFor: today, status: 'taken' });
    expect(buildDesiredNotifications(state, true, now).some((job) => job.cycleKey === today)).toBe(false);
  });

  it('produces nothing when reminders are disabled', () => {
    const state = makeState({ schedules: [schedule()], settings: { ...createDefaultState().settings, enabled: false } });
    expect(buildDesiredNotifications(state, true, new Date(2026, 0, 5, 8, 0, 0))).toHaveLength(0);
  });
});

describe('medication-tracker plugin lifecycle & backup', () => {
  it('is disabled by default and enabled only on request', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();
    expect(manager.isEnabled(MEDICATION_TRACKER_PLUGIN_ID)).toBe(false);

    const result = await manager.enable(MEDICATION_TRACKER_PLUGIN_ID);
    expect(result.ok).toBe(true);
    expect(manager.isEnabled(MEDICATION_TRACKER_PLUGIN_ID)).toBe(true);

    // Disabling keeps data.
    setState(makeState({ schedules: [schedule()] }));
    await manager.disable(MEDICATION_TRACKER_PLUGIN_ID);
    expect(manager.isEnabled(MEDICATION_TRACKER_PLUGIN_ID)).toBe(false);
    expect(peek().items).toHaveLength(1);
  });

  it('backs up plugin data while the plugin is disabled', async () => {
    localStorage.clear();
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();
    await manager.enable(MEDICATION_TRACKER_PLUGIN_ID);
    setState(makeState({ schedules: [schedule()] }));
    await manager.disable(MEDICATION_TRACKER_PLUGIN_ID);

    const backup = createBackup();
    const section = backup.data.plugins?.[MEDICATION_TRACKER_PLUGIN_ID];
    expect(section).toBeDefined();
    expect((section!.data as MedicationState).items).toHaveLength(1);

    // Restore into this same build applies the disabled plugin's data back.
    clearStore();
    const validation = validateBackup(serializeBackup(backup));
    expect(validation.valid).toBe(true);
    const outcome = restoreBackup(backup);
    expect(outcome.success).toBe(true);
    expect(getState().items).toHaveLength(1);
  });

  it('retains plugin data when restored into a build without the plugin, then adopts it on install', async () => {
    // A backup section produced by a build that has the plugin.
    const sectionData = makeState({ schedules: [schedule()] });
    const plugin = createMedicationTrackerPlugin();
    const backupSection = {
      payloadVersion: 1,
      pluginId: MEDICATION_TRACKER_PLUGIN_ID,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      schemaVersion: plugin.manifest.schemaVersion,
      enabled: false,
      data: sectionData,
    };

    // A fresh build with NO plugins registered yet.
    localStorage.clear();
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    const outcome = manager.restoreSections({ [MEDICATION_TRACKER_PLUGIN_ID]: backupSection });
    expect(outcome.retained).toContain(MEDICATION_TRACKER_PLUGIN_ID);
    expect(manager.getRetainedPluginIds()).toContain(MEDICATION_TRACKER_PLUGIN_ID);

    // Now the plugin becomes available (e.g. user installs it).
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();
    expect(manager.isEnabled(MEDICATION_TRACKER_PLUGIN_ID)).toBe(false);
    await manager.enable(MEDICATION_TRACKER_PLUGIN_ID);
    expect(getState().items).toHaveLength(1);
    expect(manager.getRetainedPluginIds()).not.toContain(MEDICATION_TRACKER_PLUGIN_ID);
  });

  it('explicitly deleting plugin data clears storage', () => {
    setState(makeState());
    expect(peek().items).toHaveLength(1);
    const plugin = createMedicationTrackerPlugin();
    const fakeContext = {
      pluginId: MEDICATION_TRACKER_PLUGIN_ID,
      notifications: { clear: () => undefined },
      diagnostics: { report: () => undefined },
    } as unknown as Parameters<NonNullable<typeof plugin.deleteData>>[0];
    plugin.deleteData!(fakeContext);
    expect(peek().items).toHaveLength(0);
  });

  it('serializes and restores through the plugin backup handler', () => {
    const plugin = createMedicationTrackerPlugin();
    setState(makeState({ schedules: [schedule()] }));
    const payload = plugin.backup!.serialize();
    expect(JSON.stringify(payload.data)).toContain('Metformin');

    clearStore();
    expect(peek().items).toHaveLength(0);
    plugin.backup!.restore({
      payloadVersion: 1,
      pluginId: MEDICATION_TRACKER_PLUGIN_ID,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      schemaVersion: 1,
      enabled: false,
      data: payload.data,
    });
    const restored = getState();
    expect(restored.items).toHaveLength(1);
    expect(restored.schedules[0].times).toEqual(['08:00']);
  });

  it('installs its own package descriptor through the plugin manager', async () => {
    const manifest = MEDICATION_TRACKER_MANIFEST;
    const manifestJson = JSON.stringify(manifest);
    const files = [{ path: 'manifest.json', size: manifestJson.length, integrity: computeFileIntegrity(manifestJson) }];
    const descriptor = {
      packageFormatVersion: PLUGIN_PACKAGE_FORMAT_VERSION,
      manifest,
      files,
      integrity: computePackageIntegrity(manifest, files),
    };
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();
    const result = await manager.installPackage({
      text: JSON.stringify(descriptor),
      fileName: 'medication-tracker.mindmesh-plugin.json',
    });
    expect(result.ok).toBe(true);
    expect(result.pluginId).toBe(MEDICATION_TRACKER_PLUGIN_ID);
    expect(result.status).toBe('installed');
    expect(result.applied).toBe(true);
  });

  it('rejects a package built against an incompatible plugin API', () => {
    const manifest = { ...MEDICATION_TRACKER_MANIFEST, apiVersion: '2.0.0' };
    const manifestJson = JSON.stringify(manifest);
    const files = [{ path: 'manifest.json', size: manifestJson.length, integrity: computeFileIntegrity(manifestJson) }];
    const descriptor = {
      packageFormatVersion: PLUGIN_PACKAGE_FORMAT_VERSION,
      manifest,
      files,
      integrity: computePackageIntegrity(manifest, files),
    };
    expect(validatePluginPackage(descriptor).ok).toBe(false);
  });
});
