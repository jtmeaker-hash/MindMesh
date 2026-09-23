import { Reminder } from '../types';
import { DiagnosticReport, DiagnosticResult, DiagnosticStatus, LogEntry } from '../types/diagnostics';
import { getFixDefinition } from './fixer';

/**
 * Local Smart Assistance diagnostics.
 *
 * This module never runs a repair and never claims one worked. It reads the
 * existing diagnostics report plus a small, explicitly inspectable set of
 * states (active reminders with no trigger, known log patterns) and produces
 * suggestions that point at the existing fixer / guidance. Anything it cannot
 * actually observe is not reported.
 */

export type SmartDiagnosticRoute = 'existing-fix' | 'confirm-fix' | 'guidance';

export interface SmartDiagnosticSuggestion {
  /** Stable id, derived from the source check so repeated runs stay deterministic. */
  id: string;
  /** Diagnostic check the evidence came from, e.g. `notifications.permission`. */
  sourceCheckId: string;
  title: string;
  severity: DiagnosticStatus;
  /** One-line detected issue. */
  issue: string;
  /** Non-sensitive evidence copied from the diagnostic details. */
  evidence: Record<string, unknown>;
  /** Plain-language, safe next step. */
  safeFix: string;
  /** True only when an existing `safe` fixer operation can resolve this. */
  canAutoFix: boolean;
  /** Fixer operation id, when one exists. */
  fixId?: string;
  route: SmartDiagnosticRoute;
  /** True when applying the fix could change stored user data. */
  requiresConfirmation: boolean;
}

export interface DiagnosticsAnalytics {
  suggestions: SmartDiagnosticSuggestion[];
  text: string;
  facts: {
    total: number;
    failures: number;
    warnings: number;
    autoFixable: number;
    requiresConfirmation: number;
    remindersWithoutTrigger: number;
  };
}

export interface DiagnosticsSuggestionOptions {
  /** Stored reminders, used only to detect active reminders with no trigger. */
  reminders?: readonly Reminder[];
  /** Retained diagnostic log entries, scanned for known patterns only. */
  logs?: readonly LogEntry[];
}

const SEVERITY_ORDER: Record<DiagnosticStatus, number> = { fail: 0, warning: 1, unknown: 2, pass: 3 };

/** Diagnostic checks that are informational and must never become "issues". */
const NON_ACTIONABLE_CHECKS = new Set([
  'app.version',
  'app.startup',
  'app.lastStartup',
  'platform.info',
  'pwa.serviceWorker',
  'pwa.installed',
  'network.connectivity',
  'storage.quota',
  'appearance.config',
]);

function isActionableResult(result: DiagnosticResult): boolean {
  if (result.status === 'pass') return false;
  if (NON_ACTIONABLE_CHECKS.has(result.id)) return false;
  // `unknown` results are only surfaced when the app already knows a fix for
  // them; otherwise they are "not applicable", not a problem.
  if (result.status === 'unknown' && !result.fixId) return false;
  // A warning with no fix, no suggested fix and no details is not enough evidence.
  if (result.status === 'warning' && !result.fixId && !result.suggestedFix) return false;
  return true;
}

function toSuggestion(result: DiagnosticResult): SmartDiagnosticSuggestion {
  const fix = result.fixId ? getFixDefinition(result.fixId) : undefined;
  const route: SmartDiagnosticRoute = !result.fixId
    ? 'guidance'
    : fix?.kind === 'confirm'
      ? 'confirm-fix'
      : 'existing-fix';
  return {
    id: `diag-${result.id}`,
    sourceCheckId: result.id,
    title: result.name,
    severity: result.status,
    issue: result.explanation,
    evidence: result.details ? { ...result.details } : {},
    safeFix: result.suggestedFix ?? fix?.description ?? 'Review this check in Diagnostics.',
    canAutoFix: fix?.kind === 'safe',
    fixId: result.fixId,
    route,
    requiresConfirmation:
      (fix?.kind === 'confirm' || Boolean(result.userDataAtRisk)) && Boolean(result.fixId),
  };
}

/**
 * Active reminders that the scheduler can never fire: no due date and no
 * recurrence, so there is no future trigger at all. Derived metadata such as
 * `recurringSeriesId` is not required for a one-off reminder, so it is not used
 * as evidence here.
 */
function detectRemindersWithoutTrigger(reminders: readonly Reminder[]): SmartDiagnosticSuggestion | null {
  const affected = reminders.filter(
    (reminder) =>
      !reminder.completed &&
      !reminder.dueDate &&
      (!reminder.recurrence || reminder.recurrence.frequency === 'none')
  );
  if (affected.length === 0) return null;
  return {
    id: 'diag-reminder-no-trigger',
    sourceCheckId: 'reminders.trigger',
    title: 'Reminders with no future trigger',
    severity: 'warning',
    issue: `${affected.length} active reminder(s) have no due date and no recurrence, so no notification can be scheduled for them.`,
    evidence: { withoutTrigger: affected.length, total: reminders.length },
    safeFix:
      'Open each reminder and set a due date (or a recurrence). Reminder text and your other details are never changed automatically.',
    canAutoFix: false,
    route: 'guidance',
    requiresConfirmation: false,
  };
}

interface LogPatternRule {
  id: string;
  subsystem: RegExp;
  message: RegExp;
  title: string;
  severity: DiagnosticStatus;
  issue: (matches: number) => string;
  safeFix: string;
  fixId?: string;
}

const LOG_PATTERN_RULES: readonly LogPatternRule[] = [
  {
    id: 'diag-log-notification-delivery',
    subsystem: /notification/i,
    message: /\b(?:fail(?:ed|ure)?|could not|couldn't|unable|error)\b/i,
    title: 'Notification delivery problems in the log',
    severity: 'warning',
    issue: (matches) => `${matches} recorded notification log entr${matches === 1 ? 'y' : 'ies'} reported a delivery problem.`,
    safeFix: 'Refresh notification schedules, then send a test notification from Notifications.',
    fixId: 'fix.refreshNotificationSchedules',
  },
  {
    id: 'diag-log-storage-write',
    subsystem: /storage/i,
    message: /\b(?:fail(?:ed|ure)?|could not|couldn't|unable|quota)\b/i,
    title: 'Storage write problems in the log',
    severity: 'warning',
    issue: (matches) => `${matches} recorded storage log entr${matches === 1 ? 'y' : 'ies'} reported a write problem.`,
    safeFix: 'Export a backup, free device storage, then reload MindMesh. Nothing is reset automatically.',
  },
  {
    id: 'diag-log-backup',
    subsystem: /backup|restore/i,
    message: /\b(?:fail(?:ed|ure)?|could not|couldn't|unable|invalid)\b/i,
    title: 'Backup or restore problems in the log',
    severity: 'warning',
    issue: (matches) => `${matches} recorded backup log entr${matches === 1 ? 'y' : 'ies'} reported a problem.`,
    safeFix: 'Create a fresh backup from Settings → Backup & Restore Data and confirm it is readable.',
  },
];

function detectLogPatterns(logs: readonly LogEntry[]): SmartDiagnosticSuggestion[] {
  const errors = logs.filter((entry) => entry.level === 'ERROR' || entry.level === 'CRITICAL' || entry.level === 'WARNING');
  const suggestions: SmartDiagnosticSuggestion[] = [];
  for (const rule of LOG_PATTERN_RULES) {
    const matches = errors.filter((entry) => rule.subsystem.test(entry.subsystem) && rule.message.test(entry.message));
    if (matches.length === 0) continue;
    const fix = rule.fixId ? getFixDefinition(rule.fixId) : undefined;
    suggestions.push({
      id: rule.id,
      sourceCheckId: rule.id,
      title: rule.title,
      severity: rule.severity,
      issue: rule.issue(matches.length),
      evidence: {
        matches: matches.length,
        latestAt: matches[0]?.timestamp,
        subsystems: Array.from(new Set(matches.map((entry) => entry.subsystem))).slice(0, 4),
      },
      safeFix: rule.safeFix,
      canAutoFix: fix?.kind === 'safe',
      fixId: rule.fixId,
      route: rule.fixId ? 'existing-fix' : 'guidance',
      requiresConfirmation: false,
    });
  }
  return suggestions;
}

function sortSuggestions(suggestions: SmartDiagnosticSuggestion[]): SmartDiagnosticSuggestion[] {
  return [...suggestions].sort((a, b) => {
    const severity = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    return severity !== 0 ? severity : a.sourceCheckId.localeCompare(b.sourceCheckId);
  });
}

/**
 * Builds deterministic, evidence-backed suggestions. Every sentence is derived
 * from the diagnostics report or from states this function actually inspected.
 */
export function buildDiagnosticsSuggestions(
  report: DiagnosticReport,
  options: DiagnosticsSuggestionOptions = {}
): SmartDiagnosticSuggestion[] {
  const fromReport = report.results.filter(isActionableResult).map(toSuggestion);
  const seen = new Set(fromReport.map((suggestion) => suggestion.sourceCheckId));

  const extra: SmartDiagnosticSuggestion[] = [];
  const noTrigger = detectRemindersWithoutTrigger(options.reminders ?? []);
  if (noTrigger) extra.push(noTrigger);
  for (const logSuggestion of detectLogPatterns(options.logs ?? [])) {
    // Do not repeat the same finding the report already raised.
    if (seen.has(logSuggestion.sourceCheckId)) continue;
    extra.push(logSuggestion);
  }

  return sortSuggestions([...fromReport, ...extra]);
}

/** Deterministic narrative using only counted facts. */
export function summarizeDiagnosticsSuggestions(suggestions: readonly SmartDiagnosticSuggestion[]): string {
  if (suggestions.length === 0) {
    return 'No notification or configuration problems were detected in the latest diagnostics run.';
  }
  const failures = suggestions.filter((suggestion) => suggestion.severity === 'fail').length;
  const warnings = suggestions.filter((suggestion) => suggestion.severity === 'warning').length;
  const autoFixable = suggestions.filter((suggestion) => suggestion.canAutoFix).length;
  const detail: string[] = [];
  if (failures > 0) detail.push(`${failures} failing`);
  if (warnings > 0) detail.push(`${warnings} warning${warnings === 1 ? '' : 's'}`);
  const lead = `${suggestions.length} diagnostic suggestion${suggestions.length === 1 ? '' : 's'}${
    detail.length ? ` (${detail.join(', ')})` : ''
  }.`;
  const fixLine = autoFixable > 0
    ? ` ${autoFixable} can be repaired with an existing safe fix.`
    : ' None can be repaired without opening the relevant screen.';
  const first = suggestions[0];
  return `${lead}${fixLine} Start with: ${first.title} — ${first.safeFix}`;
}

/** Structured analytics for the facade and settings UI. */
export function analyzeDiagnostics(
  report: DiagnosticReport,
  options: DiagnosticsSuggestionOptions = {}
): DiagnosticsAnalytics {
  const suggestions = buildDiagnosticsSuggestions(report, options);
  const reminders = options.reminders ?? [];
  return {
    suggestions,
    text: summarizeDiagnosticsSuggestions(suggestions),
    facts: {
      total: suggestions.length,
      failures: suggestions.filter((suggestion) => suggestion.severity === 'fail').length,
      warnings: suggestions.filter((suggestion) => suggestion.severity === 'warning').length,
      autoFixable: suggestions.filter((suggestion) => suggestion.canAutoFix).length,
      requiresConfirmation: suggestions.filter((suggestion) => suggestion.requiresConfirmation).length,
      remindersWithoutTrigger: reminders.filter(
        (reminder) =>
          !reminder.completed &&
          !reminder.dueDate &&
          (!reminder.recurrence || reminder.recurrence.frequency === 'none')
      ).length,
    },
  };
}
