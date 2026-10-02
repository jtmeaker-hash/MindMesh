/**
 * PluginManager — lifecycle orchestration.
 *
 * Owns registration, default migration (auto-enabling features that used to be
 * built in), enable/disable, migrations, activation isolation, the backup
 * provider contract and the React subscription snapshot.
 *
 * GUARANTEES:
 *  - Disabling a plugin never deletes its data. Data removal is a separate,
 *    explicitly-confirmed `deletePluginData` action.
 *  - A plugin that throws during load/activation is isolated: Core keeps
 *    running, the plugin is marked `error`, and the cause is recorded.
 */
import type {
  MindMeshHostAPI,
  MindMeshPlugin,
  PluginContext,
  PluginErrorPhase,
  PluginErrorRecord,
  PluginNodeType,
  PluginRoute,
  PluginView,
} from './types';
import type { PluginRegistryEntry, PluginRegistryState } from '../../types/plugin';
import { PluginRegistry, resolvePluginStatus } from './registry';
import { createPluginContext } from './context';
import { loadPluginRegistry, loadReminders, savePluginRegistry } from '../../services/storage';
import { logger } from '../../services/logger';
import { setPluginBackupProvider, type PluginBackupProvider, type PluginRestoreOutcome } from './backupBridge';

export interface PluginRuntimeSnapshot {
  revision: number;
  views: PluginView[];
  enabledIds: string[];
  lastError?: PluginErrorRecord;
}

export interface PluginActionResult {
  ok: boolean;
  error?: string;
}

/** A route contributed by an enabled plugin, tagged with its owning plugin. */
export type EnabledPluginRoute = PluginRoute & { pluginId: string };

function nowIso(): string {
  return new Date().toISOString();
}

export class PluginManager implements PluginBackupProvider {
  readonly registry = new PluginRegistry();
  private state: PluginRegistryState;
  private host: MindMeshHostAPI | null = null;
  private initialized = false;
  private nodeTypes = new Map<string, PluginNodeType[]>();
  private listeners = new Set<() => void>();
  private revision = 0;
  private snapshot: PluginRuntimeSnapshot = { revision: 0, views: [], enabledIds: [] };

  constructor(state: PluginRegistryState = loadPluginRegistry()) {
    this.state = state;
  }

  // -------------------------------------------------------------------------
  // Registration
  // -------------------------------------------------------------------------

  register(plugin: MindMeshPlugin): void {
    this.registry.register(plugin);
    this.rebuildSnapshot();
  }

  registerAll(plugins: MindMeshPlugin[]): void {
    for (const plugin of plugins) this.registry.register(plugin);
    this.rebuildSnapshot();
  }

  setHost(host: MindMeshHostAPI): void {
    this.host = host;
  }

  /**
   * Synchronous bootstrap: resolves registry entries and enablement so the very
   * first render already knows which plugin tabs are available. This is what
   * makes the architectural migration invisible — built-in features appear
   * immediately, exactly as before.
   */
  bootstrapSync(): void {
    for (const plugin of this.registry.list()) {
      this.ensureEntry(plugin);
    }
    this.persist();
    setPluginBackupProvider(this);
    this.initialized = true;
    this.rebuildSnapshot();
  }

  /**
   * Idempotent startup. Ensures a registry entry exists for every plugin
   * (auto-enabling built-ins so previously-integrated features keep working),
   * runs required migrations and activates enabled plugins in isolation.
   */
  async initialize(): Promise<void> {
    this.bootstrapSync();

    for (const plugin of this.registry.list()) {
      const entry = this.state.plugins[plugin.manifest.id];
      if (!entry?.enabled) continue;
      await this.activatePlugin(plugin, entry);
    }
    this.rebuildSnapshot();
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  // -------------------------------------------------------------------------
  // Enable / disable / delete
  // -------------------------------------------------------------------------

  async enable(pluginId: string): Promise<PluginActionResult> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) return { ok: false, error: `Unknown plugin "${pluginId}"` };

    const entry = this.ensureEntry(plugin);
    const resolution = resolvePluginStatus(plugin, entry, this.state);
    if (resolution.status === 'incompatible') {
      return { ok: false, error: `${plugin.manifest.name} is not compatible with this MindMesh Core version.` };
    }
    if (resolution.status === 'missing-dependency') {
      return { ok: false, error: `${plugin.manifest.name} is missing a required plugin dependency.` };
    }

    // Run required migrations before activation, and only then flip enabled.
    const migrated = await this.runMigrations(plugin, entry);
    if (!migrated.ok) return migrated;

    entry.enabled = true;
    entry.enabledAt = nowIso();
    entry.disabledAt = undefined;
    entry.updatedAt = nowIso();
    // Re-read: runMigrations persisted completedMigrations.
    const refreshed = this.state.plugins[pluginId];
    refreshed.enabled = true;
    refreshed.enabledAt = nowIso();
    refreshed.disabledAt = undefined;
    refreshed.updatedAt = nowIso();
    refreshed.lastError = undefined;

    const activated = await this.activatePlugin(plugin, refreshed);
    this.persist();
    this.rebuildSnapshot();
    return activated;
  }

  async disable(pluginId: string): Promise<PluginActionResult> {
    const plugin = this.registry.get(pluginId);
    if (!plugin) return { ok: false, error: `Unknown plugin "${pluginId}"` };

    try {
      await plugin.deactivate(this.getContext(pluginId));
    } catch (err) {
      this.recordError(pluginId, 'deactivate', err);
    }

    const entry = this.state.plugins[pluginId];
    if (entry) {
      entry.enabled = false;
      entry.disabledAt = nowIso();
      entry.updatedAt = nowIso();
      // Disabling never removes data or migrations; only enablement changes.
    }
    this.nodeTypes.delete(pluginId);
    this.registry.clearLoadError(pluginId);
    this.persist();
    this.rebuildSnapshot();
    return { ok: true };
  }

  /**
   * Explicit, destructive data removal. Must be confirmed by the user in the
   * Plugin Manager. The plugin itself decides what "its data" means; built-in
   * plugins restore their storage slices to defaults rather than dropping the
   * underlying schema.
   */
  deletePluginData(pluginId: string): PluginActionResult {
    const plugin = this.registry.get(pluginId);
    if (!plugin || !plugin.deleteData) {
      return { ok: false, error: `${plugin?.manifest.name ?? pluginId} does not expose a data-removal action.` };
    }
    try {
      plugin.deleteData(this.getContext(pluginId));
      const entry = this.state.plugins[pluginId];
      if (entry) {
        entry.completedMigrations = [];
        entry.dataSchemaVersion = 0;
        entry.updatedAt = nowIso();
      }
      this.persist();
      this.rebuildSnapshot();
      return { ok: true };
    } catch (err) {
      this.recordError(pluginId, 'migration', err);
      this.rebuildSnapshot();
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  isEnabled(pluginId: string): boolean {
    const entry = this.state.plugins[pluginId];
    if (!entry?.enabled) return false;
    if (this.registry.getLoadError(pluginId)) return false;
    return true;
  }

  isInstalled(pluginId: string): boolean {
    return Boolean(this.state.plugins[pluginId]);
  }

  getState(): PluginRegistryState {
    return this.state;
  }

  getViews(): PluginView[] {
    return this.registry.views(this.state);
  }

  getView(pluginId: string): PluginView | undefined {
    return this.getViews().find((view) => view.id === pluginId);
  }

  /** Routes contributed by enabled plugins, in registration order. */
  getEnabledRoutes(): EnabledPluginRoute[] {
    const routes: EnabledPluginRoute[] = [];
    for (const plugin of this.registry.list()) {
      if (!this.isEnabled(plugin.manifest.id)) continue;
      for (const route of plugin.routes ?? []) {
        routes.push({ ...route, pluginId: plugin.manifest.id });
      }
    }
    return routes;
  }

  getEnabledTabs(): string[] {
    return [...new Set(this.getEnabledRoutes().map((route) => route.tab))];
  }

  getContext(pluginId: string): PluginContext {
    return createPluginContext(pluginId, {
      // Read-only snapshot of Core reminders for the plugin.
      getReminders: () => loadReminders(),
      registerNodeType: (id, nodeType) => {
        const existing = this.nodeTypes.get(id) ?? [];
        this.nodeTypes.set(id, [...existing.filter((n) => n.id !== nodeType.id), nodeType]);
      },
      getNodeTypes: (id) => this.nodeTypes.get(id) ?? [],
    });
  }

  // -------------------------------------------------------------------------
  // Backup provider (PluginBackupProvider)
  // -------------------------------------------------------------------------

  exportSections(): Record<string, import('../../types/plugin').PluginBackupSection> {
    const sections: Record<string, import('../../types/plugin').PluginBackupSection> = {};
    for (const plugin of this.registry.list()) {
      if (!plugin.backup) continue;
      // Installed or not, plugin data is included so disabling never risks data.
      try {
        sections[plugin.manifest.id] = plugin.backup.serialize();
      } catch (err) {
        logger.warn('Plugins', 'Plugin backup serialization failed', {
          pluginId: plugin.manifest.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return sections;
  }

  restoreSections(
    sections: Record<string, import('../../types/plugin').PluginBackupSection>
  ): PluginRestoreOutcome {
    const outcome: PluginRestoreOutcome = { restored: [], skipped: [], errors: {} };
    for (const [pluginId, section] of Object.entries(sections)) {
      const plugin = this.registry.get(pluginId);
      if (!plugin) {
        outcome.skipped.push(pluginId);
        continue;
      }
      if (!plugin.backup) {
        outcome.skipped.push(pluginId);
        continue;
      }
      try {
        plugin.backup.restore(section);
        outcome.restored.push(pluginId);
      } catch (err) {
        outcome.errors[pluginId] = err instanceof Error ? err.message : String(err);
        logger.warn('Plugins', 'Plugin backup restore failed', { pluginId, error: outcome.errors[pluginId] });
      }
    }
    return outcome;
  }

  listBackupPluginIds(): string[] {
    return this.registry.list().filter((plugin) => Boolean(plugin.backup)).map((plugin) => plugin.manifest.id);
  }

  // -------------------------------------------------------------------------
  // Subscription (React)
  // -------------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): PluginRuntimeSnapshot => this.snapshot;

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private ensureEntry(plugin: MindMeshPlugin): PluginRegistryEntry {
    const id = plugin.manifest.id;
    const existing = this.state.plugins[id];
    if (existing) {
      // Keep the plugin version current without disturbing user enablement.
      if (existing.version !== plugin.manifest.version) {
        existing.version = plugin.manifest.version;
        existing.updatedAt = nowIso();
      }
      return existing;
    }

    const detect = this.host && plugin.detectExistingData ? plugin.detectExistingData(this.host) : false;
    const enabled = detect || (plugin.defaultEnabled ?? false);
    const entry: PluginRegistryEntry = {
      id,
      version: plugin.manifest.version,
      enabled,
      installedAt: nowIso(),
      updatedAt: nowIso(),
      enabledAt: enabled ? nowIso() : undefined,
      completedMigrations: [],
      dataSchemaVersion: 0,
    };
    this.state.plugins[id] = entry;
    logger.info('Plugins', 'Registered plugin', {
      pluginId: id,
      version: plugin.manifest.version,
      enabled,
      detectedExistingData: detect,
    });
    return entry;
  }

  private async activatePlugin(plugin: MindMeshPlugin, entry: PluginRegistryEntry): Promise<PluginActionResult> {
    const id = plugin.manifest.id;
    try {
      await plugin.activate(this.getContext(id));
      entry.lastError = undefined;
      this.registry.clearLoadError(id);
      logger.info('Plugins', 'Plugin activated', { pluginId: id, version: plugin.manifest.version });
      return { ok: true };
    } catch (err) {
      this.recordError(id, 'activate', err);
      logger.error('Plugins', 'Plugin activation failed; Core continues', {
        pluginId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async runMigrations(plugin: MindMeshPlugin, entry: PluginRegistryEntry): Promise<PluginActionResult> {
    const migrations = plugin.migrations ?? [];
    if (migrations.length === 0) return { ok: true };
    const completed = new Set(entry.completedMigrations);
    const ordered = [...migrations].sort((a, b) => a.fromSchemaVersion - b.fromSchemaVersion);
    for (const migration of ordered) {
      if (completed.has(migration.id)) continue;
      try {
        await migration.run(this.getContext(plugin.manifest.id));
        entry.completedMigrations.push(migration.id);
        entry.dataSchemaVersion = migration.toSchemaVersion;
        entry.updatedAt = nowIso();
        this.persist();
        logger.info('Plugins', 'Plugin migration complete', {
          pluginId: plugin.manifest.id,
          migrationId: migration.id,
          toSchemaVersion: migration.toSchemaVersion,
        });
      } catch (err) {
        this.recordError(plugin.manifest.id, 'migration', err);
        this.rebuildSnapshot();
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { ok: true };
  }

  private recordError(pluginId: string, phase: PluginErrorPhase, err: unknown): void {
    const record: PluginErrorRecord = {
      message: err instanceof Error ? err.message : String(err),
      at: nowIso(),
      phase,
    };
    this.registry.recordLoadError(pluginId, record);
    const entry = this.state.plugins[pluginId];
    if (entry) entry.lastError = record;
    this.persist();
  }

  private persist(): void {
    try {
      this.state.lastUpdated = nowIso();
      savePluginRegistry(this.state);
    } catch (err) {
      logger.warn('Plugins', 'Failed to persist plugin registry state', {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private rebuildSnapshot(): void {
    this.revision += 1;
    const views = this.getViews();
    const enabledIds = views.filter((view) => view.enabled).map((view) => view.id);
    const lastError = this.registry
      .list()
      .map((plugin) => this.registry.getLoadError(plugin.manifest.id))
      .filter((error): error is PluginErrorRecord => Boolean(error))
      .pop();
    this.snapshot = { revision: this.revision, views, enabledIds, lastError };
    for (const listener of this.listeners) listener();
  }
}
