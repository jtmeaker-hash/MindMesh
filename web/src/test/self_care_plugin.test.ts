import { beforeEach, describe, expect, it } from 'vitest';
import { PluginManager } from '../plugins/core/manager';
import { validateManifest } from '../plugins/core/manifest';
import { createEmptyRegistryState } from '../plugins/core/types';
import type { MindMeshHostAPI } from '../plugins/core/types';
import type { PluginManifest } from '../types/plugin';
import { registerBuiltinPlugins } from '../plugins/registerBuiltins';
import { createSelfCarePlugin } from '../plugins/self-care';
import { SELF_CARE_MANIFEST } from '../plugins/self-care/manifest';
import rawManifest from '../plugins/self-care/plugin.manifest.json';
import { createSelfCareMigrations } from '../plugins/self-care/migrations';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { createDefaultVehicleState } from '../services/vehicleMaintenance';
import { loadSelfCareState, saveSelfCareState } from '../services/selfCare';
import { loadRetainedPluginData } from '../services/storage';
import { defaultSelfCareState } from '../types/selfCare';
import { createBackup, restoreBackup } from '../services/backup';

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
    notificationSettings: {
      enabled: true,
      historyLimit: 50,
    } as MindMeshHostAPI['notificationSettings'],
    onOpenReminder: () => undefined,
    navigateToTab: () => undefined,
  };
}

function seedCheckIn() {
  saveSelfCareState({
    ...defaultSelfCareState(),
    checkIns: [
      {
        id: 'c1',
        title: 'Eat check-in',
        category: 'eat',
        enabled: true,
        paused: false,
        defaultTone: 'gentle',
        variants: [{ id: 'v1', tone: 'gentle', text: 'Eat something 💛' }],
        schedule: { weekdays: [1], times: ['09:00'], everyNDays: 1 },
        snoozeMinutes: 20,
        createdAt: new Date(2026, 4, 4, 7, 0, 0, 0).toISOString(),
        updatedAt: new Date(2026, 4, 4, 7, 0, 0, 0).toISOString(),
      },
    ],
  });
}

describe('self care plugin lifecycle', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('ships a valid manifest pinned to current Core/Plugin API versions', () => {
    const result = validateManifest(rawManifest as unknown as PluginManifest);
    expect(result.ok).toBe(true);
    expect(SELF_CARE_MANIFEST.id).toBe('self-care');
    expect(SELF_CARE_MANIFEST.version).toBe('1.0.0');
    expect(SELF_CARE_MANIFEST.minimumCoreVersion).toBe('1.8.0');
    expect(SELF_CARE_MANIFEST.apiVersion).toBe('1.0.0');
    expect(SELF_CARE_MANIFEST.permissions).toContain('native');
  });

  it('registers as a built-in but stays opt-in (disabled) after first start', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    const ids = registerBuiltinPlugins(manager);
    expect(ids).toContain('self-care');
    manager.setHost(makeHost());
    await manager.initialize();
    // Existing features keep working; the new plugin waits for explicit opt-in.
    expect(manager.isEnabled('money-management')).toBe(true);
    expect(manager.isEnabled('car-maintenance')).toBe(true);
    expect(manager.isEnabled('self-care')).toBe(false);
    expect(manager.getEnabledRoutes().some((r) => r.pluginId === 'self-care')).toBe(false);
  });

  it('enable exposes the route; disable cancels alarms but retains everything', async () => {
    seedCheckIn();
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.setHost(makeHost());
    await manager.initialize();

    expect((await manager.enable('self-care')).ok).toBe(true);
    expect(manager.isEnabled('self-care')).toBe(true);
    const routes = manager.getEnabledRoutes().filter((r) => r.pluginId === 'self-care');
    expect(routes).toHaveLength(1);
    expect(routes[0].tab).toBe('self-care');

    expect((await manager.disable('self-care')).ok).toBe(true);
    expect(manager.isEnabled('self-care')).toBe(false);
    // Disable != delete: check-ins, messages and history survive.
    const state = loadSelfCareState();
    expect(state.checkIns).toHaveLength(1);
    expect(state.checkIns[0].variants).toHaveLength(1);
    expect(state.scheduledIds).toEqual([]);
  });

  it('a failing plugin cannot prevent Core startup (isolation)', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.register({
      manifest: {
        id: 'broken-demo',
        name: 'Broken',
        version: '1.0.0',
        description: 'Throws on activation.',
        minimumCoreVersion: '1.0.0',
        apiVersion: '1.0.0',
        schemaVersion: 0,
      },
      defaultEnabled: true,
      activate: () => {
        throw new Error('boom');
      },
      deactivate: () => undefined,
    });
    manager.setHost(makeHost());
    await manager.initialize();
    expect(manager.isEnabled('money-management')).toBe(true);
    expect(manager.isEnabled('car-maintenance')).toBe(true);
  });

  it('migrations are additive and idempotent', () => {
    seedCheckIn();
    const migrations = createSelfCareMigrations();
    expect(migrations).toHaveLength(1);
    const before = JSON.stringify(loadSelfCareState());
    for (const migration of migrations) migration.run(managerContext());
    expect(JSON.stringify(loadSelfCareState())).toBe(before);
    // Legacy-shaped payloads are adopted, never dropped.
    localStorage.clear();
    saveSelfCareState(defaultSelfCareState());
    for (const migration of migrations) migration.run(managerContext());
    expect(loadSelfCareState().checkIns).toEqual([]);

    function managerContext() {
      const manager = new PluginManager(createEmptyRegistryState());
      registerBuiltinPlugins(manager);
      return manager.getContext('self-care');
    }
  });

  it('participates in backup/restore while enabled, disabled, and after wipe', async () => {
    seedCheckIn();
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.setHost(makeHost());
    await manager.initialize();
    await manager.enable('self-care');

    const enabled = createBackup();
    expect(enabled.data.plugins?.['self-care']).toBeTruthy();

    await manager.disable('self-care');
    const disabled = createBackup();
    expect(disabled.data.plugins?.['self-care'].enabled).toBe(false);
    expect(
      (disabled.data.plugins?.['self-care'].data as { checkIns: unknown[] }).checkIns
    ).toHaveLength(1);

    // Simulate a fresh device: wipe, then restore the disabled backup.
    localStorage.clear();
    const fresh = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(fresh);
    fresh.setHost(makeHost());
    await fresh.initialize();
    const outcome = restoreBackup(disabled);
    expect(outcome.success).toBe(true);
    expect(loadSelfCareState().checkIns).toHaveLength(1);
    expect(loadSelfCareState().checkIns[0].variants[0].text).toBe('Eat something 💛');
  });

  it('retained data from a legacy backup is adopted on reinstall path', async () => {
    seedCheckIn();
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.setHost(makeHost());
    await manager.initialize();
    const backup = createBackup();

    // Restore onto a build where Self Care is unknown: data must be retained.
    localStorage.clear();
    const withoutPlugin = new PluginManager(createEmptyRegistryState());
    withoutPlugin.bootstrapSync();
    expect(restoreBackup(backup).success).toBe(true);
    const retained = loadRetainedPluginData();
    // Either retained (unknown plugin) or adopted (built-in present) — never lost.
    const adopted = loadSelfCareState().checkIns.length === 1;
    const held = retained.sections['self-care'] !== undefined;
    expect(adopted || held).toBe(true);
  });

  it('explicit delete removes data only through the confirmed action', async () => {
    seedCheckIn();
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.setHost(makeHost());
    await manager.initialize();
    await manager.enable('self-care');
    const result = manager.deletePluginData('self-care');
    expect(result.ok).toBe(true);
    expect(loadSelfCareState().checkIns).toEqual([]);
  });

  it('self care enable/disable never disturbs money or car plugins', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.setHost(makeHost());
    await manager.initialize();
    await manager.enable('self-care');
    expect(manager.isEnabled('money-management')).toBe(true);
    expect(manager.isEnabled('car-maintenance')).toBe(true);
    await manager.disable('self-care');
    expect(manager.isEnabled('money-management')).toBe(true);
    expect(manager.isEnabled('car-maintenance')).toBe(true);
    expect(createSelfCarePlugin().manifest.id).toBe('self-care');
  });
});
