/**
 * Plugin manifest + package validation.
 *
 * A downloaded plugin package is untrusted input. Everything about it — id,
 * version, compatibility, capabilities and integrity — is validated before it
 * is allowed to register. Malformed packages are rejected with clear reasons
 * and can never stop MindMesh from starting.
 */
import {
  PluginManifest,
  PluginPermission,
  PLUGIN_API_VERSION,
  MINDMESH_CORE_VERSION,
} from './types';
import { satisfiesMinimum, sameMajorVersion } from './version';

export const PLUGIN_PACKAGE_FORMAT_VERSION = 1;
export const PLUGIN_PACKAGE_EXTENSION = '.mindmesh-plugin.zip';
export const PLUGIN_MANIFEST_FILENAME = 'manifest.json';

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
const ALLOWED_PERMISSIONS: PluginPermission[] = [
  'storage',
  'notifications',
  'scheduler',
  'reminders',
  'graph',
  'backup',
  'settings',
  'diagnostics',
  'native',
];

export interface ManifestValidationOk {
  ok: true;
  manifest: PluginManifest;
}
export interface ManifestValidationError {
  ok: false;
  errors: string[];
}
export type ManifestValidationResult = ManifestValidationOk | ManifestValidationError;

function isSemver(value: unknown): value is string {
  return typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value.trim().replace(/^v/i, ''));
}

/** Validates an untrusted manifest object. Never throws. */
export function validateManifest(raw: unknown): ManifestValidationResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['manifest must be a JSON object'] };
  }
  const input = raw as Record<string, unknown>;

  if (typeof input.id !== 'string' || !PLUGIN_ID_PATTERN.test(input.id)) {
    errors.push('id must be a lowercase slug (a-z, 0-9, dashes)');
  }
  if (typeof input.name !== 'string' || input.name.trim().length === 0) {
    errors.push('name is required');
  }
  if (typeof input.description !== 'string' || input.description.trim().length === 0) {
    errors.push('description is required');
  }
  if (!isSemver(input.version)) errors.push('version must be semver (e.g. 1.0.0)');
  if (!isSemver(input.minimumCoreVersion)) errors.push('minimumCoreVersion must be semver');
  if (!isSemver(input.apiVersion)) errors.push('apiVersion must be semver');
  if (typeof input.schemaVersion !== 'number' || !Number.isInteger(input.schemaVersion) || input.schemaVersion < 0) {
    errors.push('schemaVersion must be a non-negative integer');
  }

  const dependencies = input.dependencies;
  if (dependencies !== undefined) {
    if (!Array.isArray(dependencies) || dependencies.some((dep) => typeof dep !== 'string' || !PLUGIN_ID_PATTERN.test(dep))) {
      errors.push('dependencies must be an array of plugin ids');
    }
  }

  const permissions = input.permissions;
  let normalizedPermissions: PluginPermission[] = [];
  if (permissions !== undefined) {
    if (!Array.isArray(permissions)) {
      errors.push('permissions must be an array');
    } else {
      const unknown = permissions.filter(
        (perm) => typeof perm !== 'string' || !ALLOWED_PERMISSIONS.includes(perm as PluginPermission)
      );
      if (unknown.length > 0) errors.push(`unknown permission(s): ${unknown.join(', ')}`);
      normalizedPermissions = permissions.filter((perm): perm is PluginPermission =>
        typeof perm === 'string' && ALLOWED_PERMISSIONS.includes(perm as PluginPermission)
      );
    }
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    manifest: {
      id: input.id as string,
      name: input.name as string,
      version: input.version as string,
      description: input.description as string,
      minimumCoreVersion: input.minimumCoreVersion as string,
      apiVersion: input.apiVersion as string,
      schemaVersion: input.schemaVersion as number,
      author: typeof input.author === 'string' ? input.author : undefined,
      dependencies: Array.isArray(dependencies) ? (dependencies as string[]) : undefined,
      permissions: normalizedPermissions,
    },
  };
}

// ---------------------------------------------------------------------------
// Package format
// ---------------------------------------------------------------------------

export interface PluginPackageFile {
  path: string;
  size: number;
  integrity: string;
}

export interface PluginPackageDescriptor {
  packageFormatVersion: number;
  manifest: PluginManifest;
  files: PluginPackageFile[];
  /** Integrity over manifest + files, verified on install. */
  integrity: string;
}

export interface PluginPackageValidationOptions {
  coreVersion?: string;
  apiVersion?: string;
}

export type PluginPackageValidationResult =
  | { ok: true; descriptor: PluginPackageDescriptor }
  | { ok: false; errors: string[] };

/** Rejects absolute paths, traversal and Windows drive prefixes. */
export function isSafePluginPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (/^[A-Za-z]:[\\/]/.test(path)) return false;
  if (path.includes('\0')) return false;
  return !path.split(/[\\/]/).some((segment) => segment === '..');
}

/**
 * Deterministic integrity hash over the manifest and declared files.
 * A lightweight FNV-1a is intentional: packages are also integrity-checked by
 * GitHub Actions artifact checksums at distribution time.
 */
export function computePackageIntegrity(
  manifest: PluginManifest,
  files: PluginPackageFile[],
  packageFormatVersion = PLUGIN_PACKAGE_FORMAT_VERSION
): string {
  const canonical = JSON.stringify({
    packageFormatVersion,
    manifest,
    files: [...files].sort((a, b) => a.path.localeCompare(b.path)),
  });
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
}

/** Validates an untrusted package descriptor before installation. */
export function validatePluginPackage(
  raw: unknown,
  options: PluginPackageValidationOptions = {}
): PluginPackageValidationResult {
  const coreVersion = options.coreVersion ?? MINDMESH_CORE_VERSION;
  const apiVersion = options.apiVersion ?? PLUGIN_API_VERSION;

  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['package must be a JSON object'] };
  }
  const input = raw as Record<string, unknown>;

  if (input.packageFormatVersion !== PLUGIN_PACKAGE_FORMAT_VERSION) {
    return {
      ok: false,
      errors: [
        `unsupported plugin package format ${String(input.packageFormatVersion)} (expected ${PLUGIN_PACKAGE_FORMAT_VERSION})`,
      ],
    };
  }

  const manifestResult = validateManifest(input.manifest);
  if (!manifestResult.ok) return { ok: false, errors: manifestResult.errors };
  const manifest = manifestResult.manifest;

  const errors: string[] = [];

  if (!satisfiesMinimum(coreVersion, manifest.minimumCoreVersion)) {
    errors.push(
      `requires MindMesh Core ${manifest.minimumCoreVersion} or newer (this is ${coreVersion})`
    );
  }
  if (!sameMajorVersion(manifest.apiVersion, apiVersion)) {
    errors.push(
      `built against Plugin API ${manifest.apiVersion}, which is incompatible with ${apiVersion}`
    );
  }

  if (!Array.isArray(input.files)) {
    errors.push('files must be an array');
    return { ok: false, errors };
  }
  const files: PluginPackageFile[] = [];
  for (const entry of input.files) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push('each package file must be an object');
      continue;
    }
    const file = entry as Record<string, unknown>;
    if (typeof file.path !== 'string' || !isSafePluginPath(file.path)) {
      errors.push(`unsafe or missing file path: ${String(file.path)}`);
      continue;
    }
    if (typeof file.integrity !== 'string' || file.integrity.length === 0) {
      errors.push(`missing integrity for ${file.path}`);
      continue;
    }
    files.push({
      path: file.path,
      size: typeof file.size === 'number' ? file.size : 0,
      integrity: file.integrity,
    });
  }
  if (files.length === 0) errors.push('package declares no files');

  if (errors.length > 0) return { ok: false, errors };

  const expectedIntegrity = computePackageIntegrity(manifest, files);
  if (typeof input.integrity !== 'string' || input.integrity !== expectedIntegrity) {
    return { ok: false, errors: ['package integrity check failed'] };
  }

  return {
    ok: true,
    descriptor: {
      packageFormatVersion: PLUGIN_PACKAGE_FORMAT_VERSION,
      manifest,
      files,
      integrity: expectedIntegrity,
    },
  };
}
