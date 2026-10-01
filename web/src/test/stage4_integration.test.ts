import { describe, it, expect, beforeEach } from 'vitest';
import {
  DirectDebit,
  DirectDebitCategory,
  Expense,
  IncomeConfig,
  MoneyState,
} from '../types/finance';
import {
  BACKUP_FORMAT_VERSION,
  createBackup,
  migrateBackup,
  restoreBackup,
  serializeBackup,
  validateBackup,
} from '../services/backup';
import {
  exportStorageJson,
  importStorageJson,
  loadAllData,
  loadMoneyState,
  saveAllData,
  saveMoneyState,
} from '../services/storage';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import {
  advanceBillForNextOccurrence,
  calculateExpenseSummary,
  getCurrentPayCycleSummary,
  isDueByOnOrAfterNextPayment,
} from '../utils/finance';
import { calculateShiftPayWithRules, normalizeRateRules, resolveRuleRate } from '../utils/payRates';
import { MindMeshBackupFile } from '../types/backup';

const CATEGORIES: DirectDebitCategory[] = [
  { id: 'bcat-util', name: 'Utilities', color: '#6366f1' },
];

const makeDebit = (overrides: Partial<DirectDebit> = {}): DirectDebit => ({
  id: 'dd-1',
  title: 'Electricity',
  amount: 120,
  categoryId: 'bcat-util',
  frequency: 'monthly',
  nextPaymentDate: '2026-10-03',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 'exp-1',
  title: 'Fuel',
  amount: 60,
  date: '2026-10-02',
  categoryId: 'bcat-util',
  createdAt: '2026-10-02T08:00:00.000Z',
  updatedAt: '2026-10-02T08:00:00.000Z',
  ...overrides,
});

/** A pre-Stages backup: no due-by, no rate rules and no general expenses. */
function legacyBackup(moneyOverrides: Record<string, unknown> = {}): MindMeshBackupFile {
  return {
    backupVersion: BACKUP_FORMAT_VERSION,
    appVersion: '1.3.0',
    appName: 'MindMesh',
    createdAt: '2026-09-01T00:00:00.000Z',
    schemaVersion: 9,
    data: {
      categories: [],
      reminders: [],
      nodePositions: {},
      money: {
        incomeConfig: {
          id: 'inc-legacy',
          title: 'Casual',
          employmentType: 'casual_hourly',
          frequency: 'fortnightly',
          averagePay: 900,
          nextPayDate: '2026-10-09',
          hourlyPayModeEnabled: true,
          // Legacy config: named rates only, no additive rateRules array.
          hourlyRates: { baseRate: 28, saturdayRate: 35 },
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
        directDebits: [makeDebit()],
        billCategories: CATEGORIES,
        extraIncomeList: [],
        extraIncomeCategories: [],
        tipEntries: [],
        shifts: [],
        payCycleOverrides: {},
        ...moneyOverrides,
      },
      contacts: [],
      contactCategories: [],
      contactRelationships: [],
    },
  } as unknown as MindMeshBackupFile;
}

describe('Stage 4 · backup format versioning', () => {
  it('keeps the backup format version stable because compatibility is defaulted, not version-gated', () => {
    // Stages 1-3 added optional data (due-by, rateRules, expenses). Older files
    // stay readable through tolerant/defaulted deserialization and migrateBackup
    // (schemaVersion is always advanced to CURRENT_STORAGE_VERSION), so no format
    // bump or version-switch migration is required.
    expect(BACKUP_FORMAT_VERSION).toBe(3);
  });
});

describe('Stage 4 · backward compatibility with pre-Stages backups', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('restores a pre-Stages backup: bill due-by -> none, rateRules -> empty, expenses -> empty', () => {
    const json = JSON.stringify(legacyBackup());
    const validation = validateBackup(json);
    expect(validation.valid).toBe(true);
    expect(validation.summary?.expensesCount).toBe(0);

    const restored = restoreBackup(validation.backupFile!);
    expect(restored.success).toBe(true);

    const money = loadMoneyState();
    // Missing bill due-by loads as "none" rather than an error.
    expect(money.directDebits).toHaveLength(1);
    expect(money.directDebits[0].nextPaymentDate).toBe('2026-10-03');
    expect(money.directDebits[0].dueByDate).toBeUndefined();
    // Missing rateRules normalizes to an empty list, keeping the named rates.
    expect(money.incomeConfig?.hourlyRates?.rateRules).toEqual([]);
    expect(money.incomeConfig?.hourlyRates?.baseRate).toBe(28);
    expect(money.incomeConfig?.hourlyRates?.saturdayRate).toBe(35);
    // Missing general expenses restores as an empty collection.
    expect(money.expenses).toEqual([]);
  });

  it('uses the preserved base rate when a legacy config has no rate rules', () => {
    const migrated = migrateBackup(legacyBackup());
    const config = (migrated.money ?? getDefaultMoneyState()).incomeConfig as IncomeConfig;
    expect(config.hourlyRates?.rateRules).toEqual([]);
    // With no rules the rule engine abstains, so the legacy per-rateType maths
    // (which falls back to baseRate for 'base') still governs pay.
    const ruled = calculateShiftPayWithRules(config.hourlyRates, {
      date: '2026-09-28',
      startTime: '09:00',
      endTime: '17:00',
      breakMinutes: 0,
    });
    expect(ruled).toBeNull();
  });

  it('does not crash when newer optional backup domains are entirely absent', () => {
    // legacyBackup() deliberately omits routines, appearance, notifications,
    // notificationHistory, smartEngineSettings, diagnostics, preferences and
    // statistics. Restore must tolerate every one of them.
    const validation = validateBackup(JSON.stringify(legacyBackup()));
    expect(validation.valid).toBe(true);

    const restored = restoreBackup(validation.backupFile!);
    expect(restored.success).toBe(true);

    const state = loadAllData();
    expect(state.routines).toEqual([]);
    expect(state.appearance).toBeDefined();
    expect(state.notifications).toBeDefined();
    expect(state.smartEngineSettings).toBeDefined();
    expect(state.preferences).toBeDefined();
  });
});

describe('Stage 4 · forward safety of the backup schema', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('preserves unknown extra fields on record types the architecture passes through', () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      money: {
        ...getDefaultMoneyState(),
        directDebits: [
          makeDebit({ dueByDate: '2026-10-10', futureBillFlag: true } as Partial<DirectDebit>),
        ],
        expenses: [makeExpense({ futureExpenseField: 'keep-me' } as Partial<Expense>)],
      },
    });

    const json = serializeBackup(createBackup());
    const validation = validateBackup(json);
    expect(validation.valid).toBe(true);

    // Simulate a fresh install before restoring.
    localStorage.clear();
    const restored = restoreBackup(validation.backupFile!);
    expect(restored.success).toBe(true);

    const money = loadMoneyState();
    const bill = money.directDebits[0] as unknown as Record<string, unknown>;
    const expense = money.expenses[0] as unknown as Record<string, unknown>;
    expect(bill.futureBillFlag).toBe(true);
    expect(bill.dueByDate).toBe('2026-10-10');
    expect(expense.futureExpenseField).toBe('keep-me');
  });

  it('does not crash on unknown top-level backup sections', () => {
    const backup = legacyBackup();
    (backup.data as unknown as Record<string, unknown>).futureModule = {
      enabled: true,
      items: [{ id: 'x' }],
    };
    const root = backup as unknown as Record<string, unknown>;
    root.futureRootKey = 'ignored';

    const validation = validateBackup(JSON.stringify(backup));
    expect(validation.valid).toBe(true);

    const restored = restoreBackup(validation.backupFile!);
    expect(restored.success).toBe(true);
    // Known domains still restore intact alongside the unknown section.
    expect(loadMoneyState().directDebits).toHaveLength(1);
  });
});

describe('Stage 4 · invalid / corrupt records do not crash the app', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('handles a bill whose due-by falls before its next payment', () => {
    const base = loadAllData();
    const bill = makeDebit({ nextPaymentDate: '2026-10-03', dueByDate: '2026-10-01' });
    saveAllData({ ...base, money: { ...getDefaultMoneyState(), directDebits: [bill] } });

    const validation = validateBackup(JSON.stringify(createBackup()));
    expect(validation.valid).toBe(true);
    expect(restoreBackup(validation.backupFile!).success).toBe(true);

    const money = loadMoneyState();
    expect(money.directDebits[0].dueByDate).toBe('2026-10-01');
    // The invalid relationship is detectable, not fatal.
    expect(isDueByOnOrAfterNextPayment('2026-10-03', '2026-10-01')).toBe(false);
    expect(() => getCurrentPayCycleSummary(money)).not.toThrow();
  });

  it('repairs a malformed casual rate rule without throwing', () => {
    const malformed = {
      id: 'bad',
      label: '',
      enabled: true,
      days: ['x', 9, -1, 3],
      allDay: false,
      startTime: '99:99',
      endTime: 'nope',
      mode: 'weird',
      rate: 'abc',
      priority: 'nope',
    };

    const backup = legacyBackup();
    (backup.data.money.incomeConfig as unknown as { hourlyRates: Record<string, unknown> }).hourlyRates = {
      baseRate: 30,
      rateRules: [malformed],
    };

    const validation = validateBackup(JSON.stringify(backup));
    expect(validation.valid).toBe(true);
    expect(restoreBackup(validation.backupFile!).success).toBe(true);

    const money = loadMoneyState();
    const rules = money.incomeConfig?.hourlyRates?.rateRules ?? [];
    expect(rules).toHaveLength(1);
    expect(rules[0].days).toEqual([3]); // invalid days dropped, valid one kept
    expect(rules[0].startTime).toBeUndefined(); // malformed time cleared
    expect(rules[0].endTime).toBeUndefined();
    expect(rules[0].mode).toBe('fixed');
    expect(rules[0].rate).toBe(0);
    expect(rules[0].label).toBe('Rule 1');

    // The repaired rule is still safe to evaluate.
    expect(() =>
      calculateShiftPayWithRules(money.incomeConfig?.hourlyRates, {
        date: '2026-09-30', // Wednesday, day 3
        startTime: '09:00',
        endTime: '17:00',
        breakMinutes: 0,
      })
    ).not.toThrow();
  });

  it('normalizes unknown day values directly through normalizeRateRules', () => {
    const rules = normalizeRateRules([
      { id: 'r', days: ['Mon', 2.5, 6], allDay: true, mode: 'multiplier', rate: 2, priority: -3 },
    ]);
    expect(rules[0].days).toEqual([6]);
    expect(rules[0].rate).toBe(2);
    expect(resolveRuleRate(rules[0], 30)).toBe(60);
  });

  it('tolerates a general expense with an old/unknown category', () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      money: {
        ...getDefaultMoneyState(),
        expenses: [makeExpense({ categoryId: 'category-that-was-deleted' })],
      },
    });

    const validation = validateBackup(JSON.stringify(createBackup()));
    expect(validation.valid).toBe(true);
    expect(restoreBackup(validation.backupFile!).success).toBe(true);

    const money = loadMoneyState();
    expect(money.expenses).toHaveLength(1);
    expect(() => calculateExpenseSummary(money.expenses, '2026-10-02')).not.toThrow();
    const summary = calculateExpenseSummary(money.expenses, '2026-10-02');
    expect(summary.byCategory).toContainEqual({
      categoryId: 'category-that-was-deleted',
      total: 60,
      count: 1,
    });
  });

  it('survives a bill missing its next payment date', () => {
    const base = loadAllData();
    const broken = { ...makeDebit(), nextPaymentDate: undefined } as unknown as DirectDebit;
    saveAllData({ ...base, money: { ...getDefaultMoneyState(), directDebits: [broken] } });

    const money = loadMoneyState();
    expect(() => getCurrentPayCycleSummary(money)).not.toThrow();
  });
});

describe('Stage 4 · raw JSON import / export path', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('defaults missing new fields when importing a pre-Stages raw state', () => {
    const raw = {
      version: 9,
      categories: [],
      reminders: [],
      nodePositions: {},
      money: {
        incomeConfig: {
          id: 'inc-1',
          title: 'Casual',
          employmentType: 'casual_hourly',
          frequency: 'weekly',
          averagePay: 700,
          nextPayDate: '2026-10-09',
          hourlyRates: { baseRate: 27 },
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
        directDebits: [makeDebit()],
        billCategories: CATEGORIES,
        extraIncomeList: [],
        extraIncomeCategories: [],
        tipEntries: [],
        shifts: [],
        payCycleOverrides: {},
      },
    };

    expect(importStorageJson(JSON.stringify(raw))).toBe(true);
    const money = loadMoneyState();
    expect(money.directDebits[0].dueByDate).toBeUndefined();
    expect(money.incomeConfig?.hourlyRates?.rateRules).toEqual([]);
    expect(money.expenses).toEqual([]);
  });

  it('round-trips due-by, rate rules and expenses through exportStorageJson/importStorageJson', () => {
    saveMoneyState({
      ...getDefaultMoneyState(),
      directDebits: [makeDebit({ dueByDate: '2026-10-10' })],
      expenses: [makeExpense()],
      incomeConfig: {
        id: 'inc-1',
        title: 'Casual',
        employmentType: 'casual_hourly',
        frequency: 'weekly',
        averagePay: 700,
        nextPayDate: '2026-10-09',
        hourlyRates: {
          baseRate: 27,
          rateRules: [
            { id: 'weekend', label: 'Weekend', enabled: true, days: [0, 6], allDay: true, mode: 'fixed', rate: 40, priority: 1 },
          ],
        },
        createdAt: '2026-09-01T00:00:00.000Z',
        updatedAt: '2026-09-01T00:00:00.000Z',
      },
    });

    const exported = exportStorageJson();
    localStorage.clear();
    expect(importStorageJson(exported)).toBe(true);

    const money = loadMoneyState();
    expect(money.directDebits[0].dueByDate).toBe('2026-10-10');
    expect(money.incomeConfig?.hourlyRates?.rateRules).toHaveLength(1);
    expect(money.expenses).toHaveLength(1);
  });
});

describe('Stage 4 · cross-domain integration', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps scheduled bills and variable expenses distinct within a pay cycle', () => {
    const config: IncomeConfig = {
      id: 'inc-1',
      title: 'Salary',
      employmentType: 'full_time',
      frequency: 'monthly',
      averagePay: 3000,
      nextPayDate: '2099-01-15',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    };
    const money: MoneyState = {
      ...getDefaultMoneyState(),
      incomeConfig: config,
      directDebits: [makeDebit({ nextPaymentDate: '2099-01-05', amount: 200 })],
      expenses: [
        makeExpense({ id: 'e1', date: '2099-01-02', amount: 60 }),
        makeExpense({ id: 'e2', date: '2099-01-03', amount: 20 }),
      ],
    };

    const cycle = getCurrentPayCycleSummary(money);
    expect(cycle.billsTotalThisCycle).toBe(200);
    expect(cycle.expensesTotalThisCycle).toBe(80);
    // The historical "remaining after bills" figure is unchanged...
    expect(cycle.estimatedRemainingSafe).toBe(2800);
    // ...and expenses are reported in a separate, additional figure.
    expect(cycle.remainingAfterBillsAndExpenses).toBe(2720);
  });

  it('advances a recurring bill and its due-by deadline together', () => {
    const advanced = advanceBillForNextOccurrence(
      makeDebit({ nextPaymentDate: '2026-10-03', dueByDate: '2026-10-10' })
    );
    expect(advanced.nextPaymentDate).toBe('2026-11-03');
    expect(advanced.dueByDate).toBe('2026-11-10');

    // Deadline-free bills are unchanged in that respect.
    const deadlineFree = advanceBillForNextOccurrence(makeDebit({ frequency: 'weekly' }));
    expect(deadlineFree.dueByDate).toBeUndefined();
  });

  it('round-trips due-by, rate rules and expenses together through backup and restore', () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      money: {
        ...getDefaultMoneyState(),
        incomeConfig: {
          id: 'inc-casual',
          title: 'Casual',
          employmentType: 'casual_hourly',
          frequency: 'fortnightly',
          averagePay: 900,
          nextPayDate: '2026-10-09',
          hourlyPayModeEnabled: true,
          hourlyRates: {
            baseRate: 30,
            rateRules: [
              { id: 'evening', label: 'Evening', enabled: true, days: [1, 2, 3, 4, 5], allDay: false, startTime: '19:00', endTime: '23:59', mode: 'fixed', rate: 45, priority: 1 },
            ],
          },
          createdAt: '2026-09-01T00:00:00.000Z',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
        directDebits: [makeDebit({ dueByDate: '2026-10-10' })],
        expenses: [makeExpense()],
      },
    });

    const json = serializeBackup(createBackup());
    const validation = validateBackup(json);
    expect(validation.valid).toBe(true);
    expect(validation.summary?.directDebitsCount).toBe(1);
    expect(validation.summary?.expensesCount).toBe(1);

    localStorage.clear();
    expect(restoreBackup(validation.backupFile!).success).toBe(true);

    const money = loadMoneyState();
    expect(money.directDebits[0].dueByDate).toBe('2026-10-10');
    expect(money.incomeConfig?.hourlyRates?.rateRules).toHaveLength(1);
    expect(money.incomeConfig?.hourlyRates?.rateRules?.[0].rate).toBe(45);
    expect(money.expenses).toHaveLength(1);
    expect(money.expenses[0].amount).toBe(60);
  });

  it('includes every pre-existing backup domain in a complete backup', () => {
    saveMoneyState({ ...getDefaultMoneyState(), expenses: [makeExpense()] });
    const backup = createBackup();
    const data = backup.data;

    expect(Array.isArray(data.categories)).toBe(true);
    expect(Array.isArray(data.reminders)).toBe(true);
    expect(Array.isArray(data.routines)).toBe(true);
    expect(data.nodePositions).toBeDefined();
    expect(data.money).toBeDefined();
    expect(Array.isArray(data.contacts)).toBe(true);
    expect(data.contactCategories).toBeDefined();
    expect(data.contactRelationships).toBeDefined();
    expect(data.appearance).toBeDefined();
    expect(data.notifications).toBeDefined();
    expect(Array.isArray(data.notificationHistory)).toBe(true);
    expect(data.smartEngineSettings).toBeDefined();
    expect(data.preferences).toBeDefined();
    expect(data.diagnostics?.preferences).toBeDefined();
    expect(data.statistics).toBeDefined();
  });
});
