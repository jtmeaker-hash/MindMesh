import {
  DIAGNOSTICS_CRASH_LIMIT,
  DIAGNOSTICS_HISTORY_LIMIT,
  DIAGNOSTICS_STORE_VERSION,
  DEFAULT_LOG_RETENTION,
  DiagnosticsHistoryEntry,
  DiagnosticsStoreData,
  LogEntry,
  LogRetentionSettings,
  StoredErrorRecord,
} from '../types/diagnostics';

/**
 * Local-only persistence for diagnostics metadata (logs, run history, crash records).
 *
 * Uses its own storage key rather than the main MindMesh state so that diagnostic
 * data never bloats a user backup and a corrupted log store can never take the
 * reminder database down with it.
 */
export const DIAGNOSTICS_STORAGE_KEY = 'mindmesh_diagnostics_v1';

/**
 * Session flag set by the crash screen so the next launch opens Diagnostics
 * directly, without the user having to find it in the options menu.
 */
export const OPEN_DIAGNOSTICS_FLAG = 'mindmesh_open_diagnostics';

/** Set when the storage layer itself fails, so callers can surface it honestly. */
let storageWriteFailed = false;

export function hasDiagnosticsStorageFailed(): boolean {
  return storageWriteFailed;
}

export function markDiagnosticsStorageFailure(failed: boolean): void {
  storageWriteFailed = failed;
}

export function getEmptyDiagnosticsStore(): DiagnosticsStoreData {
  return {
    version: DIAGNOSTICS_STORE_VERSION,
    logs: [],
    history: [],
    retention: { ...DEFAULT_LOG_RETENTION },
    crashes: [],
  };
}

function safeParse(raw: string | null): Partial<DiagnosticsStoreData> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Partial<DiagnosticsStoreData>;
  } catch {
    return null;
  }
}

function normalizeRetention(input: unknown): LogRetentionSettings {
  const base = { ...DEFAULT_LOG_RETENTION };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const raw = input as Record<string, unknown>;
  const num = (value: unknown, fallback: number, min: number, max: number): number => {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  };
  return {
    maxEntries: num(raw.maxEntries, base.maxEntries, 50, 5000),
    maxBytes: num(raw.maxBytes, base.maxBytes, 16 * 1024, 5 * 1024 * 1024),
    retentionDays: num(raw.retentionDays, base.retentionDays, 1, 90),
  };
}

function normalizeLogEntry(input: unknown): LogEntry | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.message !== 'string') return null;
  if (typeof raw.timestamp !== 'string' || Number.isNaN(Date.parse(raw.timestamp))) return null;
  const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
  const level = levels.includes(raw.level as string) ? (raw.level as LogEntry['level']) : 'INFO';
  return {
    id: raw.id,
    timestamp: raw.timestamp,
    level,
    subsystem: typeof raw.subsystem === 'string' && raw.subsystem ? raw.subsystem : 'App',
    message: raw.message,
    ...(raw.details && typeof raw.details === 'object' && !Array.isArray(raw.details)
      ? { details: raw.details as Record<string, unknown> }
      : {}),
  };
}

function normalizeHistoryEntry(input: unknown): DiagnosticsHistoryEntry | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.timestamp !== 'string') return null;
  if (Number.isNaN(Date.parse(raw.timestamp))) return null;
  const n = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  return {
    id: raw.id,
    timestamp: raw.timestamp,
    mode: raw.mode === 'deep' ? 'deep' : 'quick',
    passed: n(raw.passed),
    warnings: n(raw.warnings),
    failed: n(raw.failed),
    unknown: n(raw.unknown),
    fixesPerformed: Array.isArray(raw.fixesPerformed)
      ? raw.fixesPerformed.filter((f): f is string => typeof f === 'string')
      : [],
  };
}

function normalizeErrorRecord(input: unknown): StoredErrorRecord | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.message !== 'string') return null;
  const levels = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];
  return {
    message: raw.message.slice(0, 500),
    at: typeof raw.at === 'string' && !Number.isNaN(Date.parse(raw.at)) ? raw.at : new Date().toISOString(),
    subsystem: typeof raw.subsystem === 'string' && raw.subsystem ? raw.subsystem : 'App',
    level: levels.includes(raw.level as string) ? (raw.level as StoredErrorRecord['level']) : 'ERROR',
    ...(typeof raw.name === 'string' ? { name: raw.name } : {}),
    ...(typeof raw.stack === 'string' ? { stack: raw.stack.slice(0, 4000) } : {}),
    ...(typeof raw.occurrences === 'number' && Number.isFinite(raw.occurrences)
      ? { occurrences: Math.max(1, Math.round(raw.occurrences)) }
      : {}),
  };
}

/** Loads the diagnostics store, recovering safely from missing or corrupted data. */
export function loadDiagnosticsStore(): DiagnosticsStoreData {
  const empty = getEmptyDiagnosticsStore();
  let raw: string | null;
  try {
    raw = localStorage.getItem(DIAGNOSTICS_STORAGE_KEY);
  } catch {
    markDiagnosticsStorageFailure(true);
    return empty;
  }

  if (!raw) return empty;

  const parsed = safeParse(raw);
  if (!parsed) {
    // Corrupted payload: start clean rather than propagating garbage.
    try {
      localStorage.removeItem(DIAGNOSTICS_STORAGE_KEY);
    } catch {
      markDiagnosticsStorageFailure(true);
    }
    return empty;
  }

  const retention = normalizeRetention(parsed.retention);
  const logs = Array.isArray(parsed.logs)
    ? (parsed.logs.map(normalizeLogEntry).filter(Boolean) as LogEntry[]).slice(0, retention.maxEntries)
    : [];
  const history = Array.isArray(parsed.history)
    ? (parsed.history.map(normalizeHistoryEntry).filter(Boolean) as DiagnosticsHistoryEntry[]).slice(
        0,
        DIAGNOSTICS_HISTORY_LIMIT
      )
    : [];
  const crashes = Array.isArray(parsed.crashes)
    ? (parsed.crashes.map(normalizeErrorRecord).filter(Boolean) as StoredErrorRecord[]).slice(
        0,
        DIAGNOSTICS_CRASH_LIMIT
      )
    : [];

  const lastError = normalizeErrorRecord(parsed.lastError);

  return {
    version: DIAGNOSTICS_STORE_VERSION,
    logs,
    history,
    retention,
    ...(typeof parsed.lastStartupAt === 'string' ? { lastStartupAt: parsed.lastStartupAt } : {}),
    ...(parsed.lastStartupSummary && typeof parsed.lastStartupSummary === 'object'
      ? {
          lastStartupSummary: {
            passed: Number(parsed.lastStartupSummary.passed) || 0,
            warnings: Number(parsed.lastStartupSummary.warnings) || 0,
            failed: Number(parsed.lastStartupSummary.failed) || 0,
            checkedAt:
              typeof parsed.lastStartupSummary.checkedAt === 'string'
                ? parsed.lastStartupSummary.checkedAt
                : new Date().toISOString(),
          },
        }
      : {}),
    ...(typeof parsed.lastBackupAt === 'string' ? { lastBackupAt: parsed.lastBackupAt } : {}),
    ...(typeof parsed.lastRestoreAt === 'string' ? { lastRestoreAt: parsed.lastRestoreAt } : {}),
    ...(lastError ? { lastError } : {}),
    crashes,
  };
}

/** Persists the diagnostics store. Never throws — failures are flagged instead. */
export function saveDiagnosticsStore(data: DiagnosticsStoreData): boolean {
  try {
    localStorage.setItem(DIAGNOSTICS_STORAGE_KEY, JSON.stringify(data));
    markDiagnosticsStorageFailure(false);
    return true;
  } catch {
    // Quota exhausted or storage disabled: keep working in memory.
    markDiagnosticsStorageFailure(true);
    return false;
  }
}

/** Records the timestamp of the most recent successful startup. */
export function recordStartup(
  summary: { passed: number; warnings: number; failed: number } | undefined
): void {
  const store = loadDiagnosticsStore();
  const checkedAt = new Date().toISOString();
  saveDiagnosticsStore({
    ...store,
    lastStartupAt: checkedAt,
    ...(summary ? { lastStartupSummary: { ...summary, checkedAt } } : {}),
  });
}

export function recordBackup(): void {
  const store = loadDiagnosticsStore();
  saveDiagnosticsStore({ ...store, lastBackupAt: new Date().toISOString() });
}

export function recordRestore(): void {
  const store = loadDiagnosticsStore();
  saveDiagnosticsStore({ ...store, lastRestoreAt: new Date().toISOString() });
}

export function appendDiagnosticsHistory(entry: DiagnosticsHistoryEntry): void {
  const store = loadDiagnosticsStore();
  const history = [entry, ...store.history].slice(0, DIAGNOSTICS_HISTORY_LIMIT);
  saveDiagnosticsStore({ ...store, history });
}

/** Persists the most recent error so the diagnostics dashboard can surface it. */
export function recordError(record: StoredErrorRecord, isCrash = false): void {
  const store = loadDiagnosticsStore();
  const crashes = isCrash
    ? [record, ...store.crashes].slice(0, DIAGNOSTICS_CRASH_LIMIT)
    : store.crashes;
  saveDiagnosticsStore({ ...store, lastError: record, crashes });
}

export function clearDiagnosticsHistory(): void {
  const store = loadDiagnosticsStore();
  saveDiagnosticsStore({ ...store, history: [], crashes: [] });
}

export function updateLogRetention(retention: Partial<LogRetentionSettings>): LogRetentionSettings {
  const store = loadDiagnosticsStore();
  const next = normalizeRetention({ ...store.retention, ...retention });
  saveDiagnosticsStore({ ...store, retention: next, logs: pruneLogs(store.logs, next) });
  return next;
}

/**
 * Applies the retention policy: age cutoff, entry cap, then a byte-budget trim.
 * Safe for low-storage devices because it never grows the payload.
 */
export function pruneLogs(logs: LogEntry[], retention: LogRetentionSettings, now = Date.now()): LogEntry[] {
  const cutoff = now - retention.retentionDays * 24 * 60 * 60 * 1000;
  let kept = logs.filter((entry) => {
    const t = Date.parse(entry.timestamp);
    return Number.isNaN(t) ? false : t >= cutoff;
  });

  kept = kept.slice(0, retention.maxEntries);

  // Byte budget: drop oldest entries until under the cap.
  let bytes = 0;
  const sized: { entry: LogEntry; size: number }[] = kept.map((entry) => {
    let size: number;
    try {
      size = JSON.stringify(entry).length;
    } catch {
      size = entry.message.length + 64;
    }
    return { entry, size };
  });
  for (const item of sized) bytes += item.size;

  while (bytes > retention.maxBytes && sized.length > 1) {
    const removed = sized.pop();
    if (!removed) break;
    bytes -= removed.size;
  }

  return sized.map((item) => item.entry);
}
