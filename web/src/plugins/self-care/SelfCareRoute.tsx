/**
 * Self Care route — the plugin's full UI.
 *
 * Onboarding (opt-in, no surprises), check-in list, check-in editor (message
 * variants, tone, preview, weekdays/times/frequency, quiet hours, limits,
 * pause/resume), Done/Snooze/Skip responses, neutral history, privacy and
 * lock-screen settings. Everything works offline; nothing leaves the device.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { PluginRouteProps } from '../core/types';
import {
  SELF_CARE_ACTION_EVENT,
  SELF_CARE_CHANGED_EVENT,
  SELF_CARE_SCHEDULE_HORIZON_DAYS,
  attachSelfCareActionListener,
  cancelAllSelfCareAlarms,
  loadSelfCareState,
  reconcileSelfCare,
  saveSelfCareState,
} from '../../services/selfCare';
import { getNativeBridge } from '../../services/notifications';
import {
  SELF_CARE_CATEGORY_LABELS,
  SELF_CARE_TEMPLATES,
  SELF_CARE_TONE_LABELS,
  checkInDisplayLabel,
  defaultSelfCareSettings,
  pickVariant,
  type SelfCareCategory,
  type SelfCareCheckIn,
  type SelfCareHistoryResult,
  type SelfCareMessageVariant,
  type SelfCareState,
  type SelfCareTone,
} from '../../types/selfCare';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const RESULT_LABELS: Record<SelfCareHistoryResult, string> = {
  done: 'Done 💛',
  snoozed: 'Snoozed',
  skipped: 'Skipped — no worries',
  missed: 'Missed — happens 💛',
  opened: 'Opened',
};

const card: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.08)',
  borderRadius: 12,
  padding: 12,
};

const inputStyle: React.CSSProperties = {
  background: 'rgba(0,0,0,0.35)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  color: 'inherit',
  padding: '6px 8px',
  fontSize: 13,
};

const buttonStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.14)',
  borderRadius: 999,
  background: 'rgba(255,255,255,0.06)',
  color: 'inherit',
  padding: '6px 12px',
  fontSize: 13,
  cursor: 'pointer',
};

function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

function emptyCheckIn(): SelfCareCheckIn {
  const now = new Date().toISOString();
  return {
    id: newId('checkin'),
    title: 'Eat check-in',
    category: 'eat',
    enabled: true,
    paused: false,
    defaultTone: 'gentle',
    variants: [],
    schedule: { weekdays: [1, 2, 3, 4, 5], times: ['09:00', '13:00'], everyNDays: 1 },
    snoozeMinutes: 20,
    createdAt: now,
    updatedAt: now,
  };
}

function scheduleSummary(checkIn: SelfCareCheckIn): string {
  const days = checkIn.schedule.weekdays.map((d) => WEEKDAY_LABELS[d]).join(' ');
  const times = checkIn.schedule.times.join(', ');
  const every = checkIn.schedule.everyNDays > 1 ? ` · every ${checkIn.schedule.everyNDays} days` : '';
  return `${days} · ${times}${every}`;
}

export const SelfCareRoute: React.FC<PluginRouteProps> = ({ context }) => {
  const [state, setState] = useState<SelfCareState>(() => loadSelfCareState());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SelfCareCheckIn | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [permission, setPermission] = useState<string>(() => {
    try {
      return getNativeBridge()?.getPermissionState() ?? 'unknown';
    } catch {
      return 'unknown';
    }
  });

  const refresh = useCallback(() => setState(loadSelfCareState()), []);

  useEffect(() => {
    const detach = attachSelfCareActionListener();
    const onChanged = () => refresh();
    const onAction = (event: Event) => {
      const detail = (event as CustomEvent<{ id: string; action: string }>).detail;
      if (detail) refresh();
    };
    window.addEventListener(SELF_CARE_CHANGED_EVENT, onChanged);
    window.addEventListener(SELF_CARE_ACTION_EVENT, onAction);
    return () => {
      detach();
      window.removeEventListener(SELF_CARE_CHANGED_EVENT, onChanged);
      window.removeEventListener(SELF_CARE_ACTION_EVENT, onAction);
    };
  }, [refresh]);

  const persist = useCallback(
    (next: SelfCareState, logMessage: string) => {
      saveSelfCareState(next);
      try {
        reconcileSelfCare();
      } catch {
        /* a rejected schedule is retried on the next reconcile */
      }
      // Mirror ids (never message text) into the scheduler store for diagnostics.
      try {
        context.scheduler.clear();
        for (const id of loadSelfCareState().scheduledIds) {
          context.scheduler.schedule({ id, runAt: new Date().toISOString() });
        }
      } catch {
        /* diagnostics mirroring must never break the UI */
      }
      context.diagnostics.log('info', logMessage, {
        checkIns: next.checkIns.length,
        scheduled: loadSelfCareState().scheduledIds.length,
      });
      refresh();
    },
    [context, refresh]
  );

  const weekDone = useMemo(() => {
    const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return state.history.filter((h) => h.result === 'done' && new Date(h.at).getTime() >= weekAgo).length;
  }, [state.history]);

  const startOnboarding = () => {
    persist(
      { ...state, settings: { ...state.settings, onboarded: true } },
      'Self Care onboarding completed'
    );
  };

  const togglePausedAll = () => {
    const pausedAll = !state.settings.pausedAll;
    if (pausedAll) cancelAllSelfCareAlarms();
    persist({ ...state, settings: { ...state.settings, pausedAll } }, pausedAll ? 'Self Care paused' : 'Self Care resumed');
  };

  const deleteCheckIn = (id: string) => {
    if (!window.confirm('Delete this check-in and its schedule? Past history entries are kept.')) return;
    persist(
      { ...state, checkIns: state.checkIns.filter((c) => c.id !== id) },
      'Self Care check-in deleted'
    );
  };

  const saveDraft = () => {
    if (!draft) return;
    if (draft.schedule.weekdays.length === 0 || draft.schedule.times.length === 0) {
      window.alert('Pick at least one weekday and one time so the check-in knows when to appear.');
      return;
    }
    const cleaned: SelfCareCheckIn = {
      ...draft,
      title: draft.title.trim() || `${checkInDisplayLabel(draft)} check-in`,
      updatedAt: new Date().toISOString(),
    };
    const exists = state.checkIns.some((c) => c.id === cleaned.id);
    persist(
      {
        ...state,
        checkIns: exists
          ? state.checkIns.map((c) => (c.id === cleaned.id ? cleaned : c))
          : [...state.checkIns, cleaned],
      },
      exists ? 'Self Care check-in updated' : 'Self Care check-in created'
    );
    setDraft(null);
    setEditingId(null);
  };

  if (!state.settings.onboarded) {
    return (
      <div style={{ padding: 16, maxWidth: 640, display: 'flex', flexDirection: 'column', gap: 12 }} role="main" aria-label="Self Care onboarding">
        <h2 style={{ margin: 0 }}>Self Care 💛</h2>
        <div style={card}>
          <p style={{ marginTop: 0 }}>
            Self Care sends <strong>gentle check-ins</strong> — to eat, drink water, rest,
            stretch, get outdoors, wind down, or anything personal — as real phone
            notifications, even when MindMesh is closed.
          </p>
          <ul style={{ paddingLeft: 20, marginBottom: 0 }}>
            <li>Nothing is scheduled until <strong>you</strong> create a check-in.</li>
            <li>Messages are encouraging and brief — never shaming, never medical advice.</li>
            <li>Pause or delete any time. Pausing keeps everything; deleting a check-in keeps past history.</li>
            <li>Works fully offline. Nothing about your self care ever leaves this device.</li>
          </ul>
        </div>
        <button type="button" style={buttonStyle} onClick={startOnboarding}>
          Get started
        </button>
      </div>
    );
  }

  return (
    <div style={{ padding: 16, maxWidth: 720, display: 'flex', flexDirection: 'column', gap: 12 }} role="main" aria-label="Self Care">
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <h2 style={{ margin: 0, flex: 1 }}>Self Care 💛</h2>
        <span aria-label="Notification permission">Notifications: {permission}</span>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            try {
              getNativeBridge()?.requestPermission();
              setTimeout(() => {
                try {
                  setPermission(getNativeBridge()?.getPermissionState() ?? 'unknown');
                } catch {
                  /* ignore */
                }
              }, 1000);
            } catch {
              /* ignore */
            }
          }}
        >
          Enable notifications
        </button>
        <button type="button" style={buttonStyle} onClick={togglePausedAll} aria-pressed={state.settings.pausedAll}>
          {state.settings.pausedAll ? 'Resume all' : 'Pause all'}
        </button>
      </div>

      {state.settings.pausedAll && (
        <div style={card} role="status">
          Everything is paused. No Self Care notifications will fire — your check-ins and history are kept.
        </div>
      )}

      <div style={card}>
        <strong>
          {weekDone} gentle check-in{weekDone === 1 ? '' : 's'} completed this week
        </strong>
        <div style={{ fontSize: 12, opacity: 0.75 }}>
          {state.scheduledIds.length} notification{state.scheduledIds.length === 1 ? '' : 's'} scheduled
          (next {SELF_CARE_SCHEDULE_HORIZON_DAYS} days) · {state.checkIns.filter((c) => c.enabled && !c.paused).length} active check-in{state.checkIns.filter((c) => c.enabled && !c.paused).length === 1 ? '' : 's'}
        </div>
      </div>

      {state.checkIns.map((checkIn) => (
        <div key={checkIn.id} style={card}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <strong style={{ flex: 1 }}>{checkIn.title}</strong>
            <span style={{ fontSize: 12, opacity: 0.75 }}>{SELF_CARE_CATEGORY_LABELS[checkIn.category]}</span>
          </div>
          <div style={{ fontSize: 12, opacity: 0.8, margin: '4px 0' }}>{scheduleSummary(checkIn)}</div>
          <div style={{ fontSize: 13, fontStyle: 'italic', opacity: 0.9 }}>
            Preview: “{pickVariant(checkIn, 0)}”
          </div>
          <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              style={buttonStyle}
              aria-pressed={checkIn.enabled}
              onClick={() => {
                persist(
                  { ...state, checkIns: state.checkIns.map((c) => (c.id === checkIn.id ? { ...c, enabled: !c.enabled } : c)) },
                  checkIn.enabled ? 'Self Care check-in disabled' : 'Self Care check-in enabled'
                );
              }}
            >
              {checkIn.enabled ? 'Disable' : 'Enable'}
            </button>
            <button
              type="button"
              style={buttonStyle}
              aria-pressed={checkIn.paused}
              onClick={() => {
                persist(
                  { ...state, checkIns: state.checkIns.map((c) => (c.id === checkIn.id ? { ...c, paused: !c.paused } : c)) },
                  checkIn.paused ? 'Self Care check-in resumed' : 'Self Care check-in paused'
                );
              }}
            >
              {checkIn.paused ? 'Resume' : 'Pause'}
            </button>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                setEditingId(checkIn.id);
                setDraft({ ...checkIn, schedule: { ...checkIn.schedule, weekdays: [...checkIn.schedule.weekdays], times: [...checkIn.schedule.times] }, variants: checkIn.variants.map((v) => ({ ...v })) });
              }}
            >
              Edit
            </button>
            <button type="button" style={buttonStyle} onClick={() => deleteCheckIn(checkIn.id)}>
              Delete
            </button>
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button
          type="button"
          style={buttonStyle}
          onClick={() => {
            setEditingId('new');
            setDraft(emptyCheckIn());
          }}
        >
          + New check-in
        </button>
        <button type="button" style={buttonStyle} onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory}>
          {showHistory ? 'Hide history' : 'Show history'}
        </button>
      </div>

      {editingId !== null && draft !== null && (
        <CheckInEditor
          draft={draft}
          onChange={setDraft}
          onSave={saveDraft}
          onCancel={() => {
            setDraft(null);
            setEditingId(null);
          }}
        />
      )}

      <div style={card}>
        <strong>Quiet hours &amp; limits</strong>
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <label>
            <input
              type="checkbox"
              checked={state.settings.quietHours.enabled}
              onChange={(e) => persist({ ...state, settings: { ...state.settings, quietHours: { ...state.settings.quietHours, enabled: e.target.checked } } }, 'Self Care quiet hours updated')}
            />{' '}
            Quiet hours
          </label>
          <label>
            From{' '}
            <input
              type="time"
              aria-label="Quiet hours start"
              style={inputStyle}
              value={state.settings.quietHours.start}
              onChange={(e) => persist({ ...state, settings: { ...state.settings, quietHours: { ...state.settings.quietHours, start: e.target.value } } }, 'Self Care quiet hours updated')}
            />
          </label>
          <label>
            To{' '}
            <input
              type="time"
              aria-label="Quiet hours end"
              style={inputStyle}
              value={state.settings.quietHours.end}
              onChange={(e) => persist({ ...state, settings: { ...state.settings, quietHours: { ...state.settings.quietHours, end: e.target.value } } }, 'Self Care quiet hours updated')}
            />
          </label>
          <label>
            Max per day{' '}
            <input
              type="number"
              aria-label="Maximum notifications per day"
              style={{ ...inputStyle, width: 64 }}
              min={1}
              max={24}
              value={state.settings.maxPerDay}
              onChange={(e) => persist({ ...state, settings: { ...state.settings, maxPerDay: Math.min(24, Math.max(1, Number(e.target.value) || 1)) } }, 'Self Care daily limit updated')}
            />
          </label>
          <label>
            Snooze default is per check-in (minutes).
          </label>
        </div>
        <div style={{ marginTop: 8 }}>
          <label>
            <input
              type="checkbox"
              checked={state.settings.privateLockScreen}
              onChange={(e) => persist({ ...state, settings: { ...state.settings, privateLockScreen: e.target.checked } }, 'Self Care privacy updated')}
            />{' '}
            Keep message text off the lock screen (show a generic line instead; full text stays in the app)
          </label>
        </div>
      </div>

      {showHistory && (
        <div style={card}>
          <strong>Recent check-ins</strong>
          {state.history.length === 0 && <div style={{ fontSize: 13, opacity: 0.75 }}>Nothing here yet — history appears as you respond to check-ins.</div>}
          <ul style={{ paddingLeft: 18, marginBottom: 0 }}>
            {[...state.history].reverse().slice(0, 30).map((entry) => {
              const checkIn = state.checkIns.find((c) => c.id === entry.checkInId);
              return (
                <li key={entry.id} style={{ fontSize: 13 }}>
                  {checkIn ? checkIn.title : 'A check-in'} · {RESULT_LABELS[entry.result]} ·{' '}
                  {new Date(entry.at).toLocaleString()}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
};

function CheckInEditor({
  draft,
  onChange,
  onSave,
  onCancel,
}: {
  draft: SelfCareCheckIn;
  onChange: (next: SelfCareCheckIn) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const [newTime, setNewTime] = useState('09:00');
  const [newVariant, setNewVariant] = useState('');

  const set = (patch: Partial<SelfCareCheckIn>) => onChange({ ...draft, ...patch });

  const toggleWeekday = (day: number) => {
    const weekdays = draft.schedule.weekdays.includes(day)
      ? draft.schedule.weekdays.filter((d) => d !== day)
      : [...draft.schedule.weekdays, day].sort();
    set({ schedule: { ...draft.schedule, weekdays } });
  };

  const addVariant = () => {
    const text = newVariant.trim();
    if (!text) return;
    const variant: SelfCareMessageVariant = { id: newId('variant'), tone: draft.defaultTone, text: text.slice(0, 280) };
    set({ variants: [...draft.variants, variant].slice(0, 12) });
    setNewVariant('');
  };

  const suggestions =
    draft.category === 'custom' ? [] : SELF_CARE_TEMPLATES[draft.category as keyof typeof SELF_CARE_TEMPLATES] ?? [];

  return (
    <div style={{ ...card, borderColor: 'rgba(244,114,182,0.4)' }} role="dialog" aria-label="Check-in editor">
      <strong>Check-in editor</strong>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
        <label>
          Title{' '}
          <input aria-label="Check-in title" style={{ ...inputStyle, width: '100%' }} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label>
          Care type{' '}
          <select
            aria-label="Care type"
            style={inputStyle}
            value={draft.category}
            onChange={(e) => {
              const category = e.target.value as SelfCareCategory;
              set({ category, title: category === 'custom' ? draft.title : `${SELF_CARE_CATEGORY_LABELS[category]} check-in` });
            }}
          >
            {(Object.keys(SELF_CARE_CATEGORY_LABELS) as SelfCareCategory[]).map((c) => (
              <option key={c} value={c}>
                {SELF_CARE_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </label>
        {draft.category === 'custom' && (
          <label>
            Your care type{' '}
            <input aria-label="Custom care type" style={{ ...inputStyle, width: '100%' }} placeholder="e.g. Take medication, Call mum" value={draft.customLabel ?? ''} onChange={(e) => set({ customLabel: e.target.value })} />
          </label>
        )}
        <label>
          Tone{' '}
          <select aria-label="Tone" style={inputStyle} value={draft.defaultTone} onChange={(e) => set({ defaultTone: e.target.value as SelfCareTone })}>
            {(Object.keys(SELF_CARE_TONE_LABELS) as SelfCareTone[]).map((t) => (
              <option key={t} value={t}>
                {SELF_CARE_TONE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        {draft.defaultTone === 'custom' && (
          <label>
            How should messages sound?{' '}
            <input aria-label="Custom tone note" style={{ ...inputStyle, width: '100%' }} placeholder="e.g. like a calm friend, short and warm" value={draft.customToneNote ?? ''} onChange={(e) => set({ customToneNote: e.target.value })} />
          </label>
        )}

        <div>
          <div style={{ fontSize: 13, marginBottom: 4 }}>Message variants (shown in rotation; first is previewed)</div>
          {draft.variants.length === 0 && (
            <div style={{ fontSize: 13, opacity: 0.75 }}>
              No custom messages — built-in gentle messages will be used. Suggestions:
              <ul style={{ paddingLeft: 18 }}>
                {suggestions.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <ul style={{ paddingLeft: 18 }}>
            {draft.variants.map((v) => (
              <li key={v.id} style={{ fontSize: 13 }}>
                {v.text}{' '}
                <button
                  type="button"
                  style={{ ...buttonStyle, padding: '2px 8px', fontSize: 12 }}
                  onClick={() => set({ variants: draft.variants.filter((x) => x.id !== v.id) })}
                  aria-label={`Remove variant ${v.text.slice(0, 20)}`}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 6 }}>
            <input aria-label="New message variant" style={{ ...inputStyle, flex: 1 }} placeholder="Write your own gentle message…" value={newVariant} onChange={(e) => setNewVariant(e.target.value)} />
            <button type="button" style={buttonStyle} onClick={addVariant}>
              Add
            </button>
          </div>
          {suggestions.length > 0 && (
            <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
              {suggestions.map((s) => (
                <button
                  key={s}
                  type="button"
                  style={{ ...buttonStyle, fontSize: 12 }}
                  onClick={() => set({ variants: [...draft.variants, { id: newId('variant'), tone: draft.defaultTone, text: s }].slice(0, 12) })}
                >
                  Use suggestion
                </button>
              ))}
            </div>
          )}
          <div style={{ fontSize: 13, fontStyle: 'italic', marginTop: 6 }}>
            Preview: “{pickVariant({ ...draft, variants: draft.variants.length > 0 ? draft.variants : [{ id: 'x', tone: draft.defaultTone, text: suggestions[0] ?? 'Hey 💛 just checking in.' }] }, 0)}”
          </div>
        </div>

        <fieldset style={{ border: '1px solid rgba(255,255,255,0.12)', borderRadius: 8 }}>
          <legend>Weekdays</legend>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {WEEKDAY_LABELS.map((label, day) => (
              <label key={day} style={{ fontSize: 13 }}>
                <input type="checkbox" checked={draft.schedule.weekdays.includes(day)} onChange={() => toggleWeekday(day)} /> {label}
              </label>
            ))}
          </div>
        </fieldset>

        <div>
          <div style={{ fontSize: 13 }}>Times: {draft.schedule.times.join(', ') || 'none yet'}</div>
          <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
            <input aria-label="New time" type="time" style={inputStyle} value={newTime} onChange={(e) => setNewTime(e.target.value)} />
            <button
              type="button"
              style={buttonStyle}
              onClick={() => {
                if (!newTime || draft.schedule.times.includes(newTime)) return;
                set({ schedule: { ...draft.schedule, times: [...draft.schedule.times, newTime].sort().slice(0, 8) } });
              }}
            >
              Add time
            </button>
            {draft.schedule.times.map((t) => (
              <button key={t} type="button" style={{ ...buttonStyle, fontSize: 12 }} onClick={() => set({ schedule: { ...draft.schedule, times: draft.schedule.times.filter((x) => x !== t) } })} aria-label={`Remove time ${t}`}>
                {t} ✕
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label>
            Repeat every{' '}
            <input aria-label="Repeat every N days" type="number" style={{ ...inputStyle, width: 64 }} min={1} max={30} value={draft.schedule.everyNDays} onChange={(e) => set({ schedule: { ...draft.schedule, everyNDays: Math.min(30, Math.max(1, Number(e.target.value) || 1)) } })} />{' '}
            day(s)
          </label>
          <label>
            Snooze{' '}
            <input aria-label="Snooze minutes" type="number" style={{ ...inputStyle, width: 64 }} min={5} max={180} value={draft.snoozeMinutes} onChange={(e) => set({ snoozeMinutes: Math.min(180, Math.max(5, Number(e.target.value) || 20)) })} />{' '}
            min
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" style={buttonStyle} onClick={onSave}>
            Save check-in
          </button>
          <button type="button" style={buttonStyle} onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export function defaultSelfCareRouteSettings() {
  return defaultSelfCareSettings();
}
