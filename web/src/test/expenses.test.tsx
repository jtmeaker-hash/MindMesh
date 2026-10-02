import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ExpenseModal } from '../components/money/ExpenseModal';
import {
  DirectDebit,
  DirectDebitCategory,
  Expense,
  IncomeConfig,
  MoneyState,
} from '../types/finance';
import {
  calculateExpenseSummary,
  sortExpensesNewestFirst,
  getCurrentPayCycleSummary,
} from '../utils/finance';
import { loadMoneyState, saveMoneyState } from '../services/storage';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { createBackup, serializeBackup, validateBackup, restoreBackup } from '../services/backup';

const CATEGORIES: DirectDebitCategory[] = [
  { id: 'bcat-car', name: 'Car & Transport', color: '#3b82f6' },
  { id: 'bcat-food', name: 'Food & Groceries', color: '#f59e0b' },
];

const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 'exp-1',
  title: 'Fuel',
  amount: 78.45,
  date: '2026-09-20',
  categoryId: 'bcat-car',
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-20T08:00:00.000Z',
  ...overrides,
});

const makeDebit = (overrides: Partial<DirectDebit> = {}): DirectDebit => ({
  id: 'dd-1',
  title: 'Phone',
  amount: 45.5,
  categoryId: 'bcat-car',
  frequency: 'monthly',
  nextPaymentDate: '2026-09-22',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function renderModal(expense: Expense | null = null) {
  const onSave = vi.fn();
  const onDelete = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <ExpenseModal
      isOpen
      onClose={onClose}
      expense={expense}
      categories={CATEGORIES}
      onSave={onSave}
      onDelete={onDelete}
    />
  );
  return { onSave, onDelete, onClose, ...utils };
}

function submittedExpense(onSave: ReturnType<typeof vi.fn>): Expense {
  expect(onSave).toHaveBeenCalledTimes(1);
  return onSave.mock.calls[0][0] as Expense;
}

describe('General Expenses: modal create / edit / delete', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('creates an expense from only title, amount and date with no recurrence fields', () => {
    const { onSave } = renderModal();

    fireEvent.change(screen.getByPlaceholderText('e.g. Fuel, Groceries, Parking'), {
      target: { value: 'Fuel' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '78.45' } });
    fireEvent.change(document.querySelector('input[type="date"]') as HTMLInputElement, {
      target: { value: '2026-09-20' },
    });
    fireEvent.click(screen.getByText('Save Expense'));

    const saved = submittedExpense(onSave);
    expect(saved.title).toBe('Fuel');
    expect(saved.amount).toBe(78.45);
    expect(saved.date).toBe('2026-09-20');
    // No scheduling fields exist on an expense.
    const record = saved as unknown as Record<string, unknown>;
    expect(record.frequency).toBeUndefined();
    expect(record.nextPaymentDate).toBeUndefined();
    expect(record.dueByDate).toBeUndefined();
  });

  it('persists the selected category and optional details', () => {
    const { onSave } = renderModal();

    fireEvent.change(screen.getByPlaceholderText('e.g. Fuel, Groceries, Parking'), {
      target: { value: 'Weekly shop' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '132' } });
    fireEvent.change(screen.getByLabelText('Category'), { target: { value: 'bcat-food' } });
    fireEvent.change(screen.getByPlaceholderText('e.g. Ampol, Coles'), { target: { value: 'Coles' } });
    fireEvent.click(screen.getByText('Save Expense'));

    const saved = submittedExpense(onSave);
    expect(saved.categoryId).toBe('bcat-food');
    expect(saved.merchant).toBe('Coles');
  });

  it('edits an existing expense, preserving its id and createdAt', () => {
    const existing = makeExpense({ notes: 'old', updatedAt: '2026-09-20T08:00:00.000Z' });
    const { onSave } = renderModal(existing);

    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '95.10' } });
    fireEvent.click(screen.getByText('Save Expense'));

    const saved = submittedExpense(onSave);
    expect(saved.id).toBe('exp-1');
    expect(saved.amount).toBe(95.1);
    expect(saved.createdAt).toBe(existing.createdAt);
  });

  it('deletes an expense through the existing confirm pattern', () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { onDelete, onClose } = renderModal(makeExpense());

    fireEvent.click(screen.getByText('Delete'));

    expect(confirmSpy).toHaveBeenCalled();
    expect(onDelete).toHaveBeenCalledWith('exp-1');
    expect(onClose).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('rejects a non-positive amount', () => {
    const { onSave, container } = renderModal();

    fireEvent.change(screen.getByPlaceholderText('e.g. Fuel, Groceries, Parking'), {
      target: { value: 'Fuel' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '0' } });
    // Submit the form directly so native constraint validation does not mask
    // the component's own amount check.
    fireEvent.submit(container.querySelector('form') as HTMLFormElement);

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

describe('General Expenses: ordering and aggregates', () => {
  it('orders expenses newest first by date, then most recently created', () => {
    const list = [
      makeExpense({ id: 'a', date: '2026-09-10' }),
      makeExpense({ id: 'b', date: '2026-09-25' }),
      makeExpense({ id: 'c', date: '2026-09-25', createdAt: '2026-09-25T12:00:00.000Z' }),
    ];

    expect(sortExpensesNewestFirst(list).map((e) => e.id)).toEqual(['c', 'b', 'a']);
  });

  it('sums variable amounts without floating-point drift', () => {
    const list = [
      makeExpense({ id: 'a', amount: 0.1, date: '2026-09-20' }),
      makeExpense({ id: 'b', amount: 0.2, date: '2026-09-20' }),
      makeExpense({ id: 'c', amount: 10.33, date: '2026-09-05' }),
    ];

    const summary = calculateExpenseSummary(list, '2026-09-20', '2026-09-01', '2026-09-30');
    expect(summary.total).toBe(10.63);
    expect(summary.todayTotal).toBe(0.3);
    expect(summary.monthTotal).toBe(10.63);
    expect(summary.cycleTotal).toBe(10.63);
    expect(summary.count).toBe(3);
  });

  it('groups totals by category, largest first', () => {
    const list = [
      makeExpense({ id: 'a', amount: 50, categoryId: 'bcat-car' }),
      makeExpense({ id: 'b', amount: 120, categoryId: 'bcat-food' }),
      makeExpense({ id: 'c', amount: 20, categoryId: 'bcat-car' }),
    ];

    const summary = calculateExpenseSummary(list, '2026-09-20');
    expect(summary.byCategory[0]).toEqual({ categoryId: 'bcat-food', total: 120, count: 1 });
    expect(summary.byCategory[1]).toEqual({ categoryId: 'bcat-car', total: 70, count: 2 });
  });
});

describe('General Expenses: pay-cycle isolation', () => {
  // A far-future next pay date keeps the derived pay cycle deterministic no
  // matter what the real "today" is when the tests run.
  const incomeConfig: IncomeConfig = {
    id: 'inc-1',
    title: 'Work',
    employmentType: 'full_time',
    frequency: 'monthly',
    averagePay: 2000,
    nextPayDate: '2099-01-15',
    createdAt: '2098-12-01',
    updatedAt: '2098-12-01',
  };

  it('keeps direct-debit totals unchanged and reports expenses separately', () => {
    const base: MoneyState = {
      ...getDefaultMoneyState(),
      incomeConfig,
      directDebits: [makeDebit()],
      expenses: [makeExpense({ amount: 80, date: '2098-12-20' })],
    };

    const withoutExpenses = getCurrentPayCycleSummary({ ...base, expenses: [] });
    const withExpenses = getCurrentPayCycleSummary(base);

    // The bills calculation and "remaining after bills" meaning are untouched.
    expect(withExpenses.billsTotalThisCycle).toBe(withoutExpenses.billsTotalThisCycle);
    expect(withExpenses.estimatedRemainingSafe).toBe(withoutExpenses.estimatedRemainingSafe);

    expect(withExpenses.expensesTotalThisCycle).toBe(80);
    expect(withExpenses.expensesInCycle.map((e) => e.id)).toEqual(['exp-1']);
    expect(withExpenses.remainingAfterBillsAndExpenses).toBe(
      withExpenses.estimatedRemainingSafe - 80
    );
  });

  it('does not pull expenses dated outside the cycle into the cycle total', () => {
    const state: MoneyState = {
      ...getDefaultMoneyState(),
      incomeConfig,
      expenses: [makeExpense({ amount: 50, date: '2026-01-01' })],
    };

    const summary = getCurrentPayCycleSummary(state);
    expect(summary.expensesTotalThisCycle).toBe(0);
    expect(summary.expensesInCycle).toHaveLength(0);
  });
});

describe('General Expenses: persistence and backup compatibility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips create / edit / delete through local storage', () => {
    const money = { ...getDefaultMoneyState(), expenses: [makeExpense()] };
    saveMoneyState(money);
    expect(loadMoneyState().expenses).toHaveLength(1);

    const edited = makeExpense({ amount: 99.99, categoryId: 'bcat-food' });
    saveMoneyState({ ...loadMoneyState(), expenses: [edited] });
    expect(loadMoneyState().expenses[0].amount).toBe(99.99);
    expect(loadMoneyState().expenses[0].categoryId).toBe('bcat-food');

    saveMoneyState({ ...loadMoneyState(), expenses: [] });
    expect(loadMoneyState().expenses).toEqual([]);
  });

  it('loads an older stored payload with no expenses as an empty collection', () => {
    localStorage.setItem(
      'mindmesh_state_v2',
      JSON.stringify({
        version: 9,
        categories: [],
        reminders: [],
        nodePositions: {},
        money: {
          incomeConfig: null,
          directDebits: [makeDebit()],
          billCategories: CATEGORIES,
          extraIncomeList: [],
          extraIncomeCategories: [],
          tipEntries: [],
          shifts: [],
          payCycleOverrides: {},
        },
      })
    );

    const money = loadMoneyState();
    expect(money.expenses).toEqual([]);
    expect(money.directDebits).toHaveLength(1);
  });

  it('includes expenses in a full backup and a serialize/validate/restore round trip', () => {
    saveMoneyState({ ...getDefaultMoneyState(), expenses: [makeExpense({ merchant: 'Ampol' })] });

    const backup = createBackup();
    expect(backup.data.money.expenses).toHaveLength(1);
    expect(backup.data.money.expenses[0].merchant).toBe('Ampol');

    const json = serializeBackup(backup);
    const validated = validateBackup(json);
    expect(validated.valid).toBe(true);
    expect(validated.summary?.expensesCount).toBe(1);

    // Clear the live store, then restore from the serialized file.
    saveMoneyState(getDefaultMoneyState());
    const restored = restoreBackup(validated.backupFile!);
    expect(restored.success).toBe(true);

    const reloaded = loadMoneyState();
    expect(reloaded.expenses).toHaveLength(1);
    expect(reloaded.expenses[0].title).toBe('Fuel');
    expect(reloaded.expenses[0].amount).toBe(78.45);
  });

  it('restores an old backup that has no expenses without error', () => {
    const legacyBackup = {
      backupVersion: 3,
      appVersion: '1.4.0',
      appName: 'MindMesh',
      createdAt: '2026-09-01T00:00:00.000Z',
      schemaVersion: 9,
      data: {
        categories: [],
        reminders: [],
        nodePositions: {},
        money: {
          incomeConfig: null,
          directDebits: [makeDebit()],
          billCategories: CATEGORIES,
          extraIncomeList: [],
          extraIncomeCategories: [],
          tipEntries: [],
          shifts: [],
          payCycleOverrides: {},
        },
        contacts: [],
        contactCategories: [],
        contactRelationships: [],
      },
    };

    const validated = validateBackup(JSON.stringify(legacyBackup));
    expect(validated.valid).toBe(true);
    expect(validated.summary?.expensesCount).toBe(0);

    const restored = restoreBackup(validated.backupFile!);
    expect(restored.success).toBe(true);

    const money = loadMoneyState();
    expect(money.expenses).toEqual([]);
    expect(money.directDebits).toHaveLength(1);
  });
});
