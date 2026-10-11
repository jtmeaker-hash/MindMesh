// Timezone-sensitive scheduling tests run in America/New_York so DST
// boundaries (spring forward / fall back) are exercised deterministically.
declare const process: { env: Record<string, string | undefined> };
process.env.TZ = 'America/New_York';

import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyQuietHours,
  buildDesiredNotifications,
  computeOccurrences,
  fireTimeOfOccurrenceKey,
} from '../services/selfCare';
import {
  defaultSelfCareState,
  normalizeSelfCareState,
  type SelfCareCheckIn,
  type SelfCareState,
} from '../types/selfCare';

function makeCheckIn(overrides: Partial<SelfCareCheckIn> = {}): SelfCareCheckIn {
  const now = new Date(2026, 4, 4, 12, 0, 0, 0); // Mon 2026-05-04 12:00 local
  return {
    id: 'c1',
    title: 'Eat check-in',
    category: 'eat',
    enabled: true,
    paused: false,
    defaultTone: 'gentle',
    variants: [],
    schedule: { weekdays: [0, 1, 2, 3, 4, 5, 6], times: ['09:00'], everyNDays: 1 },
    snoozeMinutes: 20,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function makeState(checkIns: SelfCareCheckIn[], nowMs: number): { state: SelfCareState; now: number } {
  const state: SelfCareState = {
    ...defaultSelfCareState(),
    checkIns,
    settings: {
      ...defaultSelfCareState().settings,
      quietHours: { enabled: false, start: '22:00', end: '07:00' },
    },
  };
  return { state, now: nowMs };
}

const MONDAY_NOON = new Date(2026, 4, 4, 12, 0, 0, 0).getTime();

describe('self care scheduling', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('schedules upcoming weekday/time combinations, sorted and deduplicated', () => {
    const { state, now } = makeState(
      [makeCheckIn({ schedule: { weekdays: [1, 3], times: ['09:00', '18:00'], everyNDays: 1 } })],
      MONDAY_NOON
    );
    const occurrences = computeOccurrences(state, now, 8);
    expect(occurrences.length).toBeGreaterThan(0);
    // Today (Monday) 09:00 already passed at noon; 18:00 remains.
    expect(occurrences[0].fireAt).toBe(new Date(2026, 4, 4, 18, 0, 0, 0).getTime());
    const keys = occurrences.map((o) => o.occurrenceKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (let i = 1; i < occurrences.length; i += 1) {
      expect(occurrences[i].fireAt).toBeGreaterThanOrEqual(occurrences[i - 1].fireAt);
    }
  });

  it('ignores past times and empty schedules', () => {
    const { state, now } = makeState([makeCheckIn({ schedule: { weekdays: [1], times: ['08:00'], everyNDays: 1 } })], MONDAY_NOON);
    // Monday 08:00 passed; next Monday is outside a 3-day horizon.
    expect(computeOccurrences(state, now, 3)).toEqual([]);
    const empty = makeState([makeCheckIn({ schedule: { weekdays: [], times: [], everyNDays: 1 } })], now);
    expect(computeOccurrences(empty.state, now, 8)).toEqual([]);
  });

  it('honours pause, disable and global pause without deleting anything', () => {
    const base = makeCheckIn();
    const { state, now } = makeState([base], MONDAY_NOON);
    expect(computeOccurrences(state, now, 2).length).toBeGreaterThan(0);
    expect(computeOccurrences({ ...state, checkIns: [{ ...base, paused: true }] }, now, 2)).toEqual([]);
    expect(computeOccurrences({ ...state, checkIns: [{ ...base, enabled: false }] }, now, 2)).toEqual([]);
    expect(
      computeOccurrences({ ...state, settings: { ...state.settings, pausedAll: true } }, now, 2)
    ).toEqual([]);
    // Pausing never removes the check-in itself.
    expect(state.checkIns).toHaveLength(1);
  });

  it('gates every-N-days repeats deterministically', () => {
    const mondayMorning = new Date(2026, 4, 4, 7, 0, 0, 0).getTime();
    const { state, now } = makeState(
      [makeCheckIn({ schedule: { weekdays: [0, 1, 2, 3, 4, 5, 6], times: ['09:00'], everyNDays: 3 } })],
      mondayMorning
    );
    const occurrences = computeOccurrences(state, now, 9);
    const days = occurrences.map((o) => o.dateKey);
    // Anchor is the creation day (Monday): occurrences fall on day 0, 3, 6.
    expect(days).toEqual(['2026-05-04', '2026-05-07', '2026-05-10']);
  });

  it('pushes quiet-hour occurrences to the end of quiet hours (overnight window)', () => {
    const fire = new Date(2026, 4, 4, 23, 15, 0, 0);
    const moved = applyQuietHours({ enabled: true, start: '22:00', end: '07:00' }, fire);
    expect(moved.getHours()).toBe(7);
    expect(moved.getMinutes()).toBe(0);
    expect(moved.getDate()).toBe(5); // next morning
    const morning = new Date(2026, 4, 4, 6, 30, 0, 0);
    const movedMorning = applyQuietHours({ enabled: true, start: '22:00', end: '07:00' }, morning);
    expect(movedMorning.getHours()).toBe(7);
    expect(movedMorning.getDate()).toBe(4); // same morning
    const afternoon = new Date(2026, 4, 4, 15, 0, 0, 0);
    expect(applyQuietHours({ enabled: true, start: '22:00', end: '07:00' }, afternoon).getTime()).toBe(
      afternoon.getTime()
    );
    expect(
      applyQuietHours({ enabled: false, start: '22:00', end: '07:00' }, fire).getTime()
    ).toBe(fire.getTime());
  });

  it('caps scheduled notifications at the daily limit and reports the drop count', () => {
    const { state, now } = makeState(
      [
        makeCheckIn({ id: 'a', schedule: { weekdays: [1], times: ['09:00', '10:00', '11:00'], everyNDays: 1 } }),
        makeCheckIn({ id: 'b', schedule: { weekdays: [1], times: ['12:00', '13:00'], everyNDays: 1 } }),
      ],
      new Date(2026, 4, 4, 7, 0, 0, 0).getTime()
    );
    const limited: SelfCareState = { ...state, settings: { ...state.settings, maxPerDay: 3 } };
    const occurrences = computeOccurrences(limited, now, 1);
    expect(occurrences.length).toBe(5);
    const { desired, droppedByLimit } = buildDesiredNotifications(limited, occurrences);
    expect(desired).toHaveLength(3);
    expect(droppedByLimit).toBe(2);
  });

  it('fires exactly once across the spring-forward DST gap', () => {
    // 2026-03-08 is the US spring-forward Sunday: 02:30 does not exist.
    const sunday = new Date(2026, 2, 8, 0, 0, 0, 0).getTime();
    const { state } = makeState(
      [makeCheckIn({ schedule: { weekdays: [0], times: ['02:30'], everyNDays: 1 } })],
      sunday
    );
    const occurrences = computeOccurrences(state, sunday, 1);
    expect(occurrences).toHaveLength(1);
    const fired = new Date(occurrences[0].fireAt);
    expect(fired.getMonth()).toBe(2);
    expect(fired.getDate()).toBe(8);
  });

  it('fires exactly once across the fall-back DST repeat', () => {
    // 2026-11-01 is the US fall-back Sunday: 01:30 happens twice.
    const sunday = new Date(2026, 10, 1, 0, 0, 0, 0).getTime();
    const { state } = makeState(
      [makeCheckIn({ schedule: { weekdays: [0], times: ['01:30'], everyNDays: 1 } })],
      sunday
    );
    const occurrences = computeOccurrences(state, sunday, 1);
    expect(occurrences).toHaveLength(1);
  });

  it('keeps occurrence keys unique across a wide horizon (no duplicates)', () => {
    const { state, now } = makeState(
      [
        makeCheckIn({ id: 'a', schedule: { weekdays: [0, 1, 2, 3, 4, 5, 6], times: ['09:00', '21:00'], everyNDays: 1 } }),
        makeCheckIn({ id: 'b', schedule: { weekdays: [0, 1, 2, 3, 4, 5, 6], times: ['09:00'], everyNDays: 2 } }),
      ],
      MONDAY_NOON
    );
    const occurrences = computeOccurrences(
      { ...state, settings: { ...state.settings, quietHours: { enabled: true, start: '22:00', end: '07:00' } } },
      now,
      14
    );
    const keys = occurrences.map((o) => o.occurrenceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('parses occurrence fire times for missed-accounting', () => {
    const fire = new Date(2026, 4, 4, 9, 5, 0, 0).getTime();
    expect(fireTimeOfOccurrenceKey('c1::2026-05-04::09:05')).toBe(fire);
    expect(fireTimeOfOccurrenceKey('c1::snooze::1234567890')).toBe(1234567890);
    expect(fireTimeOfOccurrenceKey('garbage')).toBeNull();
  });

  it('normalizes stored state without dropping records', () => {
    const normalized = normalizeSelfCareState({
      checkIns: [{ ...makeCheckIn(), variants: [{ id: 'v', tone: 'gentle', text: 'Hi 💛' }], extra: 'dropped' }],
      history: [{ id: 'h', checkInId: 'c1', occurrenceKey: 'k', result: 'done', at: '2026-01-01' }],
      settings: { maxPerDay: 99 },
    });
    expect(normalized.checkIns).toHaveLength(1);
    expect(normalized.checkIns[0].variants).toHaveLength(1);
    expect(normalized.history).toHaveLength(1);
    expect(normalized.settings.maxPerDay).toBe(24); // clamped, not dropped
    // Idempotent: normalizing twice changes nothing.
    expect(normalizeSelfCareState(normalized)).toEqual(normalized);
  });
});
