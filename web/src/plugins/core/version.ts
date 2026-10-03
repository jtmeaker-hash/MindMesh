/**
 * Minimal semantic-version helpers used for Core/Plugin compatibility checks.
 * Deliberately dependency-free: MindMesh ships no runtime version library.
 */

export interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string;
}

/** Parses `1.2.3`, `1.2.3-beta.1` and the common `v`-prefixed form. */
export function parseVersion(input: string): ParsedVersion | null {
  if (typeof input !== 'string') return null;
  const match = input.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? '',
  };
}

/** Returns -1 / 0 / 1, or null when either version is unparseable. */
export function compareVersions(a: string, b: string): number | null {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return null;
  if (left.major !== right.major) return left.major < right.major ? -1 : 1;
  if (left.minor !== right.minor) return left.minor < right.minor ? -1 : 1;
  if (left.patch !== right.patch) return left.patch < right.patch ? -1 : 1;
  if (left.prerelease === right.prerelease) return 0;
  // A prerelease sorts before the corresponding release.
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease < right.prerelease ? -1 : 1;
}

/** True when `version` is at least `minimum`. Unparseable input is rejected. */
export function satisfiesMinimum(version: string, minimum: string): boolean {
  const result = compareVersions(version, minimum);
  return result !== null && result >= 0;
}

/** True when the major version matches (used for Plugin API compatibility). */
export function sameMajorVersion(a: string, b: string): boolean {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) return false;
  return left.major === right.major;
}
