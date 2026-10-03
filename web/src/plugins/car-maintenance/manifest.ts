import type { PluginManifest } from '../../types/plugin';
// JSON is the single source of truth so CI packaging can read the exact same
// manifest that the runtime registers.
import rawManifest from './plugin.manifest.json';

/**
 * Car Maintenance plugin manifest.
 *
 * Tracks vehicles, odometer, services, serviceable items, known issues, parts
 * estimates and recurring odometer/service reminders.
 */
export const CAR_MAINTENANCE_MANIFEST: PluginManifest = rawManifest as PluginManifest;

export const CAR_MAINTENANCE_PLUGIN_ID = CAR_MAINTENANCE_MANIFEST.id;
