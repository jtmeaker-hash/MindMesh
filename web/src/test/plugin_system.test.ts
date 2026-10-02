import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PluginManager } from '../plugins/core/manager';
import { resolvePluginStatus } from '../plugins/core/registry';
import {
  computePackageIntegrity,
  validateManifest,
  validatePluginPackage,
} from '../plugins/core/manifest';
import { PluginLoader } from '../plugins/core/loader';
import { createEmptyRegistryState, type MindMeshPlugin } from '../plugins/core/types';
import type { PluginManifest } from '../types/plugin';
import { registerBuiltinPlugins } from '../plugins/registerBuiltins';
import { createMoneyManagementPlugin, MONEY_MANAGEMENT_PLUGIN_ID } from '../plugins/money-management';
import { CAR_MAINTENANCE_PLUGIN_ID } from '../plugins/car-maintenance';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { createDefaultVehicleState } from '../services/vehicleMaintenance';
import {
  getDefaultState,
  loadMoneyState,
  saveAllData,
  saveMoneyState,
  saveVehicleState,
} from '../services/storage';
import { createBackup, restoreBackup, serializeBackup, validateBackup } from '../services/backup';
import type { MindMeshHostAPI } from '../plugins/core/types';

function makeHost(): MindMeshHostAPI {
  const money = getDefaultMoneyState();
  const vehicles = createDefaultVehicleState();
  return {
    moneyState: money,
    onUpdateMoneyState: () => undefined,
    vehicleState: vehicles,
    onUpdateVehicleState: () => undefined,
    reminders: [],
    categories: [],
    onUpdateReminders: () => undefined,
    onUpdateCategories: () => undefined,
    notificationSettings: {
      enabled: true,
      historyLimit: 50,
    } as MindMeshHostAPI['notificationSettings'],
    onOpenReminder: () => undefined,
    navigateToTab: () => undefined,
  };
}

function baseManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo-plugin',
    name: 'Demo',
    version: '1.0.0',
    description: 'A demo plugin.',
    minimumCoreVersion: '1.0.0',
    apiVersion: '1.0.0',
    schemaVersion: 1,
    permissions: ['storage'],
    ...overrides,
  };
}

function makePlugin(overrides: Partial<MindMeshPlugin> = {}): MindMeshPlugin {
  return {
    manifest: baseManifest(),
    activate: () => undefined,
    deactivate: () => undefined,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
  saveAllData(getDefaultState());
});

describe('plugin manifest + package validation', () => {
  it('accepts a well-formed manifest and rejects unsafe ids', () => {
    expect(validateManifest(baseManifest()).ok).toBe(true);
    const bad = validateManifest(baseManifest({ id: '../evil' }));
    expect(bad.ok).toBe(false);
  });

  it('validates a signed package and detects tampering', () => {
    const manifest = baseManifest();
    const files = [{ path: 'dist/index.js', size: 10, integrity: 'abc' }];
    const integrity = computePackageIntegrity(manifest, files);
    const descriptor = { packageFormatVersion: 1, manifest, files, integrity };

    expect(validatePluginPackage(descriptor).ok).toBe(true);

    const tampered = { ...descriptor, files: [{ path: 'dist/index.js', size: 11, integrity: 'abc' }] };
    expect(validatePluginPackage(tampered).ok).toBe(false);
  });

  it('rejects incompatible minimum Core versions and unsafe paths', () => {
    const manifest = baseManifest({ minimumCoreVersion: '99.0.0' });
    const files = [{ path: 'dist/index.js', size: 1, integrity: 'x' }];
    const result = validatePluginPackage({
      packageFormatVersion: 1,
      manifest,
      files,
      integrity: computePackageIntegrity(manifest, files),
    });
    expect(result.ok).toBe(false);

    expect(
      validatePluginPackage({
        packageFormatVersion: 1,
        manifest: baseManifest(),
        files: [{ path: '../escape.js', size: 1, integrity: 'x' }],
        integrity: 'whatever',
      }).ok
    ).toBe(false);
  });

  it('loads only packages whose dependencies are installed', () => {
    const loader = new PluginLoader({ getRegistryState: () => createEmptyRegistryState() });
    const manifest = baseManifest({ dependencies: ['missing-dep'] });
    const files = [{ path: 'dist/index.js', size: 1, integrity: 'x' }];
    const result = loader.load({
      packageFormatVersion: 1,
      manifest,
      files,
      integrity: computePackageIntegrity(manifest, files),
    });
    expect(result.ok).toBe(false);
  });
});

describe('plugin registry status', () => {
  it('reports disabled, enabled and incompatible states', () => {
    const plugin = makePlugin();
    const state = createEmptyRegistryState();

    expect(resolvePluginStatus(plugin, undefined, state).status).toBe('disabled');

    const entry = {
      id: plugin.manifest.id,
      version: plugin.manifest.version,
      enabled: true,
      installedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedMigrations: [],
      dataSchemaVersion: 1,
    };
    state.plugins[plugin.manifest.id] = entry;
    expect(resolvePluginStatus(plugin, entry, state).status).toBe('enabled');

    const incompatible = makePlugin({ manifest: baseManifest({ minimumCoreVersion: '99.0.0' }) });
    expect(resolvePluginStatus(incompatible, undefined, state).status).toBe('incompatible');
  });
});

describe('plugin lifecycle + data retention', () => {
  it('auto-enables built-ins so the migration is invisible', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    registerBuiltinPlugins(manager);
    await manager.initialize();

    expect(manager.isEnabled(MONEY_MANAGEMENT_PLUGIN_ID)).toBe(true);
    expect(manager.isEnabled(CAR_MAINTENANCE_PLUGIN_ID)).toBe(true);
  });

  it('disabling a plugin stops it without deleting its data', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    registerBuiltinPlugins(manager);
    await manager.initialize();

    const seeded = { ...getDefaultMoneyState(), extraIncomeList: [
      { id: 'inc-1', title: 'Cash job', amount: 120, date: '2026-01-01', categoryId: 'cat', createdAt: '2026-01-01T00:00:00.000Z' },
    ] };
    saveMoneyState(seeded);

    const result = await manager.disable(MONEY_MANAGEMENT_PLUGIN_ID);
    expect(result.ok).toBe(true);
    expect(manager.isEnabled(MONEY_MANAGEMENT_PLUGIN_ID)).toBe(false);

    // Data must survive disable untouched.
    expect(loadMoneyState().extraIncomeList).toHaveLength(1);
    expect(loadMoneyState().extraIncomeList[0].title).toBe('Cash job');

    // Re-enabling restores availability without losing anything.
    await manager.enable(MONEY_MANAGEMENT_PLUGIN_ID);
    expect(manager.isEnabled(MONEY_MANAGEMENT_PLUGIN_ID)).toBe(true);
    expect(loadMoneyState().extraIncomeList).toHaveLength(1);
  });

  it('removes data only through the explicit delete action', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    registerBuiltinPlugins(manager);
    await manager.initialize();

    saveMoneyState({ ...getDefaultMoneyState(), extraIncomeList: [
      { id: 'inc-1', title: 'Cash job', amount: 120, date: '2026-01-01', categoryId: 'cat', createdAt: '2026-01-01T00:00:00.000Z' },
    ] });

    const result = manager.deletePluginData(MONEY_MANAGEMENT_PLUGIN_ID);
    expect(result.ok).toBe(true);
    expect(loadMoneyState().extraIncomeList).toHaveLength(0);
  });

  it('isolates a plugin that throws during activation', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    manager.register(
      makePlugin({
        manifest: baseManifest({ id: 'broken-plugin', name: 'Broken', defaultEnabled: true } as Partial<PluginManifest>),
        defaultEnabled: true,
        activate: () => {
          throw new Error('boom');
        },
      })
    );
    const healthy = makePlugin({
      manifest: baseManifest({ id: 'healthy-plugin', name: 'Healthy' }),
      defaultEnabled: true,
    });
    manager.register(healthy);

    await manager.initialize();

    // Core continued; the broken plugin is marked error, the healthy one enabled.
    expect(manager.getView('broken-plugin')?.status).toBe('error');
    expect(manager.isEnabled('broken-plugin')).toBe(false);
    expect(manager.isEnabled('healthy-plugin')).toBe(true);
  });
});

describe('plugin migrations', () => {
  it('runs each migration exactly once (idempotent)', async () => {
    const run = vi.fn();
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    manager.register(
      makePlugin({
        manifest: baseManifest({ id: 'migrator', name: 'Migrator' }),
        defaultEnabled: true,
        migrations: [
          {
            id: 'migrator.v1',
            description: 'first',
            fromSchemaVersion: 0,
            toSchemaVersion: 1,
            run,
          },
        ],
      })
    );

    await manager.initialize();
    await manager.disable('migrator');
    await manager.enable('migrator');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('money legacy migration preserves record counts', async () => {
    const seeded = {
      ...getDefaultMoneyState(),
      directDebits: [
        {
          id: 'bill-1',
          title: 'Internet',
          amount: 80,
          categoryId: 'cat',
          frequency: 'monthly' as const,
          nextPaymentDate: '2026-02-01',
          active: true,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    };
    saveMoneyState(seeded);

    const plugin = createMoneyManagementPlugin();
    const context = {
      pluginId: MONEY_MANAGEMENT_PLUGIN_ID,
    } as Parameters<NonNullable<typeof plugin.migrations>[number]['run']>[0];
    for (const migration of plugin.migrations ?? []) {
      await migration.run(context);
      await migration.run(context);
    }

    expect(loadMoneyState().directDebits).toHaveLength(1);
    expect(loadMoneyState().directDebits[0].title).toBe('Internet');
  });
});

describe('plugin backup participation', () => {
  it('includes disabled plugin data and restores it', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    registerBuiltinPlugins(manager);
    await manager.initialize();

    saveMoneyState({
      ...getDefaultMoneyState(),
      expenses: [
        { id: 'exp-1', title: 'Fuel', amount: 70, categoryId: 'cat', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    const vehicles = createDefaultVehicleState();
    saveVehicleState(vehicles);

    // Disable money: its data must STILL be backed up.
    await manager.disable(MONEY_MANAGEMENT_PLUGIN_ID);

    const backup = createBackup();
    expect(backup.data.plugins?.[MONEY_MANAGEMENT_PLUGIN_ID]).toBeTruthy();
    expect(backup.data.plugins?.[CAR_MAINTENANCE_PLUGIN_ID]).toBeTruthy();

    // Round-trip through the real serialize/validate pipeline.
    const json = serializeBackup(backup);
    const validation = validateBackup(json);
    expect(validation.valid).toBe(true);
    expect(validation.summary?.pluginSectionCount).toBeGreaterThanOrEqual(2);

    // Wipe money, then restore and confirm data returns.
    saveMoneyState(getDefaultMoneyState());
    expect(loadMoneyState().expenses).toHaveLength(0);

    const restore = restoreBackup(backup);
    expect(restore.success).toBe(true);
    expect(loadMoneyState().expenses).toHaveLength(1);
    expect(loadMoneyState().expenses[0].title).toBe('Fuel');
  });

  it('keeps old backups (without plugin sections) importable', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    manager.setHost(makeHost());
    registerBuiltinPlugins(manager);
    await manager.initialize();

    const backup = createBackup();
    // Simulate a pre-plugin backup by stripping the additive sections.
    const legacy: typeof backup = {
      ...backup,
      data: { ...backup.data, plugins: undefined, pluginRegistry: undefined },
    };
    const validation = validateBackup(serializeBackup(legacy));
    expect(validation.valid).toBe(true);
    expect(validation.summary?.pluginSectionCount).toBe(0);

    const restore = restoreBackup(legacy);
    expect(restore.success).toBe(true);
  });
});
