/**
 * Runtime plugin installer.
 *
 * Wires the existing package validation (`core/manifest.ts`, `core/loader.ts`)
 * into a downloadable install flow. A `.mindmesh-plugin.zip` (or a bare
 * `.mindmesh-plugin.json` descriptor) is parsed, its descriptor is validated
 * against this Core/Plugin API build, and the package's identity/version/
 * integrity metadata is recorded.
 *
 * SECURITY MODEL: the installer parses and validates packages; it never
 * evaluates downloaded code. Plugin implementations ship compiled into the app
 * (e.g. the Money Management / Car Maintenance built-ins distributed through
 * their plugin branches), and an installed package is reconciled with the
 * implementation present in this build. A package for a plugin this build does
 * not contain is *staged* rather than executed.
 */
import {
  computeFileIntegrity,
  computePackageIntegrity,
  isSafePluginPath,
  PLUGIN_PACKAGE_FORMAT_VERSION,
  type PluginPackageFile,
} from './manifest';
import { readZipEntries, readZipTextEntry } from './zip';

/** Descriptor file written into `.mindmesh-plugin.zip` packages. */
export const PLUGIN_PACKAGE_DESCRIPTOR_FILENAME = 'mindmesh-package.json';
/** Bare manifest file, tolerated as a fallback for manifest-only archives. */
export const PLUGIN_PACKAGE_MANIFEST_FILENAME = 'manifest.json';

export interface ParsedPluginPackage {
  /** Untrusted package descriptor (`{ packageFormatVersion, manifest, files, integrity }`). */
  descriptor: unknown;
  sourceName: string;
}

export interface PluginPackageInput {
  bytes?: Uint8Array | ArrayBuffer;
  text?: string;
  fileName?: string;
}

/**
 * Reads an untrusted package descriptor from a ZIP archive.
 *
 * Prefers the packaged `mindmesh-package.json` descriptor (which carries the
 * integrity value). When only a `manifest.json` is present, derives a
 * *self-describing* descriptor from the archive contents so the package can
 * still be validated structurally — such archives are not tamper-evident, so
 * distribution packages should always include the descriptor.
 */
export async function readPluginPackageDescriptor(
  bytes: Uint8Array | ArrayBuffer,
  sourceName = 'package.mindmesh-plugin.zip'
): Promise<ParsedPluginPackage> {
  const entries = await readZipEntries(bytes);

  const descriptorText =
    readZipTextEntry(entries, PLUGIN_PACKAGE_DESCRIPTOR_FILENAME) ??
    readZipTextEntry(entries, 'package.json');
  if (descriptorText) {
    return { descriptor: JSON.parse(descriptorText), sourceName };
  }

  const manifestText = readZipTextEntry(entries, PLUGIN_PACKAGE_MANIFEST_FILENAME);
  if (!manifestText) {
    throw new Error(
      `Plugin package is missing ${PLUGIN_PACKAGE_DESCRIPTOR_FILENAME} and ${PLUGIN_PACKAGE_MANIFEST_FILENAME}.`
    );
  }

  const manifest = JSON.parse(manifestText) as unknown;
  const files: PluginPackageFile[] = entries
    .filter((entry) => isSafePluginPath(entry.path))
    .map((entry) => ({
      path: entry.path,
      size: entry.bytes.byteLength,
      integrity: computeFileIntegrity(new TextDecoder().decode(entry.bytes)),
    }));
  const integrity = computePackageIntegrity(
    manifest as Parameters<typeof computePackageIntegrity>[0],
    files
  );
  return {
    descriptor: { packageFormatVersion: PLUGIN_PACKAGE_FORMAT_VERSION, manifest, files, integrity },
    sourceName,
  };
}

/** Parses any supported plugin-package input into an untrusted descriptor. */
export async function parsePluginPackage(input: PluginPackageInput): Promise<ParsedPluginPackage> {
  if (typeof input.text === 'string') {
    const sourceName = input.fileName ?? 'package.mindmesh-plugin.json';
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.text);
    } catch {
      throw new Error('Plugin package is not valid JSON.');
    }
    return { descriptor: parsed, sourceName };
  }

  if (input.bytes) {
    return readPluginPackageDescriptor(input.bytes, input.fileName ?? 'package.mindmesh-plugin.zip');
  }

  throw new Error('No plugin package content was provided.');
}
