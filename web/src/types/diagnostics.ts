/**
 * Types for the on-device diagnostics, logging and fixer systems.
 *
 * Everything here is local-first: logs and reports stay on the device unless the
 * user explicitly exports them.
 */

export type DiagnosticStatus = 'pass' | 'warning' | 'fail' | 'unknown';

export type DiagnosticMode = 'quick' | 'deep';

export type DiagnosticCategory =
  | 'app'
  | 'storage'
  | 'reminders'
  | 'notifications'
  | 'money'
  | 'dashboard'
  | 'backup'
  | 'appearance'
  | 'navigation'
  | 'platform'
  | 'network'
  | 'references'
  | 'routines';

/** How risky a repair is. Nothing except `safe` may ever run automatically. */
export type FixKind = 'none' | 'safe' | 'confirm';

export interface DiagnosticResult {
  /** Stable id, e.g. `notifications.permission`. */
  id: string;
  name: string;
  category: DiagnosticCategory;
  status: DiagnosticStatus;
  /** One-line, human-readable explanation. */
  explanation: string;
  timestamp: string;
  /** Non-sensitive technical context (counts, versions, flags). */
  details?: Record<string, unknown>;
  /** Friendly, actionable guidance. */
  suggestedFix?: string;
  /** Fixer operation that can resolve this, when one exists. */
  fixId?: string;
  /** True when running the fix could alter stored user data. */
  userDataAtRisk?: boolean;
}

export interface DiagnosticSummary {
  overall: DiagnosticStatus;
  passed: number;
  warnings: number;
  failed: number;
  unknown: number;
  total: number;
  runAt: string;
  mode: DiagnosticMode;
}

export interface DiagnosticReport {
  summary: DiagnosticSummary;
  results: DiagnosticResult[];
}

export type LogLevel = 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL';

export const LOG_LEVEL_ORDER: LogLevel[] = ['DEBUG', 'INFO', 'WARNING', 'ERROR', 'CRITICAL'];

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  /** Subsystem topic, e.g. `Storage`, `Notifications`, `Backup`. */
  subsystem: string;
  message: string;
  /** Redacted, low-cardinality technical context only. */
  details?: Record<string, unknown>;
}

export interface LogRetentionSettings {
  /** Hard cap on retained entries. */
  maxEntries: number;
  /** Approximate byte budget for the persisted log payload. */
  maxBytes: number;
  /** Drop entries older than this many days. */
  retentionDays: number;
}

export const DEFAULT_LOG_RETENTION: LogRetentionSettings = {
  maxEntries: 400,
  maxBytes: 256 * 1024,
  retentionDays: 7,
};

export interface DiagnosticsHistoryEntry {
  id: string;
  timestamp: string;
  mode: DiagnosticMode;
  passed: number;
  warnings: number;
  failed: number;
  unknown: number;
  /** Fix ids applied during this run/session. */
  fixesPerformed: string[];
}

export interface StoredErrorRecord {
  message: string;
  name?: string;
  stack?: string;
  at: string;
  subsystem: string;
  level: LogLevel;
  /** Number of times the same error signature has been seen. */
  occurrences?: number;
}

export interface DiagnosticsStoreData {
  version: number;
  logs: LogEntry[];
  history: DiagnosticsHistoryEntry[];
  retention: LogRetentionSettings;
  lastStartupAt?: string;
  lastStartupSummary?: {
    passed: number;
    warnings: number;
    failed: number;
    checkedAt: string;
  };
  lastBackupAt?: string;
  lastRestoreAt?: string;
  lastError?: StoredErrorRecord;
  crashes: StoredErrorRecord[];
}

export const DIAGNOSTICS_STORE_VERSION = 1;
export const DIAGNOSTICS_HISTORY_LIMIT = 25;
export const DIAGNOSTICS_CRASH_LIMIT = 10;

/** User-facing preferences that are part of the normal backup. */
export interface DiagnosticPreferences {
  /** Include diagnostic logs in full backups. Default OFF (privacy-safe). */
  includeDiagnosticLogs: boolean;
  /** Reveal the developer/advanced diagnostics panel. */
  advancedMode: boolean;
  /** Include application data (titles, notes, contacts) in exported reports. */
  includeAppDataInReports: boolean;
}

export const DEFAULT_DIAGNOSTIC_PREFERENCES: DiagnosticPreferences = {
  includeDiagnosticLogs: false,
  advancedMode: false,
  includeAppDataInReports: false,
};

export function normalizeDiagnosticPreferences(input: unknown): DiagnosticPreferences {
  const base = { ...DEFAULT_DIAGNOSTIC_PREFERENCES };
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const raw = input as Record<string, unknown>;
  const bool = (value: unknown, fallback: boolean): boolean =>
    typeof value === 'boolean' ? value : fallback;
  return {
    includeDiagnosticLogs: bool(raw.includeDiagnosticLogs, base.includeDiagnosticLogs),
    advancedMode: bool(raw.advancedMode, base.advancedMode),
    includeAppDataInReports: bool(raw.includeAppDataInReports, base.includeAppDataInReports),
  };
}

export type FixResultStatus = 'fixed' | 'still_failing' | 'manual_action_required';

export interface FixOutcome {
  fixId: string;
  title: string;
  status: FixResultStatus;
  message: string;
  /** Diagnostic ids that should be re-evaluated after the repair. */
  affectedChecks: string[];
  /** Fixes applied as part of this operation (e.g. Fix All). */
  timestamp: string;
}

export interface FixDefinition {
  id: string;
  title: string;
  kind: FixKind;
  /** What the fix intends to change, in plain language. */
  description: string;
  /** Whether stored user data could be affected. */
  affectsUserData: boolean;
  /** Diagnostic ids this repair targets. */
  targetChecks: string[];
}

export function summarizeDiagnostics(results: DiagnosticResult[], mode: DiagnosticMode): DiagnosticSummary {
  const passed = results.filter((r) => r.status === 'pass').length;
  const warnings = results.filter((r) => r.status === 'warning').length;
  const failed = results.filter((r) => r.status === 'fail').length;
  const unknown = results.filter((r) => r.status === 'unknown').length;

  const overall: DiagnosticStatus = failed > 0 ? 'fail' : warnings > 0 ? 'warning' : 'pass';

  return {
    overall,
    passed,
    warnings,
    failed,
    unknown,
    total: results.length,
    runAt: new Date().toISOString(),
    mode,
  };
}

export function statusLabel(status: DiagnosticStatus): string {
  switch (status) {
    case 'pass':
      return 'PASS';
    case 'warning':
      return 'WARNING';
    case 'fail':
      return 'FAIL';
    default:
      return 'UNKNOWN';
  }
}
