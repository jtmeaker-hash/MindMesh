import {
  LOG_LEVEL_ORDER,
  LogEntry,
  LogLevel,
  LogRetentionSettings,
  DEFAULT_LOG_RETENTION,
} from '../types/diagnostics';
import {
  loadDiagnosticsStore,
  pruneLogs,
  recordError,
  saveDiagnosticsStore,
  updateLogRetention,
  markDiagnosticsStorageFailure,
} from './diagnosticsStore';

/**
 * Centralized MindMesh logger.
 *
 * - One place writes logs, so UI, diagnostics and crash capture all share history.
 * - Never logs secrets, credentials, photo data or full backup contents.
 * - Retained with an entry cap, a byte budget and an age cutoff.
 * - Re-entrancy guarded: if logging itself fails we fall back to console only and
 *   never enter an infinite logging loop.
 */

const MAX_DETAIL_DEPTH = 3;
const REDACTED = '[redacted]';

/** Keys whose values are never written to the log store. */
const SENSITIVE_KEY_PATTERNS = [
  'password',
  'passphrase',
  'token',
  'secret',
  'apikey',
  'api_key',
  'authorization',
  'auth',
  'cookie',
  'credential',
  'privatekey',
  'photo',
  'image',
  'avatar',
  'signature',
  'backupdata',
  'backup',
  'contents',
  'rawjson',
];

/** Keys holding personal content: kept out of report exports by default. */
export const PERSONAL_CONTENT_KEY_PATTERNS = [
  'title',
  'notes',
  'note',
  'email',
  'phone',
  'address',
  'birthday',
  'fullname',
  'displayname',
  'amount',
  'salary',
  'balance',
];

function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PATTERNS.some((pattern) => lower.includes(pattern));
}

/** Recursively strips sensitive values and caps depth/size of log context. */
export function redactValue(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'function') return '[function]';
  if (depth >= MAX_DETAIL_DEPTH) return '[depth-limit]';

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((item) => redactValue(item, depth + 1));
  }

  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (count >= 40) break;
      count += 1;
      out[key] = isSensitiveKey(key) ? REDACTED : redactValue(val, depth + 1);
    }
    return out;
  }

  return String(value);
}

function describeError(err: unknown): Record<string, unknown> {
  if (!err) return {};
  if (err instanceof Error) {
    return {
      errorName: err.name,
      errorMessage: err.message,
      stack: typeof err.stack === 'string' ? err.stack.slice(0, 2000) : undefined,
    };
  }
  if (typeof err === 'string') return { errorMessage: err.slice(0, 500) };
  return { errorMessage: String(err).slice(0, 500) };
}

let buffer: LogEntry[] = [];
let loaded = false;
let retention: LogRetentionSettings = { ...DEFAULT_LOG_RETENTION };
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let inLoggingCall = false;
let loggingBroken = false;
const listeners = new Set<(logs: LogEntry[]) => void>();

function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const store = loadDiagnosticsStore();
    buffer = store.logs;
    retention = store.retention;
  } catch {
    loggingBroken = true;
    buffer = [];
  }
}

export function isLoggingHealthy(): boolean {
  return !loggingBroken;
}

function notify(): void {
  for (const listener of listeners) {
    try {
      listener(buffer);
    } catch {
      // A failing subscriber must never break logging.
    }
  }
}

function persistNow(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  try {
    const store = loadDiagnosticsStore();
    saveDiagnosticsStore({ ...store, logs: buffer, retention });
  } catch {
    loggingBroken = true;
  }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    persistNow();
  }, 400);
}

/** Flushes pending log writes (also wired to page hide/unload). */
export function flushLogs(): void {
  persistNow();
}

function append(level: LogLevel, subsystem: string, message: string, details?: Record<string, unknown>): void {
  // Console output keeps dev workflows intact.
  const consoleArgs: unknown[] = [`[MindMesh:${subsystem}] ${message}`];
  if (details && Object.keys(details).length > 0) consoleArgs.push(details);

  try {
    if (level === 'CRITICAL' || level === 'ERROR') console.error(...consoleArgs);
    else if (level === 'WARNING') console.warn(...consoleArgs);
    else if (import.meta.env.DEV) {
      if (level === 'INFO') console.info(...consoleArgs);
      else console.log(...consoleArgs);
    }
  } catch {
    // Console may be unavailable; never let that break the app.
  }

  // Re-entrancy guard: if a log call is already in flight we stop here.
  if (inLoggingCall) return;
  inLoggingCall = true;

  try {
    ensureLoaded();

    const entry: LogEntry = {
      id: `log-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      level,
      subsystem: subsystem || 'App',
      message: String(message).slice(0, 1000),
      ...(details && Object.keys(details).length > 0
        ? { details: redactValue(details) as Record<string, unknown> }
        : {}),
    };

    buffer = pruneLogs([entry, ...buffer], retention);

    // Diagnostics data is optional infrastructure: never log about logging.
    if (level === 'ERROR' || level === 'CRITICAL') {
      persistNow();
      // Surface the most recent error to the diagnostics dashboard so failures in
      // storage, migration, notifications, backup and restore are all captured.
      recordError({
        message: entry.message,
        at: entry.timestamp,
        subsystem: entry.subsystem,
        level,
        ...(typeof details?.errorName === 'string' ? { name: details.errorName } : {}),
        ...(typeof details?.stack === 'string' ? { stack: details.stack } : {}),
      });
    } else {
      scheduleFlush();
    }

    notify();
  } catch {
    loggingBroken = true;
  } finally {
    inLoggingCall = false;
  }
}

export const logging = {
  debug(subsystem: string, message: string, details?: Record<string, unknown>): void {
    append('DEBUG', subsystem, message, details);
  },
  info(subsystem: string, message: string, details?: Record<string, unknown>): void {
    append('INFO', subsystem, message, details);
  },
  warn(subsystem: string, message: string, details?: Record<string, unknown>): void {
    append('WARNING', subsystem, message, details);
  },
  error(subsystem: string, message: string, err?: unknown, details?: Record<string, unknown>): void {
    append('ERROR', subsystem, message, { ...describeError(err), ...(details || {}) });
  },
  critical(subsystem: string, message: string, err?: unknown, details?: Record<string, unknown>): void {
    append('CRITICAL', subsystem, message, { ...describeError(err), ...(details || {}) });
  },
};

export function getLogs(): LogEntry[] {
  ensureLoaded();
  return buffer;
}

export function subscribeLogs(listener: (logs: LogEntry[]) => void): () => void {
  ensureLoaded();
  listeners.add(listener);
  listener(buffer);
  return () => {
    listeners.delete(listener);
  };
}

export function clearLogs(): void {
  buffer = [];
  notify();
  persistNow();
  logging.info('Diagnostics', 'Diagnostic log cleared by user');
}

export function getLogRetention(): LogRetentionSettings {
  ensureLoaded();
  return retention;
}

export function setLogRetention(partial: Partial<LogRetentionSettings>): LogRetentionSettings {
  ensureLoaded();
  retention = updateLogRetention(partial);
  buffer = pruneLogs(buffer, retention);
  notify();
  return retention;
}

export function levelRank(level: LogLevel): number {
  return LOG_LEVEL_ORDER.indexOf(level);
}

export interface LogQuery {
  levels?: LogLevel[];
  subsystem?: string | 'all';
  search?: string;
}

export function filterLogs(logs: LogEntry[], query: LogQuery): LogEntry[] {
  const activeLevels = query.levels && query.levels.length > 0 ? new Set(query.levels) : null;
  const subsystem = query.subsystem && query.subsystem !== 'all' ? query.subsystem : null;
  const search = query.search?.trim().toLowerCase() || null;

  return logs.filter((entry) => {
    if (activeLevels && !activeLevels.has(entry.level)) return false;
    if (subsystem && entry.subsystem !== subsystem) return false;
    if (search) {
      const haystack = `${entry.message} ${entry.subsystem} ${JSON.stringify(entry.details || {})}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });
}

export function getSubsystems(logs: LogEntry[]): string[] {
  return Array.from(new Set(logs.map((entry) => entry.subsystem))).sort();
}

/** Plain-text form for copy/export actions. */
export function formatLogEntry(entry: LogEntry): string {
  const details =
    entry.details && Object.keys(entry.details).length > 0 ? ` ${JSON.stringify(entry.details)}` : '';
  return `[${entry.timestamp}] [${entry.level}] [${entry.subsystem}] ${entry.message}${details}`;
}

export function exportLogsAsText(logs: LogEntry[]): string {
  return logs.map(formatLogEntry).join('\n');
}

export function exportLogsAsJson(logs: LogEntry[]): string {
  return JSON.stringify(
    {
      app: 'MindMesh',
      exportedAt: new Date().toISOString(),
      entryCount: logs.length,
      retention,
      logs,
    },
    null,
    2
  );
}

// Flush buffered logs when the app is backgrounded or closed so nothing is lost.
if (typeof window !== 'undefined') {
  const flush = () => flushLogs();
  window.addEventListener('pagehide', flush);
  window.addEventListener('beforeunload', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });
}

export { markDiagnosticsStorageFailure };
