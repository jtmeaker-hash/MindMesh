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
  addMonthsClamped,
  getExpenseCycleContribution,
  getExpenseOccurrencesInDateRange,
  getNextBillOccurrence,
  getDirectDebitStatus,
  reconcileDirectDebits,
  resolveExpenseRepeat,
  resolveDirectDebitKind,
  getCurrentPayCycleSummary,
} from '../utils/finance';
import { loadMoneyState, saveMoneyState } from '../services/storage';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { createBackup, serializeBackup, validateBackup, restoreBackup } from '../services/backup';
import { collectDirectDebitNotifications } from '../services/moneyNotifications';

const CATEGORIES: DirectDebitCategory[] = [
  { id: 'bcat-car', name: 'Car & Transport', color: '#3b82f6' },
  { id: 'bcat-food', name: 'Food & Groceries', color: '#f59e0b' },
];

const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 'exp-1',
  title: 'Fuel',
  amount: 70,
  categoryId: 'bcat-car',
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-20T08:00:00.000Z',
  ...overrides,
});

const makeDebit = (overrides: Partial<DirectDebit> = {}): DirectDebit => ({
  id: 'dd-1',
  title: 'Netflix',
  amount: 25,
  categoryId: 'bcat-car',
  frequency: 'monthly',
  nextPaymentDate: '2026-10-15',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('Recurrence: monthly handling across different month lengths', () => {
  it('clamps short months instead of rolling into the next month', () => {
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(getNextBillOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(getNextBillOccurrence('2026-08-31', 'monthly')).toBe('2026-09-30');
  });

  it('keeps the intended day of month via the anchor across a short month', () => {
    expect(getNextBillOccurrence('2026-01-31', 'monthly', 1, undefined, 31)).toBe('2026-02-28');
    expect(getNextBillOccurrence('2026-02-28', 'monthly', 1, undefined, 31)).toBe('2026-03-31');
    expect(getNextBillOccurrence('2026-03-31', 'quarterly')).toBe('2026-06-30');
  });
});

describe('General Expenses: repeating and per-pay-cycle behaviour', () => {
  it('allocates a per-pay-cycle amount to every cycle with no date', () => {
    const expense = makeExpense({ repeat: 'per_pay_cycle', amount: 70 });
    const first = getExpenseCycleContribution(expense, '2026-09-15', '2026-10-15');
    const second = getExpenseCycleContribution(expense, '2026-10-15', '2026-11-15');

    expect(first.amount).toBe(70);
    expect(first.undated).toBe(true);
    expect(first.occurrences).toEqual([]);
    // It resets into the next cycle automatically without being recreated.
    expect(second.amount).toBe(70);
  });

  it('counts a repeating weekly expense once per occurrence in the cycle', () => {
    const expense = makeExpense({ repeat: 'weekly', amount: 10, date: '2026-09-01' });
    expect(getExpenseOccurrencesInDateRange(expense, '2026-09-01', '2026-09-30')).toEqual([
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
      '2026-09-22',
      '2026-09-29',
    ]);
    expect(getExpenseCycleContribution(expense, '2026-09-01', '2026-09-30').amount).toBe(50);
  });

  it('counts an undated one-off only in the cycle it was created in', () => {
    const expense = makeExpense({ repeat: 'none', date: undefined, createdAt: '2026-10-01T12:00:00.000Z' });
    expect(getExpenseCycleContribution(expense, '2026-09-15', '2026-10-15').amount).toBe(70);
    expect(getExpenseCycleContribution(expense, '2026-11-15', '2026-12-15').amount).toBe(0);
  });

  it('feeds per-pay-cycle expenses into the current cycle budget and remaining money', () => {
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
    const base: MoneyState = { ...getDefaultMoneyState(), incomeConfig };

    const without = getCurrentPayCycleSummary(base);
    const withFuel = getCurrentPayCycleSummary({
      ...base,
      expenses: [makeExpense({ repeat: 'per_pay_cycle', amount: 70, date: undefined })],
    });

    expect(withFuel.expensesTotalThisCycle).toBe(70);
    expect(withFuel.expectedExpensesTotalThisCycle).toBe(70);
    expect(withFuel.remainingAfterBillsAndExpenses).toBe(without.remainingAfterBillsAndExpenses - 70);
  });
});

describe('Direct Debits: lifecycle without overdue or manual completion', () => {
  it('reports a due-today withdrawal without ever being overdue', () => {
    const debit = makeDebit({ kind: 'direct_debit', nextPaymentDate: '2026-10-15' });
    const status = getDirectDebitStatus(debit, '2026-10-15');

    expect(status.kind).toBe('direct_debit');
    expect(status.state).toBe('due_today');
    expect(status.isDueToday).toBe(true);
    expect(status.isOverdue).toBe(false);
    // Even long after the date passes, it is never overdue.
    expect(getDirectDebitStatus(debit, '2027-05-01').isOverdue).toBe(false);
  });

  it('automatically advances to the next occurrence the day after payment', () => {
    const debit = makeDebit({ kind: 'direct_debit', nextPaymentDate: '2026-10-15' });
    const reconciled = reconcileDirectDebits([debit], '2026-10-16');

    expect(reconciled[0].nextPaymentDate).toBe('2026-11-15');
    const status = getDirectDebitStatus(reconciled[0], '2026-10-16');
    expect(status.state).toBe('upcoming');
    expect(status.isOverdue).toBe(false);
  });

  it('keeps an end-of-month schedule on its day across short months', () => {
    const debit = makeDebit({ kind: 'direct_debit', nextPaymentDate: '2026-01-31' });
    const reconciled = reconcileDirectDebits([debit], '2026-02-05');
    expect(reconciled[0].nextPaymentDate).toBe('2026-02-28');
    // The anchor is remembered, so the following month returns to the 31st.
    const again = reconcileDirectDebits(reconciled, '2026-03-05');
    expect(again[0].nextPaymentDate).toBe('2026-03-31');
  });

  it('catches up several missed occurrences at once', () => {
    const debit = makeDebit({ kind: 'direct_debit', nextPaymentDate: '2026-07-15' });
    const reconciled = reconcileDirectDebits([debit], '2026-10-16');
    expect(reconciled[0].nextPaymentDate).toBe('2026-11-15');
  });

  it('leaves user-paid bills untouched so an overdue deadline is preserved', () => {
    const bill = makeDebit({ kind: 'bill', nextPaymentDate: '2026-10-01', dueByDate: '2026-10-05' });
    const reconciled = reconcileDirectDebits([bill], '2026-10-20');

    expect(reconciled[0].nextPaymentDate).toBe('2026-10-01');
    const status = getDirectDebitStatus(reconciled[0], '2026-10-20');
    expect(status.isOverdue).toBe(true);
    expect(status.state).toBe('overdue');
  });

  it('builds a notification for each automatic withdrawal due today', () => {
    const notifications = collectDirectDebitNotifications(
      [makeDebit({ kind: 'direct_debit', nextPaymentDate: '2026-10-15' })],
      '2026-10-15'
    );
    expect(notifications).toHaveLength(1);
    expect(notifications[0].message).toBe('Netflix $25 is scheduled to be withdrawn today.');
  });
});

describe('Migration and backup compatibility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('infers kind for legacy records and defaults expense repeat to none', () => {
    localStorage.setItem(
      'mindmesh_state_v2',
      JSON.stringify({
        version: 9,
        categories: [],
        reminders: [],
        nodePositions: {},
        money: {
          incomeConfig: null,
          directDebits: [
            makeDebit({ dueByDate: undefined, id: 'legacy-dd' }),
            makeDebit({ dueByDate: '2026-10-05', id: 'legacy-bill' }),
          ],
          billCategories: CATEGORIES,
          extraIncomeList: [],
          extraIncomeCategories: [],
          tipEntries: [],
          shifts: [],
          expenses: [makeExpense({ id: 'legacy-exp', repeat: undefined, date: '2026-09-20' })],
          payCycleOverrides: {},
        },
      })
    );

    const money = loadMoneyState();
    expect(resolveDirectDebitKind(money.directDebits[0])).toBe('direct_debit');
    expect(resolveDirectDebitKind(money.directDebits[1])).toBe('bill');
    expect(resolveExpenseRepeat(money.expenses[0])).toBe('none');
    expect(money.expenses[0].estimated).toBe(false);
  });

  it('round-trips repeating expenses and direct-debit kind through storage and backup', () => {
    const money: MoneyState = {
      ...getDefaultMoneyState(),
      directDebits: [makeDebit({ kind: 'direct_debit', nextPaymentDate: '2026-10-15' })],
      expenses: [makeExpense({ repeat: 'per_pay_cycle', date: undefined, amount: 70 })],
    };
    saveMoneyState(money);

    const reloaded = loadMoneyState();
    expect(reloaded.directDebits[0].kind).toBe('direct_debit');
    expect(reloaded.expenses[0].repeat).toBe('per_pay_cycle');
    expect(reloaded.expenses[0].date).toBeUndefined();

    const backup = createBackup();
    expect(backup.data.money.expenses[0].repeat).toBe('per_pay_cycle');
    expect(backup.data.money.directDebits[0].kind).toBe('direct_debit');

    const validated = validateBackup(serializeBackup(backup));
    expect(validated.valid).toBe(true);
    saveMoneyState(getDefaultMoneyState());
    const restored = restoreBackup(validated.backupFile!);
    expect(restored.success).toBe(true);

    const after = loadMoneyState();
    expect(after.expenses[0].repeat).toBe('per_pay_cycle');
    expect(after.directDebits[0].kind).toBe('direct_debit');
  });
});

describe('ExpenseModal: date is optional and repeat is selectable', () => {
  afterEach(() => cleanup());

  function renderModal(expense: Expense | null = null) {
    const onSave = vi.fn();
    const onClose = vi.fn();
    render(
      <ExpenseModal
        isOpen
        onClose={onClose}
        expense={expense}
        categories={CATEGORIES}
        onSave={onSave}
        onDelete={vi.fn()}
      />
    );
    return { onSave, onClose };
  }

  it('saves a per-pay-cycle expense with no date', () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('e.g. Fuel, Groceries, Parking'), {
      target: { value: 'Fuel' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '70' } });
    fireEvent.change(screen.getByLabelText('Repeat'), { target: { value: 'per_pay_cycle' } });
    fireEvent.click(screen.getByText('Save Expense'));

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0][0] as Expense;
    expect(saved.repeat).toBe('per_pay_cycle');
    expect(saved.estimated).toBe(true);
    expect(saved.date).toBeUndefined();
    // No missing-date warning is shown for a per-pay-cycle expense.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('still saves a one-off expense with no date', () => {
    const { onSave } = renderModal();
    fireEvent.change(screen.getByPlaceholderText('e.g. Fuel, Groceries, Parking'), {
      target: { value: 'Parking' },
    });
    fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: '12' } });
    fireEvent.click(screen.getByText('Save Expense'));

    const saved = onSave.mock.calls[0][0] as Expense;
    expect(saved.repeat).toBe('none');
    expect(saved.date).toBeUndefined();
    expect(saved.estimated).toBe(true);
  });
});
