import type { PluginManifest } from '../../types/plugin';
// JSON is the single source of truth so CI packaging reads the exact manifest
// the runtime registers.
import rawManifest from './plugin.manifest.json';

export const MEDICATION_TRACKER_MANIFEST: PluginManifest = rawManifest as PluginManifest;
export const MEDICATION_TRACKER_PLUGIN_ID = MEDICATION_TRACKER_MANIFEST.id;
