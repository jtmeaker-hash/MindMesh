/**
 * Built-in plugin registration.
 *
 * The only place Core knows about specific built-in plugins. Adding a future
 * plugin requires adding it here (plus its folder and workflow), not editing
 * App.tsx or scattering plugin logic through Core.
 */
import type { PluginManager } from './core/manager';
import { createMoneyManagementPlugin } from './money-management';
import { createCarMaintenancePlugin } from './car-maintenance';
import { createMedicationTrackerPlugin } from './medication-tracker';

export function registerBuiltinPlugins(manager: PluginManager): string[] {
  const builtins = [
    createMoneyManagementPlugin(),
    createCarMaintenancePlugin(),
    createMedicationTrackerPlugin(),
  ];
  for (const plugin of builtins) {
    if (!manager.registry.has(plugin.manifest.id)) {
      manager.register(plugin);
    }
  }
  return builtins.map((plugin) => plugin.manifest.id);
}
