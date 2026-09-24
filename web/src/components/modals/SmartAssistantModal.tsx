import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, Lock, Send, Settings, ShieldCheck, Sparkles, X } from 'lucide-react';
import { Category, Reminder } from '../../types';
import { Contact } from '../../types/contact';
import { DiagnosticReport } from '../../types/diagnostics';
import { MoneyState } from '../../types/finance';
import { SmartEngineResult, SmartEngineSettings } from '../../types/smartEngine';
import {
  AssistantResolutionPrompt,
  ProposalResolution,
  SmartAssistantHandlers,
  SmartAssistantWriteOutcome,
  buildProposalPreview,
  buildResolutionPrompts,
  createSmartAssistantSession,
  resolveProposal,
} from '../../services/smartAssistant';

export interface SmartAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: SmartEngineSettings;
  categories: Category[];
  reminders: Reminder[];
  moneyState: MoneyState;
  contacts: Contact[];
  diagnosticsReport?: DiagnosticReport;
  handlers: SmartAssistantHandlers;
  onOpenSettings: () => void;
}

const EXAMPLE_COMMANDS = [
  'Remind me to get my car serviced next Friday',
  'Move my dentist reminder to Thursday',
  'Create a category called Work',
  'Add Personal under Work',
  'Netflix is $25.99 every month on the 16th',
  'How am I going with errands?',
  'Summarize my reminders',
  'Show what bills are due before next pay',
  "Why aren't my reminder notifications working?",
];

const shellStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(3, 7, 18, 0.72)',
  backdropFilter: 'blur(8px)',
  zIndex: 1000,
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'flex-end',
  animation: 'fadeIn 0.2s ease',
};

const panelStyle: React.CSSProperties = {
  backgroundColor: '#0F172A',
  borderTop: '1px solid rgba(255,255,255,0.12)',
  borderTopLeftRadius: 24,
  borderTopRightRadius: 24,
  padding: '16px 18px 26px 18px',
  boxShadow: '0 -10px 40px rgba(0,0,0,0.8)',
  width: '100%',
  maxWidth: 520,
  maxHeight: '88dvh',
  overflowY: 'auto',
  margin: '0 auto',
};

/**
 * Stage 07 assistant surface. It only ever previews; the actual write goes
 * through the existing app handlers passed in as `handlers`, and only after the
 * user presses the confirm button. Nothing here talks to a network or a model.
 */
export const SmartAssistantModal: React.FC<SmartAssistantModalProps> = ({
  isOpen,
  onClose,
  settings,
  categories,
  reminders,
  moneyState,
  contacts,
  diagnosticsReport,
  handlers,
  onOpenSettings,
}) => {
  const [command, setCommand] = useState('');
  const [result, setResult] = useState<SmartEngineResult | null>(null);
  const [resolutions, setResolutions] = useState<ProposalResolution>({});
  const [outcome, setOutcome] = useState<SmartAssistantWriteOutcome | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Survives session rebuilds so the same proposal is never written twice.
  const completedProposalIds = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!isOpen) return;
    setCommand('');
    setResult(null);
    setResolutions({});
    setOutcome(null);
    setError(null);
  }, [isOpen]);

  const context = useMemo(
    () => ({ categories, billCategories: moneyState.billCategories, reminders, contacts }),
    [categories, moneyState, reminders, contacts]
  );

  const buildSession = () =>
    createSmartAssistantSession({
      settings,
      categories,
      reminders,
      moneyState,
      contacts,
      diagnosticsReport,
      handlers: {
        saveReminder: (reminder) => handlers.saveReminder(reminder),
        saveCategory: (category) => handlers.saveCategory(category),
        saveDirectDebit: (debit, linkedReminder) => handlers.saveDirectDebit(debit, linkedReminder),
      },
      completedProposalIds: completedProposalIds.current,
    });

  const resolvedResult = useMemo(() => {
    if (!result) return null;
    return Object.keys(resolutions).length ? resolveProposal(result, resolutions, context) : result;
  }, [result, resolutions, context]);

  const previewRows = useMemo(
    () => (resolvedResult?.proposal ? buildProposalPreview(resolvedResult.proposal, { command, reminders }) : []),
    [resolvedResult, command, reminders]
  );

  const prompts = useMemo(
    () => (resolvedResult ? buildResolutionPrompts(resolvedResult, context) : []),
    [resolvedResult, context]
  );

  if (!isOpen) return null;

  const disabled = !settings.enabled;
  const unresolved = prompts.filter((prompt) => prompt.required);
  const hasProposal = Boolean(resolvedResult?.proposal);
  const canConfirm = Boolean(hasProposal) && unresolved.length === 0 && !outcome;

  const handlePreview = () => {
    if (disabled) return;
    const next = buildSession().interpret(command);
    setOutcome(null);
    setResolutions({});
    setError(null);
    setResult(next);
  };

  const handleConfirm = () => {
    if (!resolvedResult || disabled) return;
    const next = buildSession().confirm(resolvedResult, { resolutions, command });
    setOutcome(next);
    if (next.success) {
      setResolutions({});
    }
  };

  const handleCancel = () => {
    setResult(null);
    setResolutions({});
    setOutcome(null);
    setError(null);
  };

  const setResolution = (field: string, value: string) => {
    setResolutions((prev) => ({ ...prev, [field]: value }));
  };

  const renderPrompt = (prompt: AssistantResolutionPrompt) => {
    const selected = resolutions[prompt.field];
    return (
      <div
        key={prompt.field}
        data-testid={`smart-assistant-prompt-${prompt.field}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          padding: '10px 12px',
          borderRadius: 12,
          backgroundColor: 'rgba(245, 158, 11, 0.08)',
          border: '1px solid rgba(245, 158, 11, 0.28)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <AlertTriangle size={14} color="#fbbf24" />
          <span style={{ fontSize: 12.5, fontWeight: 700, color: '#fcd34d' }}>{prompt.label}</span>
        </div>
        <span style={{ fontSize: 11.5, color: '#cbd5e1', lineHeight: 1.45 }}>{prompt.message}</span>
        {prompt.options.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {prompt.currentValue && !prompt.options.some((option) => option.value === prompt.currentValue) && (
              <button
                type="button"
                onClick={() => setResolution(prompt.field, String(prompt.currentValue))}
                style={chipStyle(selected === String(prompt.currentValue))}
              >
                Use {prompt.currentValue}
              </button>
            )}
            {prompt.options.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={selected === option.value}
                onClick={() => setResolution(prompt.field, option.value)}
                style={chipStyle(selected === option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}
        {prompt.freeText && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="text"
              aria-label={prompt.label}
              value={selected ?? ''}
              onChange={(event) => setResolution(prompt.field, event.target.value)}
              placeholder={prompt.currentValue ? `e.g. ${prompt.currentValue}` : 'Type a value'}
              style={{
                flex: 1,
                minHeight: 34,
                borderRadius: 10,
                border: '1px solid #334155',
                backgroundColor: '#0b1220',
                color: '#f8fafc',
                fontSize: 13,
                padding: '6px 10px',
              }}
            />
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={shellStyle} onClick={onClose} data-testid="smart-assistant-modal">
      <div style={panelStyle} role="dialog" aria-label="MindMesh Smart Assistant" onClick={(event) => event.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={17} color="#a5b4fc" />
            <div>
              <div style={{ fontSize: 16, fontWeight: 800, color: '#F8FAFC' }}>Smart Assistant</div>
              <div style={{ fontSize: 11, color: '#94a3b8' }}>Local rules only · no network, no model</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Smart Assistant"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              borderRadius: '50%',
              width: 30,
              height: 30,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            <X size={16} />
          </button>
        </div>

        {disabled ? (
          <div
            data-testid="smart-assistant-off"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: 14,
              borderRadius: 16,
              backgroundColor: 'rgba(148, 163, 184, 0.1)',
              border: '1px solid rgba(148, 163, 184, 0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9 }}>
              <Lock size={16} color="#cbd5e1" style={{ flexShrink: 0, marginTop: 1 }} />
              <div style={{ fontSize: 12.5, color: '#cbd5e1', lineHeight: 1.5 }}>
                <strong>Smart Assistance is off.</strong> Your reminders, contacts, money data, notifications and
                everything else keep working exactly as normal — this surface is simply inactive until you turn it
                back on.
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenSettings}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 7,
                padding: '10px 12px',
                borderRadius: 12,
                border: '1px solid rgba(99, 102, 241, 0.4)',
                backgroundColor: 'rgba(99, 102, 241, 0.16)',
                color: '#c7d2fe',
                fontSize: 13,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              <Settings size={14} color="#818cf8" /> Open Smart Assistance settings
            </button>
          </div>
        ) : (
          <>
            <div
              style={{
                display: 'flex',
                gap: 9,
                padding: '10px 12px',
                borderRadius: 12,
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                border: '1px solid rgba(16, 185, 129, 0.22)',
                marginBottom: 12,
              }}
            >
              <ShieldCheck size={15} color="#34d399" style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 11.5, color: '#a7f3d0', lineHeight: 1.5 }}>
                Type a request and preview exactly what would change. Nothing is written until you confirm.
              </span>
            </div>

            <label htmlFor="smart-assistant-command" style={{ display: 'block', fontSize: 12, fontWeight: 700, color: '#cbd5e1', marginBottom: 6 }}>
              What would you like to do?
            </label>
            <textarea
              id="smart-assistant-command"
              data-testid="smart-assistant-command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              rows={2}
              placeholder="e.g. Remind me to get my car serviced next Friday"
              style={{
                width: '100%',
                resize: 'vertical',
                borderRadius: 12,
                border: '1px solid #334155',
                backgroundColor: '#0b1220',
                color: '#f8fafc',
                fontSize: 13.5,
                padding: '10px 12px',
                lineHeight: 1.45,
              }}
            />

            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                type="button"
                data-testid="smart-assistant-ready"
                onClick={handlePreview}
                disabled={!command.trim()}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: 'none',
                  backgroundColor: command.trim() ? '#6366F1' : 'rgba(99, 102, 241, 0.35)',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: command.trim() ? 'pointer' : 'not-allowed',
                }}
              >
                <Send size={14} /> Preview
              </button>
              <button
                type="button"
                onClick={handleCancel}
                style={{
                  padding: '10px 14px',
                  borderRadius: 12,
                  border: '1px solid #334155',
                  backgroundColor: 'transparent',
                  color: '#cbd5e1',
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                Clear
              </button>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 }}>
              {EXAMPLE_COMMANDS.map((example) => (
                <button key={example} type="button" onClick={() => setCommand(example)} style={chipStyle(false)}>
                  {example}
                </button>
              ))}
            </div>

            {error && (
              <div role="alert" style={{ marginTop: 12, fontSize: 12.5, color: '#fca5a5' }}>
                {error}
              </div>
            )}

            {resolvedResult && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div
                  data-testid="smart-assistant-message"
                  style={{
                    display: 'flex',
                    gap: 9,
                    padding: '11px 12px',
                    borderRadius: 12,
                    backgroundColor: resolvedResult.proposal
                      ? 'rgba(99, 102, 241, 0.1)'
                      : resolvedResult.status === 'ok'
                        ? 'rgba(59, 130, 246, 0.1)'
                        : 'rgba(148, 163, 184, 0.1)',
                    border: '1px solid rgba(148, 163, 184, 0.22)',
                  }}
                >
                  <Info size={15} color="#93c5fd" style={{ flexShrink: 0, marginTop: 1 }} />
                  <span style={{ fontSize: 12.5, color: '#e2e8f0', lineHeight: 1.5 }}>{resolvedResult.message}</span>
                </div>

                {hasProposal && (
                  <div data-testid="smart-assistant-rows" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.04em', marginBottom: 2 }}>
                      PROPOSED ACTION — PREVIEW
                    </div>
                    {previewRows.map((row) => (
                      <div
                        key={row.field}
                        style={{
                          display: 'flex',
                          alignItems: 'flex-start',
                          justifyContent: 'space-between',
                          gap: 12,
                          padding: '7px 10px',
                          borderRadius: 10,
                          backgroundColor: '#111c31',
                          border: '1px solid #1e293b',
                        }}
                      >
                        <span style={{ fontSize: 12, color: '#94a3b8', flexShrink: 0 }}>{row.label}</span>
                        <span
                          style={{
                            fontSize: 12.5,
                            color: row.uncertain ? '#fcd34d' : '#f8fafc',
                            textAlign: 'right',
                            fontWeight: 600,
                          }}
                        >
                          {row.value}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {hasProposal && prompts.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.04em' }}>
                      NEEDS YOUR CONFIRMATION
                    </div>
                    {prompts.map(renderPrompt)}
                  </div>
                )}

                {outcome && (
                  <div
                    data-testid="smart-assistant-outcome"
                    role="status"
                    style={{
                      display: 'flex',
                      gap: 9,
                      padding: '11px 12px',
                      borderRadius: 12,
                      backgroundColor: outcome.success ? 'rgba(16, 185, 129, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                      border: outcome.success ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                    }}
                  >
                    {outcome.success ? (
                      <CheckCircle2 size={15} color="#34d399" style={{ flexShrink: 0, marginTop: 1 }} />
                    ) : (
                      <AlertTriangle size={15} color="#f87171" style={{ flexShrink: 0, marginTop: 1 }} />
                    )}
                    <span style={{ fontSize: 12.5, color: outcome.success ? '#a7f3d0' : '#fca5a5', lineHeight: 1.5 }}>
                      {outcome.message}
                    </span>
                  </div>
                )}

                {hasProposal && !outcome && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 2 }}>
                    <button
                      type="button"
                      data-testid="smart-assistant-confirm"
                      onClick={handleConfirm}
                      disabled={!canConfirm}
                      style={{
                        flex: 1,
                        padding: '11px 14px',
                        borderRadius: 12,
                        border: 'none',
                        backgroundColor: canConfirm ? '#10b981' : 'rgba(148, 163, 184, 0.25)',
                        color: canConfirm ? '#052e1a' : '#94a3b8',
                        fontSize: 13.5,
                        fontWeight: 800,
                        cursor: canConfirm ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Confirm &amp; write
                    </button>
                    <button
                      type="button"
                      data-testid="smart-assistant-cancel"
                      onClick={handleCancel}
                      style={{
                        padding: '11px 16px',
                        borderRadius: 12,
                        border: '1px solid #334155',
                        backgroundColor: 'transparent',
                        color: '#cbd5e1',
                        fontSize: 13.5,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                )}

                {hasProposal && unresolved.length > 0 && (
                  <div style={{ fontSize: 11.5, color: '#94a3b8' }}>
                    Answer the highlighted field{unresolved.length === 1 ? '' : 's'} to enable confirmation.
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '5px 10px',
    borderRadius: 999,
    border: active ? '1px solid #818cf8' : '1px solid #334155',
    backgroundColor: active ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255,255,255,0.04)',
    color: active ? '#c7d2fe' : '#cbd5e1',
    fontSize: 11.5,
    cursor: 'pointer',
    textAlign: 'left',
  };
}
