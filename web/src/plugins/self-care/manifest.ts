import type { PluginManifest } from '../../types/plugin';
// JSON is the single source of truth so CI packaging can read the exact same
// manifest that the runtime registers.
import rawManifest from './plugin.manifest.json';

/**
 * Self Care plugin manifest.
 *
 * Gentle opt-in check-ins delivered as real Android notifications. The plugin
 * version is independent from MindMesh Core: the plugin can be updated without
 * forcing a Core release, as long as `minimumCoreVersion` remains compatible.
 */
export const SELF_CARE_MANIFEST: PluginManifest = rawManifest as PluginManifest;

export const SELF_CARE_PLUGIN_ID = SELF_CARE_MANIFEST.id;
