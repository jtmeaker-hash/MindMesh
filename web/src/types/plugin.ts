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

export interface PluginBackupSection {
  version: string;
  schemaVersion: number;
  data: unknown;
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
