import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  BellOff,
  BellRing,
  CheckCircle2,
  Clock,
  ExternalLink,
  History,
  Loader2,
  Send,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import {
  ADVANCE_PRESETS,
  AppNotificationSettings,
  NotificationHistoryEntry,
  SNOOZE_PRESETS,
  formatAdvanceLabel,
  formatSnoozeLabel,
} from '../../types/notifications';
import {
  getMissedNotificationCount,
  getNotificationEngineState,
  getPendingNotificationCount,
  openDeviceNotificationSettings,
  requestNotificationPermission,
  sendTestNotification,
  snoozeNotification,
  subscribeNotificationEngine,
  syncNotificationSchedules,
} from '../../services/notifications';

interface NotificationsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: AppNotificationSettings;
  onChange: (settings: AppNotificationSettings) => void;
  history: NotificationHistoryEntry[];
  onChangeHistory: (history: NotificationHistoryEntry[]) => void;
  onOpenReminder: (reminderId: string) => void;
  onOpenDiagnostics: () => void;
}

const cardStyle: React.CSSProperties = {
  padding: 14,
  borderRadius: 14,
  backgroundColor: 'rgba(15, 23, 42, 0.72)',
  border: '1px solid rgba(148, 163, 184, 0.16)',
};

const secondaryButton: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid rgba(148, 163, 184, 0.25)',
  backgroundColor: 'rgba(148, 163, 184, 0.08)',
  color: '#cbd5e1',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, hint, checked, onChange, disabled }) => (
  <label
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 10,
      padding: '8px 0',
      cursor: disabled ? 'default' : 'pointer',
      opacity: disabled ? 0.55 : 1,
    }}
  >
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled}
      onChange={(e) => onChange(e.target.checked)}
      style={{ marginTop: 2, accentColor: '#6366f1', cursor: disabled ? 'default' : 'pointer' }}
    />
    <span style={{ fontSize: 12.5, color: '#e2e8f0' }}>
      {label}
      {hint && <span style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginTop: 1 }}>{hint}</span>}
    </span>
  </label>
);

const STATUS_COPY: Record<string, { label: string; color: string; detail: string }> = {
  granted: { label: 'Allowed', color: '#34d399', detail: 'MindMesh can show reminder notifications.' },
  denied: { label: 'Blocked', color: '#ef4444', detail: 'Notifications are blocked for MindMesh.' },
  default: { label: 'Not yet allowed', color: '#f59e0b', detail: 'Permission has not been requested yet.' },
  unsupported: { label: 'Unavailable', color: '#94a3b8', detail: 'This environment has no notification API.' },
};

const HISTORY_STATUS_COLOR: Record<NotificationHistoryEntry['status'], string> = {
  pending: '#818cf8',
  fired: '#34d399',
  snoozed: '#f59e0b',
  cancelled: '#64748b',
  missed: '#ef4444',
  failed: '#ef4444',
};

export const NotificationsModal: React.FC<NotificationsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onChange,
  history,
  onChangeHistory,
  onOpenReminder,
  onOpenDiagnostics,
}) => {
  const [engine, setEngine] = useState(() => getNotificationEngineState());
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [historyFilter, setHistoryFilter] = useState<'upcoming' | 'all'>('upcoming');

  useEffect(() => subscribeNotificationEngine(setEngine), []);

  useEffect(() => {
    if (isOpen) syncNotificationSchedules(true);
  }, [isOpen]);

  const pending = useMemo(() => getPendingNotificationCount(history), [history]);
  const missed = useMemo(() => getMissedNotificationCount(history), [history]);
  const permissionCopy = STATUS_COPY[engine.permission] ?? STATUS_COPY.unsupported;

  const visibleHistory = useMemo(() => {
    const sorted = [...history].sort((a, b) => Date.parse(b.scheduledFor) - Date.parse(a.scheduledFor));
    if (historyFilter === 'all') return sorted;
    return sorted.filter((entry) => entry.status === 'pending' || entry.status === 'snoozed');
  }, [history, historyFilter]);

  const handleRequestPermission = async () => {
    setBusy(true);
    setTestResult(null);
    try {
      const state = await requestNotificationPermission();
      const copy = STATUS_COPY[state] ?? STATUS_COPY.unsupported;
      setTestResult({ ok: state === 'granted', message: copy.detail });
    } finally {
      setBusy(false);
    }
  };

  const handleTest = async () => {
    setBusy(true);
    try {
      setTestResult(await sendTestNotification());
    } finally {
      setBusy(false);
    }
  };

  const handleOpenSettings = () => {
    const result = openDeviceNotificationSettings();
    setSettingsNotice(result.message);
    setTestResult(result.ok ? { ok: true, message: result.message } : { ok: false, message: result.message });
  };

  if (!isOpen) return null;

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
        aria-label="Notification settings"
        style={{
          width: '100%',
          maxWidth: 680,
          maxHeight: '92vh',
          overflowY: 'auto',
          backgroundColor: '#0F172A',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          border: '1px solid rgba(148, 163, 184, 0.18)',
          padding: '16px 18px 30px 18px',
          boxShadow: '0 -12px 44px rgba(0, 0, 0, 0.7)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
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
              <Bell size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 800, color: '#f8fafc', margin: 0 }}>Notifications</h2>
              <p style={{ fontSize: 11, color: '#94a3b8', margin: '2px 0 0 0' }}>
                Reminder alerts and advance warnings
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close notification settings"
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

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Master + status */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {settings.enabled ? <BellRing size={17} color="#818cf8" /> : <BellOff size={17} color="#64748b" />}
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#e2e8f0' }}>Reminder notifications</div>
                  <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 1 }}>
                    {settings.enabled ? 'Enabled' : 'All reminder notifications are off'}
                  </div>
                </div>
              </div>
              <button
                type="button"
                aria-pressed={settings.enabled}
                onClick={() => onChange({ ...settings, enabled: !settings.enabled })}
                style={{
                  flexShrink: 0,
                  padding: '7px 14px',
                  borderRadius: 999,
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 700,
                  backgroundColor: settings.enabled ? '#6366f1' : 'rgba(148, 163, 184, 0.15)',
                  color: settings.enabled ? '#ffffff' : '#94a3b8',
                }}
              >
                {settings.enabled ? 'On' : 'Off'}
              </button>
            </div>

            {/* Permission status */}
            <div
              style={{
                marginTop: 12,
                padding: '10px 12px',
                borderRadius: 12,
                backgroundColor: 'rgba(2, 6, 23, 0.5)',
                border: `1px solid ${permissionCopy.color}33`,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ShieldCheck size={14} color={permissionCopy.color} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: permissionCopy.color }}>
                  Permission: {permissionCopy.label}
                </span>
              </div>
              <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4, lineHeight: 1.5 }}>
                {permissionCopy.detail}
                {engine.platform === 'android-native'
                  ? ' Background delivery is available on Android.'
                  : engine.supported
                    ? ' Notifications are delivered while MindMesh is open; anything that comes due while it is closed is caught up afterwards.'
                    : ''}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                <button type="button" style={secondaryButton} disabled={busy} onClick={handleTest}>
                  {busy ? <Loader2 size={13} /> : <Send size={13} />} Test Notification
                </button>
                <button type="button" style={secondaryButton} disabled={busy} onClick={handleOpenSettings}>
                  <ExternalLink size={13} /> Open Device Notification Settings
                </button>
                {engine.permission !== 'granted' && engine.supported && (
                  <button
                    type="button"
                    style={{ ...secondaryButton, color: '#c7d2fe', borderColor: 'rgba(99, 102, 241, 0.4)' }}
                    disabled={busy}
                    onClick={handleRequestPermission}
                  >
                    <Bell size={13} /> Allow notifications
                  </button>
                )}
              </div>

              {testResult && (
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 11.5,
                    color: testResult.ok ? '#34d399' : '#f59e0b',
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 6,
                  }}
                >
                  {testResult.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}
                  <span>{testResult.message}</span>
                </div>
              )}
              {settingsNotice && !testResult && (
                <div style={{ marginTop: 8, fontSize: 11.5, color: '#94a3b8' }}>{settingsNotice}</div>
              )}
            </div>

            {/* Counts */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 12, fontSize: 12 }}>
              <span style={{ color: '#cbd5e1' }}>
                Scheduled: <strong style={{ color: '#818cf8' }}>{pending}</strong>
              </span>
              <span style={{ color: '#cbd5e1' }}>
                Missed: <strong style={{ color: missed > 0 ? '#ef4444' : '#64748b' }}>{missed}</strong>
              </span>
              <span style={{ color: '#cbd5e1' }}>
                Next:{' '}
                <strong style={{ color: '#e2e8f0' }}>
                  {engine.nextFireAt ? new Date(engine.nextFireAt).toLocaleString() : 'nothing scheduled'}
                </strong>
              </span>
            </div>
            {engine.lastError && (
              <div style={{ marginTop: 8, fontSize: 11.5, color: '#f59e0b' }}>{engine.lastError}</div>
            )}
            <button
              type="button"
              style={{ ...secondaryButton, marginTop: 10, padding: '5px 10px' }}
              onClick={onOpenDiagnostics}
            >
              Open Diagnostics for notification checks
            </button>
          </div>

          {/* Defaults */}
          <div style={cardStyle}>
            <div style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8', marginBottom: 4 }}>
              DEFAULTS FOR NEW REMINDERS
            </div>

            <ToggleRow
              label="Enable notifications on new reminders"
              checked={settings.defaultReminderNotifications}
              onChange={(value) => onChange({ ...settings, defaultReminderNotifications: value })}
            />
            <ToggleRow
              label="Notify at the exact due time by default"
              checked={settings.defaultNotifyAtDueTime}
              onChange={(value) => onChange({ ...settings, defaultNotifyAtDueTime: value })}
            />
            <ToggleRow
              label="Notification sound"
              hint="Where the platform supports it"
              checked={settings.sound}
              onChange={(value) => onChange({ ...settings, sound: value })}
            />
            <ToggleRow
              label="Vibration"
              hint="Where the platform supports it"
              checked={settings.vibration}
              onChange={(value) => onChange({ ...settings, vibration: value })}
            />
            <ToggleRow
              label="Notify about completed reminders"
              hint="Off by default so completing something silences its remaining alerts"
              checked={settings.showCompletedNotifications}
              onChange={(value) => onChange({ ...settings, showCompletedNotifications: value })}
            />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginTop: 10 }}>
              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                  DEFAULT ADVANCE NOTIFICATION
                </label>
                <select
                  aria-label="Default advance notification"
                  value={settings.defaultAdvanceMinutes}
                  onChange={(e) => onChange({ ...settings, defaultAdvanceMinutes: Number(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    fontSize: 12,
                    outline: 'none',
                  }}
                >
                  <option value={0}>No advance notification</option>
                  {ADVANCE_PRESETS.map((preset) => (
                    <option key={preset.minutes} value={preset.minutes}>
                      {formatAdvanceLabel(preset.minutes)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                  DEFAULT SNOOZE DURATION
                </label>
                <select
                  aria-label="Default snooze duration"
                  value={settings.defaultSnoozeMinutes}
                  onChange={(e) => onChange({ ...settings, defaultSnoozeMinutes: Number(e.target.value) })}
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    fontSize: 12,
                    outline: 'none',
                  }}
                >
                  {SNOOZE_PRESETS.map((preset) => (
                    <option key={preset.minutes} value={preset.minutes}>
                      {formatSnoozeLabel(preset.minutes)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                  MISSED AFTER (MINUTES)
                </label>
                <input
                  type="number"
                  aria-label="Missed notification grace minutes"
                  min={0}
                  max={1440}
                  value={settings.missedGraceMinutes}
                  onChange={(e) =>
                    onChange({
                      ...settings,
                      missedGraceMinutes: Math.max(0, Math.min(1440, Number(e.target.value) || 0)),
                    })
                  }
                  style={{
                    width: '100%',
                    padding: '8px 10px',
                    borderRadius: 8,
                    backgroundColor: '#1E293B',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
              </div>
            </div>

            <div style={{ fontSize: 11, color: '#64748b', marginTop: 8, lineHeight: 1.5 }}>
              When MindMesh is closed at a reminder's time, notifications due within this window fire as soon as it
              reopens. Anything older is recorded as missed.
            </div>
          </div>

          {/* History */}
          <div style={cardStyle}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <History size={14} color="#818cf8" />
                <span style={{ fontSize: 12, fontWeight: 700, color: '#94a3b8' }}>NOTIFICATION HISTORY</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => setHistoryFilter('upcoming')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    backgroundColor: historyFilter === 'upcoming' ? '#6366f1' : 'rgba(148, 163, 184, 0.12)',
                    color: historyFilter === 'upcoming' ? '#ffffff' : '#94a3b8',
                  }}
                >
                  Upcoming
                </button>
                <button
                  type="button"
                  onClick={() => setHistoryFilter('all')}
                  style={{
                    padding: '4px 10px',
                    borderRadius: 999,
                    border: 'none',
                    fontSize: 11,
                    fontWeight: 700,
                    cursor: 'pointer',
                    backgroundColor: historyFilter === 'all' ? '#6366f1' : 'rgba(148, 163, 184, 0.12)',
                    color: historyFilter === 'all' ? '#ffffff' : '#94a3b8',
                  }}
                >
                  All
                </button>
              </div>
            </div>

            {visibleHistory.length === 0 ? (
              <div style={{ fontSize: 12, color: '#64748b' }}>
                {historyFilter === 'upcoming'
                  ? 'Nothing scheduled yet. Enable notifications on a reminder with a due date.'
                  : 'No notification history yet.'}
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 260, overflowY: 'auto' }}>
                {visibleHistory.map((entry) => (
                  <div
                    key={entry.id}
                    style={{
                      padding: '8px 10px',
                      borderRadius: 10,
                      backgroundColor: 'rgba(2, 6, 23, 0.5)',
                      border: '1px solid rgba(148, 163, 184, 0.12)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                      <span
                        style={{
                          fontSize: 12,
                          fontWeight: 600,
                          color: '#e2e8f0',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {entry.reminderTitle}
                      </span>
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 800,
                          color: HISTORY_STATUS_COLOR[entry.status],
                          textTransform: 'uppercase',
                          flexShrink: 0,
                        }}
                      >
                        {entry.status}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3, fontSize: 10.5, color: '#94a3b8' }}>
                      <Clock size={10} />
                      <span>{new Date(entry.scheduledFor).toLocaleString()}</span>
                      <span>·</span>
                      <span>{entry.offsetMinutes === 0 ? 'at due time' : formatAdvanceLabel(entry.offsetMinutes)}</span>
                    </div>
                    {entry.error && <div style={{ fontSize: 10.5, color: '#f59e0b', marginTop: 3 }}>{entry.error}</div>}

                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        style={{ ...secondaryButton, padding: '4px 9px', fontSize: 11 }}
                        onClick={() => onOpenReminder(entry.reminderId)}
                      >
                        Open reminder
                      </button>
                      {(entry.status === 'pending' || entry.status === 'fired' || entry.status === 'missed') && (
                        <select
                          aria-label={`Snooze ${entry.reminderTitle}`}
                          value=""
                          onChange={(e) => {
                            const minutes = Number(e.target.value);
                            if (!Number.isFinite(minutes) || minutes <= 0) return;
                            snoozeNotification(entry.id, minutes);
                            onChangeHistory([...history]);
                          }}
                          style={{
                            padding: '4px 8px',
                            borderRadius: 9,
                            backgroundColor: 'rgba(148, 163, 184, 0.08)',
                            border: '1px solid rgba(148, 163, 184, 0.25)',
                            color: '#f59e0b',
                            fontSize: 11,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          <option value="">Snooze…</option>
                          {SNOOZE_PRESETS.map((preset) => (
                            <option key={preset.minutes} value={preset.minutes}>
                              {preset.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {history.length > 0 && (
              <button
                type="button"
                style={{ ...secondaryButton, marginTop: 10, color: '#f87171', borderColor: 'rgba(248, 113, 113, 0.3)' }}
                onClick={() => {
                  if (confirm('Clear notification history? Scheduled notifications are recalculated from your reminders.')) {
                    onChangeHistory([]);
                  }
                }}
              >
                <Trash2 size={13} /> Clear history
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default NotificationsModal;
