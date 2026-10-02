import type { PluginManifest } from '../../types/plugin';
// JSON is the single source of truth so CI packaging can read the exact same
// manifest that the runtime registers.
import rawManifest from './plugin.manifest.json';

/**
 * Money Management plugin manifest.
 *
 * The plugin version is independent from MindMesh Core: the plugin can be
 * updated without forcing a Core release, as long as `minimumCoreVersion`
 * remains compatible.
 */
export const MONEY_MANAGEMENT_MANIFEST: PluginManifest = rawManifest as PluginManifest;

export const MONEY_MANAGEMENT_PLUGIN_ID = MONEY_MANAGEMENT_MANIFEST.id;
