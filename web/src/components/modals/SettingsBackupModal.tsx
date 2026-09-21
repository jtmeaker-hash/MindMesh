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
} from 'lucide-react';
import { MindMeshBackupFile, RestoreSummary } from '../../types/backup';
import {
  createBackup,
  downloadBackupFile,
  validateBackup,
  restoreBackup,
  generateBackupFilename,
} from '../../services/backup';
import { resetMindMeshEntirely } from '../../services/storage';

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
  const [activeTab, setActiveTab] = useState<'backup' | 'restore' | 'reset'>('backup');
  const [exporting, setExporting] = useState(false);
  const [exportedFilename, setExportedFilename] = useState<string | null>(null);

  // Restore state
  const [restoreSummary, setRestoreSummary] = useState<RestoreSummary | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [pendingBackupFile, setPendingBackupFile] = useState<MindMeshBackupFile | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreSuccess, setRestoreSuccess] = useState(false);

  // Reset state
  const [resetConfirmation, setResetConfirmation] = useState('');
  const [isResetting, setIsResetting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  // Handle Full Export
  const handleExport = () => {
    try {
      setExporting(true);
      const backup = createBackup();
      const filename = generateBackupFilename(new Date(backup.createdAt));
      downloadBackupFile(backup, filename);
      setExportedFilename(filename);
      setTimeout(() => setExporting(false), 800);
    } catch (err) {
      alert(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      setExporting(false);
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
                <li>User settings & completion statistics</li>
              </ul>
            </div>

            {exportedFilename && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 14px',
                  borderRadius: 12,
                  backgroundColor: 'rgba(16, 185, 129, 0.12)',
                  border: '1px solid rgba(16, 185, 129, 0.25)',
                  color: '#34d399',
                  fontSize: 13,
                }}
              >
                <CheckCircle2 size={16} />
                <span>Saved as <strong>{exportedFilename}</strong></span>
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
              <span>{exporting ? 'Generating Backup...' : 'Export Full Backup'}</span>
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
                  Supports MindMesh-Backup-*.json
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
          </div>
        )}

        {/* TAB 3: RESET MINDMESH */}
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
