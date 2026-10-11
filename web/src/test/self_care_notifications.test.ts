import { beforeEach, describe, expect, it } from 'vitest';
import {
  SELF_CARE_STORAGE_KEY,
  cancelAllSelfCareAlarms,
  handleSelfCareAction,
  loadSelfCareState,
  reconcileSelfCare,
  saveSelfCareState,
  selfCareDiagnostics,
} from '../services/selfCare';
import { defaultSelfCareState, type SelfCareCheckIn } from '../types/selfCare';

interface ScheduledCall {
  id: string;
  title: string;
  body: string;
  fireAt: number;
  options: string;
}

function installMockBridge() {
  const scheduled: ScheduledCall[] = [];
  const cancelled: string[] = [];
  const bridge = {
    isSupported: () => true,
    getPermissionState: () => 'granted',
    requestPermission: () => undefined,
    schedule: (id: string, title: string, body: string, fireAt: number, optionsJson: string) => {
      scheduled.push({ id, title, body, fireAt, options: optionsJson });
      return true;
    },
    cancel: (id: string) => {
      cancelled.push(id);
    },
    cancelAll: () => undefined,
    getScheduledCount: () => scheduled.length,
    openNotificationSettings: () => undefined,
  };
  (window as unknown as Record<string, unknown>).MindMeshNotifications = bridge;
  return { scheduled, cancelled, bridge };
}

function makeCheckIn(overrides: Partial<SelfCareCheckIn> = {}): SelfCareCheckIn {
  const stamp = new Date(2026, 4, 4, 7, 0, 0, 0).toISOString(); // Mon 07:00 local
  return {
    id: 'c1',
    title: 'Eat check-in',
    category: 'eat',
    enabled: true,
    paused: false,
    defaultTone: 'gentle',
    variants: [{ id: 'v1', tone: 'gentle', text: 'Secret gentle words 💛' }],
    schedule: { weekdays: [1], times: ['09:00'], everyNDays: 1 },
    snoozeMinutes: 20,
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  };
}

const MONDAY_EARLY = new Date(2026, 4, 4, 7, 0, 0, 0).getTime();

describe('self care native delivery', () => {
  beforeEach(() => {
    localStorage.clear();
    delete (window as unknown as Record<string, unknown>).MindMeshNotifications;
  });

  it('schedules upcoming check-ins through the real native bridge contract', () => {
    const { scheduled } = installMockBridge();
    saveSelfCareState({ ...defaultSelfCareState(), checkIns: [makeCheckIn()] });
    const result = reconcileSelfCare(MONDAY_EARLY, 1);
    expect(result.nativeAvailable).toBe(true);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].id.startsWith('selfcare::')).toBe(true);
    expect(scheduled[0].body).toBe('Secret gentle words 💛');
    const options = JSON.parse(scheduled[0].options) as Record<string, unknown>;
    expect(options.kind).toBe('self-care');
    expect(options.actions).toEqual(['complete', 'snooze', 'skip', 'open']);
    expect(loadSelfCareState().scheduledIds).toEqual([scheduled[0].id]);
  });

  it('never schedules the same alarm twice', () => {
    const { scheduled } = installMockBridge();
    saveSelfCareState({ ...defaultSelfCareState(), checkIns: [makeCheckIn()] });
    reconcileSelfCare(MONDAY_EARLY, 1);
    reconcileSelfCare(MONDAY_EARLY, 1);
    expect(scheduled).toHaveLength(1);
  });

  it('cancels only its own obsolete alarms when the schedule changes', () => {
    const { scheduled, cancelled } = installMockBridge();
    saveSelfCareState({ ...defaultSelfCareState(), checkIns: [makeCheckIn()] });
    reconcileSelfCare(MONDAY_EARLY, 1);
    expect(scheduled).toHaveLength(1);
    const firstId = scheduled[0].id;

    // User removes the only time: the alarm must be cancelled, nothing scheduled.
    saveSelfCareState({
      ...loadSelfCareState(),
      checkIns: [makeCheckIn({ schedule: { weekdays: [1], times: [], everyNDays: 1 } })],
    });
    const result = reconcileSelfCare(MONDAY_EARLY, 1);
    expect(cancelled).toContain(firstId);
    expect(result.scheduled).toEqual([]);
  });

  it('uses a generic body on the lock screen when privacy is enabled', () => {
    const { scheduled } = installMockBridge();
    saveSelfCareState({
      ...defaultSelfCareState(),
      checkIns: [makeCheckIn()],
      settings: { ...defaultSelfCareState().settings, privateLockScreen: true },
    });
    reconcileSelfCare(MONDAY_EARLY, 1);
    expect(scheduled).toHaveLength(1);
    expect(scheduled[0].body).not.toContain('Secret gentle words');
  });

  it('handles Done / Snooze / Skip / Open from the device', () => {
    const { scheduled, cancelled } = installMockBridge();
    saveSelfCareState({ ...defaultSelfCareState(), checkIns: [makeCheckIn()] });
    reconcileSelfCare(MONDAY_EARLY, 1);
    const id = scheduled[0].id;

    expect(handleSelfCareAction(id, 'complete')).toBe(true);
    let state = loadSelfCareState();
    expect(state.history[state.history.length - 1].result).toBe('done');
    expect(cancelled).toContain(id);
    expect(state.scheduledIds).not.toContain(id);

    // Snooze registers a deferred alarm and logs neutrally.
    saveSelfCareState({ ...defaultSelfCareState(), checkIns: [makeCheckIn()] });
    reconcileSelfCare(MONDAY_EARLY, 1);
    const id2 = loadSelfCareState().scheduledIds[0];
    const before = scheduled.length;
    expect(handleSelfCareAction(id2, 'snooze')).toBe(true);
    state = loadSelfCareState();
    expect(state.history[state.history.length - 1].result).toBe('snoozed');
    expect(scheduled.length).toBe(before + 1);
    expect(scheduled[scheduled.length - 1]!.id).toContain('::snooze::');

    // Skip is neutral: no re-alarm, no guilt.
    const snoozeId = scheduled[scheduled.length - 1]!.id;
    expect(handleSelfCareAction(snoozeId, 'skip')).toBe(true);
    expect(loadSelfCareState().history[loadSelfCareState().history.length - 1].result).toBe('skipped');

    // Open records and asks the app to navigate (observed via event).
    const seen: string[] = [];
    window.addEventListener('mindmesh-navigate-selfcare', () => seen.push('nav'));
    saveSelfCareState({ ...defaultSelfCareState(), checkIns: [makeCheckIn()] });
    reconcileSelfCare(MONDAY_EARLY, 1);
    const id3 = loadSelfCareState().scheduledIds[0];
    expect(handleSelfCareAction(id3, 'open')).toBe(true);
    expect(loadSelfCareState().history[loadSelfCareState().history.length - 1].result).toBe('opened');
    expect(seen).toEqual(['nav']);

    // Foreign ids are not ours.
    expect(handleSelfCareAction('reminder::abc', 'complete')).toBe(false);
  });

  it('records silent misses only for fired, unanswered alarms — never for superseded futures', () => {
    installMockBridge();
    // A stale alarm for a long-past occurrence with no history: genuinely missed.
    saveSelfCareState({
      ...defaultSelfCareState(),
      checkIns: [makeCheckIn({ schedule: { weekdays: [1], times: [], everyNDays: 1 } })],
      scheduledIds: ['selfcare::c1::2020-01-01::09:00'],
    });
    const result = reconcileSelfCare(MONDAY_EARLY, 1);
    expect(result.missedRecorded).toBe(1);
    expect(loadSelfCareState().history[loadSelfCareState().history.length - 1].result).toBe('missed');

    // A stale alarm for a FUTURE occurrence (superseded by an edit): cancelled silently.
    const futureKey = 'c1::2030-01-01::09:00';
    saveSelfCareState({
      ...defaultSelfCareState(),
      checkIns: [makeCheckIn({ schedule: { weekdays: [1], times: [], everyNDays: 1 } })],
      scheduledIds: [`selfcare::${futureKey}`],
    });
    const result2 = reconcileSelfCare(MONDAY_EARLY, 1);
    expect(result2.missedRecorded).toBe(0);
    expect(loadSelfCareState().history.filter((h) => h.occurrenceKey === futureKey)).toEqual([]);
  });

  it('reports no-update gracefully when the native bridge is unavailable', () => {
    saveSelfCareState({ ...defaultSelfCareState(), checkIns: [makeCheckIn()] });
    const result = reconcileSelfCare(MONDAY_EARLY, 1);
    expect(result.nativeAvailable).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('keeps diagnostics free of private message text', () => {
    const { scheduled } = installMockBridge();
    void scheduled;
    saveSelfCareState({ ...defaultSelfCareState(), checkIns: [makeCheckIn()] });
    const diagnostics = selfCareDiagnostics(loadSelfCareState());
    expect(JSON.stringify(diagnostics)).not.toContain('Secret gentle words');
    expect(diagnostics.checkIns).toBe(1);
  });

  it('cancels every scoped alarm without touching stored data', () => {
    const { cancelled } = installMockBridge();
    saveSelfCareState({ ...defaultSelfCareState(), checkIns: [makeCheckIn()] });
    reconcileSelfCare(MONDAY_EARLY, 1);
    expect(loadSelfCareState().scheduledIds).toHaveLength(1);
    const removed = cancelAllSelfCareAlarms();
    expect(removed).toHaveLength(1);
    expect(cancelled).toHaveLength(1);
    const state = loadSelfCareState();
    expect(state.scheduledIds).toEqual([]);
    expect(state.checkIns).toHaveLength(1); // data retained
    expect(JSON.parse(localStorage.getItem(SELF_CARE_STORAGE_KEY) ?? '{}').checkIns).toHaveLength(1);
  });

  it('does not reschedule while everything is paused', () => {
    const { scheduled } = installMockBridge();
    saveSelfCareState({
      ...defaultSelfCareState(),
      checkIns: [makeCheckIn()],
      settings: { ...defaultSelfCareState().settings, pausedAll: true },
    });
    reconcileSelfCare(MONDAY_EARLY, 1);
    expect(scheduled).toHaveLength(0);
  });
});
