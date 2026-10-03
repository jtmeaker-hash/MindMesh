#!/usr/bin/env node
/**
 * MindMesh plugin packaging + validation.
 *
 * Validates a plugin manifest against the MindMesh Core/Plugin API versions,
 * produces a `.mindmesh-plugin.zip` package plus its integrity/descriptor
 * metadata and a checksums file, and exposes artifact names for CI.
 *
 * Usage:
 *   node scripts/package-plugin.mjs --id money-management --dir web/src/plugins/money-management --out artifacts/plugin
 *   node scripts/package-plugin.mjs --id money-management --dir web/src/plugins/money-management --check
 *
 * NOTE: no third-party dependencies are used so this runs in any CI Node image.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const PACKAGE_FORMAT_VERSION = 1;
const PLUGIN_API_SOURCE = 'web/src/types/plugin.ts';

function parseArgs(argv) {
  const args = { id: null, dir: null, out: null, check: false, coreSource: PLUGIN_API_SOURCE };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--id') args.id = argv[++i];
    else if (token === '--dir') args.dir = argv[++i];
    else if (token === '--out') args.out = argv[++i];
    else if (token === '--check') args.check = true;
    else if (token === '--core-source') args.coreSource = argv[++i];
  }
  return args;
}

function fail(message) {
  console.error(`\u2716 ${message}`);
  process.exit(1);
}

function readCoreVersions(sourcePath) {
  const text = readFileSync(sourcePath, 'utf8');
  const read = (name) => {
    const match = text.match(new RegExp(`${name}\\s*=\\s*'([^']+)'`));
    return match ? match[1] : null;
  };
  const coreVersion = read('MINDMESH_CORE_VERSION');
  const apiVersion = read('PLUGIN_API_VERSION');
  if (!coreVersion || !apiVersion) {
    fail(`Could not read Core/Plugin API versions from ${sourcePath}`);
  }
  return { coreVersion, apiVersion };
}

function parseSemver(value) {
  const match = String(value).trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)/);
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) } : null;
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/** FNV-1a over a string; must match computePackageIntegrity in the web runtime. */
function fnv1a(input) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, '0')}`;
}

function computePackageIntegrity(manifest, files, packageFormatVersion = PACKAGE_FORMAT_VERSION) {
  const canonical = JSON.stringify({
    packageFormatVersion,
    manifest,
    files: [...files].sort((a, b) => a.path.localeCompare(b.path)),
  });
  return fnv1a(canonical);
}

function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  writeFileSync(outputFile, `${key}=${value}\n`, { flag: 'a' });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.id || !args.dir) fail('Both --id and --dir are required');

  const manifestPath = join(args.dir, 'plugin.manifest.json');
  if (!existsSync(manifestPath)) fail(`Missing manifest: ${manifestPath}`);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));

  // --- manifest validation -------------------------------------------------
  if (manifest.id !== args.id) {
    fail(`Manifest id "${manifest.id}" does not match --id "${args.id}"`);
  }
  for (const field of ['name', 'version', 'description', 'minimumCoreVersion', 'apiVersion']) {
    if (!manifest[field]) fail(`Manifest is missing "${field}"`);
  }
  if (typeof manifest.schemaVersion !== 'number') fail('Manifest schemaVersion must be a number');

  const { coreVersion, apiVersion } = readCoreVersions(args.coreSource);

  // --- compatibility validation -------------------------------------------
  const pluginMinCore = parseSemver(manifest.minimumCoreVersion);
  const runtimeCore = parseSemver(coreVersion);
  const pluginApi = parseSemver(manifest.apiVersion);
  const runtimeApi = parseSemver(apiVersion);
  if (!pluginMinCore || !runtimeCore || !pluginApi || !runtimeApi) {
    fail('Could not parse semver from manifest or Core source');
  }
  if (compareSemver(runtimeCore, pluginMinCore) < 0) {
    fail(`Plugin requires Core >= ${manifest.minimumCoreVersion} but this build is ${coreVersion}`);
  }
  if (pluginApi.major !== runtimeApi.major) {
    fail(`Plugin API ${manifest.apiVersion} is incompatible with runtime API ${apiVersion}`);
  }

  console.log(`\u2714 ${manifest.name} manifest valid (plugin v${manifest.version})`);
  console.log(`   Core required: >= ${manifest.minimumCoreVersion} (this build ${coreVersion})`);
  console.log(`   Plugin API: ${manifest.apiVersion} (runtime ${apiVersion})`);

  if (args.check) {
    setOutput('plugin-id', manifest.id);
    setOutput('plugin-version', manifest.version);
    return;
  }

  // --- package + integrity metadata ---------------------------------------
  const outDir = resolve(args.out ?? 'artifacts/plugin');
  const stagingDir = join(outDir, 'staging');
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  const manifestJson = JSON.stringify(manifest, null, 2);
  writeFileSync(join(stagingDir, 'manifest.json'), manifestJson);

  const files = [
    { path: 'manifest.json', size: Buffer.byteLength(manifestJson), integrity: fnv1a(manifestJson) },
  ];
  const integrity = computePackageIntegrity(manifest, files);
  const descriptor = { packageFormatVersion: PACKAGE_FORMAT_VERSION, manifest, files, integrity };
  const descriptorJson = JSON.stringify(descriptor, null, 2);
  writeFileSync(join(outDir, `${manifest.id}.mindmesh-plugin.json`), descriptorJson);
  // Embedded in the archive so the runtime installer can verify integrity. It is
  // metadata, not a declared package file, so it is not part of `files`.
  writeFileSync(join(stagingDir, 'mindmesh-package.json'), descriptorJson);

  const packageFile = `${manifest.id}-v${manifest.version}.mindmesh-plugin.zip`;
  const packagePath = join(outDir, packageFile);
  const packageAbsolute = resolve(packagePath);

  try {
    execFileSync('zip', ['-q', packageAbsolute, 'manifest.json', 'mindmesh-package.json'], { cwd: stagingDir });
  } catch (err) {
    fail(`Failed to create plugin package (is "zip" available?): ${err.message}`);
  }
  rmSync(stagingDir, { recursive: true, force: true });

  const sha256 = createHash('sha256').update(readFileSync(packageAbsolute)).digest('hex');
  writeFileSync(join(outDir, 'checksums.txt'), `${sha256}  ${packageFile}\n`);
  writeFileSync(
    join(outDir, 'integrity.json'),
    JSON.stringify({ pluginId: manifest.id, version: manifest.version, integrity, sha256 }, null, 2)
  );

  const artifactName = `MindMesh-${manifest.name.replace(/\s+/g, '-')}-Plugin-v${manifest.version}`;
  setOutput('plugin-id', manifest.id);
  setOutput('plugin-version', manifest.version);
  setOutput('artifact-name', artifactName);
  setOutput('package-file', packageFile);
  setOutput('package-integrity', integrity);

  console.log(`\u2714 Packaged ${packageFile}`);
  console.log(`   integrity: ${integrity}`);
  console.log(`   sha256:    ${sha256}`);
  console.log(`   artifact:  ${artifactName}`);
}

main();
