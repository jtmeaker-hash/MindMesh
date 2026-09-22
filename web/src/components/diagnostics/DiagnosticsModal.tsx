import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  Bell,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Database,
  Download,
  HardDrive,
  HelpCircle,
  Loader2,
  Play,
  Save,
  ShieldCheck,
  Terminal,
  Trash2,
  Wand2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import {
  DiagnosticCategory,
  DiagnosticPreferences,
  DiagnosticReport,
  DiagnosticResult,
  DiagnosticStatus,
  LogEntry,
  statusLabel,
} from '../../types/diagnostics';
import {
  BUILD_VERSION,
  buildDiagnosticsReportJson,
  buildDiagnosticsReportText,
  runDiagnostics,
} from '../../services/diagnostics';
import { APP_VERSION, BACKUP_FORMAT_VERSION } from '../../services/backup';
import { CURRENT_STORAGE_VERSION, loadDiagnosticPreferences, saveDiagnosticPreferences } from '../../services/storage';
import {
  appendDiagnosticsHistory,
  clearDiagnosticsHistory,
  loadDiagnosticsStore,
} from '../../services/diagnosticsStore';
import { getLogs } from '../../services/logging';
import { getFixesForCheck, runFix } from '../../services/fixer';
import { FixOutcome } from '../../types/diagnostics';
import { getNotificationEngineState, getNotificationEnvironment } from '../../services/notifications';
import { diagnoseRoutines, routineTrashRetentionDays, setRoutineTrashRetentionDays, purgeExpiredRoutineTrash, restoreRoutineVersion } from '../../services/routineSafety';
import { loadRoutines, saveRoutines } from '../../services/storage';
import { DIAGNOSTICS_STORAGE_KEY } from '../../services/diagnosticsStore';
import { LogViewer } from './LogViewer';
import { FixerPanel } from './FixerPanel';

type DiagnosticsTab = 'health' | 'routines' | 'notifications' | 'storage' | 'backups' | 'logs' | 'fixer' | 'advanced';

interface DiagnosticsModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Lets the user jump to the backup tools from the Backups tab. */
  onOpenBackup?: () => void;
  /** Message from the startup self-check, shown when opened from its banner. */
  startupNotice?: string;
}

/** Storage keys used by MindMesh, surfaced only in advanced diagnostics. */
const STORAGE_KEYS = {
  state: 'mindmesh_state_v2',
  diagnostics: DIAGNOSTICS_STORAGE_KEY,
  legacyCategories: 'mindmesh_categories_v1',
  legacyReminders: 'mindmesh_reminders_v1',
  legacyPositions: 'mindmesh_positions_v1',
};

function readStoredSchemaVersion(): number | 'unknown' {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.state);
    if (!raw) return 'unknown';
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return typeof parsed.version === 'number' ? parsed.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const TABS: { id: DiagnosticsTab; label: string; icon: React.ReactNode }[] = [
  { id: 'health', label: 'Health', icon: <Activity size={14} /> },
  { id: 'routines', label: 'Routine Diagnostics', icon: <Wrench size={14} /> },
  { id: 'notifications', label: 'Notifications', icon: <Bell size={14} /> },
  { id: 'storage', label: 'Storage', icon: <HardDrive size={14} /> },
  { id: 'backups', label: 'Backups', icon: <Save size={14} /> },
  { id: 'logs', label: 'Logs', icon: <Terminal size={14} /> },
  { id: 'fixer', label: 'Fixer', icon: <Wrench size={14} /> },
  { id: 'advanced', label: 'Advanced', icon: <ShieldCheck size={14} /> },
];

const STATUS_META: Record<DiagnosticStatus, { color: string; icon: React.ReactNode }> = {
  pass: { color: '#34d399', icon: <CheckCircle2 size={13} /> },
  warning: { color: '#f59e0b', icon: <AlertTriangle size={13} /> },
  fail: { color: '#ef4444', icon: <XCircle size={13} /> },
  unknown: { color: '#94a3b8', icon: <HelpCircle size={13} /> },
};

const cardStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  backgroundColor: 'rgba(15, 23, 42, 0.7)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
};

const secondaryButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '7px 12px',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.25)',
  backgroundColor: 'rgba(148, 163, 184, 0.08)',
  color: '#cbd5e1',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const primaryButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '9px 14px',
  borderRadius: 10,
  border: 'none',
  backgroundColor: '#6366f1',
  color: '#ffffff',
  fontSize: 12,
  fontWeight: 700,
  cursor: 'pointer',
};

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
    return true;
  } catch {
    return false;
  }
}

function downloadText(content: string, filename: string, type: string): void {
  try {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  } catch {
    // Best-effort: copy buttons remain as the fallback.
  }
}

const TAB_CATEGORIES: Record<DiagnosticsTab, DiagnosticCategory[] | null> = {
  health: null, // everything not claimed by a more specific tab
  routines: ['routines'],
  notifications: ['notifications'],
  storage: ['storage'],
  backups: ['backup'],
  logs: null,
  fixer: null,
  advanced: null,
};

const CLAIMED_CATEGORIES: DiagnosticCategory[] = ['notifications', 'storage', 'backup', 'routines'];

interface ResultCardProps {
  result: DiagnosticResult;
  onRepairsApplied: (outcomes: FixOutcome[]) => void;
}

const ResultCard: React.FC<ResultCardProps> = ({ result, onRepairsApplied }) => {
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<FixOutcome | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState(false);

  const fixes = useMemo(() => getFixesForCheck(result.id), [result.id]);
  const meta = STATUS_META[result.status];

  const runSafeFix = async (fixId: string, confirmed: boolean) => {
    setBusy(true);
    setPendingConfirm(false);
    try {
      const result2 = await runFix(fixId, { confirmed });
      setOutcome(result2);
      onRepairsApplied([result2]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 12,
        backgroundColor: 'rgba(15, 23, 42, 0.7)',
        border: `1px solid ${meta.color}33`,
      }}
      data-diagnostic-id={result.id}
      data-diagnostic-status={result.status}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, minWidth: 0 }}>
          <span style={{ color: meta.color, marginTop: 1 }}>{meta.icon}</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>{result.name}</div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 2, lineHeight: 1.5 }}>{result.explanation}</div>
          </div>
        </div>
        <span
          style={{
            flexShrink: 0,
            fontSize: 10,
            fontWeight: 800,
            color: meta.color,
            border: `1px solid ${meta.color}55`,
            backgroundColor: `${meta.color}18`,
            padding: '2px 7px',
            borderRadius: 999,
          }}
        >
          {statusLabel(result.status)}
        </span>
      </div>

      {result.suggestedFix && (
        <div
          style={{
            marginTop: 8,
            padding: '8px 10px',
            borderRadius: 10,
            backgroundColor: 'rgba(56, 189, 248, 0.08)',
            border: '1px solid rgba(56, 189, 248, 0.2)',
            fontSize: 11.5,
            color: '#bae6fd',
          }}
        >
          <strong>Suggested fix: </strong>
          {result.suggestedFix}
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
        <button type="button" style={secondaryButton} onClick={() => setExpanded((prev) => !prev)}>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Technical details
        </button>

        {fixes.length > 0 && (
          <button
            type="button"
            style={{ ...secondaryButton, color: '#c7d2fe', borderColor: 'rgba(99, 102, 241, 0.4)' }}
            disabled={busy}
            onClick={() => {
              const safeFix = fixes.find((fix) => fix.kind === 'safe');
              if (safeFix) {
                void runSafeFix(safeFix.id, true);
              } else {
                setPendingConfirm(true);
              }
            }}
          >
            {busy ? <Loader2 size={12} /> : <Wand2 size={12} />} {busy ? 'Repairing…' : 'Fix Issue'}
          </button>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 11, color: '#64748b', marginBottom: 4 }}>
            Timestamp: {new Date(result.timestamp).toLocaleString()} · ID: {result.id}
          </div>
          {result.details && Object.keys(result.details).length > 0 && (
            <pre
              style={{
                margin: 0,
                padding: 8,
                borderRadius: 8,
                backgroundColor: '#0b1220',
                color: '#cbd5e1',
                fontSize: 11,
                overflowX: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
              }}
            >
              {JSON.stringify(result.details, null, 2)}
            </pre>
          )}
        </div>
      )}

      {pendingConfirm && (
        <div
          style={{
            marginTop: 10,
            padding: 10,
            borderRadius: 10,
            backgroundColor: 'rgba(245, 158, 11, 0.08)',
            border: '1px solid rgba(245, 158, 11, 0.3)',
            fontSize: 11.5,
            color: '#fcd34d',
          }}
        >
          <div style={{ marginBottom: 6 }}>
            This repair can change stored records. {fixes[0]?.description}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={secondaryButton} onClick={() => setPendingConfirm(false)}>
              Cancel
            </button>
            <button
              type="button"
              style={{
                padding: '7px 12px',
                borderRadius: 10,
                border: 'none',
                backgroundColor: '#f59e0b',
                color: '#1f2937',
                fontSize: 12,
                fontWeight: 800,
                cursor: 'pointer',
              }}
              onClick={() => {
                const confirmFix = fixes.find((fix) => fix.kind === 'confirm') ?? fixes[0];
                if (confirmFix) void runSafeFix(confirmFix.id, true);
              }}
            >
              Confirm & run
            </button>
          </div>
        </div>
      )}

      {outcome && (
        <div
          style={{
            marginTop: 8,
            fontSize: 11.5,
            color:
              outcome.status === 'fixed' ? '#34d399' : outcome.status === 'still_failing' ? '#f59e0b' : '#38bdf8',
          }}
        >
          <strong>
            {outcome.status === 'fixed'
              ? 'FIXED'
              : outcome.status === 'still_failing'
                ? 'STILL FAILING'
                : 'MANUAL ACTION REQUIRED'}
          </strong>{' '}
          — {outcome.message}
        </div>
      )}
    </div>
  );
};

export const DiagnosticsModal: React.FC<DiagnosticsModalProps> = ({
  isOpen,
  onClose,
  onOpenBackup,
  startupNotice,
}) => {
  const [tab, setTab] = useState<DiagnosticsTab>('health');
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [running, setRunning] = useState(false);
  const [startupWarning, setStartupWarning] = useState<string | null>(null);
  const [preferences, setPreferences] = useState<DiagnosticPreferences>(() => loadDiagnosticPreferences());
  const [copied, setCopied] = useState(false);
  const [includeAppData, setIncludeAppData] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>(() => getLogs());
  const [routineSafety, setRoutineSafety] = useState(() => diagnoseRoutines());
  const [trashRetention, setTrashRetention] = useState(() => routineTrashRetentionDays());

  const run = useCallback(async (mode: 'quick' | 'deep') => {
    setRunning(true);
    try {
      const next = await runDiagnostics(mode);
      setReport(next);
      setRoutineSafety(diagnoseRoutines());
      setTrashRetention(routineTrashRetentionDays());
      setLogs(getLogs());
      appendDiagnosticsHistory({
        id: `diag-${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
        mode,
        passed: next.summary.passed,
        warnings: next.summary.warnings,
        failed: next.summary.failed,
        unknown: next.summary.unknown,
        fixesPerformed: [],
      });
    } finally {
      setRunning(false);
    }
  }, []);

  // Run a quick pass whenever the panel is opened.
  useEffect(() => {
    if (!isOpen) return;
    void run('quick');
    setStartupWarning(startupNotice ?? null);
  }, [isOpen, run, startupNotice]);

  const handleRepairsApplied = useCallback(
    (outcomes: FixOutcome[]) => {
      setLogs(getLogs());
      const fixes = outcomes.map((outcome) => `${outcome.fixId}:${outcome.status}`);
      if (fixes.length === 0) return;
      appendDiagnosticsHistory({
        id: `fix-${Date.now().toString(36)}`,
        timestamp: new Date().toISOString(),
        mode: report?.summary.mode ?? 'quick',
        passed: report?.summary.passed ?? 0,
        warnings: report?.summary.warnings ?? 0,
        failed: report?.summary.failed ?? 0,
        unknown: report?.summary.unknown ?? 0,
        fixesPerformed: fixes,
      });
    },
    [report]
  );

  const updatePreferences = (patch: Partial<DiagnosticPreferences>) => {
    const next = { ...preferences, ...patch };
    setPreferences(next);
    saveDiagnosticPreferences(next);
  };

  const buildReport = (format: 'text' | 'json'): string | null => {
    if (!report) return null;
    const options = { includeAppData, logs };
    return format === 'text' ? buildDiagnosticsReportText(report, options) : buildDiagnosticsReportJson(report, options);
  };

  const handleCopyReport = async () => {
    const text = buildReport('text');
    if (!text) return;
    const ok = await copyToClipboard(text);
    setCopied(ok);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleExportReport = (format: 'text' | 'json') => {
    const content = buildReport(format);
    if (!content) return;
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadText(
      content,
      format === 'text' ? `MindMesh-Diagnostics-${stamp}.txt` : `MindMesh-Diagnostics-${stamp}.json`,
      format === 'text' ? 'text/plain' : 'application/json'
    );
  };

  const visibleResults = useMemo(() => {
    if (!report) return [];
    const categories = TAB_CATEGORIES[tab];
    if (!categories) {
      if (tab === 'health') {
        return report.results.filter((result) => !CLAIMED_CATEGORIES.includes(result.category));
      }
      return report.results;
    }
    return report.results.filter((result) => categories.includes(result.category));
  }, [report, tab]);

  if (!isOpen) return null;

  const summary = report?.summary;
  const diagnosticStore = loadDiagnosticsStore();
  const engine = getNotificationEngineState();
  const environment = getNotificationEnvironment();

  const refreshRoutineSafety = () => {
    setRoutineSafety(diagnoseRoutines());
    setReport(null);
    void run('deep');
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1200,
        backgroundColor: 'rgba(2, 6, 23, 0.8)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'center',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="MindMesh Diagnostics"
        style={{
          width: '100%',
          maxWidth: 720,
          maxHeight: '92vh',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: '#0F172A',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          border: '1px solid rgba(148, 163, 184, 0.18)',
          boxShadow: '0 -12px 44px rgba(0, 0, 0, 0.7)',
        }}
      >
        {/* Header */}
        <div style={{ padding: '16px 18px 10px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 11,
                  backgroundColor: 'rgba(99, 102, 241, 0.15)',
                  color: '#818cf8',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Activity size={18} />
              </div>
              <div>
                <h2 style={{ fontSize: 17, fontWeight: 800, color: '#f8fafc', margin: 0 }}>Diagnostics</h2>
                <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0 0' }}>
                  Everything here stays on this device unless you export it.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close diagnostics"
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                border: '1px solid rgba(148, 163, 184, 0.2)',
                backgroundColor: 'rgba(148, 163, 184, 0.08)',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={16} />
            </button>
          </div>

          {/* Overall health summary */}
          <div
            style={{
              ...cardStyle,
              marginTop: 14,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>MINDMESH HEALTH</div>
              {summary ? (
                <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap', fontSize: 13 }}>
                  <span style={{ color: '#34d399', fontWeight: 700 }}>{summary.passed} Passed</span>
                  <span style={{ color: '#f59e0b', fontWeight: 700 }}>{summary.warnings} Warnings</span>
                  <span style={{ color: '#ef4444', fontWeight: 700 }}>{summary.failed} Failed</span>
                  {summary.unknown > 0 && (
                    <span style={{ color: '#94a3b8', fontWeight: 700 }}>{summary.unknown} Unknown</span>
                  )}
                </div>
              ) : (
                <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>Not run yet.</div>
              )}
              <div style={{ fontSize: 10.5, color: '#64748b', marginTop: 6 }}>
                Last diagnostic run:{' '}
                {summary ? new Date(summary.runAt).toLocaleString() : 'never'}
                {diagnosticStore.lastStartupAt
                  ? ` · Last startup: ${new Date(diagnosticStore.lastStartupAt).toLocaleString()}`
                  : ''}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                style={{ ...primaryButton, opacity: running ? 0.7 : 1 }}
                disabled={running}
                onClick={() => void run('quick')}
              >
                {running ? <Loader2 size={13} /> : <Play size={13} />} {running ? 'Running…' : 'Run Diagnostics'}
              </button>
              <button
                type="button"
                style={secondaryButton}
                disabled={running}
                onClick={() => void run('deep')}
              >
                <ShieldCheck size={13} /> Run Deep Diagnostics
              </button>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: 'flex',
            gap: 4,
            padding: '0 14px',
            overflowX: 'auto',
            borderBottom: '1px solid rgba(148, 163, 184, 0.16)',
          }}
        >
          {TABS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setTab(entry.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '9px 11px',
                border: 'none',
                background: 'transparent',
                borderBottom: `2px solid ${tab === entry.id ? '#6366f1' : 'transparent'}`,
                color: tab === entry.id ? '#c7d2fe' : '#94a3b8',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {entry.icon}
              {entry.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '14px 18px 28px 18px' }}>
          {startupWarning && tab === 'health' && (
            <div
              style={{
                marginBottom: 12,
                padding: '9px 12px',
                borderRadius: 10,
                backgroundColor: 'rgba(245, 158, 11, 0.1)',
                border: '1px solid rgba(245, 158, 11, 0.3)',
                color: '#fcd34d',
                fontSize: 12,
              }}
            >
              {startupWarning}
            </div>
          )}

          {tab === 'routines' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={cardStyle}>
                <div style={{ fontSize: 12, fontWeight: 800, color: '#67e8f9', letterSpacing: '.08em' }}>ROUTINE DATA SAFETY</div>
                <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 6 }}>Routine diagnostics are local-only and never discard a definition during repair.</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: 8, marginTop: 12 }}>
                  {[['Schedules', routineSafety.scheduleRegistration.scheduled], ['Active sessions', routineSafety.scheduleRegistration.activeSessions], ['Invalid sessions', routineSafety.invalidSessions.length], ['Broken links', routineSafety.missingLinks.length], ['Quarantined', routineSafety.quarantined.length], ['Trash', routineSafety.trash.count]].map(([label, value]) => <div key={String(label)} style={{ padding: 9, borderRadius: 9, background: 'rgba(30,41,59,.7)' }}><div style={{ fontSize: 10, color: '#64748b' }}>{label}</div><div style={{ fontSize: 18, fontWeight: 800, color: Number(value) > 0 && ['Invalid sessions','Broken links','Quarantined'].includes(String(label)) ? '#fbbf24' : '#e2e8f0' }}>{value}</div></div>)}
                </div>
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 12 }}>
                  <button type="button" style={secondaryButton} onClick={() => { void runFix('fix.repairRoutineSafety', { confirmed: true }).then(() => refreshRoutineSafety()); }}><Wand2 size={13} /> Repair Routine state</button>
                  <button type="button" style={secondaryButton} onClick={() => { const result = purgeExpiredRoutineTrash(Boolean(window.confirm('Permanently remove expired trashed Routines? This cannot be undone.'))); setRoutineSafety(diagnoseRoutines()); window.alert(result.removed ? `Removed ${result.removed} expired Routine(s).` : 'No expired Routine records were removed.'); }}><Trash2 size={13} /> Purge expired Trash</button>
                </div>
              </div>
              <div style={cardStyle}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>TRASH RETENTION</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: '#cbd5e1' }}>Keep trashed Routines for <input type="number" min={1} max={3650} value={trashRetention} onChange={(e) => { const value = Number(e.target.value); setTrashRetention(value); setRoutineTrashRetentionDays(value); }} style={{ ...secondaryButton, width: 80, display: 'block' }} /> days</label>
              </div>
              {routineSafety.quarantined.length > 0 && <div style={cardStyle}><div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>QUARANTINED RECORDS</div>{routineSafety.quarantined.map((entry) => <div key={entry.id} style={{ fontSize: 11, color: '#cbd5e1', marginTop: 6 }}><strong>{entry.id}</strong>: {entry.reason}</div>)}</div>}
              <div style={cardStyle}><div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>VERSION HISTORY & TRASH</div>{loadRoutines().filter((routine) => routine.trashedAt || routine.versionHistory.length > 0).slice(0, 20).map((routine) => <div key={routine.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, padding: '8px 0', borderBottom: '1px solid rgba(148,163,184,.1)' }}><div style={{ minWidth: 0 }}><div style={{ fontSize: 12, color: '#e2e8f0', fontWeight: 700 }}>{routine.name}</div><div style={{ fontSize: 10.5, color: '#64748b' }}>{routine.trashedAt ? 'In Trash' : `${routine.versionHistory.length} prior version(s)`}</div></div><div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', justifyContent: 'flex-end' }}>{routine.trashedAt && <button type="button" style={secondaryButton} onClick={() => { const next = { ...routine, trashedAt: undefined, status: routine.archivedAt ? 'archived' as const : 'draft' as const, updatedAt: new Date().toISOString() }; saveRoutines(loadRoutines().map((item) => item.id === routine.id ? next : item)); refreshRoutineSafety(); }}>Restore</button>}{routine.versionHistory.length > 0 && <button type="button" style={secondaryButton} onClick={() => { const snapshot = routine.versionHistory[routine.versionHistory.length - 1]; if (window.confirm(`Restore the previous version of ${routine.name}?`)) { restoreRoutineVersion(routine.id, snapshot.id); refreshRoutineSafety(); } }}>Restore prior version</button>}</div></div>)}</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{visibleResults.map((result) => <ResultCard key={result.id} result={result} onRepairsApplied={handleRepairsApplied} />)}</div>
            </div>
          ) : tab === 'logs' ? (
            <LogViewer onCopyReport={handleCopyReport} onExportReport={handleExportReport} />
          ) : tab === 'fixer' ? (
            <FixerPanel results={report?.results ?? []} onRepairsApplied={handleRepairsApplied} />
          ) : tab === 'advanced' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div style={cardStyle}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
                  DIAGNOSTIC PREFERENCES
                </div>
                {(
                  [
                    {
                      key: 'advancedMode' as const,
                      label: 'Advanced diagnostics mode',
                      hint: 'Show raw identifiers, storage keys and internal state versions.',
                    },
                    {
                      key: 'includeDiagnosticLogs' as const,
                      label: 'Include diagnostic logs in full backup',
                      hint: 'Off by default so backups stay free of technical logs.',
                    },
                    {
                      key: 'includeAppDataInReports' as const,
                      label: 'Include application data in exported reports',
                      hint: 'Off by default. Reports never include personal content unless you enable this.',
                    },
                  ]
                ).map((entry) => (
                  <label
                    key={entry.key}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      padding: '7px 0',
                      cursor: 'pointer',
                      fontSize: 12,
                      color: '#cbd5e1',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={preferences[entry.key]}
                      onChange={(e) => updatePreferences({ [entry.key]: e.target.checked })}
                      style={{ marginTop: 2, accentColor: '#6366f1', cursor: 'pointer' }}
                    />
                    <span>
                      <strong style={{ display: 'block', color: '#e2e8f0' }}>{entry.label}</strong>
                      <span style={{ color: '#94a3b8', fontSize: 11 }}>{entry.hint}</span>
                    </span>
                  </label>
                ))}

                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    marginTop: 6,
                    fontSize: 12,
                    color: '#cbd5e1',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={includeAppData}
                    onChange={(e) => setIncludeAppData(e.target.checked)}
                    style={{ accentColor: '#6366f1', cursor: 'pointer' }}
                  />
                  Include application data in the next report export (this session only)
                </label>
              </div>

              {!preferences.advancedMode && (
                <div style={{ ...cardStyle, fontSize: 12, color: '#94a3b8' }}>
                  Raw identifiers, storage keys and internal state versions are hidden. Enable advanced diagnostics
                  mode above to reveal them.
                </div>
              )}

              {preferences.advancedMode && (
                <>
                  <div style={cardStyle}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
                      BUILD & STATE
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: 11,
                        color: '#cbd5e1',
                        backgroundColor: '#0b1220',
                        padding: 10,
                        borderRadius: 8,
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {JSON.stringify(
                        {
                          appVersion: APP_VERSION,
                          buildVersion: BUILD_VERSION,
                          schemaVersion: CURRENT_STORAGE_VERSION,
                          storedSchemaVersion: readStoredSchemaVersion(),
                          backupFormatVersion: BACKUP_FORMAT_VERSION,
                          featureFlags: {
                            dev: import.meta.env.DEV,
                            prod: import.meta.env.PROD,
                            mode: import.meta.env.MODE,
                          },
                          storageKeys: STORAGE_KEYS,
                        },
                        null,
                        2
                      )}
                    </pre>
                  </div>

                  <div style={cardStyle}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
                      RAW DIAGNOSTIC IDS
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: 11,
                        color: '#cbd5e1',
                        backgroundColor: '#0b1220',
                        padding: 10,
                        borderRadius: 8,
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {JSON.stringify(
                        (report?.results ?? []).map((result) => `${result.id} => ${result.status}`),
                        null,
                        2
                      )}
                    </pre>
                  </div>

                  <div style={cardStyle}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
                      NOTIFICATION IDS & SERVICE WORKER
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        fontSize: 11,
                        color: '#cbd5e1',
                        backgroundColor: '#0b1220',
                        padding: 10,
                        borderRadius: 8,
                        overflowX: 'auto',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {JSON.stringify(
                        {
                          platform: environment.platform,
                          permission: environment.permission,
                          schedulingMode: environment.schedulingMode,
                          serviceWorkerSupported: environment.serviceWorkerSupported,
                          serviceWorkerActive: environment.serviceWorkerActive,
                          lastError: engine.lastError ?? null,
                          pendingIds: diagnosticStore.history.slice(0, 5).map((entry) => entry.id),
                        },
                        null,
                        2
                      )}
                    </pre>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 6 }}>
                      Pending notification ids are listed from stored diagnostic history.
                    </div>
                  </div>

                  <div style={cardStyle}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
                      MIGRATION & DIAGNOSTIC HISTORY
                    </div>
                    {diagnosticStore.history.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#94a3b8' }}>No diagnostic runs recorded yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {diagnosticStore.history.slice(0, 12).map((entry) => (
                          <div key={entry.id} style={{ fontSize: 11, color: '#cbd5e1' }}>
                            {new Date(entry.timestamp).toLocaleString()} · {entry.mode} · {entry.passed}P/
                            {entry.warnings}W/{entry.failed}F
                            {entry.fixesPerformed.length > 0 ? ` · fixes: ${entry.fixesPerformed.join(', ')}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      style={{ ...secondaryButton, marginTop: 8 }}
                      onClick={() => {
                        if (confirm('Clear stored diagnostic history and crash records? Logs are kept.')) {
                          clearDiagnosticsHistory();
                          setLogs(getLogs());
                        }
                      }}
                    >
                      Clear diagnostic history
                    </button>
                  </div>

                  <div style={cardStyle}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
                      RECENT STACK TRACES
                    </div>
                    {!diagnosticStore.lastError && diagnosticStore.crashes.length === 0 ? (
                      <div style={{ fontSize: 12, color: '#34d399' }}>No errors or crashes recorded.</div>
                    ) : (
                      <pre
                        style={{
                          margin: 0,
                          fontSize: 11,
                          color: '#fca5a5',
                          backgroundColor: '#0b1220',
                          padding: 10,
                          borderRadius: 8,
                          overflowX: 'auto',
                          whiteSpace: 'pre-wrap',
                        }}
                      >
                        {JSON.stringify(
                          {
                            lastError: diagnosticStore.lastError ?? null,
                            crashes: diagnosticStore.crashes.slice(0, 3),
                          },
                          null,
                          2
                        )}
                      </pre>
                    )}
                  </div>
                </>
              )}
            </div>
          ) : tab === 'backups' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={cardStyle}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 6 }}>BACKUP HISTORY</div>
                <div style={{ fontSize: 12, color: '#cbd5e1' }}>
                  Last backup: {diagnosticStore.lastBackupAt ? new Date(diagnosticStore.lastBackupAt).toLocaleString() : 'never'}
                </div>
                <div style={{ fontSize: 12, color: '#cbd5e1', marginTop: 2 }}>
                  Last restore: {diagnosticStore.lastRestoreAt ? new Date(diagnosticStore.lastRestoreAt).toLocaleString() : 'never'}
                </div>
                {onOpenBackup && (
                  <button type="button" style={{ ...secondaryButton, marginTop: 10 }} onClick={onOpenBackup}>
                    <Database size={13} /> Open Backup & Restore Data
                  </button>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {visibleResults.map((result) => (
                  <ResultCard key={result.id} result={result} onRepairsApplied={handleRepairsApplied} />
                ))}
              </div>

              <div style={{ ...cardStyle, fontSize: 11, color: '#94a3b8' }}>
                Diagnostic logs are excluded from backups by default. Enable “Include diagnostic logs in full backup”
                in the Advanced tab if you want them included.
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {visibleResults.length === 0 ? (
                <div style={{ ...cardStyle, fontSize: 12, color: '#94a3b8' }}>
                  {report ? 'No checks in this section.' : 'Running diagnostics…'}
                </div>
              ) : (
                visibleResults.map((result) => (
                  <ResultCard key={result.id} result={result} onRepairsApplied={handleRepairsApplied} />
                ))
              )}

              {tab === 'health' && report && report.summary.failed > 0 && (
                <button
                  type="button"
                  style={{ ...secondaryButton, alignSelf: 'flex-start' }}
                  onClick={() => setTab('fixer')}
                >
                  <Wrench size={13} /> Open the Fixer for failing checks
                </button>
              )}

              {tab === 'health' && (
                <div style={{ ...cardStyle, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" style={secondaryButton} onClick={handleCopyReport}>
                    <Copy size={13} /> {copied ? 'Copied' : 'Copy diagnostic report'}
                  </button>
                  <button type="button" style={secondaryButton} onClick={() => handleExportReport('text')}>
                    <Download size={13} /> Export report (text)
                  </button>
                  <button type="button" style={secondaryButton} onClick={() => handleExportReport('json')}>
                    <Download size={13} /> Export report (JSON)
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DiagnosticsModal;
