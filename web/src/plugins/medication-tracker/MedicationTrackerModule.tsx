import React, { useMemo, useState, useSyncExternalStore } from 'react';
import {
  Pill,
  Plus,
  Check,
  X,
  Undo2,
  History as HistoryIcon,
  Settings as SettingsIcon,
  CalendarDays,
  Trash2,
  Pencil,
  BellRing,
  AlertTriangle,
  BarChart3,
  Package,
} from 'lucide-react';
import { KIND_LABELS, type MedicationItem, type MedicationSchedule } from './model';
import {
  getState,
  subscribe,
  update,
} from './store';
import {
  describeSchedule,
  formatTime12,
  getAdherenceStats,
  getDosesForDay,
  getDoseStatus,
  getItemsWithStatus,
  getPrnTakenToday,
  getRecentDoses,
  logDose,
  deleteItem,
  deleteSchedule,
  saveItem,
  saveSchedule,
  setItemActive,
  setSupply,
  undoDose,
  updateSettings,
  type DoseDisplayStatus,
} from './logic';
import {
  ItemFormModal,
  PrnLogModal,
  ScheduleFormModal,
  SupplyFormModal,
} from './MedicationTrackerForms';
import { Button, Field, M, Panel, Row, StatusPill, TextInput, relativeDayLabel } from './MedicationTrackerUi';

type Tab = 'today' | 'items' | 'history' | 'summary' | 'settings';

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'today', label: 'Today', icon: <CalendarDays size={15} /> },
  { id: 'items', label: 'Medications', icon: <Pill size={15} /> },
  { id: 'history', label: 'History', icon: <HistoryIcon size={15} /> },
  { id: 'summary', label: 'Summary', icon: <BarChart3 size={15} /> },
  { id: 'settings', label: 'Settings', icon: <SettingsIcon size={15} /> },
];

const STATUS_ORDER: DoseDisplayStatus[] = ['due', 'upcoming', 'missed', 'taken', 'skipped'];

export interface MedicationTrackerModuleProps {
  appNotificationsEnabled: boolean;
}

export const MedicationTrackerModule: React.FC<MedicationTrackerModuleProps> = ({ appNotificationsEnabled }) => {
  const state = useSyncExternalStore(subscribe, getState);
  const [tab, setTab] = useState<Tab>('today');
  const [toast, setToast] = useState<string | null>(null);

  const [itemFormOpen, setItemFormOpen] = useState(false);
  const [itemFormInitial, setItemFormInitial] = useState<MedicationItem | undefined>();
  const [scheduleItem, setScheduleItem] = useState<MedicationItem | undefined>();
  const [scheduleInitial, setScheduleInitial] = useState<MedicationSchedule | undefined>();
  const [supplyItem, setSupplyItem] = useState<MedicationItem | undefined>();
  const [prnItem, setPrnItem] = useState<MedicationItem | undefined>();

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3000);
  };

  const todayDoses = useMemo(() => getDosesForDay(state), [state]);
  const sortedToday = useMemo(
    () =>
      [...todayDoses].sort((a, b) => {
        const diff = STATUS_ORDER.indexOf(getDoseStatus(a, state).status) - STATUS_ORDER.indexOf(getDoseStatus(b, state).status);
        return diff !== 0 ? diff : a.scheduledFor.localeCompare(b.scheduledFor);
      }),
    [todayDoses, state]
  );
  const itemsWithStatus = useMemo(() => getItemsWithStatus(state), [state]);
  const prnItems = useMemo(() => state.items.filter((item) => item.active && item.asNeeded), [state.items]);
  const recentDoses = useMemo(() => getRecentDoses(state, 200), [state]);
  const adherence7 = useMemo(() => getAdherenceStats(state, 7), [state]);
  const adherence30 = useMemo(() => getAdherenceStats(state, 30), [state]);
  const adherence90 = useMemo(() => getAdherenceStats(state, 90), [state]);

  const takenToday = useMemo(
    () => todayDoses.filter((occurrence) => getDoseStatus(occurrence, state).status === 'taken').length,
    [todayDoses, state]
  );

  const upcomingTimeline = useMemo(() => {
    const from = new Date();
    const to = new Date(from.getTime() + 14 * 24 * 60 * 60 * 1000);
    const occurrences = [] as ReturnType<typeof getDosesForDay>;
    const dayMs = 24 * 60 * 60 * 1000;
    for (let i = 0; i < 14; i += 1) {
      const day = new Date(from.getTime() + i * dayMs);
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
      if (start > to) break;
      occurrences.push(...getDosesForDay(state, start).filter((o) => Date.parse(o.scheduledFor) >= start.getTime() && Date.parse(o.scheduledFor) <= end.getTime()));
    }
    return occurrences;
  }, [state]);

  const openAddItem = () => {
    setItemFormInitial(undefined);
    setItemFormOpen(true);
  };

  return (
    <div
      className="mm-module"
      style={{
        flex: '1 1 0%', minHeight: 0, minWidth: 0, width: '100%', display: 'flex', flexDirection: 'column',
        gap: 14, padding: '14px 16px 90px', overflowY: 'auto',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', width: 38, height: 38, borderRadius: 12,
            background: M.accentSoft, border: `1px solid ${M.borderStrong}`, color: M.accent, flex: '0 0 auto',
          }}
        >
          <Pill size={20} />
        </span>
        <div style={{ minWidth: 0 }}>
          <h1 style={{ fontSize: 19, fontWeight: 800, color: '#f8fafc', lineHeight: 1.1 }}>Medication & Supplement Tracker</h1>
          <p style={{ fontSize: 12, color: M.muted }}>Track what you take, stay on schedule, and never guess your history.</p>
        </div>
        <div style={{ marginLeft: 'auto' }}>
          <Button onClick={openAddItem}>
            <Plus size={15} /> Add
          </Button>
        </div>
      </header>

      <nav style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setTab(item.id)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 999, fontSize: 13,
              fontWeight: 600, cursor: 'pointer',
              border: `1px solid ${tab === item.id ? M.accent : M.border}`,
              background: tab === item.id ? M.accentSoft : 'transparent',
              color: tab === item.id ? '#a7f3d0' : M.muted,
            }}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>

      {state.items.length === 0 ? (
        <Panel>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '24px 10px', textAlign: 'center' }}>
            <Pill size={30} color={M.accent} />
            <h3 style={{ fontSize: 15, fontWeight: 700, color: '#f1f5f9' }}>Nothing tracked yet</h3>
            <p style={{ fontSize: 13, color: M.muted, maxWidth: 400 }}>
              Add a medication, supplement, vitamin or prescribed treatment, set when you take it, and this plugin will remind you and
              keep a factual history.
            </p>
            <Button onClick={openAddItem}>
              <Plus size={15} /> Add your first entry
            </Button>
          </div>
        </Panel>
      ) : (
        <>
          {tab === 'today' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Stat label="Doses today" value={`${takenToday}/${todayDoses.length}`} hint="taken / scheduled" />
                <Stat label="7-day taken" value={`${Math.round(adherence7.rate * 100)}%`} hint={`${adherence7.taken} of ${adherence7.expected} doses`} />
                <Stat label="Missed (30 days)" value={String(adherence30.missed)} hint="factual count only" />
              </div>

              {itemsWithStatus.some((entry) => entry.lowSupply) && (
                <Notice tone="warn">
                  Low supply: {itemsWithStatus.filter((entry) => entry.lowSupply).map((entry) => entry.item.name).join(', ')}.
                </Notice>
              )}

              <Panel title="Today's doses">
                {sortedToday.length === 0 ? (
                  <p style={{ fontSize: 13, color: M.muted }}>No scheduled doses today.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {sortedToday.map((occurrence) => {
                      const info = getDoseStatus(occurrence, state);
                      const item = state.items.find((candidate) => candidate.id === occurrence.itemId);
                      if (!item) return null;
                      const logged = info.event && (info.event.status === 'taken' || info.event.status === 'skipped');
                      const label = item.doseAmount ? `${item.doseAmount}${item.doseUnit ? ` ${item.doseUnit}` : ''}` : '';
                      return (
                        <div
                          key={occurrence.key}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 12,
                            background: M.panelAlt, border: `1px solid ${info.status === 'due' ? 'rgba(251, 191, 36, 0.4)' : M.border}`,
                            flexWrap: 'wrap',
                          }}
                        >
                          <div style={{ minWidth: 62, textAlign: 'center', fontSize: 15, fontWeight: 800, color: '#f1f5f9' }}>
                            {formatTime12(occurrence.time)}
                          </div>
                          <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span style={{ width: 9, height: 9, borderRadius: '50%', background: item.color ?? M.accent }} />
                              <span style={{ fontSize: 14.5, fontWeight: 700, color: '#f1f5f9' }}>{item.name}</span>
                              <span style={{ fontSize: 11, color: M.faint }}>{KIND_LABELS[item.kind]}</span>
                            </div>
                            <div style={{ fontSize: 12, color: M.muted }}>{label || 'As entered'}</div>
                          </div>
                          <StatusPill status={info.status} />
                          <div style={{ display: 'flex', gap: 8 }}>
                            {logged ? (
                              <Button variant="ghost" onClick={() => update((prev) => undoDose(prev, info.event!.id))}>
                                <Undo2 size={14} /> Undo
                              </Button>
                            ) : (
                              <>
                                <Button
                                  onClick={() => {
                                    update((prev) => logDose(prev, { itemId: occurrence.itemId, scheduleId: occurrence.scheduleId, scheduledFor: occurrence.scheduledFor, status: 'taken' }));
                                    showToast(`Logged ${item.name}`);
                                  }}
                                >
                                  <Check size={14} /> Take
                                </Button>
                                <Button
                                  variant="ghost"
                                  onClick={() => {
                                    update((prev) => logDose(prev, { itemId: occurrence.itemId, scheduleId: occurrence.scheduleId, scheduledFor: occurrence.scheduledFor, status: 'skipped' }));
                                    showToast(`Skipped ${item.name}`);
                                  }}
                                >
                                  <X size={14} /> Skip
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              {prnItems.length > 0 && (
                <Panel title="As needed (PRN)">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {prnItems.map((item) => {
                      const taken = getPrnTakenToday(state, item.id);
                      const over = item.maxDaily !== undefined && taken > item.maxDaily;
                      return (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: M.panelAlt, border: `1px solid ${M.border}`, flexWrap: 'wrap' }}>
                          <span style={{ flex: '1 1 140px', fontSize: 13.5, color: '#e2e8f0' }}>{item.name}</span>
                          <span style={{ fontSize: 12, color: over ? '#fbbf24' : M.muted }}>
                            {taken} today{item.maxDaily !== undefined ? ` · your limit ${item.maxDaily}` : ''}
                          </span>
                          {over && <span style={{ fontSize: 11.5, color: '#fbbf24' }}>Above your entered limit</span>}
                          <Button variant="subtle" onClick={() => setPrnItem(item)}>
                            <Plus size={14} /> Log dose
                          </Button>
                        </div>
                      );
                    })}
                  </div>
                </Panel>
              )}
            </div>
          )}

          {tab === 'items' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {itemsWithStatus.map((entry) => {
                const { item, schedules, remaining, lowSupply, supply } = entry;
                return (
                  <Panel
                    key={item.id}
                    right={
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Button variant="ghost" onClick={() => { setItemFormInitial(item); setItemFormOpen(true); }}>
                          <Pencil size={14} /> Edit
                        </Button>
                        <Button variant="subtle" onClick={() => { setScheduleInitial(undefined); setScheduleItem(item); }}>
                          <Plus size={14} /> Schedule
                        </Button>
                        <Button variant="ghost" onClick={() => setSupplyItem(item)}>
                          <Package size={14} /> Supply
                        </Button>
                      </div>
                    }
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                      <span style={{ width: 12, height: 12, borderRadius: '50%', background: item.color ?? M.accent }} />
                      <h3 style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>{item.name}</h3>
                      {item.brandName && <span style={{ fontSize: 12, color: M.faint }}>{item.brandName}</span>}
                      <Tag>{KIND_LABELS[item.kind]}</Tag>
                      {item.asNeeded && <Tag>PRN</Tag>}
                      {item.strengthAmount !== undefined && (
                        <span style={{ fontSize: 12, color: M.muted }}>
                          {item.strengthAmount}
                          {item.strengthUnit ? ` ${item.strengthUnit}` : ''}
                        </span>
                      )}
                    </div>
                    {(item.instructions || item.reason) && (
                      <p style={{ fontSize: 12.5, color: M.muted, marginTop: 4 }}>
                        {item.instructions}
                        {item.instructions && item.reason ? ' · ' : ''}
                        {item.reason}
                      </p>
                    )}
                    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 8, fontSize: 12.5, color: M.muted }}>
                      {!item.asNeeded && (
                        <span>
                          Next dose: <strong style={{ color: '#e2e8f0' }}>{entry.nextDose ? `${relativeDayLabel(entry.nextDose.scheduledFor)} · ${formatTime12(entry.nextDose.time)}` : 'None scheduled'}</strong>
                        </span>
                      )}
                      {state.settings.supplyTracking && remaining !== undefined && (
                        <span style={{ color: lowSupply ? '#fbbf24' : M.muted }}>
                          Remaining: <strong>{remaining}{supply.unit ? ` ${supply.unit}` : ''}</strong>{lowSupply ? ' · refill soon' : ''}
                        </span>
                      )}
                    </div>
                    {!item.asNeeded && (
                      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {schedules.length === 0 && <p style={{ fontSize: 12.5, color: M.faint }}>No schedule — no reminders for this entry.</p>}
                        {schedules.map((schedule) => (
                          <div key={schedule.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: M.panelAlt, border: `1px solid ${M.border}`, flexWrap: 'wrap' }}>
                            <BellRing size={14} color={schedule.active ? M.accent : M.faint} />
                            <span style={{ flex: '1 1 160px', fontSize: 13, color: schedule.active ? '#e2e8f0' : M.faint }}>
                              {describeSchedule(schedule)}{!schedule.active ? ' · paused' : ''}
                            </span>
                            <Button variant="ghost" onClick={() => { setScheduleInitial(schedule); setScheduleItem(item); }} style={{ padding: '6px 10px' }} aria-label="Edit schedule">
                              <Pencil size={13} />
                            </Button>
                            <Button
                              variant="ghost"
                              onClick={() => {
                                if (window.confirm('Delete this schedule and its recorded doses?')) update((prev) => deleteSchedule(prev, schedule.id));
                              }}
                              style={{ padding: '6px 10px' }}
                              aria-label="Delete schedule"
                            >
                              <Trash2 size={13} />
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </Panel>
                );
              })}

              {state.items.some((item) => !item.active) && (
                <Panel title="No longer taking">
                  {state.items.filter((item) => !item.active).map((item) => (
                    <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', flexWrap: 'wrap' }}>
                      <span style={{ flex: 1, fontSize: 13, color: M.muted }}>{item.name}</span>
                      <Button variant="ghost" onClick={() => update((prev) => setItemActive(prev, item.id, true))} style={{ padding: '6px 10px' }}>
                        Reactivate
                      </Button>
                    </div>
                  ))}
                </Panel>
              )}
            </div>
          )}

          {tab === 'history' && (
            <Panel title="Dose history">
              {recentDoses.length === 0 ? (
                <p style={{ fontSize: 13, color: M.muted }}>Nothing logged yet. Doses you take or skip will appear here.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {recentDoses.map((event) => {
                    const item = state.items.find((candidate) => candidate.id === event.itemId);
                    const when = Date.parse(event.scheduledFor);
                    return (
                      <div key={event.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 10, background: M.panelAlt, border: `1px solid ${M.border}`, flexWrap: 'wrap' }}>
                        <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#e2e8f0' }}>{item?.name ?? 'Unknown'}</div>
                          <div style={{ fontSize: 11.5, color: M.faint }}>
                            {Number.isFinite(when) ? `${relativeDayLabel(event.scheduledFor)} · ${formatTime12(new Date(when).toTimeString().slice(0, 5))}` : '—'}
                            {event.takenAt ? ` · logged ${new Date(event.takenAt).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}` : ''}
                            {event.note ? ` · ${event.note}` : ''}
                          </div>
                        </div>
                        <StatusPill status={event.status === 'taken' ? 'taken' : event.status === 'skipped' ? 'skipped' : 'upcoming'} />
                        <Button variant="ghost" onClick={() => update((prev) => undoDose(prev, event.id))} style={{ padding: '6px 10px' }}>
                          <Undo2 size={13} /> Undo
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </Panel>
          )}

          {tab === 'summary' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Panel title="Factual adherence counts">
                <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                  <SummaryCard label="Last 7 days" stats={adherence7} />
                  <SummaryCard label="Last 30 days" stats={adherence30} />
                  <SummaryCard label="Last 90 days" stats={adherence90} />
                </div>
                <p style={{ fontSize: 11.5, color: M.faint, marginTop: 12 }}>
                  These are counts of your own logged entries only. They are not medical advice or an assessment of any treatment.
                </p>
              </Panel>

              <Panel title="Upcoming doses (14 days)">
                {upcomingTimeline.length === 0 ? (
                  <p style={{ fontSize: 13, color: M.muted }}>No scheduled doses in the next two weeks.</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
                    {upcomingTimeline.map((occurrence) => {
                      const item = state.items.find((candidate) => candidate.id === occurrence.itemId);
                      if (!item) return null;
                      return (
                        <div key={occurrence.key} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5 }}>
                          <span style={{ width: 84, color: M.faint }}>{relativeDayLabel(occurrence.scheduledFor)}</span>
                          <span style={{ width: 52, color: '#e2e8f0', fontWeight: 700 }}>{formatTime12(occurrence.time)}</span>
                          <span style={{ color: M.muted }}>{item.name}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </Panel>

              {state.settings.supplyTracking && (
                <Panel title="Refills">
                  {itemsWithStatus.filter((entry) => entry.remaining !== undefined).length === 0 ? (
                    <p style={{ fontSize: 13, color: M.muted }}>No supply recorded yet.</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {itemsWithStatus
                        .filter((entry) => entry.remaining !== undefined)
                        .map((entry) => (
                          <div key={entry.item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, flexWrap: 'wrap' }}>
                            <span style={{ flex: '1 1 140px', color: '#e2e8f0' }}>{entry.item.name}</span>
                            <span style={{ color: entry.lowSupply ? '#fbbf24' : M.muted }}>
                              {entry.remaining}
                              {entry.supply.unit ? ` ${entry.supply.unit}` : ''} left
                            </span>
                            {entry.supply.refillByDate && <span style={{ color: M.faint }}>refill by {entry.supply.refillByDate}</span>}
                            {entry.lowSupply && <span style={{ color: '#fbbf24' }}>low</span>}
                          </div>
                        ))}
                    </div>
                  )}
                </Panel>
              )}
            </div>
          )}

          {tab === 'settings' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Panel title="Reminders">
                {!appNotificationsEnabled && <Notice tone="error">App notifications are off globally, so dose reminders are paused.</Notice>}
                <SettingToggle label="Medication dose reminders" checked={state.settings.enabled} onChange={(v) => update((prev) => updateSettings(prev, { enabled: v }))} />
                <Row style={{ marginTop: 10 }}>
                  <Field label="Remind before (min)">
                    <TextInput type="number" min={0} value={state.settings.advanceMinutes} onChange={(e) => update((prev) => updateSettings(prev, { advanceMinutes: Math.max(0, Number(e.target.value) || 0) }))} />
                  </Field>
                  <Field label="Missed after (min)">
                    <TextInput type="number" min={0} value={state.settings.missAfterMinutes} onChange={(e) => update((prev) => updateSettings(prev, { missAfterMinutes: Math.max(0, Number(e.target.value) || 0) }))} />
                  </Field>
                  <Field label="Snooze (min)">
                    <TextInput type="number" min={1} value={state.settings.defaultSnoozeMinutes} onChange={(e) => update((prev) => updateSettings(prev, { defaultSnoozeMinutes: Math.max(1, Number(e.target.value) || 1) }))} />
                  </Field>
                  <Field label="Schedule ahead (days)">
                    <TextInput type="number" min={1} max={60} value={state.settings.horizonDays} onChange={(e) => update((prev) => updateSettings(prev, { horizonDays: Math.min(60, Math.max(1, Number(e.target.value) || 1)) }))} />
                  </Field>
                </Row>
              </Panel>

              <Panel title="Display & history">
                <SettingToggle label="Show completed doses" checked={state.settings.showCompletedDoses} onChange={(v) => update((prev) => updateSettings(prev, { showCompletedDoses: v }))} />
                <SettingToggle label="Show missed doses" checked={state.settings.showMissedDoses} onChange={(v) => update((prev) => updateSettings(prev, { showMissedDoses: v }))} />
                <SettingToggle label="Weekly factual summary" checked={state.settings.weeklySummary} onChange={(v) => update((prev) => updateSettings(prev, { weeklySummary: v }))} />
                <Row style={{ marginTop: 10 }}>
                  <Field label="Keep history for (days)" hint="0 = keep everything">
                    <TextInput type="number" min={0} value={state.settings.historyRetentionDays} onChange={(e) => update((prev) => updateSettings(prev, { historyRetentionDays: Math.max(0, Number(e.target.value) || 0) }))} />
                  </Field>
                </Row>
              </Panel>

              <Panel title="Supply & refills">
                <SettingToggle label="Enable supply tracking" checked={state.settings.supplyTracking} onChange={(v) => update((prev) => updateSettings(prev, { supplyTracking: v }))} />
                <SettingToggle label="Enable refill alerts" checked={state.settings.refillAlerts} onChange={(v) => update((prev) => updateSettings(prev, { refillAlerts: v }))} />
              </Panel>

              <Panel title="Privacy & safety">
                <p style={{ fontSize: 12.5, color: M.muted }}>
                  Everything here is stored on your device with the rest of MindMesh and travels in your backups. Nothing is uploaded.
                  Diagnostic logs never include medication names or doses. This plugin records only what you enter and never provides
                  medical advice, dosing recommendations or interactions.
                </p>
              </Panel>
            </div>
          )}
        </>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 700, padding: '10px 18px', borderRadius: 999, background: 'rgba(6, 20, 15, 0.95)', border: `1px solid ${M.borderStrong}`, color: '#a7f3d0', fontSize: 13, fontWeight: 600 }}>
          {toast}
        </div>
      )}

      {itemFormOpen && (
        <ItemFormModal
          initial={itemFormInitial}
          onClose={() => setItemFormOpen(false)}
          onSave={(item) => update((prev) => saveItem(prev, item))}
          onDelete={(id) => update((prev) => deleteItem(prev, id))}
        />
      )}
      {scheduleItem && (
        <ScheduleFormModal
          itemId={scheduleItem.id}
          itemName={scheduleItem.name}
          initial={scheduleInitial}
          onClose={() => { setScheduleItem(undefined); setScheduleInitial(undefined); }}
          onSave={(schedule) => update((prev) => saveSchedule(prev, schedule))}
          onDelete={(id) => update((prev) => deleteSchedule(prev, id))}
        />
      )}
      {supplyItem && (
        <SupplyFormModal
          itemName={supplyItem.name}
          initial={state.supply[supplyItem.id]}
          onClose={() => setSupplyItem(undefined)}
          onSave={(supply) => update((prev) => setSupply(prev, supplyItem.id, supply))}
        />
      )}
      {prnItem && (
        <PrnLogModal
          item={prnItem}
          onClose={() => setPrnItem(undefined)}
          onLog={(note) => {
            update((prev) => logDose(prev, { itemId: prnItem.id, scheduledFor: new Date().toISOString(), status: 'taken', note: note.trim() || undefined }));
            showToast(`Logged ${prnItem.name}`);
            setPrnItem(undefined);
          }}
        />
      )}
    </div>
  );
};

const Stat: React.FC<{ label: string; value: string; hint?: string }> = ({ label, value, hint }) => (
  <div style={{ flex: '1 1 150px', background: M.panel, border: `1px solid ${M.border}`, borderRadius: 14, padding: '14px 16px' }}>
    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: M.muted }}>{label}</div>
    <div style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc', marginTop: 2 }}>{value}</div>
    {hint && <div style={{ fontSize: 11, color: M.faint }}>{hint}</div>}
  </div>
);

const Tag: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <span style={{ fontSize: 10.5, fontWeight: 700, padding: '3px 9px', borderRadius: 999, background: M.accentSoft, color: '#a7f3d0', border: `1px solid ${M.borderStrong}` }}>
    {children}
  </span>
);

const Notice: React.FC<{ tone: 'warn' | 'error'; children: React.ReactNode }> = ({ tone, children }) => {
  const palette = tone === 'warn'
    ? { bg: 'rgba(251, 191, 36, 0.12)', border: 'rgba(251, 191, 36, 0.35)', color: '#fde68a' }
    : { bg: 'rgba(239, 68, 68, 0.12)', border: 'rgba(239, 68, 68, 0.35)', color: '#fecaca' };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 12, background: palette.bg, border: `1px solid ${palette.border}`, color: palette.color, fontSize: 13 }}>
      <AlertTriangle size={16} />
      <span>{children}</span>
    </div>
  );
};

const SummaryCard: React.FC<{ label: string; stats: { expected: number; taken: number; skipped: number; missed: number } }> = ({ label, stats }) => (
  <div style={{ flex: '1 1 150px', background: M.panelAlt, border: `1px solid ${M.border}`, borderRadius: 12, padding: 14 }}>
    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: M.muted }}>{label}</div>
    <div style={{ fontSize: 12.5, color: '#e2e8f0', marginTop: 6, display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span>{stats.expected} scheduled</span>
      <span style={{ color: '#34d399' }}>{stats.taken} taken</span>
      <span>{stats.skipped} skipped</span>
      <span style={{ color: '#f87171' }}>{stats.missed} missed</span>
    </div>
  </div>
);

const SettingToggle: React.FC<{ label: string; checked: boolean; onChange: (value: boolean) => void }> = ({ label, checked, onChange }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, color: M.text, marginBottom: 8 }}>
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);
