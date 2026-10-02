/**
 * PluginLoader — validates downloaded plugin packages before they register.
 *
 * A downloaded `.mindmesh-plugin.zip` is untrusted. Loader validation checks the
 * ID, package format, manifest, version, Plugin API version, minimum Core
 * version, dependencies, integrity and declared capabilities. Rejections are
 * graceful: Core continues to run.
 */
import type { PluginManifest, PluginBackupSection } from '../../types/plugin';
import { MINDMESH_CORE_VERSION, PLUGIN_API_VERSION, normalizePluginBackupSection } from '../../types/plugin';
import {
  validatePluginPackage,
  type PluginPackageDescriptor,
  type PluginPackageValidationResult,
} from './manifest';
import type { PluginRegistryState } from '../../types/plugin';

export interface LoadedPluginPackage {
  descriptor: PluginPackageDescriptor;
  entryScript: string | null;
}

export interface PluginLoaderDependencies {
  getRegistryState: () => PluginRegistryState;
  coreVersion?: string;
  apiVersion?: string;
}

export class PluginLoader {
  constructor(private readonly deps: PluginLoaderDependencies) {}

  /** Validates a raw package descriptor (parsed manifest.json + file table). */
  validate(raw: unknown): PluginPackageValidationResult {
    return validatePluginPackage(raw, {
      coreVersion: this.deps.coreVersion ?? MINDMESH_CORE_VERSION,
      apiVersion: this.deps.apiVersion ?? PLUGIN_API_VERSION,
    });
  }

  /**
   * Validates a package and verifies its declared dependencies are present in
   * the registry. Returns the resolved descriptor or a human-readable reason.
   */
  load(raw: unknown): { ok: true; loaded: LoadedPluginPackage } | { ok: false; errors: string[] } {
    const validation = this.validate(raw);
    if (!validation.ok) return validation;

    const { descriptor } = validation;
    const state = this.deps.getRegistryState();
    const errors: string[] = [];

    for (const dependency of descriptor.manifest.dependencies ?? []) {
      if (!state.plugins[dependency]) {
        errors.push(`missing dependency: ${dependency}`);
      }
    }

    if (errors.length > 0) return { ok: false, errors };

    const entryScript =
      descriptor.files.map((file) => file.path).sort().find((path) => /\.(js|mjs)$/.test(path)) ?? null;

    return { ok: true, loaded: { descriptor, entryScript } };
  }

  manifestOf(raw: unknown): PluginManifest | null {
    const result = this.validate(raw);
    return result.ok ? result.descriptor.manifest : null;
  }
}

/**
 * Type guard for a plugin backup section found in an imported backup file.
 * Accepts both the current envelope and older `{ version, schemaVersion, data }`
 * sections, which the normalizer backfills with identity metadata.
 */
export function isPluginBackupSection(value: unknown): value is PluginBackupSection {
  return normalizePluginBackupSection(value) !== null;
}
