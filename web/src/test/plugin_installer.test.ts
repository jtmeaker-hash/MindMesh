import { beforeEach, describe, expect, it } from 'vitest';
import { PluginManager } from '../plugins/core/manager';
import {
  computePackageIntegrity,
  type PluginPackageFile,
} from '../plugins/core/manifest';
import { readZipEntries, readZipTextEntry } from '../plugins/core/zip';
import { createEmptyRegistryState } from '../plugins/core/types';
import type { PluginManifest } from '../types/plugin';
import { registerBuiltinPlugins } from '../plugins/registerBuiltins';
import { MONEY_MANAGEMENT_MANIFEST } from '../plugins/money-management';
import {
  getDefaultState,
  loadInstalledPluginPackages,
  loadRetainedPluginData,
  resetMindMeshEntirely,
  saveAllData,
  saveRetainedPluginData,
} from '../services/storage';
import { createEmptyRetainedPluginData } from '../types/plugin';

function baseManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'demo-plugin',
    name: 'Demo',
    version: '1.0.0',
    description: 'A demo plugin.',
    minimumCoreVersion: '1.0.0',
    apiVersion: '1.0.0',
    schemaVersion: 1,
    permissions: ['storage'],
    ...overrides,
  };
}

function descriptorFor(manifest: PluginManifest, files?: PluginPackageFile[]) {
  const declared = files ?? [{ path: 'manifest.json', size: 2, integrity: 'fnv1a-00000000' }];
  return {
    packageFormatVersion: 1,
    manifest,
    files: declared,
    integrity: computePackageIntegrity(manifest, declared),
  };
}

/** Builds a minimal ZIP. Entries are stored (method 0) unless `deflate` is set. */
async function buildZip(entries: { path: string; text: string }[], deflate = false): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  interface Meta {
    name: Uint8Array;
    method: number;
    compressedLength: number;
    rawLength: number;
    offset: number;
  }
  const metas: Meta[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.path);
    const raw = encoder.encode(entry.text);
    let payload = raw;
    let method = 0;
    if (deflate) {
      const stream = new Blob([raw]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      payload = new Uint8Array(await new Response(stream).arrayBuffer());
      method = 8;
    }

    const local = new Uint8Array(30 + name.length + payload.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(8, method, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, raw.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(payload, 30 + name.length);
    localParts.push(local);
    metas.push({ name, method, compressedLength: payload.length, rawLength: raw.length, offset });
    offset += local.length;
  }

  const centralOffset = offset;
  for (const meta of metas) {
    const central = new Uint8Array(46 + meta.name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, meta.method, true);
    cv.setUint32(20, meta.compressedLength, true);
    cv.setUint32(24, meta.rawLength, true);
    cv.setUint16(28, meta.name.length, true);
    cv.setUint32(42, meta.offset, true);
    central.set(meta.name, 46);
    centralParts.push(central);
  }

  let centralSize = 0;
  for (const part of centralParts) centralSize += part.length;

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, centralOffset, true);

  const total = new Uint8Array(centralOffset + centralSize + 22);
  let cursor = 0;
  for (const part of [...localParts, ...centralParts, eocd]) {
    total.set(part, cursor);
    cursor += part.length;
  }
  return total.buffer as ArrayBuffer;
}

function zipBytesFor(descriptor: unknown, manifest: PluginManifest): Promise<ArrayBuffer> {
  return buildZip([
    { path: 'manifest.json', text: JSON.stringify(manifest) },
    { path: 'mindmesh-package.json', text: JSON.stringify(descriptor) },
  ]);
}

beforeEach(() => {
  localStorage.clear();
  saveAllData(getDefaultState());
});

describe('plugin package ZIP reader', () => {
  it('reads stored entries and rejects non-archives', async () => {
    const zip = await buildZip([{ path: 'manifest.json', text: '{"id":"x"}' }]);
    const entries = await readZipEntries(zip);
    expect(entries.map((entry) => entry.path)).toEqual(['manifest.json']);
    expect(readZipTextEntry(entries, 'manifest.json')).toBe('{"id":"x"}');

    await expect(readZipEntries(new Uint8Array([1, 2, 3, 4]).buffer)).rejects.toThrow();
  });

  it('decompresses deflated entries when the runtime supports it', async () => {
    const blobSupportsStream = typeof Blob !== 'undefined' && typeof new Blob([]).stream === 'function';
    if (!blobSupportsStream || typeof CompressionStream === 'undefined' || typeof DecompressionStream === 'undefined') {
      return;
    }
    const zip = await buildZip([{ path: 'manifest.json', text: '{"id":"deflated"}' }], true);
    const entries = await readZipEntries(zip);
    expect(readZipTextEntry(entries, 'manifest.json')).toBe('{"id":"deflated"}');
  });
});

describe('runtime plugin installer', () => {
  it('installs a package for a plugin present in this build', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();

    const descriptor = descriptorFor(MONEY_MANAGEMENT_MANIFEST);
    const result = await manager.installPackage({
      bytes: await zipBytesFor(descriptor, MONEY_MANAGEMENT_MANIFEST),
      fileName: 'money-management-v1.2.0.mindmesh-plugin.zip',
    });

    expect(result.ok).toBe(true);
    expect(result.pluginId).toBe(MONEY_MANAGEMENT_MANIFEST.id);
    expect(result.status).toBe('installed');
    expect(result.applied).toBe(true);

    const packages = manager.getInstalledPackages();
    expect(packages).toHaveLength(1);
    expect(packages[0].state).toBe('applied');
    expect(packages[0].sourceName).toContain('money-management');
  });

  it('stages a package for a plugin this build does not contain', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();

    const manifest = baseManifest({ id: 'ghost-plugin', name: 'Ghost' });
    const result = await manager.installPackage({ text: JSON.stringify(descriptorFor(manifest)), fileName: 'ghost.json' });

    expect(result.ok).toBe(true);
    expect(result.status).toBe('staged');
    expect(result.applied).toBe(false);
    expect(manager.getInstalledPackages()[0].state).toBe('staged');
    // A staged package never creates a registry entry or enables anything.
    expect(manager.isInstalled('ghost-plugin')).toBe(false);
  });

  it('rejects tampered and incompatible packages without recording them', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();

    const manifest = baseManifest({ id: 'tamper-plugin' });
    const descriptor = descriptorFor(manifest);
    const tampered = {
      ...descriptor,
      files: [{ path: 'manifest.json', size: 999, integrity: 'fnv1a-deadbeef' }],
    };
    const bad = await manager.installPackage({ text: JSON.stringify(tampered) });
    expect(bad.ok).toBe(false);
    expect(bad.errors?.length).toBeGreaterThan(0);

    const incompatible = descriptorFor(baseManifest({ id: 'future-plugin', minimumCoreVersion: '99.0.0' }));
    const future = await manager.installPackage({ text: JSON.stringify(incompatible) });
    expect(future.ok).toBe(false);
    expect(manager.getInstalledPackages()).toHaveLength(0);
  });

  it('accepts a manifest-only archive via the self-describing fallback', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();

    const manifest = baseManifest({ id: 'manifest-only' });
    const zip = await buildZip([{ path: 'manifest.json', text: JSON.stringify(manifest) }]);
    const result = await manager.installPackage({ bytes: zip, fileName: 'manifest-only.zip' });
    expect(result.ok).toBe(true);
    expect(result.status).toBe('staged');
  });

  it('is idempotent when the same package is installed twice', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();

    const descriptor = descriptorFor(MONEY_MANAGEMENT_MANIFEST);
    const first = await manager.installPackage({ text: JSON.stringify(descriptor) });
    const second = await manager.installPackage({ text: JSON.stringify(descriptor) });

    expect(first.status).toBe('installed');
    expect(second.status).toBe('updated');
    expect(manager.getInstalledPackages()).toHaveLength(1);
  });

  it('removes only the package record on uninstall, never plugin data', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();

    const descriptor = descriptorFor(MONEY_MANAGEMENT_MANIFEST);
    await manager.installPackage({ text: JSON.stringify(descriptor) });
    expect(manager.getInstalledPackages()).toHaveLength(1);

    const result = manager.uninstallPackage(MONEY_MANAGEMENT_MANIFEST.id);
    expect(result.ok).toBe(true);
    expect(manager.getInstalledPackages()).toHaveLength(0);
  });

  it('surfaces installation failures for a package that cannot be parsed', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    const result = await manager.installPackage({ bytes: new Uint8Array([0, 1, 2, 3]).buffer });
    expect(result.ok).toBe(false);
    expect(result.errors?.[0]).toBeTruthy();
  });
});

describe('factory reset clears out-of-band plugin stores', () => {
  it('purges retained plugin data and installed package records', async () => {
    const manager = new PluginManager(createEmptyRegistryState());
    registerBuiltinPlugins(manager);
    manager.bootstrapSync();

    // Seed a retained payload for an unavailable plugin...
    const retained = createEmptyRetainedPluginData();
    retained.sections['ghost'] = {
      payloadVersion: 1,
      pluginId: 'ghost',
      name: 'Ghost',
      version: '1.0.0',
      schemaVersion: 1,
      enabled: false,
      data: { items: ['must-not-survive'] },
    };
    saveRetainedPluginData(retained);
    expect(loadRetainedPluginData().sections['ghost']).toBeTruthy();

    // ...and an installed package record.
    await manager.installPackage({ text: JSON.stringify(descriptorFor(MONEY_MANAGEMENT_MANIFEST)) });
    expect(loadInstalledPluginPackages().packages[MONEY_MANAGEMENT_MANIFEST.id]).toBeTruthy();

    resetMindMeshEntirely();

    expect(loadRetainedPluginData().sections).toEqual({});
    expect(loadInstalledPluginPackages().packages).toEqual({});
  });
});
