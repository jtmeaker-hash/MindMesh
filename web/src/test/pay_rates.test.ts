import { describe, it, expect } from 'vitest';
import {
  calculateRuledShiftPay,
  calculateShiftPayWithRules,
  normalizeIncomeConfig,
  normalizeHourlyRates,
  normalizeRateRules,
  resolveRuleRate,
  selectRateAt,
  formatRuleDays,
  summarizeRateRules,
} from '../utils/payRates';
import { CasualPayRateRule, HourlyRateConfig } from '../types/finance';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { loadMoneyState, saveMoneyState } from '../services/storage';

// 2026-09-28 is a Monday, 2026-10-03 a Saturday and 2026-10-04 a Sunday.
const MONDAY = '2026-09-28';
const TUESDAY = '2026-09-29';
const WEDNESDAY = '2026-09-30';
const FRIDAY = '2026-10-02';
const SATURDAY = '2026-10-03';
const SUNDAY = '2026-10-04';

function makeRule(partial: Partial<CasualPayRateRule>): CasualPayRateRule {
  return {
    id: partial.id ?? 'rule',
    label: partial.label ?? 'Rule',
    enabled: partial.enabled ?? true,
    days: partial.days ?? [1, 2, 3, 4, 5],
    allDay: partial.allDay ?? false,
    startTime: partial.startTime ?? '19:00',
    endTime: partial.endTime ?? '23:59',
    mode: partial.mode ?? 'fixed',
    rate: partial.rate ?? 45,
    priority: partial.priority ?? 1,
  };
}

/** The example config from the brief: base, weekday evening, Sat all day, Sun all day. */
function exampleConfig(): HourlyRateConfig {
  return {
    baseRate: 30,
    rateRules: [
      makeRule({ id: 'evening', label: 'Weekday evening', days: [1, 2, 3, 4, 5], startTime: '19:00', endTime: '00:00', rate: 45, priority: 3 }),
      makeRule({ id: 'saturday', label: 'Saturday', days: [6], allDay: true, rate: 40, priority: 2 }),
      makeRule({ id: 'sunday', label: 'Sunday', days: [0], allDay: true, rate: 50, priority: 1 }),
    ],
  };
}

describe('Casual pay rate engine', () => {
  it('pays the whole shift at the base rate when there are no rules', () => {
    const result = calculateRuledShiftPay({ baseRate: 30, rateRules: [] }, MONDAY, '09:00', '17:00', 0);
    expect(result.paidHours).toBe(8);
    expect(result.estimatedPay).toBe(240);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].isBase).toBe(true);
    expect(result.segments[0].hours).toBe(8);
    expect(result.appliedRuleIds).toEqual([]);
  });

  it('uses the base rate on a weekday before the evening rule starts', () => {
    const result = calculateRuledShiftPay(exampleConfig(), MONDAY, '09:00', '17:00', 0);
    expect(result.paidHours).toBe(8);
    expect(result.estimatedPay).toBe(240);
    expect(result.segments.every((segment) => segment.isBase)).toBe(true);
  });

  it('applies the evening rule after 19:00', () => {
    const result = calculateRuledShiftPay(exampleConfig(), MONDAY, '19:00', '22:00', 0);
    expect(result.estimatedPay).toBe(135);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].ruleId).toBe('evening');
    expect(result.segments[0].hours).toBe(3);
  });

  it('splits a shift across the 19:00 boundary', () => {
    const result = calculateRuledShiftPay(exampleConfig(), MONDAY, '17:00', '22:00', 0);
    expect(result.paidHours).toBe(5);
    expect(result.estimatedPay).toBe(195); // 2h @ 30 + 3h @ 45

    const base = result.segments.find((segment) => segment.isBase);
    const evening = result.segments.find((segment) => segment.ruleId === 'evening');
    expect(base?.hours).toBe(2);
    expect(base?.pay).toBe(60);
    expect(evening?.hours).toBe(3);
    expect(evening?.pay).toBe(135);
  });

  it('applies a Saturday all-day rule for the whole Saturday shift', () => {
    const result = calculateRuledShiftPay(exampleConfig(), SATURDAY, '10:00', '14:00', 0);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].ruleId).toBe('saturday');
    expect(result.estimatedPay).toBe(160); // 4h @ 40
  });

  it('applies a Sunday all-day rule for the whole Sunday shift', () => {
    const result = calculateRuledShiftPay(exampleConfig(), SUNDAY, '10:00', '14:00', 0);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].ruleId).toBe('sunday');
    expect(result.estimatedPay).toBe(200); // 4h @ 50
  });

  it('respects user-defined alternative days and times', () => {
    const rules: HourlyRateConfig = {
      baseRate: 20,
      rateRules: [
        makeRule({ id: 'early', days: [3], allDay: false, startTime: '06:00', endTime: '12:00', rate: 60, priority: 1 }),
      ],
    };
    const result = calculateRuledShiftPay(rules, WEDNESDAY, '06:00', '12:00', 0);
    expect(result.estimatedPay).toBe(360); // 6h @ 60
    expect(result.segments[0].ruleId).toBe('early');

    // A different day (Tuesday) is not covered by the Wednesday rule.
    const other = calculateRuledShiftPay(rules, TUESDAY, '06:00', '12:00', 0);
    expect(other.estimatedPay).toBe(120); // 6h @ 20 base
  });

  it('ignores disabled rules', () => {
    const rules: HourlyRateConfig = {
      baseRate: 20,
      rateRules: [
        makeRule({ id: 'disabled', enabled: false, days: [1], allDay: true, rate: 99, priority: 9 }),
      ],
    };
    const result = calculateRuledShiftPay(rules, MONDAY, '09:00', '17:00', 0);
    expect(result.estimatedPay).toBe(160); // 8h @ 20 base
    expect(result.segments.every((segment) => segment.isBase)).toBe(true);
  });

  it('treats the rule start as inclusive and the end as exclusive', () => {
    const rules: HourlyRateConfig = {
      baseRate: 30,
      rateRules: [
        makeRule({ id: 'evening', days: [1], allDay: false, startTime: '19:00', endTime: '22:00', rate: 45, priority: 1 }),
      ],
    };

    // Ends exactly when the evening window opens -> entirely base.
    expect(calculateRuledShiftPay(rules, MONDAY, '18:00', '19:00', 0).estimatedPay).toBe(30);
    // Starts exactly when the evening window opens -> entirely evening.
    expect(calculateRuledShiftPay(rules, MONDAY, '19:00', '20:00', 0).estimatedPay).toBe(45);
    // Starts exactly when the evening window closes -> entirely base.
    expect(calculateRuledShiftPay(rules, MONDAY, '22:00', '23:00', 0).estimatedPay).toBe(30);
  });

  it('evaluates the correct day-of-week rules on each side of midnight', () => {
    const result = calculateRuledShiftPay(exampleConfig(), FRIDAY, '22:00', '02:00', 0);
    // Fri 22:00-24:00 evening (2h @ 45), Sat 00:00-02:00 all day (2h @ 40).
    expect(result.paidHours).toBe(4);
    expect(result.estimatedPay).toBe(170);
    const friday = result.segments.find((segment) => segment.ruleId === 'evening');
    const saturday = result.segments.find((segment) => segment.ruleId === 'saturday');
    expect(friday?.hours).toBe(2);
    expect(saturday?.hours).toBe(2);
  });

  it('supports a rule window that crosses midnight', () => {
    const rules: HourlyRateConfig = {
      baseRate: 25,
      rateRules: [
        makeRule({ id: 'night', label: 'Night', days: [1], allDay: false, startTime: '22:00', endTime: '06:00', rate: 50, priority: 1 }),
      ],
    };

    // Monday 23:00 -> Tuesday 01:00 stays inside the crossing window.
    const overnight = calculateRuledShiftPay(rules, MONDAY, '23:00', '01:00', 0);
    expect(overnight.estimatedPay).toBe(100); // 2h @ 50
    expect(overnight.segments[0].ruleId).toBe('night');

    // Tuesday 02:00-05:00 is covered by Monday's crossing window.
    const morningAfter = calculateRuledShiftPay(rules, TUESDAY, '02:00', '05:00', 0);
    expect(morningAfter.estimatedPay).toBe(150); // 3h @ 50
    expect(morningAfter.segments[0].ruleId).toBe('night');
  });

  it('resolves overlapping rules deterministically by priority', () => {
    const high = makeRule({ id: 'high', label: 'High', days: [1], allDay: true, rate: 50, priority: 5 });
    const low = makeRule({ id: 'low', label: 'Low', days: [1], allDay: true, rate: 40, priority: 1 });

    const a = calculateRuledShiftPay({ baseRate: 30, rateRules: [high, low] }, MONDAY, '09:00', '10:00', 0);
    const b = calculateRuledShiftPay({ baseRate: 30, rateRules: [low, high] }, MONDAY, '09:00', '10:00', 0);
    expect(a.estimatedPay).toBe(50);
    expect(b.estimatedPay).toBe(50);
    expect(a.segments[0].ruleId).toBe('high');
    expect(b.segments[0].ruleId).toBe('high');
  });

  it('breaks equal-priority ties by list order', () => {
    const first = makeRule({ id: 'first', days: [1], allDay: true, rate: 41, priority: 2 });
    const second = makeRule({ id: 'second', days: [1], allDay: true, rate: 42, priority: 2 });
    const selection = selectRateAt([first, second], 30, 1, 9 * 60);
    expect(selection.rule?.id).toBe('first');
    expect(selection.rate).toBe(41);
  });

  it('allocates an unpaid break proportionally across rate windows', () => {
    const result = calculateRuledShiftPay(exampleConfig(), MONDAY, '17:00', '22:00', 30);
    expect(result.paidHours).toBe(4.5);
    // 300 raw minutes -> 270 paid: base 108 min, evening 162 min.
    const base = result.segments.find((segment) => segment.isBase);
    const evening = result.segments.find((segment) => segment.ruleId === 'evening');
    expect(base?.hours).toBe(1.8);
    expect(evening?.hours).toBe(2.7);
    expect(result.estimatedPay).toBe(175.5); // 1.8*30 + 2.7*45
  });

  it('keeps single-window shifts matching the legacy duration minus break', () => {
    const result = calculateRuledShiftPay({ baseRate: 30, rateRules: [] }, MONDAY, '16:00', '23:30', 30);
    expect(result.paidHours).toBe(7);
    expect(result.estimatedPay).toBe(210);
  });

  it('avoids floating point drift in money totals', () => {
    const rules: HourlyRateConfig = {
      baseRate: 30.1,
      rateRules: [
        makeRule({ id: 'evening', days: [1], allDay: false, startTime: '19:00', endTime: '23:59', mode: 'multiplier', rate: 1.5, priority: 1 }),
      ],
    };
    const result = calculateRuledShiftPay(rules, MONDAY, '17:00', '22:00', 0);
    expect(result.segments.find((segment) => segment.isBase)?.rate).toBe(30.1);
    expect(result.segments.find((segment) => segment.ruleId === 'evening')?.rate).toBe(45.15);
    expect(result.estimatedPay).toBe(195.65); // 2*30.10 + 3*45.15
  });

  it('rounds per-segment pay to cents using the existing convention', () => {
    const rules: HourlyRateConfig = {
      baseRate: 25.55,
      rateRules: [makeRule({ id: 'r', days: [1], allDay: true, rate: 25.55, priority: 1 })],
    };
    const result = calculateRuledShiftPay(rules, MONDAY, '19:00', '20:30', 0);
    expect(result.paidHours).toBe(1.5);
    expect(result.estimatedPay).toBe(38.33);
  });
});

describe('Casual pay configuration normalization and migration', () => {
  it('fills an empty rateRules list on a legacy config and keeps the base rate', () => {
    const legacy = {
      baseRate: 32,
      saturdayRate: 38,
      sundayRate: 44,
      eveningRate: 35,
    };
    const normalized = normalizeIncomeConfig({
      id: 'inc-1',
      title: 'Casual Job',
      employmentType: 'casual_hourly',
      frequency: 'weekly',
      averagePay: 800,
      nextPayDate: '2026-09-25',
      hourlyRates: legacy,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
    });
    expect(normalized?.hourlyRates?.baseRate).toBe(32);
    expect(normalized?.hourlyRates?.saturdayRate).toBe(38);
    expect(normalized?.hourlyRates?.rateRules).toEqual([]);
  });

  it('returns null only for genuinely missing income configs', () => {
    expect(normalizeIncomeConfig(undefined)).toBeNull();
    expect(normalizeIncomeConfig(null)).toBeNull();
    // An object payload is passed through unchanged (matching prior `|| null`).
    expect(normalizeIncomeConfig({})).toEqual({});
  });

  it('leaves configs without hourly rates untouched', () => {
    const config = normalizeIncomeConfig({
      id: 'inc-2',
      title: 'Salary',
      employmentType: 'full_time',
      frequency: 'fortnightly',
      averagePay: 2000,
      nextPayDate: '2026-09-25',
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
    });
    expect(config?.hourlyRates).toBeUndefined();
    expect(config?.averagePay).toBe(2000);
  });

  it('repairs malformed rules with safe defaults', () => {
    const rules = normalizeRateRules([
      { id: 'a', label: '', enabled: 'nope', days: [7, -1, 1, 1, 3.5], allDay: false, startTime: '99:99', endTime: '22:00', mode: 'weird', rate: '12.5' },
      null,
    ]);
    expect(rules).toHaveLength(2);
    expect(rules[0].label).toBe('Rule 1');
    expect(rules[0].days).toEqual([1]);
    expect(rules[0].startTime).toBeUndefined();
    expect(rules[0].endTime).toBe('22:00');
    expect(rules[0].mode).toBe('fixed');
    expect(rules[0].rate).toBe(12.5);
    expect(rules[1].id).toBe('rate-rule-1');
  });

  it('does not trigger rule-based pay for configs without rules', () => {
    expect(
      calculateShiftPayWithRules({ baseRate: 30, saturdayRate: 38 }, {
        date: MONDAY,
        startTime: '09:00',
        endTime: '17:00',
        breakMinutes: 0,
      })
    ).toBeNull();

    expect(
      calculateShiftPayWithRules(undefined, {
        date: MONDAY,
        startTime: '09:00',
        endTime: '17:00',
        breakMinutes: 0,
      })
    ).toBeNull();

    expect(normalizeHourlyRates(undefined)).toBeUndefined();
  });

  it('round-trips a ruled config through storage persistence', () => {
    localStorage.clear();
    const state = getDefaultMoneyState();
    const withRules = {
      ...state,
      incomeConfig: {
        id: 'inc-rules',
        title: 'Bar',
        employmentType: 'casual_hourly' as const,
        frequency: 'weekly' as const,
        averagePay: 900,
        nextPayDate: '2026-10-09',
        hourlyPayModeEnabled: true,
        hourlyRates: {
          baseRate: 31,
          rateRules: [makeRule({ id: 'evening', days: [1, 2, 3, 4, 5], rate: 46, priority: 1 })],
        },
        createdAt: '2026-09-01',
        updatedAt: '2026-09-01',
      },
    };
    saveMoneyState(withRules);
    const loaded = loadMoneyState();
    expect(loaded.incomeConfig?.hourlyRates?.baseRate).toBe(31);
    expect(loaded.incomeConfig?.hourlyRates?.rateRules).toHaveLength(1);
    expect(loaded.incomeConfig?.hourlyRates?.rateRules?.[0].id).toBe('evening');
  });

  it('migrates a stored legacy config to an empty rateRules list on load', () => {
    localStorage.clear();
    const state = getDefaultMoneyState();
    saveMoneyState({
      ...state,
      incomeConfig: {
        id: 'inc-legacy',
        title: 'Old Casual',
        employmentType: 'casual_hourly',
        frequency: 'fortnightly',
        averagePay: 1000,
        nextPayDate: '2026-10-09',
        hourlyPayModeEnabled: true,
        hourlyRates: { baseRate: 28, saturdayRate: 35 },
        createdAt: '2026-09-01',
        updatedAt: '2026-09-01',
      },
    });
    const loaded = loadMoneyState();
    expect(loaded.incomeConfig?.hourlyRates?.baseRate).toBe(28);
    expect(loaded.incomeConfig?.hourlyRates?.saturdayRate).toBe(35);
    expect(loaded.incomeConfig?.hourlyRates?.rateRules).toEqual([]);
  });
});

describe('Casual pay rate helpers', () => {
  it('resolves multiplier rules against the base rate', () => {
    const rule = makeRule({ mode: 'multiplier', rate: 1.5 });
    expect(resolveRuleRate(rule, 30)).toBe(45);
    expect(resolveRuleRate(rule, 32.5)).toBe(48.75);
  });

  it('formats day summaries', () => {
    expect(formatRuleDays([1, 2, 3, 4, 5])).toBe('Mon-Fri');
    expect(formatRuleDays([0, 6])).toBe('Sun, Sat');
    expect(formatRuleDays([1, 2, 3, 4, 5, 6, 0])).toBe('Every day');
    expect(formatRuleDays([])).toBe('No days');
  });

  it('summarizes the base and enabled rules only', () => {
    const config: HourlyRateConfig = {
      baseRate: 30,
      rateRules: [
        makeRule({ id: 'e', label: 'Evening', days: [1, 2, 3, 4, 5], startTime: '19:00', endTime: '23:59', rate: 45 }),
        makeRule({ id: 'off', label: 'Disabled', enabled: false, days: [6], allDay: true, rate: 60 }),
      ],
    };
    const lines = summarizeRateRules(config);
    expect(lines[0]).toBe('Base: $30.00/hr');
    expect(lines.some((line) => line.includes('Evening'))).toBe(true);
    expect(lines.some((line) => line.includes('Disabled'))).toBe(false);
  });
});
