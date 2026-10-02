import { beforeEach, describe, expect, it } from 'vitest';
import { PluginManager } from '../plugins/core/manager';
import {
  createEmptyRegistryState,
  type MindMeshPlugin,
  type RuntimePluginMigration,
} from '../plugins/core/types';
import type { PluginManifest } from '../types/plugin';
import { registerBuiltinPlugins } from '../plugins/registerBuiltins';
import { MONEY_MANAGEMENT_PLUGIN_ID } from '../plugins/money-management';
import { CAR_MAINTENANCE_PLUGIN_ID } from '../plugins/car-maintenance';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { createDefaultVehicleState } from '../services/vehicleMaintenance';
import {
  getDefaultState,
  loadMoneyState,
  loadRetainedPluginData,
  loadVehicleState,
  saveAllData,
  saveMoneyState,
  saveVehicleState,
} from '../services/storage';
import { createBackup, restoreBackup, serializeBackup, validateBackup } from '../services/backup';
import type { MindMeshBackupFile } from '../types/backup';

function baseManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo-plugin',
    name: 'Demo',
    version: '1.0.0',
    description: 'A demo plugin.',
    minimumCoreVersion: '1.0.0',
    apiVersion: '1.0.0',
    schemaVersion: 1,
    permissions: ['storage', 'backup'],
    ...overrides,
  };
}

interface PluginStore {
  items: unknown[];
}

/** A minimal, self-contained plugin used to exercise generic backup behaviour. */
function makeBackupPlugin(opts: {
  id: string;
  schemaVersion?: number;
  store: PluginStore;
  migrations?: RuntimePluginMigration[];
}): MindMeshPlugin {
  const manifest = baseManifest({
    id: opts.id,
    name: `Plugin ${opts.id}`,
    schemaVersion: opts.schemaVersion ?? 1,
  });
  return {
    manifest,
    defaultEnabled: true,
    migrations: opts.migrations,
    activate: () => undefined,
    deactivate: () => undefined,
    deleteData: () => {
      opts.store.items = [];
    },
    backup: {
      serialize: () => ({ data: { items: [...opts.store.items] }, history: [`${opts.id}-history`] }),
      restore: (section) => {
        const data = section.data as { items?: unknown[] } | undefined;
        if (!data || !Array.isArray(data.items)) throw new Error('malformed plugin section');
        opts.store.items = [...data.items];
      },
    },
  };
}

function backupWithPlugin(id: string, items: unknown[]): { backup: MindMeshBackupFile; store: PluginStore } {
  const store: PluginStore = { items };
  const manager = new PluginManager(createEmptyRegistryState());
  manager.register(makeBackupPlugin({ id, store }));
  // bootstrapSync registers the manager as the global backup provider.
  manager.bootstrapSync();
  const backup = createBackup();
  return { backup, store };
}

beforeEach(() => {
  localStorage.clear();
  saveAllData(getDefaultState());
});

describe('plugin backup section envelope', () => {
  it('records identity, name, schema version, enablement, settings and history', async () => {
    const store: PluginStore = { items: ['a'] };
    const manager = new PluginManager(createEmptyRegistryState());
    manager.register(makeBackupPlugin({ id: 'alpha', store }));
    await manager.initialize();

    const section = manager.exportSections()['alpha'];
    expect(section).toBeTruthy();
    expect(section.pluginId).toBe('alpha');
    expect(section.name).toBe('Plugin alpha');
    expect(section.version).toBe('1.0.0');
    expect(section.schemaVersion).toBe(1);
    expect(section.enabled).toBe(true);
    expect(section.payloadVersion).toBe(1);
    expect(section.history).toEqual(['alpha-history']);
    expect(section.lastModified).toBeTruthy();
    expect(section.data).toEqual({ items: ['a'] });
  });

  it('backfills identity metadata for legacy sections without the new fields', () => {
    const manager = new PluginManager(createEmptyRegistryState());
    const outcome = manager.restoreSections({
      // Old-style section: only version/schemaVersion/data.
      legacy: { version: '0.9.0', schemaVersion: 1, data: { items: [1] } } as never,
    });
    // No plugin registered, so it is retained rather than discarded.
    expect(outcome.retained).toContain('legacy');
    const retained = loadRetainedPluginData().sections['legacy'];
    expect(retained?.pluginId).toBe('legacy');
    expect(retained?.data).toEqual({ items: [1] });
  });
});

describe('plugin backup/restore integrity', () => {
  it('1. plugin enabled → backup → restore', async () => {
    const store: PluginStore = { items: ['x'] };
    const manager = new PluginManager(createEmptyRegistryState());
    manager.register(makeBackupPlugin({ id: 'alpha', store }));
    await manager.initialize();

    const backup = createBackup();
    expect(backup.data.plugins?.['alpha']).toBeTruthy();

    store.items = [];
    const restore = restoreBackup(backup);
    expect(restore.success).toBe(true);
    expect(store.items).toEqual(['x']);
  });

  it('2. plugin disabled → backup → restore keeps the data', async () => {
    const store: PluginStore = { items: ['x'] };
    const manager = new PluginManager(createEmptyRegistryState());
    manager.register(makeBackupPlugin({ id: 'alpha', store }));
    await manager.initialize();

    await manager.disable('alpha');
    const backup = createBackup();
    expect(backup.data.plugins?.['alpha'].enabled).toBe(false);
    expect((backup.data.plugins?.['alpha'].data as { items: unknown[] }).items).toEqual(['x']);

    store.items = [];
    const restore = restoreBackup(backup);
    expect(restore.success).toBe(true);
    expect(store.items).toEqual(['x']);
  });

  it('3. plugin disabled → backup → plugin re-enabled', async () => {
    const store: PluginStore = { items: ['x'] };
    const manager = new PluginManager(createEmptyRegistryState());
    manager.register(makeBackupPlugin({ id: 'alpha', store }));
    await manager.initialize();

    await manager.disable('alpha');
    const backup = createBackup();
    expect((backup.data.plugins?.['alpha'].data as { items: unknown[] }).items).toEqual(['x']);

    await manager.enable('alpha');
    expect(manager.isEnabled('alpha')).toBe(true);
    expect(store.items).toEqual(['x']);
  });

  it('4. plugin absent → restore retains the payload untouched', () => {
    const { backup } = backupWithPlugin('ghost', ['ghost-data']);

    // A fresh installation that does not contain the "ghost" plugin.
    const manager = new PluginManager(createEmptyRegistryState());
    manager.bootstrapSync();

    const restore = restoreBackup(backup);
    expect(restore.success).toBe(true);

    const retained = loadRetainedPluginData().sections['ghost'];
    expect(retained).toBeTruthy();
    expect(retained.enabled).toBe(false);
    expect(retained.data).toEqual({ items: ['ghost-data'] });
    expect(manager.getRetainedPluginIds()).toContain('ghost');
  });

  it('5. plugin installed after restore → retained data becomes available', async () => {
    const { backup } = backupWithPlugin('ghost', ['ghost-data']);

    const manager = new PluginManager(createEmptyRegistryState());
    manager.bootstrapSync();
    expect(restoreBackup(backup).success).toBe(true);
    expect(manager.getRetainedPluginIds()).toContain('ghost');

    // Install the plugin later: its retained data must be adopted automatically.
    const store: PluginStore = { items: [] };
    manager.register(makeBackupPlugin({ id: 'ghost', store }));
    await manager.initialize();

    expect(store.items).toEqual(['ghost-data']);
    expect(manager.getRetainedPluginIds()).not.toContain('ghost');
  });

  it('6. backup containing multiple plugins', () => {
    const storeAlpha: PluginStore = { items: ['a'] };
    const storeBeta: PluginStore = { items: ['b'] };
    const manager = new PluginManager(createEmptyRegistryState());
    manager.register(makeBackupPlugin({ id: 'alpha', store: storeAlpha }));
    manager.register(makeBackupPlugin({ id: 'beta', store: storeBeta }));
    manager.bootstrapSync();

    const backup = createBackup();
    expect(Object.keys(backup.data.plugins ?? {}).sort()).toEqual(['alpha', 'beta']);

    storeAlpha.items = [];
    storeBeta.items = [];
    const restore = restoreBackup(backup);
    expect(restore.success).toBe(true);
    expect(storeAlpha.items).toEqual(['a']);
    expect(storeBeta.items).toEqual(['b']);
  });

  it('7. backup containing an older plugin schema is migrated on adoption', async () => {
    // Backup made when the plugin was on schema v1.
    const { backup } = backupWithPlugin('delta', [{ value: 'raw' }]);

    const manager = new PluginManager(createEmptyRegistryState());
    manager.bootstrapSync();
    expect(restoreBackup(backup).success).toBe(true);
    expect(loadRetainedPluginData().sections['delta']?.schemaVersion).toBe(1);

    // The newer plugin is on schema v2 and migrates the retained data.
    const store: PluginStore = { items: [] };
    const migrations: RuntimePluginMigration[] = [
      {
        id: 'delta.v0-v2',
        description: 'upgrade retained data to schema v2',
        fromSchemaVersion: 0,
        toSchemaVersion: 2,
        run: () => {
          store.items = store.items.map((item) => ({ ...(item as Record<string, unknown>), migrated: true }));
        },
      },
    ];
    manager.register(makeBackupPlugin({ id: 'delta', schemaVersion: 2, store, migrations }));
    await manager.initialize();

    expect(store.items).toEqual([{ value: 'raw', migrated: true }]);
    expect(manager.getRetainedPluginIds()).not.toContain('delta');
  });

  it('8. a migration failure does not destroy the retained data', async () => {
    const { backup } = backupWithPlugin('broken', ['important']);

    const manager = new PluginManager(createEmptyRegistryState());
    manager.bootstrapSync();
    expect(restoreBackup(backup).success).toBe(true);
    expect(loadRetainedPluginData().sections['broken']?.data).toEqual({ items: ['important'] });

    const store: PluginStore = { items: [] };
    const migrations: RuntimePluginMigration[] = [
      {
        id: 'broken.explodes',
        description: 'always fails',
        fromSchemaVersion: 0,
        toSchemaVersion: 1,
        run: () => {
          throw new Error('migration boom');
        },
      },
    ];
    manager.register(makeBackupPlugin({ id: 'broken', store, migrations }));
    await manager.initialize();

    // The retained payload survives the failed migration, verbatim.
    const retained = loadRetainedPluginData().sections['broken'];
    expect(retained).toBeTruthy();
    expect(retained.data).toEqual({ items: ['important'] });
    expect(manager.getRetainedPluginIds()).toContain('broken');
    // A plugin whose retained-data migration failed is not activated with it.
    expect(manager.isEnabled('broken')).toBe(false);
  });

  it('9. a core-only backup still restores without plugin sections', () => {
    const manager = new PluginManager(createEmptyRegistryState());
    manager.bootstrapSync();
    const backup = createBackup();
    expect(backup.data.plugins).toEqual({});

    registerBuiltinPlugins(manager);
    const validation = validateBackup(serializeBackup(backup));
    expect(validation.valid).toBe(true);
    expect(validation.summary?.pluginSectionCount).toBe(0);

    const restore = restoreBackup(backup);
    expect(restore.success).toBe(true);
    expect(manager.getRetainedPluginIds()).toEqual([]);
  });

  it('10. existing legacy backups (no plugin fields) keep restoring', () => {
    const manager = new PluginManager(createEmptyRegistryState());
    manager.bootstrapSync();
    registerBuiltinPlugins(manager);
    const backup = createBackup();
    const legacy: MindMeshBackupFile = {
      ...backup,
      data: { ...backup.data, plugins: undefined, pluginRegistry: undefined },
    };

    expect(validateBackup(serializeBackup(legacy)).valid).toBe(true);
    expect(restoreBackup(legacy).success).toBe(true);
  });
});

describe('plugin uninstall / delete protection', () => {
  it('retained data survives disabling and is dropped only by explicit deletion', async () => {
    const { backup } = backupWithPlugin('ghost', ['keep-me']);

    const manager = new PluginManager(createEmptyRegistryState());
    manager.bootstrapSync();
    expect(restoreBackup(backup).success).toBe(true);

    const store: PluginStore = { items: [] };
    manager.register(makeBackupPlugin({ id: 'ghost', store }));
    await manager.initialize();
    // Adopted on install; put a retained copy back to model an explicit uninstall
    // that removed the plugin code but kept its data.
    expect(store.items).toEqual(['keep-me']);

    await manager.disable('ghost');
    // Disabling must not clear anything.
    expect(store.items).toEqual(['keep-me']);

    const result = manager.deletePluginData('ghost');
    expect(result.ok).toBe(true);
    expect(store.items).toEqual([]);
    expect(manager.getRetainedPluginIds()).not.toContain('ghost');
  });
});

describe('built-in plugin backup retention', () => {
  it('backs up disabled built-in data and round-trips it through the real pipeline', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    await manager.initialize();

    saveMoneyState({
      ...getDefaultMoneyState(),
      expenses: [
        {
          id: 'exp-1',
          title: 'Fuel',
          amount: 70,
          categoryId: 'cat',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });
    saveVehicleState(createDefaultVehicleState());

    await manager.disable(MONEY_MANAGEMENT_PLUGIN_ID);

    const backup = createBackup();
    expect(backup.data.plugins?.[MONEY_MANAGEMENT_PLUGIN_ID]).toBeTruthy();
    expect(backup.data.plugins?.[CAR_MAINTENANCE_PLUGIN_ID]).toBeTruthy();

    const validation = validateBackup(serializeBackup(backup));
    expect(validation.valid).toBe(true);
    expect(validation.summary?.pluginSectionCount).toBeGreaterThanOrEqual(2);

    saveMoneyState(getDefaultMoneyState());
    expect(loadMoneyState().expenses).toHaveLength(0);

    expect(restoreBackup(backup).success).toBe(true);
    expect(loadMoneyState().expenses).toHaveLength(1);
    expect(loadMoneyState().expenses[0].title).toBe('Fuel');
    expect(loadVehicleState()).toBeTruthy();
  });
});
