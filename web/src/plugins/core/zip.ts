/**
 * Minimal, dependency-free ZIP reader for `.mindmesh-plugin.zip` packages.
 *
 * A downloaded plugin package is untrusted input, so this reader is defensive:
 * it validates signatures, bounds every read against the buffer, ignores
 * directory entries and refuses archives that expand beyond a safe size
 * (zip-bomb guard). Stored (`0`) and deflated (`8`) entries are supported;
 * deflate uses the platform `DecompressionStream('deflate-raw')`.
 *
 * It deliberately only reads *text* content — the plugin runtime never executes
 * downloaded code, it consumes the package descriptor and manifest.
 */

export interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 32 * 1024 * 1024;

function findEndOfCentralDirectory(view: DataView): number {
  const min = Math.max(0, view.byteLength - (22 + 0xffff));
  for (let i = view.byteLength - 22; i >= min; i -= 1) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) return i;
  }
  return -1;
}

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ctor = (globalThis as { DecompressionStream?: typeof DecompressionStream }).DecompressionStream;
  if (!ctor) {
    throw new Error('This runtime cannot decompress deflated plugin packages.');
  }
  const stream = new Blob([new Uint8Array(bytes)]).stream().pipeThrough(new ctor('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

/** Reads every file entry from a ZIP archive in declaration order. */
export async function readZipEntries(input: Uint8Array | ArrayBuffer): Promise<ZipEntry[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  // Copy into a standalone buffer so DataView offsets are stable.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const eocd = findEndOfCentralDirectory(view);
  if (eocd < 0) throw new Error('Not a valid plugin package (missing ZIP end record).');

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  let totalBytes = 0;

  for (let i = 0; i < entryCount; i += 1) {
    if (offset + 46 > view.byteLength) {
      throw new Error('Corrupt plugin package (truncated central directory).');
    }
    if (view.getUint32(offset, true) !== CENTRAL_SIGNATURE) {
      throw new Error('Corrupt plugin package (bad directory entry).');
    }

    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const uncompressedSize = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const nameStart = offset + 46;
    const path = new TextDecoder().decode(bytes.subarray(nameStart, nameStart + nameLength));
    offset = nameStart + nameLength + extraLength + commentLength;

    if (path.endsWith('/')) continue; // directory entry

    if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) {
      throw new Error(`Corrupt plugin package (bad entry header for ${path}).`);
    }
    const localNameLength = view.getUint16(localOffset + 26, true);
    const localExtraLength = view.getUint16(localOffset + 28, true);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    if (dataEnd > bytes.byteLength) {
      throw new Error(`Corrupt plugin package (truncated data for ${path}).`);
    }

    if (uncompressedSize > MAX_ENTRY_BYTES) {
      throw new Error(`Plugin package entry is too large: ${path}`);
    }
    totalBytes += uncompressedSize;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new Error('Plugin package expands to too much data and was rejected.');
    }

    const raw = bytes.subarray(dataStart, dataEnd);
    let content: Uint8Array;
    if (method === 0) content = raw;
    else if (method === 8) content = await inflateRaw(raw);
    else throw new Error(`Unsupported compression in plugin package: ${method}`);

    entries.push({ path, bytes: content });
  }

  return entries;
}

/** Returns the UTF-8 text of the first matching entry, or null. */
export function readZipTextEntry(entries: ZipEntry[], path: string): string | null {
  const entry = entries.find((candidate) => candidate.path === path || candidate.path === `./${path}`);
  return entry ? new TextDecoder().decode(entry.bytes) : null;
}
