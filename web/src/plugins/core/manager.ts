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
import type {
  PluginBackupSection,
  PluginRegistryEntry,
  PluginRegistryState,
} from '../../types/plugin';
import { PLUGIN_BACKUP_PAYLOAD_VERSION, normalizePluginBackupSection } from '../../types/plugin';
import { PluginRegistry, resolvePluginStatus } from './registry';
import { createPluginContext } from './context';
import {
  loadPluginRegistry,
  loadReminders,
  loadRetainedPluginData,
  savePluginRegistry,
  saveRetainedPluginData,
} from '../../services/storage';
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
      // Adopt any retained backup data matching this plugin before activating,
      // so a plugin installed after a restore automatically gets its data back.
      await this.adoptRetainedData(plugin, entry);
      // A failed adoption (e.g. a throwing migration) leaves the retained copy
      // intact and must not be cleared by a successful activation, so skip it.
      if (this.registry.getLoadError(plugin.manifest.id)) continue;
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

    // Adopt any retained backup data before activating. The retained copy is
    // only dropped after the restore + migration both succeed, so a failure can
    // never destroy the preserved payload.
    await this.adoptRetainedData(plugin, entry);

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
      // Explicit deletion is the only path that may drop a retained payload.
      this.clearRetainedSection(pluginId);
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

  /**
   * Serializes every registered plugin that declares a backup handler into a
   * full section, regardless of enablement, plus any retained payloads for
   * plugins that are not currently available. Plugin state (enabled/disabled/
   * absent) never gates whether data is included.
   */
  exportSections(): Record<string, PluginBackupSection> {
    const sections: Record<string, PluginBackupSection> = {};
    for (const plugin of this.registry.list()) {
      if (!plugin.backup) continue;
      try {
        sections[plugin.manifest.id] = this.buildBackupSection(plugin);
      } catch (err) {
        logger.warn('Plugins', 'Plugin backup serialization failed', {
          pluginId: plugin.manifest.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Retained data for unavailable plugins keeps travelling with every backup.
    const retained = loadRetainedPluginData();
    for (const [id, section] of Object.entries(retained.sections)) {
      if (!sections[id]) sections[id] = section;
    }
    return sections;
  }

  /**
   * Applies plugin sections after Core state is persisted.
   *
   *  - Available plugin  → the payload is applied immediately.
   *  - Unavailable plugin → the payload is retained verbatim and marked as
   *    belonging to an unavailable plugin, never discarded or modified.
   *  - Apply failure      → the payload is retained so nothing is ever lost.
   */
  restoreSections(sections: Record<string, PluginBackupSection>): PluginRestoreOutcome {
    const outcome: PluginRestoreOutcome = { restored: [], retained: [], skipped: [], errors: {} };
    const retainedState = loadRetainedPluginData();
    let retainedChanged = false;

    const retain = (id: string, section: PluginBackupSection) => {
      // `enabled` is configuration only; forcing it false marks the payload as
      // unclaimed without touching its data.
      retainedState.sections[id] = { ...section, enabled: false };
      retainedChanged = true;
      if (!outcome.retained.includes(id)) outcome.retained.push(id);
    };

    for (const [pluginId, raw] of Object.entries(sections)) {
      const section = normalizePluginBackupSection(raw, pluginId);
      if (!section) {
        outcome.skipped.push(pluginId);
        logger.warn('Plugins', 'Plugin backup section carried no usable payload; skipped', { pluginId });
        continue;
      }

      const plugin = this.registry.get(pluginId);
      if (!plugin || !plugin.backup) {
        // Unknown or not-yet-installed plugin: preserve the data untouched.
        retain(pluginId, section);
        logger.info('Plugins', 'Retained plugin data for an unavailable plugin', { pluginId });
        continue;
      }

      try {
        plugin.backup.restore(section);
        outcome.restored.push(pluginId);
        if (retainedState.sections[pluginId]) {
          delete retainedState.sections[pluginId];
          retainedChanged = true;
        }
      } catch (err) {
        outcome.errors[pluginId] = err instanceof Error ? err.message : String(err);
        // A failed apply must never destroy the payload; keep it for a retry.
        retain(pluginId, section);
        logger.warn('Plugins', 'Plugin backup restore failed; data retained for a later retry', {
          pluginId,
          error: outcome.errors[pluginId],
        });
      }
    }

    if (retainedChanged) saveRetainedPluginData(retainedState);
    return outcome;
  }

  listBackupPluginIds(): string[] {
    const ids = this.registry
      .list()
      .filter((plugin) => Boolean(plugin.backup))
      .map((plugin) => plugin.manifest.id);
    for (const id of this.getRetainedPluginIds()) {
      if (!ids.includes(id)) ids.push(id);
    }
    return ids;
  }

  /** Ids of plugins whose backup data is retained because they are unavailable. */
  getRetainedPluginIds(): string[] {
    return Object.keys(loadRetainedPluginData().sections);
  }

  hasRetainedData(pluginId: string): boolean {
    return Boolean(loadRetainedPluginData().sections[pluginId]);
  }

  /** Builds a full backup section from a plugin's manifest + serialized payload. */
  private buildBackupSection(plugin: MindMeshPlugin): PluginBackupSection {
    if (!plugin.backup) throw new Error(`Plugin ${plugin.manifest.id} has no backup handler`);
    const id = plugin.manifest.id;
    const entry = this.state.plugins[id];
    const context = this.getContext(id);

    // Settings are generic: read every declared setting from plugin-owned
    // storage so configuration travels without each plugin hand-rolling it.
    const settings: Record<string, unknown> = {};
    for (const setting of plugin.settings ?? []) {
      settings[setting.id] = context.settings.get(setting.id, setting.defaultValue);
    }

    const payload = plugin.backup.serialize();
    return {
      payloadVersion: PLUGIN_BACKUP_PAYLOAD_VERSION,
      pluginId: id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      schemaVersion: plugin.manifest.schemaVersion,
      enabled: entry?.enabled === true,
      settings: Object.keys(settings).length > 0 ? settings : undefined,
      history: payload.history,
      lastModified: entry?.updatedAt ?? nowIso(),
      data: payload.data,
    };
  }

  /**
   * Adopts retained backup data for a plugin that just became available:
   * restore → migrate → verify. The retained copy is removed only after both
   * the restore and the migration succeed, so a migration failure can never
   * destroy the original retained payload.
   */
  private async adoptRetainedData(plugin: MindMeshPlugin, entry: PluginRegistryEntry): Promise<void> {
    if (!plugin.backup) return;
    const id = plugin.manifest.id;
    const section = loadRetainedPluginData().sections[id];
    if (!section) return;

    try {
      plugin.backup.restore(section);
    } catch (err) {
      logger.warn('Plugins', 'Retained plugin data could not be restored; payload preserved', {
        pluginId: id,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    const migrated = await this.runMigrations(plugin, entry);
    if (!migrated.ok) {
      logger.warn('Plugins', 'Migration of retained plugin data failed; payload preserved', {
        pluginId: id,
        error: migrated.error,
      });
      return;
    }

    this.clearRetainedSection(id);
    logger.info('Plugins', 'Retained plugin data adopted', {
      pluginId: id,
      schemaVersion: section.schemaVersion,
    });
  }

  private clearRetainedSection(pluginId: string): void {
    const retained = loadRetainedPluginData();
    if (!retained.sections[pluginId]) return;
    delete retained.sections[pluginId];
    saveRetainedPluginData(retained);
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
