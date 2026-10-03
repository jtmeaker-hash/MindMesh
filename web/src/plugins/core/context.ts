/**
 * Controlled PluginContext factory.
 *
 * Plugins interact with MindMesh only through these APIs. There is deliberately
 * no access to the whole application state: a plugin gets namespaced storage,
 * a notification surface, a scheduler registry, read-only reminders, graph
 * registration, settings, diagnostics and a native-bridge probe.
 */
import type {
  PluginContext,
  PluginNodeType,
  PluginNotificationProvider,
  PluginNotificationJob,
  PluginSchedulerJob,
} from './types';
import type { Reminder } from '../../types';
import { MINDMESH_CORE_VERSION, PLUGIN_API_VERSION } from '../../types/plugin';
import { logger } from '../../services/logger';

/**
 * Namespaced localStorage key for one plugin-owned value. Exported so a plugin's
 * backup handler can read its own storage without a live PluginContext.
 */
export function pluginStorageKey(pluginId: string, key: string): string {
  return `mindmesh_plugin_${pluginId}_${key}`;
}

const storageKey = pluginStorageKey;

function readNamespaced<T>(pluginId: string, key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey(pluginId, key));
    if (raw === null) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeNamespaced<T>(pluginId: string, key: string, value: T): void {
  try {
    localStorage.setItem(storageKey(pluginId, key), JSON.stringify(value));
  } catch (err) {
    logger.warn('Plugins', 'Failed to persist plugin storage value', {
      pluginId,
      key,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export interface PluginContextDeps {
  /** Read-only reminder snapshot for the plugin. */
  getReminders: () => Reminder[];
  /** Registered graph node types (mutated by the graph API). */
  registerNodeType: (pluginId: string, nodeType: PluginNodeType) => void;
  getNodeTypes: (pluginId: string) => PluginNodeType[];
  /** Registers/replaces the plugin's shared-notification provider. */
  registerNotificationProvider: (provider: PluginNotificationProvider) => void;
  /** Removes the plugin's shared-notification provider. */
  clearNotificationProvider: (pluginId: string) => void;
}

/** Builds the controlled context handed to a plugin on activation. */
export function createPluginContext(pluginId: string, deps: PluginContextDeps): PluginContext {
  const schedulerKey = 'scheduler.jobs';
  const settingsKey = 'settings.values';

  return {
    pluginId,
    coreVersion: MINDMESH_CORE_VERSION,
    apiVersion: PLUGIN_API_VERSION,
    storage: {
      read: <T,>(key: string, fallback: T) => readNamespaced<T>(pluginId, key, fallback),
      write: <T,>(key: string, value: T) => writeNamespaced<T>(pluginId, key, value),
      remove: (key: string) => {
        try {
          localStorage.removeItem(storageKey(pluginId, key));
        } catch {
          /* ignore */
        }
      },
      keys: () => {
        const prefix = storageKey(pluginId, '');
        const keys: string[] = [];
        try {
          for (let i = 0; i < localStorage.length; i += 1) {
            const candidate = localStorage.key(i);
            if (candidate && candidate.startsWith(prefix)) {
              keys.push(candidate.slice(prefix.length));
            }
          }
        } catch {
          /* ignore */
        }
        return keys;
      },
    },
    notifications: {
      notify: (title, message, details) => {
        logger.info('Plugins', `[${pluginId}] ${title}`, { message, ...(details ?? {}) });
      },
      register: (provider) => {
        const wrapped: PluginNotificationProvider = {
          pluginId,
          getDesired: (now: Date): PluginNotificationJob[] => {
            try {
              return provider.getDesired(now);
            } catch (err) {
              logger.warn('Plugins', `[${pluginId}] notification provider threw; skipping`, {
                error: err instanceof Error ? err.message : String(err),
              });
              return [];
            }
          },
          onAction: provider.onAction
            ? (action, job) => {
                try {
                  provider.onAction!(action, job);
                } catch (err) {
                  logger.warn('Plugins', `[${pluginId}] notification action threw`, {
                    error: err instanceof Error ? err.message : String(err),
                  });
                }
              }
            : undefined,
        };
        deps.registerNotificationProvider(wrapped);
      },
      clear: () => deps.clearNotificationProvider(pluginId),
    },
    scheduler: {
      schedule: (job: PluginSchedulerJob) => {
        const jobs = readNamespaced<PluginSchedulerJob[]>(pluginId, schedulerKey, []);
        const next = jobs.filter((existing) => existing.id !== job.id);
        next.push(job);
        writeNamespaced(pluginId, schedulerKey, next);
      },
      cancel: (jobId: string) => {
        const jobs = readNamespaced<PluginSchedulerJob[]>(pluginId, schedulerKey, []);
        writeNamespaced(
          pluginId,
          schedulerKey,
          jobs.filter((job) => job.id !== jobId)
        );
      },
      list: () => readNamespaced<PluginSchedulerJob[]>(pluginId, schedulerKey, []),
      clear: () => writeNamespaced(pluginId, schedulerKey, []),
    },
    reminders: {
      list: () => deps.getReminders(),
    },
    graph: {
      registerNodeType: (nodeType) => deps.registerNodeType(pluginId, nodeType),
      nodeTypes: () => deps.getNodeTypes(pluginId),
    },
    settings: {
      get: <T,>(key: string, fallback: T) => {
        const values = readNamespaced<Record<string, unknown>>(pluginId, settingsKey, {});
        return (key in values ? (values[key] as T) : fallback);
      },
      set: <T,>(key: string, value: T) => {
        const values = readNamespaced<Record<string, unknown>>(pluginId, settingsKey, {});
        writeNamespaced(pluginId, settingsKey, { ...values, [key]: value });
      },
    },
    diagnostics: {
      log: (level, message, details) => {
        const tag = `Plugins/${pluginId}`;
        if (level === 'error') logger.error(tag, message, details);
        else if (level === 'warn') logger.warn(tag, message, details);
        else if (level === 'debug') logger.debug(tag, message, details);
        else logger.info(tag, message, details);
      },
      report: (message, details) => logger.info(`Plugins/${pluginId}`, message, details),
    },
    nativeBridge: {
      available: (capability) => {
        if (typeof window === 'undefined') return false;
        const bridge = (window as unknown as Record<string, unknown>).MindMeshNative;
        if (!bridge || typeof bridge !== 'object') return false;
        return typeof (bridge as Record<string, unknown>)[capability] !== 'undefined';
      },
    },
  };
}
