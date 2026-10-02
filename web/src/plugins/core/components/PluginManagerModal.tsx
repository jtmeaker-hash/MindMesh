import React, { useCallback, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  Loader2,
  Plug,
  Power,
  ShieldCheck,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import type { PluginStatus, PluginView } from '../types';
import { PLUGIN_PERMISSION_LABELS, type PluginPermission } from '../../../types/plugin';
import { getPluginManager } from '../runtime';
import { usePluginRuntime } from '../usePluginRuntime';

interface PluginManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const STATUS_LABELS: Record<PluginStatus, string> = {
  installed: 'Installed',
  enabled: 'Enabled',
  disabled: 'Disabled',
  'update-available': 'Update Available',
  incompatible: 'Incompatible',
  'missing-dependency': 'Missing Dependency',
  'migration-required': 'Migration Required',
  error: 'Error',
};

function statusColor(status: PluginStatus, enabled: boolean): { fg: string; bg: string; border: string } {
  if (status === 'error' || status === 'incompatible' || status === 'missing-dependency') {
    return { fg: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.4)' };
  }
  if (status === 'update-available' || status === 'migration-required') {
    return { fg: '#fbbf24', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.4)' };
  }
  if (enabled) {
    return { fg: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.4)' };
  }
  return { fg: '#94a3b8', bg: 'rgba(148,163,184,0.1)', border: 'rgba(148,163,184,0.3)' };
}

function StatusIcon({ status }: { status: PluginStatus }) {
  if (status === 'error' || status === 'incompatible' || status === 'missing-dependency') {
    return <XCircle size={14} color="#f87171" />;
  }
  if (status === 'update-available' || status === 'migration-required') {
    return <AlertTriangle size={14} color="#fbbf24" />;
  }
  if (status === 'enabled' || status === 'installed') {
    return <CheckCircle2 size={14} color="#34d399" />;
  }
  return <Info size={14} color="#94a3b8" />;
}

export const PluginManagerModal: React.FC<PluginManagerModalProps> = ({ isOpen, onClose }) => {
  const manager = getPluginManager();
  const snapshot = usePluginRuntime(manager);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const views = snapshot.views;

  const handleEnable = useCallback(
    async (view: PluginView) => {
      setPendingId(view.id);
      setMessage(null);
      const result = await manager.enable(view.id);
      setPendingId(null);
      setMessage(result.ok ? `${view.name} enabled.` : `Could not enable ${view.name}: ${result.error}`);
    },
    [manager]
  );

  const handleDisable = useCallback(
    async (view: PluginView) => {
      setPendingId(view.id);
      setMessage(null);
      const result = await manager.disable(view.id);
      setPendingId(null);
      setMessage(
        result.ok
          ? `${view.name} disabled. Its data is retained and still included in backups.`
          : `Could not disable ${view.name}: ${result.error}`
      );
    },
    [manager]
  );

  const handleDeleteData = useCallback(
    (view: PluginView) => {
      const confirmed = window.confirm(
        `Delete all data owned by ${view.name}?\n\nThis permanently removes its records and cannot be undone. Export a backup first if you need one.`
      );
      if (!confirmed) return;
      const result = manager.deletePluginData(view.id);
      setMessage(result.ok ? `${view.name} data deleted.` : `Could not delete data: ${result.error}`);
    },
    [manager]
  );

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Plugin Manager"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 400,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
        backgroundColor: 'rgba(8, 11, 18, 0.72)',
        backdropFilter: 'blur(6px)',
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 560,
          maxHeight: '86vh',
          overflowY: 'auto',
          borderRadius: 18,
          border: '1px solid #1e293b',
          background: 'linear-gradient(180deg, #0F172A 0%, #0B1220 100%)',
          boxShadow: '0 24px 60px rgba(0,0,0,0.6)',
          color: '#e2e8f0',
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '16px 18px',
            borderBottom: '1px solid #1e293b',
            position: 'sticky',
            top: 0,
            background: '#0F172A',
            zIndex: 1,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Plug size={18} color="#818cf8" />
            <div>
              <h2 style={{ fontSize: 16, fontWeight: 800 }}>Plugins</h2>
              <p style={{ fontSize: 11.5, color: '#94a3b8' }}>
                Optional extensions. Disabling a plugin never deletes its data.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close plugin manager"
            style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 6, display: 'flex' }}
          >
            <X size={18} />
          </button>
        </header>

        {message && (
          <div style={{ margin: '12px 18px 0', padding: '9px 12px', borderRadius: 10, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', fontSize: 12.5, color: '#c7d2fe' }}>
            {message}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 18 }}>
          {views.length === 0 && (
            <p style={{ fontSize: 13, color: '#94a3b8' }}>No plugins are registered in this build.</p>
          )}

          {views.map((view) => {
            const colors = statusColor(view.status, view.enabled);
            const busy = pendingId === view.id;
            const canEnable = !view.enabled && view.status !== 'incompatible' && view.status !== 'missing-dependency';
            return (
              <section
                key={view.id}
                style={{
                  borderRadius: 14,
                  border: '1px solid #1e293b',
                  background: 'rgba(15,23,42,0.7)',
                  padding: 14,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 14.5, fontWeight: 700, color: '#f8fafc' }}>{view.name}</span>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 5,
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: '2px 8px',
                          borderRadius: 999,
                          color: colors.fg,
                          background: colors.bg,
                          border: `1px solid ${colors.border}`,
                        }}
                      >
                        <StatusIcon status={view.status} />
                        {STATUS_LABELS[view.status]}
                      </span>
                    </div>
                    <p style={{ fontSize: 12, color: '#94a3b8', marginTop: 5, lineHeight: 1.5 }}>{view.description}</p>
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8, fontSize: 11.5 }}>
                  <div style={{ color: '#94a3b8' }}>
                    Version <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{view.installedVersion}</span>
                  </div>
                  <div style={{ color: '#94a3b8' }}>
                    Requires Core <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{view.minimumCoreVersion}</span>
                  </div>
                  <div style={{ color: '#94a3b8' }}>
                    API <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{view.apiVersion}</span>
                  </div>
                </div>

                {view.permissions.length > 0 && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {view.permissions.map((permission) => (
                      <span
                        key={permission}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          fontSize: 10.5,
                          padding: '2px 8px',
                          borderRadius: 999,
                          background: 'rgba(148,163,184,0.1)',
                          border: '1px solid rgba(148,163,184,0.24)',
                          color: '#cbd5e1',
                        }}
                      >
                        <ShieldCheck size={11} />
                        {PLUGIN_PERMISSION_LABELS[permission as PluginPermission] ?? permission}
                      </span>
                    ))}
                  </div>
                )}

                {view.status === 'migration-required' && (
                  <p style={{ fontSize: 11.5, color: '#fbbf24' }}>
                    {view.pendingMigrationIds.length} migration(s) pending. Enabling runs them automatically.
                  </p>
                )}

                {view.lastError && (
                  <div
                    style={{
                      fontSize: 11.5,
                      color: '#fca5a5',
                      background: 'rgba(239,68,68,0.08)',
                      border: '1px solid rgba(239,68,68,0.28)',
                      borderRadius: 10,
                      padding: '8px 10px',
                    }}
                  >
                    <strong style={{ color: '#f87171' }}>{view.lastError.phase} error:</strong>{' '}
                    {view.lastError.message}
                  </div>
                )}

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {view.enabled ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => handleDisable(view)}
                      style={buttonStyle('#f87171', 'rgba(239,68,68,0.14)', 'rgba(239,68,68,0.4)')}
                    >
                      {busy ? <Loader2 size={14} className="mm-spin" /> : <Power size={14} />}
                      Disable
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={busy || !canEnable}
                      onClick={() => handleEnable(view)}
                      style={{
                        ...buttonStyle('#34d399', 'rgba(16,185,129,0.14)', 'rgba(16,185,129,0.4)'),
                        opacity: busy || !canEnable ? 0.5 : 1,
                        cursor: busy || !canEnable ? 'not-allowed' : 'pointer',
                      }}
                    >
                      {busy ? <Loader2 size={14} className="mm-spin" /> : <Power size={14} />}
                      Enable
                    </button>
                  )}

                  {view.status === 'update-available' && (
                    <span style={{ ...buttonStyle('#fbbf24', 'rgba(245,158,11,0.14)', 'rgba(245,158,11,0.4)'), cursor: 'default' }}>
                      <Download size={14} /> Update available
                    </span>
                  )}

                  {view.installed && (
                    <button type="button" onClick={() => handleDeleteData(view)} style={buttonStyle('#94a3b8', 'transparent', 'rgba(148,163,184,0.24)')}>
                      <Trash2 size={14} /> Delete plugin data
                    </button>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function buttonStyle(color: string, background: string, border: string): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    borderRadius: 10,
    background,
    border: `1px solid ${border}`,
    color,
    fontSize: 12.5,
    fontWeight: 600,
    cursor: 'pointer',
  };
}
