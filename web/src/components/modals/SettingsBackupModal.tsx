import React, { useState, useRef } from 'react';
import {
  X,
  Download,
  Upload,
  AlertTriangle,
  CheckCircle2,
  Database,
  Trash2,
  FileCheck,
  RefreshCw,
  Info,
  Copy,
} from 'lucide-react';
import { MindMeshBackupFile, RestoreSummary } from '../../types/backup';
import {
  BackupExportResult,
  createBackup,
  serializeBackup,
  exportBackup,
  isEmbeddedFrame,
  validateBackup,
  restoreBackup,
  generateBackupFilename,
} from '../../services/backup';
import {
  applyLastImportedNodePositions,
  hasLastImportedNodePositions,
  loadLastImportedNodePositions,
  resetMindMeshEntirely,
} from '../../services/storage';
import { logger } from '../../services/logger';
import { SmartAssistancePanel } from './SmartAssistancePanel';

function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

interface LayoutRecoveryCardProps {
  hasPositions: boolean;
  positionCount: number;
  restored: boolean;
  onRestore: () => void;
}

/**
 * Lets the user bring back the custom node positions from the last imported
 * backup without importing the whole backup again. The stored positions are
 * kept separately from the live layout, so resetting the layout never loses them.
 */
const LayoutRecoveryCard: React.FC<LayoutRecoveryCardProps> = ({
  hasPositions,
  positionCount,
  restored,
  onRestore,
}) => (
  <div
    data-testid="layout-recovery"
    style={{
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
      padding: 16,
      borderRadius: 16,
      backgroundColor: 'rgba(30, 41, 59, 0.5)',
      border: '1px solid rgba(99, 102, 241, 0.3)',
      fontSize: 13,
      color: '#cbd5e1',
      lineHeight: 1.5,
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 700, color: '#f8fafc' }}>
      <Info size={16} color="#818cf8" />
      <span>Node layout recovery</span>
    </div>
    <span style={{ color: '#94a3b8' }}>
      The custom node positions from your last imported backup are kept separately, so resetting the
      current layout does not remove them.
    </span>
    {hasPositions ? (
      <button
        type="button"
        data-testid="restore-imported-positions"
        onClick={onRestore}
        style={{
          alignSelf: 'flex-start',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '9px 14px',
          borderRadius: 10,
          border: '1px solid rgba(99, 102, 241, 0.45)',
          backgroundColor: 'rgba(99, 102, 241, 0.16)',
          color: restored ? '#34d399' : '#a5b4fc',
          fontSize: 12.5,
          fontWeight: 700,
          cursor: 'pointer',
        }}
      >
        <RefreshCw size={14} />
        <span>{restored ? 'Custom positions restored' : `Restore ${positionCount} custom position${positionCount === 1 ? '' : 's'}`}</span>
      </button>
    ) : (
      <span style={{ fontSize: 11.5, color: '#64748b' }}>
        No node positions from an imported backup are stored yet.
      </span>
    )}
  </div>
);

interface SettingsBackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRestoreComplete: () => void;
  onResetComplete: () => void;
}

export const SettingsBackupModal: React.FC<SettingsBackupModalProps> = ({
  isOpen,
  onClose,
  onRestoreComplete,
  onResetComplete,
}) => {
  const [activeTab, setActiveTab] = useState<'backup' | 'restore' | 'smart' | 'reset'>('backup');
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<BackupExportResult | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [copiedBackup, setCopiedBackup] = useState(false);

  // Restore state
  const [restoreSummary, setRestoreSummary] = useState<RestoreSummary | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [pendingBackupFile, setPendingBackupFile] = useState<MindMeshBackupFile | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  // Reset state
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [isResetting, setIsResetting] = useState(false);
  const [layoutRestored, setLayoutRestored] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const importedPositionCount = hasLastImportedNodePositions()
    ? Object.keys(loadLastImportedNodePositions()).length
    : 0;
  const hasImportedPositions = importedPositionCount > 0;

  // Reapply the positions captured from the last imported backup to the live
  // layout, then let the app reload its persisted state.
  const handleRestoreImportedPositions = () => {
    const applied = applyLastImportedNodePositions();
    if (!applied) return;
    setLayoutRestored(true);
    window.setTimeout(() => setLayoutRestored(false), 2600);
    onRestoreComplete();
  };

  // Handle Full Export: only reports success once the platform confirms the write.
  const handleExport = async () => {
    setExporting(true);
    setExportError(null);
    setCopiedBackup(false);
    setExportResult(null);

    try {
      const backup = createBackup();
      const filename = generateBackupFilename(new Date(backup.createdAt));
      const result = await exportBackup(backup, filename);

      if (result.ok) {
        setExportResult(result);
      } else {
        setExportError(result.error || 'The backup file could not be created.');
      }
    } catch (err) {
      logger.error('BackupService', 'Backup export threw an unexpected error', err);
      setExportError(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  };

  /** Manual fallback for platforms that block programmatic file downloads. */
  const handleCopyBackupJson = async () => {
    try {
      const json = serializeBackup(createBackup());
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(json);
      } else {
        const area = document.createElement('textarea');
        area.value = json;
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        document.body.removeChild(area);
      }
      setCopiedBackup(true);
    } catch (err) {
      logger.error('BackupService', 'Copying the backup JSON failed', err);
      setExportError(`Copying the backup JSON failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Handle Restore file selection & validation
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setRestoreError(null);
    setRestoreSummary(null);
    setPendingBackupFile(null);
    setRestoreSuccess(false);

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result;
      if (typeof content !== 'string') {
        setRestoreError('Could not read file text.');
        return;
      }

      const validation = validateBackup(content);
      if (!validation.valid || !validation.summary || !validation.backupFile) {
        setRestoreError(validation.error || 'Invalid MindMesh backup file.');
        return;
      }

      setRestoreSummary(validation.summary);
      setPendingBackupFile(validation.backupFile);
    };

    reader.onerror = () => {
      setRestoreError('Failed reading backup file from disk.');
    };

    reader.readAsText(file);
  };

  // Perform Transactional Restore
  const handleConfirmRestore = () => {
    if (!pendingBackupFile) return;

    setRestoring(true);
    setRestoreError(null);

    const result = restoreBackup(pendingBackupFile);
    setRestoring(false);

    if (result.success) {
      setRestoreSuccess(true);
      setTimeout(() => {
        onRestoreComplete();
        onClose();
      }, 1200);
    } else {
      setRestoreError(result.error || 'Restore failed. State rolled back safely.');
    }
  };

  // Perform Total Reset
  const handleConfirmReset = () => {
    if (resetConfirmation.trim().toLowerCase() !== 'delete') {
      alert('Please type "DELETE" to confirm.');
      return;
    }

    if (confirm('Are you absolutely certain? This will wipe all reminders, contacts, financial entries, and local positions!')) {
      setIsResetting(true);
      resetMindMeshEntirely();
      setIsResetting(false);
      onResetComplete();
      onClose();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#0F172A',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 24,
          padding: '24px 20px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
          width: '100%',
          maxWidth: 560,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 20,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: '#818cf8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Database size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F8FAFC', margin: 0 }}>
                Backup, Restore & Data
              </h2>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                Complete application persistence controls
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'rgba(255,255,255,0.06)',
              border: 'none',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#94a3b8',
              cursor: 'pointer',
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Switcher */}
        <div
          style={{
            display: 'flex',
            backgroundColor: '#1E293B',
            borderRadius: 12,
            padding: 3,
            marginBottom: 20,
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('backup')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              border: 'none',
              backgroundColor: activeTab === 'backup' ? '#6366f1' : 'transparent',
              color: activeTab === 'backup' ? '#ffffff' : '#94a3b8',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Export Backup
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('restore')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              border: 'none',
              backgroundColor: activeTab === 'restore' ? '#6366f1' : 'transparent',
              color: activeTab === 'restore' ? '#ffffff' : '#94a3b8',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Restore Backup
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('smart')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              border: 'none',
              backgroundColor: activeTab === 'smart' ? '#6366f1' : 'transparent',
              color: activeTab === 'smart' ? '#ffffff' : '#94a3b8',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Smart
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('reset')}
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 10,
              border: 'none',
              backgroundColor: activeTab === 'reset' ? 'rgba(239, 68, 68, 0.2)' : 'transparent',
              color: activeTab === 'reset' ? '#ef4444' : '#94a3b8',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            Reset MindMesh
          </button>
        </div>

        {/* TAB 1: EXPORT BACKUP */}
        {activeTab === 'backup' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                padding: 16,
                borderRadius: 16,
                backgroundColor: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                fontSize: 13,
                color: '#cbd5e1',
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 700, color: '#f8fafc', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Info size={16} color="#818cf8" />
                <span>Everything is included:</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 20, color: '#94a3b8', fontSize: 12 }}>
                <li>Active & completed reminders + subtasks</li>
                <li>Radial layout node positions & categories</li>
                <li>Contact book entries, photos & relationships</li>
                <li>Direct debit bills, categories & notification rules</li>
                <li>Pay schedule, hourly penalty rates, tips & shifts</li>
                <li>Appearance: theme, node & connection colours, background, code rain</li>
                <li>Smart Assistance settings & per-feature permissions</li>
                <li>User settings & completion statistics</li>
              </ul>
            </div>

            {exportResult && exportResult.ok && (
              <div
                data-testid="export-result"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: '12px 14px',
                  borderRadius: 12,
                  backgroundColor: exportResult.unverified
                    ? 'rgba(245, 158, 11, 0.12)'
                    : 'rgba(16, 185, 129, 0.12)',
                  border: `1px solid ${exportResult.unverified ? 'rgba(245, 158, 11, 0.3)' : 'rgba(16, 185, 129, 0.25)'}`,
                  color: exportResult.unverified ? '#fcd34d' : '#34d399',
                  fontSize: 13,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {exportResult.unverified ? <Info size={16} /> : <CheckCircle2 size={16} />}
                  <span>
                    {exportResult.unverified ? (
                      <>
                        Sent <strong>{exportResult.filename}</strong> ({formatBytes(exportResult.bytes)}) to your
                        browser downloads. If it does not appear, use “Copy backup JSON” below.
                      </>
                    ) : (
                      <>
                        Saved <strong>{exportResult.filename}</strong> ({formatBytes(exportResult.bytes)}) to the
                        location you chose.
                      </>
                    )}
                  </span>
                </div>
                {exportResult.unverified && isEmbeddedFrame() && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <span style={{ fontSize: 11.5, color: '#fcd34d' }}>
                      MindMesh is running inside another page, which can block save dialogs and
                      downloads. Open it in its own tab and export again.
                    </span>
                    <button
                      type="button"
                      onClick={() => window.open(window.location.href, '_blank', 'noopener')}
                      style={{
                        alignSelf: 'flex-start',
                        padding: '6px 12px',
                        borderRadius: 9,
                        border: '1px solid rgba(245, 158, 11, 0.5)',
                        backgroundColor: 'rgba(245, 158, 11, 0.16)',
                        color: '#fcd34d',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      Open MindMesh in a new tab
                    </button>
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleCopyBackupJson}
                  style={{
                    alignSelf: 'flex-start',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 9,
                    border: '1px solid rgba(148, 163, 184, 0.35)',
                    backgroundColor: 'rgba(148, 163, 184, 0.12)',
                    color: copiedBackup ? '#34d399' : '#cbd5e1',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Copy size={13} />
                  <span>{copiedBackup ? 'Copied backup JSON' : 'Copy backup JSON'}</span>
                </button>
              </div>
            )}

            {exportError && (
              <div
                data-testid="export-error"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  padding: '12px 14px',
                  borderRadius: 12,
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: 13,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={16} />
                  <span>{exportError}</span>
                </div>
                <button
                  type="button"
                  onClick={handleCopyBackupJson}
                  style={{
                    alignSelf: 'flex-start',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '6px 12px',
                    borderRadius: 9,
                    border: '1px solid rgba(148, 163, 184, 0.35)',
                    backgroundColor: 'rgba(148, 163, 184, 0.12)',
                    color: copiedBackup ? '#34d399' : '#cbd5e1',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <Copy size={13} />
                  <span>{copiedBackup ? 'Copied backup JSON' : 'Copy backup JSON instead'}</span>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={handleExport}
              disabled={exporting}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px',
                borderRadius: 14,
                border: 'none',
                background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                color: '#ffffff',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 16px rgba(99, 102, 241, 0.4)',
              }}
            >
              <Download size={18} />
              <span>{exporting ? 'Creating backup file...' : 'Export Full Backup'}</span>
            </button>
          </div>
        )}

        {/* TAB 2: RESTORE BACKUP */}
        {activeTab === 'restore' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                padding: 16,
                borderRadius: 16,
                backgroundColor: 'rgba(30, 41, 59, 0.5)',
                border: '1px solid rgba(255, 255, 255, 0.06)',
                fontSize: 13,
                color: '#94a3b8',
                lineHeight: 1.5,
              }}
            >
              Select an exported <strong>.json</strong> file. MindMesh will validate its structure, schema version, and integrity before prompting you to confirm replacement.
            </div>

            {/* File upload picker */}
            <div>
              <input
                type="file"
                ref={fileInputRef}
                accept=".json,application/json"
                onChange={handleFileChange}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                style={{
                  width: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '24px 16px',
                  borderRadius: 16,
                  border: '2px dashed rgba(99, 102, 241, 0.4)',
                  backgroundColor: 'rgba(99, 102, 241, 0.06)',
                  color: '#a5b4fc',
                  cursor: 'pointer',
                  textAlign: 'center',
                }}
              >
                <Upload size={24} color="#818cf8" />
                <span style={{ fontSize: 14, fontWeight: 600 }}>
                  {restoreSummary ? 'Select Different Backup File' : 'Choose MindMesh Backup File'}
                </span>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Supports mindmesh-backup-*.json
                </span>
              </button>
            </div>

            {/* Validation Error Message */}
            {restoreError && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 10,
                  padding: 14,
                  borderRadius: 14,
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#f87171',
                  fontSize: 13,
                }}
              >
                <AlertTriangle size={18} style={{ flexShrink: 0, marginTop: 2 }} />
                <span>{restoreError}</span>
              </div>
            )}

            {/* Restore Summary Breakdown */}
            {restoreSummary && !restoreSuccess && (
              <div
                style={{
                  padding: 16,
                  borderRadius: 16,
                  backgroundColor: 'rgba(15, 23, 42, 0.8)',
                  border: '1px solid rgba(99, 102, 241, 0.3)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 12,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#818cf8', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <FileCheck size={16} />
                    Valid MindMesh Backup
                  </span>
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>
                    Created: {new Date(restoreSummary.createdAt).toLocaleDateString()}
                  </span>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(2, 1fr)',
                    gap: 8,
                    fontSize: 12,
                  }}
                >
                  <div style={{ padding: 10, borderRadius: 10, backgroundColor: '#1E293B', border: '1px solid #334155' }}>
                    <span style={{ color: '#94a3b8', display: 'block' }}>Reminders</span>
                    <strong style={{ fontSize: 16, color: '#f8fafc' }}>
                      {restoreSummary.remindersCount}
                    </strong>
                    <span style={{ fontSize: 10, color: '#10b981', display: 'block' }}>
                      ({restoreSummary.completedRemindersCount} completed)
                    </span>
                  </div>

                  <div style={{ padding: 10, borderRadius: 10, backgroundColor: '#1E293B', border: '1px solid #334155' }}>
                    <span style={{ color: '#94a3b8', display: 'block' }}>Contacts</span>
                    <strong style={{ fontSize: 16, color: '#f8fafc' }}>
                      {restoreSummary.contactsCount}
                    </strong>
                  </div>

                  <div style={{ padding: 10, borderRadius: 10, backgroundColor: '#1E293B', border: '1px solid #334155' }}>
                    <span style={{ color: '#94a3b8', display: 'block' }}>Direct Debits</span>
                    <strong style={{ fontSize: 16, color: '#f8fafc' }}>
                      {restoreSummary.directDebitsCount}
                    </strong>
                  </div>

                  <div style={{ padding: 10, borderRadius: 10, backgroundColor: '#1E293B', border: '1px solid #334155' }}>
                    <span style={{ color: '#94a3b8', display: 'block' }}>Extra Income & Shifts</span>
                    <strong style={{ fontSize: 16, color: '#f8fafc' }}>
                      {restoreSummary.extraIncomeCount + restoreSummary.shiftsCount}
                    </strong>
                  </div>

                  <div style={{ padding: 10, borderRadius: 10, backgroundColor: '#1E293B', border: '1px solid #334155' }}>
                    <span style={{ color: '#94a3b8', display: 'block' }}>Appearance</span>
                    <strong style={{ fontSize: 16, color: '#f8fafc', textTransform: 'capitalize' }}>
                      {restoreSummary.hasAppearance ? restoreSummary.appearanceTheme || 'custom' : 'defaults'}
                    </strong>
                    <span style={{ fontSize: 10, color: '#10b981', display: 'block' }}>
                      ({restoreSummary.hasAppearance ? 'theme included' : 'will use current'})
                    </span>
                  </div>

                  <div style={{ padding: 10, borderRadius: 10, backgroundColor: '#1E293B', border: '1px solid #334155' }}>
                    <span style={{ color: '#94a3b8', display: 'block' }}>Notifications</span>
                    <strong style={{ fontSize: 16, color: '#f8fafc' }}>
                      {restoreSummary.hasNotifications
                        ? restoreSummary.notificationHistoryCount
                        : 'defaults'}
                    </strong>
                    <span style={{ fontSize: 10, color: '#10b981', display: 'block' }}>
                      {restoreSummary.hasNotifications
                        ? `(${restoreSummary.scheduledNotificationsCount} scheduled)`
                        : '(settings will use defaults)'}
                    </span>
                  </div>

                  <div style={{ padding: 10, borderRadius: 10, backgroundColor: '#1E293B', border: '1px solid #334155' }}>
                    <span style={{ color: '#94a3b8', display: 'block' }}>Diagnostic Logs</span>
                    <strong style={{ fontSize: 16, color: '#f8fafc' }}>
                      {restoreSummary.diagnosticLogCount}
                    </strong>
                    <span style={{ fontSize: 10, color: '#10b981', display: 'block' }}>
                      {restoreSummary.hasDiagnosticLogs ? '(included)' : '(not included — privacy default)'}
                    </span>
                  </div>
                </div>

                {restoreSummary.warnings.length > 0 && (
                  <div style={{ fontSize: 11, color: '#f59e0b', padding: '6px 10px', borderRadius: 8, backgroundColor: 'rgba(245, 158, 11, 0.1)' }}>
                    {restoreSummary.warnings.join(' • ')}
                  </div>
                )}

                <button
                  type="button"
                  onClick={handleConfirmRestore}
                  disabled={restoring}
                  style={{
                    width: '100%',
                    padding: '12px',
                    borderRadius: 12,
                    backgroundColor: '#10b981',
                    border: 'none',
                    color: '#ffffff',
                    fontSize: 14,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    boxShadow: '0 4px 14px rgba(16, 185, 129, 0.4)',
                    marginTop: 4,
                  }}
                >
                  <RefreshCw size={16} />
                  <span>{restoring ? 'Restoring Backup...' : 'Confirm & Restore Backup'}</span>
                </button>
              </div>
            )}

            {restoreSuccess && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: 16,
                  borderRadius: 14,
                  backgroundColor: 'rgba(16, 185, 129, 0.15)',
                  border: '1px solid rgba(16, 185, 129, 0.3)',
                  color: '#34d399',
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                <CheckCircle2 size={20} />
                <span>Restoration complete! Reloading MindMesh state...</span>
              </div>
            )}

            <LayoutRecoveryCard
              hasPositions={hasImportedPositions}
              positionCount={importedPositionCount}
              restored={layoutRestored}
              onRestore={handleRestoreImportedPositions}
            />
          </div>
        )}

        {/* TAB 3: SMART ASSISTANCE */}
        {activeTab === 'smart' && <SmartAssistancePanel />}

        {/* TAB 4: RESET MINDMESH */}
        {activeTab === 'reset' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div
              style={{
                padding: 16,
                borderRadius: 16,
                backgroundColor: 'rgba(239, 68, 68, 0.08)',
                border: '1px solid rgba(239, 68, 68, 0.25)',
                fontSize: 13,
                color: '#fca5a5',
                lineHeight: 1.5,
              }}
            >
              <div style={{ fontWeight: 700, color: '#ef4444', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <AlertTriangle size={16} />
                <span>Danger: Irreversible Action</span>
              </div>
              This will completely wipe all local storage data, including:
              <ul style={{ margin: '6px 0 0 0', paddingLeft: 20 }}>
                <li>All active & completed reminders and subtasks</li>
                <li>All contacts in your Contact Book</li>
                <li>All direct debits, income configurations, shifts, and tips</li>
                <li>All manual node positions and custom categories</li>
              </ul>
            </div>

            <LayoutRecoveryCard
              hasPositions={hasImportedPositions}
              positionCount={importedPositionCount}
              restored={layoutRestored}
              onRestore={handleRestoreImportedPositions}
            />

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Type <strong>DELETE</strong> below to confirm:
              </label>
              <input
                type="text"
                placeholder="DELETE"
                value={resetConfirmation}
                onChange={(e) => setResetConfirmation(e.target.value)}
                style={{
                  width: '100%',
                  padding: '12px 14px',
                  borderRadius: 12,
                  backgroundColor: '#1E293B',
                  border: '1px solid #ef4444',
                  color: '#F8FAFC',
                  fontSize: 14,
                  fontWeight: 600,
                  outline: 'none',
                }}
              />
            </div>

            <button
              type="button"
              onClick={handleConfirmReset}
              disabled={resetConfirmation.trim().toLowerCase() !== 'delete' || isResetting}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '14px',
                borderRadius: 14,
                border: 'none',
                backgroundColor: resetConfirmation.trim().toLowerCase() === 'delete' ? '#ef4444' : '#334155',
                color: '#ffffff',
                fontSize: 15,
                fontWeight: 700,
                cursor: resetConfirmation.trim().toLowerCase() === 'delete' ? 'pointer' : 'not-allowed',
                boxShadow: resetConfirmation.trim().toLowerCase() === 'delete' ? '0 4px 16px rgba(239, 68, 68, 0.4)' : 'none',
              }}
            >
              <Trash2 size={18} />
              <span>{isResetting ? 'Wiping MindMesh...' : 'Reset MindMesh Entirely'}</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
