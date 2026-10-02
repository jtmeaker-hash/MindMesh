/**
 * React-free plugin types shared by Core infrastructure (storage, backup,
 * diagnostics) and the plugin runtime. Keeping them here avoids a circular
 * dependency between `types/index.ts` and the plugin core.
 */

export type PluginPermission =
  | 'storage'
  | 'notifications'
  | 'scheduler'
  | 'reminders'
  | 'graph'
  | 'backup'
  | 'settings'
  | 'diagnostics'
  | 'native';

export const PLUGIN_PERMISSION_LABELS: Record<PluginPermission, string> = {
  storage: 'Plugin storage',
  notifications: 'Send notifications',
  scheduler: 'Schedule background work',
  reminders: 'Read reminders',
  graph: 'Add graph node types',
  backup: 'Participate in backup/restore',
  settings: 'Store settings',
  diagnostics: 'Report diagnostics',
  native: 'Use the Android native bridge',
};

export const PLUGIN_API_VERSION = '1.0.0';
export const MINDMESH_CORE_VERSION = '1.8.0';

export type PluginStatus =
  | 'installed'
  | 'enabled'
  | 'disabled'
  | 'update-available'
  | 'incompatible'
  | 'missing-dependency'
  | 'migration-required'
  | 'error';

export type PluginErrorPhase = 'validate' | 'load' | 'activate' | 'deactivate' | 'migration';

export interface PluginErrorRecord {
  message: string;
  at: string;
  phase: PluginErrorPhase;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description: string;
  minimumCoreVersion: string;
  apiVersion: string;
  schemaVersion: number;
  author?: string;
  dependencies?: string[];
  permissions?: PluginPermission[];
}

export interface PluginRegistryEntry {
  id: string;
  version: string;
  enabled: boolean;
  installedAt: string;
  updatedAt: string;
  enabledAt?: string;
  disabledAt?: string;
  lastError?: PluginErrorRecord;
  completedMigrations: string[];
  dataSchemaVersion: number;
}

export interface PluginRegistryState {
  version: number;
  lastUpdated: string;
  plugins: Record<string, PluginRegistryEntry>;
}

export const PLUGIN_REGISTRY_VERSION = 1;

export function createEmptyRegistryState(): PluginRegistryState {
  return { version: PLUGIN_REGISTRY_VERSION, lastUpdated: new Date().toISOString(), plugins: {} };
}

/**
 * Version of the backup *section envelope* itself (independent of a plugin's
 * own data schema version). Bumped only if the envelope's shape changes.
 */
export const PLUGIN_BACKUP_PAYLOAD_VERSION = 1;

/**
 * One plugin's entry inside a MindMesh backup's `plugins` map.
 *
 * A section always carries the plugin's data plus enough identity metadata to
 * be retained and later applied even when the plugin is not installed. The
 * `enabled` flag is configuration only: it is never a reason to drop `data`.
 */
export interface PluginBackupSection {
  /** Backup envelope version for this section. */
  payloadVersion: number;
  /** Unique plugin id (matches this section's key in the plugins map). */
  pluginId: string;
  /** Human-readable plugin name at backup time. */
  name: string;
  /** Plugin version that produced the section. */
  version: string;
  /** Plugin data/schema version of `data`. */
  schemaVersion: number;
  /** Enablement at backup time. Configuration only — never gates `data`. */
  enabled: boolean;
  /** Plugin configuration/settings values, when the plugin defines settings. */
  settings?: Record<string, unknown>;
  /** Plugin-specific history, when applicable. */
  history?: unknown;
  /** When the plugin's data was last known to change, when applicable. */
  lastModified?: string;
  /** The plugin's actual user data. Always preserved. */
  data: unknown;
}

/**
 * Plugin data restored while the owning plugin was unavailable. It is held here,
 * untouched, until the plugin is installed/re-enabled and adopts it.
 */
export interface RetainedPluginData {
  version: number;
  lastUpdated: string;
  sections: Record<string, PluginBackupSection>;
}

export const RETAINED_PLUGIN_DATA_VERSION = 1;

export function createEmptyRetainedPluginData(): RetainedPluginData {
  return { version: RETAINED_PLUGIN_DATA_VERSION, lastUpdated: new Date().toISOString(), sections: {} };
}

/**
 * Non-destructively normalizes a plugin backup section. Old sections that only
 * had `{ version, schemaVersion, data }` are backfilled with identity metadata
 * (using the map key as `pluginId`). Returns null only when there is no usable
 * payload, so a malformed entry is skipped rather than corrupting the backup.
 */
export function normalizePluginBackupSection(
  input: unknown,
  fallbackId?: string
): PluginBackupSection | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  const pluginId =
    typeof raw.pluginId === 'string' && raw.pluginId.length > 0
      ? raw.pluginId
      : typeof fallbackId === 'string' && fallbackId.length > 0
        ? fallbackId
        : '';
  if (!pluginId) return null;
  if (!('data' in raw)) return null;
  return {
    payloadVersion:
      typeof raw.payloadVersion === 'number' && Number.isInteger(raw.payloadVersion)
        ? raw.payloadVersion
        : PLUGIN_BACKUP_PAYLOAD_VERSION,
    pluginId,
    name: typeof raw.name === 'string' && raw.name.length > 0 ? raw.name : pluginId,
    version: typeof raw.version === 'string' ? raw.version : '0.0.0',
    schemaVersion:
      typeof raw.schemaVersion === 'number' && Number.isInteger(raw.schemaVersion)
        ? raw.schemaVersion
        : 0,
    enabled: raw.enabled === true,
    settings:
      raw.settings && typeof raw.settings === 'object' && !Array.isArray(raw.settings)
        ? (raw.settings as Record<string, unknown>)
        : undefined,
    history: 'history' in raw ? raw.history : undefined,
    lastModified: typeof raw.lastModified === 'string' ? raw.lastModified : undefined,
    data: raw.data,
  };
}

/** Non-destructive normalizer for the retained-plugin-data store. */
export function normalizeRetainedPluginData(input: unknown): RetainedPluginData {
  const base = createEmptyRetainedPluginData();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const raw = input as Record<string, unknown>;
  const sections: Record<string, PluginBackupSection> = {};
  const rawSections = raw.sections;
  if (rawSections && typeof rawSections === 'object' && !Array.isArray(rawSections)) {
    for (const [id, value] of Object.entries(rawSections as Record<string, unknown>)) {
      const normalized = normalizePluginBackupSection(value, id);
      if (normalized) sections[id] = normalized;
    }
  }
  return {
    version: typeof raw.version === 'number' ? raw.version : RETAINED_PLUGIN_DATA_VERSION,
    lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : new Date().toISOString(),
    sections,
  };
}

/** Non-destructive normalizer: unknown/invalid fields fall back to safe values. */
export function normalizePluginRegistryState(input: unknown): PluginRegistryState {
  const base = createEmptyRegistryState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const raw = input as Record<string, unknown>;
  const plugins: Record<string, PluginRegistryEntry> = {};
  const rawPlugins = raw.plugins;
  if (rawPlugins && typeof rawPlugins === 'object' && !Array.isArray(rawPlugins)) {
    for (const [id, value] of Object.entries(rawPlugins as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const entry = value as Record<string, unknown>;
      plugins[id] = {
        id,
        version: typeof entry.version === 'string' ? entry.version : '0.0.0',
        enabled: entry.enabled === true,
        installedAt: typeof entry.installedAt === 'string' ? entry.installedAt : new Date().toISOString(),
        updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : new Date().toISOString(),
        enabledAt: typeof entry.enabledAt === 'string' ? entry.enabledAt : undefined,
        disabledAt: typeof entry.disabledAt === 'string' ? entry.disabledAt : undefined,
        lastError:
          entry.lastError && typeof entry.lastError === 'object' && !Array.isArray(entry.lastError)
            ? (entry.lastError as PluginErrorRecord)
            : undefined,
        completedMigrations: Array.isArray(entry.completedMigrations)
          ? entry.completedMigrations.filter((migration): migration is string => typeof migration === 'string')
          : [],
        dataSchemaVersion:
          typeof entry.dataSchemaVersion === 'number' && Number.isInteger(entry.dataSchemaVersion)
            ? entry.dataSchemaVersion
            : 0,
      };
    }
  }
  return {
    version: typeof raw.version === 'number' ? raw.version : PLUGIN_REGISTRY_VERSION,
    lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : new Date().toISOString(),
    plugins,
  };
}

/**
 * A validated plugin package recorded by the runtime installer.
 *
 * This is install/provenance state, not user data. The package supplies the
 * plugin's identity, version and integrity metadata; the runtime reconciles it
 * with the plugin implementation compiled into this build. Removing a package
 * record never removes the plugin's stored data (uninstall protection).
 */
export interface InstalledPluginPackage {
  id: string;
  name: string;
  version: string;
  schemaVersion: number;
  apiVersion: string;
  minimumCoreVersion: string;
  permissions: PluginPermission[];
  /** Verified package integrity (`fnv1a-...`) at install time. */
  integrity: string;
  /** Paths declared by the package descriptor. */
  files: string[];
  /** Original downloaded file name, for provenance. */
  sourceName: string;
  installedAt: string;
}

export interface InstalledPluginPackageState {
  version: number;
  lastUpdated: string;
  packages: Record<string, InstalledPluginPackage>;
}

export const INSTALLED_PLUGIN_PACKAGES_VERSION = 1;

export function createEmptyInstalledPackageState(): InstalledPluginPackageState {
  return {
    version: INSTALLED_PLUGIN_PACKAGES_VERSION,
    lastUpdated: new Date().toISOString(),
    packages: {},
  };
}

/** Non-destructive normalizer for the installed-plugin-package store. */
export function normalizeInstalledPluginPackageState(input: unknown): InstalledPluginPackageState {
  const base = createEmptyInstalledPackageState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const raw = input as Record<string, unknown>;
  const packages: Record<string, InstalledPluginPackage> = {};
  const rawPackages = raw.packages;
  if (rawPackages && typeof rawPackages === 'object' && !Array.isArray(rawPackages)) {
    for (const [id, value] of Object.entries(rawPackages as Record<string, unknown>)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
      const pkg = value as Record<string, unknown>;
      if (typeof pkg.version !== 'string' || typeof pkg.integrity !== 'string') continue;
      packages[id] = {
        id,
        name: typeof pkg.name === 'string' && pkg.name.length > 0 ? pkg.name : id,
        version: pkg.version,
        schemaVersion:
          typeof pkg.schemaVersion === 'number' && Number.isInteger(pkg.schemaVersion) ? pkg.schemaVersion : 0,
        apiVersion: typeof pkg.apiVersion === 'string' ? pkg.apiVersion : '0.0.0',
        minimumCoreVersion:
          typeof pkg.minimumCoreVersion === 'string' ? pkg.minimumCoreVersion : '0.0.0',
        permissions: Array.isArray(pkg.permissions)
          ? pkg.permissions.filter((permission): permission is PluginPermission => typeof permission === 'string')
          : [],
        integrity: pkg.integrity,
        files: Array.isArray(pkg.files) ? pkg.files.filter((file): file is string => typeof file === 'string') : [],
        sourceName: typeof pkg.sourceName === 'string' ? pkg.sourceName : '',
        installedAt: typeof pkg.installedAt === 'string' ? pkg.installedAt : new Date().toISOString(),
      };
    }
  }
  return {
    version: typeof raw.version === 'number' ? raw.version : INSTALLED_PLUGIN_PACKAGES_VERSION,
    lastUpdated: typeof raw.lastUpdated === 'string' ? raw.lastUpdated : new Date().toISOString(),
    packages,
  };
}

export interface PluginMigration {
  id: string;
  description: string;
  fromSchemaVersion: number;
  toSchemaVersion: number;
}

export interface PluginSetting {
  id: string;
  label: string;
  description?: string;
  type: 'boolean' | 'string' | 'number';
  defaultValue: boolean | string | number;
}

export interface PluginNodeType {
  id: string;
  label: string;
  color?: string;
}

export interface PluginHealth {
  status: PluginStatus;
  message: string;
  lastError?: PluginErrorRecord;
}
