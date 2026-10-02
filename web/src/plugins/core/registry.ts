/**
 * PluginRegistry — the source of truth for which plugins are available,
 * installed, enabled, compatible and healthy.
 *
 * It holds the in-memory plugin implementations and resolves a read-only
 * `PluginView` (shown in Settings → Plugins and Diagnostics) from the persisted
 * registry state. It performs no lifecycle side effects; `PluginManager` does.
 */
import type { MindMeshPlugin, PluginErrorRecord, PluginStatus, PluginView } from './types';
import type { PluginRegistryEntry, PluginRegistryState } from '../../types/plugin';
import { MINDMESH_CORE_VERSION, PLUGIN_API_VERSION } from '../../types/plugin';
import { satisfiesMinimum, sameMajorVersion } from './version';

export interface StatusResolution {
  status: PluginStatus;
  coreCompatible: boolean;
  pendingMigrationIds: string[];
}

/** Pure status resolution from a plugin + its registry entry + the peer set. */
export function resolvePluginStatus(
  plugin: MindMeshPlugin,
  entry: PluginRegistryEntry | undefined,
  state: PluginRegistryState,
  coreVersion: string = MINDMESH_CORE_VERSION,
  apiVersion: string = PLUGIN_API_VERSION
): StatusResolution {
  const { manifest } = plugin;

  const coreCompatible = satisfiesMinimum(coreVersion, manifest.minimumCoreVersion);
  if (!coreCompatible || !sameMajorVersion(manifest.apiVersion, apiVersion)) {
    return { status: 'incompatible', coreCompatible: false, pendingMigrationIds: [] };
  }

  const completed = new Set(entry?.completedMigrations ?? []);
  const pendingMigrationIds = (plugin.migrations ?? [])
    .filter((migration) => !completed.has(migration.id))
    .map((migration) => migration.id);

  if (entry?.lastError) {
    return { status: 'error', coreCompatible: true, pendingMigrationIds };
  }

  // Dependencies must be installed and enabled.
  const missing = (manifest.dependencies ?? []).some((dep) => {
    const depEntry = state.plugins[dep];
    return !depEntry || !depEntry.enabled;
  });
  if (missing) {
    return { status: 'missing-dependency', coreCompatible: true, pendingMigrationIds };
  }

  if (!entry || !entry.enabled) {
    return { status: 'disabled', coreCompatible: true, pendingMigrationIds };
  }

  if (pendingMigrationIds.length > 0) {
    return { status: 'migration-required', coreCompatible: true, pendingMigrationIds };
  }

  if (entry.version !== manifest.version) {
    return { status: 'update-available', coreCompatible: true, pendingMigrationIds };
  }

  return { status: 'enabled', coreCompatible: true, pendingMigrationIds };
}

export class PluginRegistry {
  private plugins = new Map<string, MindMeshPlugin>();
  private loadErrors = new Map<string, PluginErrorRecord>();

  register(plugin: MindMeshPlugin): void {
    this.plugins.set(plugin.manifest.id, plugin);
  }

  get(id: string): MindMeshPlugin | undefined {
    return this.plugins.get(id);
  }

  has(id: string): boolean {
    return this.plugins.has(id);
  }

  list(): MindMeshPlugin[] {
    return [...this.plugins.values()];
  }

  ids(): string[] {
    return [...this.plugins.keys()];
  }

  recordLoadError(id: string, error: PluginErrorRecord): void {
    this.loadErrors.set(id, error);
  }

  clearLoadError(id: string): void {
    this.loadErrors.delete(id);
  }

  getLoadError(id: string): PluginErrorRecord | undefined {
    return this.loadErrors.get(id);
  }

  /** Builds the read-only view used by the Plugin Manager UI. */
  view(plugin: MindMeshPlugin, state: PluginRegistryState): PluginView {
    const entry = state.plugins[plugin.manifest.id];
    const { manifest } = plugin;
    const resolution = resolvePluginStatus(plugin, entry, state);
    const loadError = this.loadErrors.get(manifest.id);
    return {
      id: manifest.id,
      name: manifest.name,
      description: manifest.description,
      version: manifest.version,
      installedVersion: entry?.version ?? manifest.version,
      minimumCoreVersion: manifest.minimumCoreVersion,
      apiVersion: manifest.apiVersion,
      author: manifest.author,
      status: loadError ? 'error' : resolution.status,
      enabled: entry?.enabled === true && !loadError,
      installed: Boolean(entry),
      coreCompatible: resolution.coreCompatible,
      permissions: manifest.permissions ?? [],
      dependencies: manifest.dependencies ?? [],
      pendingMigrationIds: resolution.pendingMigrationIds,
      routes: (plugin.routes ?? []).map((route) => ({ id: route.id, tab: route.tab, label: route.label })),
      lastError: loadError ?? entry?.lastError,
    };
  }

  views(state: PluginRegistryState): PluginView[] {
    return this.list()
      .map((plugin) => this.view(plugin, state))
      .sort((a, b) => a.name.localeCompare(b.name));
  }
}
