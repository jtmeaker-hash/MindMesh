import { useSyncExternalStore } from 'react';
import type { PluginManager, PluginRuntimeSnapshot } from './manager';

/**
 * Subscribes a component to the plugin manager snapshot. Kept in its own file
 * so `runtime.ts` (imported by non-React Core services) stays React-free.
 */
export function usePluginRuntime(manager: PluginManager): PluginRuntimeSnapshot {
  return useSyncExternalStore(manager.subscribe, manager.getSnapshot, manager.getSnapshot);
}
