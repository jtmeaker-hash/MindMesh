import React, { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, ShieldCheck, Wand2, XCircle } from 'lucide-react';
import { DiagnosticResult, FixOutcome, FixDefinition } from '../../types/diagnostics';
import {
  getConfirmFixes,
  getSafeFixes,
  isFixImplemented,
  runAllSafeFixes,
  runFix,
} from '../../services/fixer';

interface FixerPanelProps {
  results: DiagnosticResult[];
  /** Called after repairs so the parent can re-run diagnostics. */
  onRepairsApplied: (outcomes: FixOutcome[]) => void;
}

const RESULT_META: Record<FixOutcome['status'], { label: string; color: string; icon: React.ReactNode }> = {
  fixed: { label: 'FIXED', color: '#34d399', icon: <CheckCircle2 size={13} /> },
  still_failing: { label: 'STILL FAILING', color: '#f59e0b', icon: <AlertTriangle size={13} /> },
  manual_action_required: { label: 'MANUAL ACTION REQUIRED', color: '#38bdf8', icon: <HelpCircle size={13} /> },
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

const cardStyle: React.CSSProperties = {
  padding: 12,
  borderRadius: 12,
  backgroundColor: 'rgba(15, 23, 42, 0.7)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
};

export const FixerPanel: React.FC<FixerPanelProps> = ({ results, onRepairsApplied }) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<FixOutcome[]>([]);
  const [summary, setSummary] = useState<{ fixed: number; remaining: number; manual: number } | null>(null);
  const [confirming, setConfirming] = useState<FixDefinition | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const safeFixes = useMemo(() => getSafeFixes().filter((fix) => isFixImplemented(fix.id)), []);
  const confirmFixes = useMemo(() => getConfirmFixes().filter((fix) => isFixImplemented(fix.id)), []);

  const failedResults = useMemo(
    () => results.filter((result) => result.status === 'fail' || result.status === 'warning'),
    [results]
  );

  const handleRunAllSafe = async () => {
    setBusy('all');
    setPreviewOpen(false);
    try {
      const result = await runAllSafeFixes();
      setOutcomes(result.outcomes);
      setSummary({ fixed: result.fixed, remaining: result.remaining, manual: result.manual });
      onRepairsApplied(result.outcomes);
    } finally {
      setBusy(null);
    }
  };

  const handleRunSingle = async (fix: FixDefinition, confirmed: boolean) => {
    setBusy(fix.id);
    setConfirming(null);
    try {
      const outcome = await runFix(fix.id, { confirmed });
      setOutcomes((prev) => [outcome, ...prev.filter((entry) => entry.fixId !== outcome.fixId)]);
      onRepairsApplied([outcome]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary of what the fixer can do */}
      <div style={cardStyle}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <Wand2 size={15} color="#818cf8" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Diagnostics Fixer</span>
        </div>
        <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 10px 0', lineHeight: 1.5 }}>
          Repairs are split into safe repairs that only rebuild derived data or clear broken pointers, and repairs that
          can change stored records, which always require your confirmation. Reminders, contacts, financial records,
          statistics and backups are never deleted automatically.
        </p>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {!previewOpen ? (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setPreviewOpen(true)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '9px 14px',
                borderRadius: 10,
                border: 'none',
                backgroundColor: busy ? '#334155' : '#6366f1',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 700,
                cursor: busy ? 'default' : 'pointer',
              }}
            >
              <ShieldCheck size={14} /> Fix All Safe Issues
            </button>
          ) : (
            <div style={{ width: '100%', ...cardStyle, backgroundColor: 'rgba(99, 102, 241, 0.08)' }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: '#c7d2fe', marginBottom: 6 }}>
                The following safe repairs will run:
              </div>
              <ul style={{ margin: '0 0 10px 16px', padding: 0, fontSize: 12, color: '#cbd5e1', lineHeight: 1.6 }}>
                {safeFixes.map((fix) => (
                  <li key={fix.id}>{fix.title}</li>
                ))}
              </ul>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  onClick={handleRunAllSafe}
                  disabled={busy !== null}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    border: 'none',
                    backgroundColor: '#6366f1',
                    color: '#ffffff',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {busy === 'all' ? 'Running…' : 'Run safe repairs'}
                </button>
                <button type="button" style={secondaryButton} onClick={() => setPreviewOpen(false)} disabled={busy !== null}>
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {summary && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 14,
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 10,
              backgroundColor: 'rgba(15, 23, 42, 0.9)',
              border: '1px solid rgba(148, 163, 184, 0.18)',
              fontSize: 12,
            }}
          >
            <span style={{ color: '#34d399' }}>Issues fixed: {summary.fixed}</span>
            <span style={{ color: '#f59e0b' }}>Issues remaining: {summary.remaining}</span>
            <span style={{ color: '#38bdf8' }}>Issues requiring manual action: {summary.manual}</span>
          </div>
        )}
      </div>

      {/* Repairs suggested by the current results */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
          REPAIRS FOR CURRENT ISSUES
        </div>
        {failedResults.length === 0 ? (
          <div style={{ fontSize: 12, color: '#34d399' }}>No failing or warning checks to repair right now.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {failedResults.map((result) => {
              const fixes = [...safeFixes, ...confirmFixes].filter((fix) => fix.targetChecks.includes(result.id));
              return (
                <div
                  key={result.id}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    backgroundColor: 'rgba(15, 23, 42, 0.6)',
                    border: `1px solid ${result.status === 'fail' ? 'rgba(239, 68, 68, 0.3)' : 'rgba(245, 158, 11, 0.25)'}`,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{result.name}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{result.explanation}</div>

                  {fixes.length === 0 ? (
                    <div style={{ fontSize: 11, color: '#f59e0b', marginTop: 6 }}>
                      Manual action required: {result.suggestedFix || 'This issue cannot be repaired automatically.'}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                      {fixes.map((fix) => (
                        <button
                          key={fix.id}
                          type="button"
                          disabled={busy !== null}
                          onClick={() => (fix.kind === 'confirm' ? setConfirming(fix) : handleRunSingle(fix, true))}
                          style={{
                            ...secondaryButton,
                            borderColor: fix.affectsUserData ? 'rgba(245, 158, 11, 0.4)' : 'rgba(99, 102, 241, 0.4)',
                            color: fix.affectsUserData ? '#fbbf24' : '#c7d2fe',
                          }}
                        >
                          <Wand2 size={12} /> {busy === fix.id ? 'Repairing…' : `Fix: ${fix.title}`}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Confirmation-required repairs */}
      <div style={cardStyle}>
        <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>
          REPAIRS REQUIRING CONFIRMATION
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {confirmFixes.map((fix) => (
            <div
              key={fix.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
                padding: 10,
                borderRadius: 10,
                backgroundColor: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(245, 158, 11, 0.2)',
              }}
            >
              <div style={{ flex: '1 1 220px' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0' }}>{fix.title}</div>
                <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{fix.description}</div>
              </div>
              <button
                type="button"
                style={secondaryButton}
                disabled={busy !== null}
                onClick={() => setConfirming(fix)}
              >
                Review & run
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Outcomes */}
      {outcomes.length > 0 && (
        <div style={cardStyle}>
          <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>REPAIR RESULTS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {outcomes.map((outcome) => {
              const meta = RESULT_META[outcome.status];
              return (
                <div
                  key={outcome.fixId}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    backgroundColor: 'rgba(15, 23, 42, 0.6)',
                    border: `1px solid ${meta.color}44`,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: meta.color, fontSize: 11, fontWeight: 800 }}>
                    {meta.icon}
                    <span>{meta.label}</span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#e2e8f0', marginTop: 4 }}>{outcome.title}</div>
                  <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{outcome.message}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Confirmation dialog */}
      {confirming && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 1400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            backgroundColor: 'rgba(2, 6, 23, 0.8)',
            backdropFilter: 'blur(6px)',
          }}
          role="dialog"
          aria-modal="true"
          aria-label="Confirm repair"
        >
          <div
            style={{
              width: '100%',
              maxWidth: 440,
              padding: 18,
              borderRadius: 16,
              backgroundColor: '#0F172A',
              border: '1px solid rgba(245, 158, 11, 0.35)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
              <AlertTriangle size={17} color="#f59e0b" />
              <span style={{ fontSize: 15, fontWeight: 800, color: '#f8fafc' }}>Confirm repair</span>
            </div>

            <div style={{ fontSize: 12, color: '#cbd5e1', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>
                <strong style={{ color: '#e2e8f0' }}>What is wrong: </strong>
                {confirming.targetChecks.join(', ')}
              </div>
              <div>
                <strong style={{ color: '#e2e8f0' }}>What the fixer will change: </strong>
                {confirming.description}
              </div>
              <div style={{ color: confirming.affectsUserData ? '#fbbf24' : '#34d399' }}>
                <strong style={{ color: '#e2e8f0' }}>User data: </strong>
                {confirming.affectsUserData
                  ? 'Stored records can be modified or removed by this repair. Create a backup first if unsure.'
                  : 'Your stored records are not modified by this repair.'}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <button
                type="button"
                style={secondaryButton}
                onClick={() => setConfirming(null)}
              >
                <XCircle size={13} /> Cancel
              </button>
              <button
                type="button"
                onClick={() => handleRunSingle(confirming, true)}
                style={{
                  flex: 1,
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: 'none',
                  backgroundColor: '#f59e0b',
                  color: '#1f2937',
                  fontSize: 12,
                  fontWeight: 800,
                  cursor: 'pointer',
                }}
              >
                Run repair
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FixerPanel;
