/**
 * Plugin runtime singleton.
 *
 * `registerBuiltinPlugins` registers the built-in plugin definitions into this
 * manager; Core modules such as Diagnostics read the current view through
 * `describePlugins()`. This module deliberately does NOT import any concrete
 * plugin, so Core can never depend on a specific plugin.
 */
import { PluginManager } from './manager';
import type { PluginRegistryState, PluginStatus } from '../../types/plugin';
import { MINDMESH_CORE_VERSION, PLUGIN_API_VERSION } from '../../types/plugin';
import { loadPluginRegistry } from '../../services/storage';

let manager: PluginManager | null = null;

/** Returns (creating on first use) the process-wide plugin manager. */
export function getPluginManager(): PluginManager {
  if (!manager) {
    manager = new PluginManager(loadPluginRegistry());
  }
  return manager;
}

/** Replaces the manager; used by tests to isolate registry state. */
export function setPluginManager(next: PluginManager | null): void {
  manager = next;
}

/** Test helper: build a fresh manager from explicit registry state. */
export function createPluginManagerWithState(state: PluginRegistryState): PluginManager {
  manager = new PluginManager(state);
  return manager;
}

export interface PluginDiagnosticsSummary {
  apiVersion: string;
  coreVersion: string;
  total: number;
  enabled: number;
  disabled: number;
  errored: number;
  installed: number;
  incompatible: number;
  missingDependency: number;
  migrationRequired: number;
  updateAvailable: number;
  lastError?: string;
  plugins: {
    id: string;
    name: string;
    version: string;
    status: PluginStatus;
    enabled: boolean;
  }[];
}

/** Privacy-safe summary for the Diagnostics surface. */
export function describePlugins(): PluginDiagnosticsSummary {
  const mgr = getPluginManager();
  const views = mgr.getViews();
  const count = (status: PluginStatus) => views.filter((view) => view.status === status).length;
  const lastError = mgr.getSnapshot().lastError;
  return {
    apiVersion: PLUGIN_API_VERSION,
    coreVersion: MINDMESH_CORE_VERSION,
    total: views.length,
    enabled: views.filter((view) => view.enabled).length,
    disabled: count('disabled'),
    errored: count('error'),
    installed: views.filter((view) => view.installed).length,
    incompatible: count('incompatible'),
    missingDependency: count('missing-dependency'),
    migrationRequired: count('migration-required'),
    updateAvailable: count('update-available'),
    lastError: lastError?.message,
    plugins: views.map((view) => ({
      id: view.id,
      name: view.name,
      version: view.version,
      status: view.status,
      enabled: view.enabled,
    })),
  };
}
