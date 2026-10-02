import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { DirectDebitModal } from '../components/money/DirectDebitModal';
import { DirectDebit, DirectDebitCategory } from '../types/finance';
import {
  advanceBillForNextOccurrence,
  advanceDueByForNextPayment,
  getDueByOffsetDays,
  getNextBillOccurrence,
  isDueByOnOrAfterNextPayment,
} from '../utils/finance';
import { loadMoneyState, saveMoneyState } from '../utils/storage';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { createBackup } from '../services/backup';

const CATEGORIES: DirectDebitCategory[] = [
  { id: 'bcat-util', name: 'Utilities', color: '#6366f1' },
];

const makeDebit = (overrides: Partial<DirectDebit> = {}): DirectDebit => ({
  id: 'dd-1',
  title: 'Vehicle registration',
  amount: 120,
  categoryId: 'bcat-util',
  frequency: 'monthly',
  nextPaymentDate: '2026-10-03',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

function renderModal(debit: DirectDebit | null = null) {
  const onSave = vi.fn();
  const onClose = vi.fn();
  render(
    <DirectDebitModal
      isOpen
      onClose={onClose}
      debit={debit}
      categories={CATEGORIES}
      reminders={[]}
      onSave={onSave}
    />
  );
  return { onSave, onClose };
}

function fillRequiredFields(title = 'Vehicle registration', amount = '120') {
  fireEvent.change(screen.getByPlaceholderText('e.g. Netflix, Car Insurance, Rent'), {
    target: { value: title },
  });
  fireEvent.change(screen.getByPlaceholderText('0.00'), { target: { value: amount } });
}

function submittedDebit(onSave: ReturnType<typeof vi.fn>): DirectDebit {
  expect(onSave).toHaveBeenCalledTimes(1);
  return onSave.mock.calls[0][0] as DirectDebit;
}

describe('Direct Debit: Payment due by', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('creates a bill with only a next payment date and no deadline', () => {
    const { onSave } = renderModal();

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Next payment date'), { target: { value: '2026-10-03' } });
    fireEvent.click(screen.getByText('Save Bill'));

    const saved = submittedDebit(onSave);
    expect(saved.nextPaymentDate).toBe('2026-10-03');
    expect(saved.dueByDate).toBeUndefined();
  });

  it('creates a bill with both next payment and due-by dates', () => {
    const { onSave } = renderModal();

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Next payment date'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('Payment due by'), { target: { value: '2026-10-10' } });
    fireEvent.click(screen.getByText('Save Bill'));

    const saved = submittedDebit(onSave);
    expect(saved.nextPaymentDate).toBe('2026-10-03');
    expect(saved.dueByDate).toBe('2026-10-10');
  });

  it('allows a due-by date equal to the next payment date', () => {
    const { onSave } = renderModal();

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Next payment date'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('Payment due by'), { target: { value: '2026-10-03' } });
    fireEvent.click(screen.getByText('Save Bill'));

    const saved = submittedDebit(onSave);
    expect(saved.dueByDate).toBe('2026-10-03');
  });

  it('blocks saving when due-by falls before next payment and keeps both values', () => {
    const { onSave } = renderModal();

    fillRequiredFields();
    fireEvent.change(screen.getByLabelText('Next payment date'), { target: { value: '2026-10-03' } });
    fireEvent.change(screen.getByLabelText('Payment due by'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('Save Bill'));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getAllByText(/on or after the next payment date/i).length).toBeGreaterThan(0);
    // Neither value is silently rewritten.
    expect((screen.getByLabelText('Next payment date') as HTMLInputElement).value).toBe('2026-10-03');
    expect((screen.getByLabelText('Payment due by') as HTMLInputElement).value).toBe('2026-10-01');
  });

  it('clears an existing due-by date when editing', () => {
    const { onSave } = renderModal(
      makeDebit({ nextPaymentDate: '2026-10-03', dueByDate: '2026-10-10' })
    );

    expect((screen.getByLabelText('Payment due by') as HTMLInputElement).value).toBe('2026-10-10');
    fireEvent.click(screen.getByText('Clear'));
    expect((screen.getByLabelText('Payment due by') as HTMLInputElement).value).toBe('');
    fireEvent.click(screen.getByText('Save Bill'));

    const saved = submittedDebit(onSave);
    expect(saved.dueByDate).toBeUndefined();
    expect(saved.nextPaymentDate).toBe('2026-10-03');
  });

  it('advances to the next occurrence and preserves the due-by offset', () => {
    const { onSave } = renderModal(
      makeDebit({ nextPaymentDate: '2026-10-03', dueByDate: '2026-10-10' })
    );

    fireEvent.click(screen.getByText('Advance to next occurrence'));
    expect((screen.getByLabelText('Next payment date') as HTMLInputElement).value).toBe('2026-11-03');
    expect((screen.getByLabelText('Payment due by') as HTMLInputElement).value).toBe('2026-11-10');

    fireEvent.click(screen.getByText('Save Bill'));
    const saved = submittedDebit(onSave);
    expect(saved.nextPaymentDate).toBe('2026-11-03');
    expect(saved.dueByDate).toBe('2026-11-10');
  });
});

describe('Direct Debit: date helpers', () => {
  it('reports the offset and validity of a due-by date', () => {
    expect(getDueByOffsetDays('2026-10-03', '2026-10-10')).toBe(7);
    expect(getDueByOffsetDays('2026-10-03', undefined)).toBeNull();
    expect(isDueByOnOrAfterNextPayment('2026-10-03', '2026-10-10')).toBe(true);
    expect(isDueByOnOrAfterNextPayment('2026-10-03', '2026-10-03')).toBe(true);
    expect(isDueByOnOrAfterNextPayment('2026-10-03', '2026-10-01')).toBe(false);
    expect(isDueByOnOrAfterNextPayment('2026-10-03', undefined)).toBe(true);
  });

  it('advances the due-by date while keeping its offset', () => {
    expect(advanceDueByForNextPayment('2026-10-03', '2026-11-03', '2026-10-10')).toBe('2026-11-10');
    // No deadline -> stays none.
    expect(advanceDueByForNextPayment('2026-10-03', '2026-11-03', undefined)).toBeUndefined();
    // Roll-over across a year boundary.
    expect(advanceDueByForNextPayment('2026-12-28', '2027-01-28', '2026-12-31')).toBe('2027-01-31');
    // End-of-month edge: short months clamp to their last day instead of
    // rolling the payment into the next month.
    expect(getNextBillOccurrence('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(advanceDueByForNextPayment('2026-01-31', '2026-02-28', '2026-02-07')).toBe('2026-03-07');
  });

  it('advances a recurring bill and its deadline together', () => {
    const advanced = advanceBillForNextOccurrence(
      makeDebit({ nextPaymentDate: '2026-10-03', dueByDate: '2026-10-10' })
    );
    expect(advanced.nextPaymentDate).toBe('2026-11-03');
    expect(advanced.dueByDate).toBe('2026-11-10');

    const deadlineFree = advanceBillForNextOccurrence(
      makeDebit({ frequency: 'weekly', nextPaymentDate: '2026-10-03' })
    );
    expect(deadlineFree.nextPaymentDate).toBe('2026-10-10');
    expect(deadlineFree.dueByDate).toBeUndefined();
  });
});

describe('Direct Debit: persistence and backup compatibility', () => {
  it('loads older stored bills that have no due-by field', () => {
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

    const debits = loadMoneyState().directDebits;
    expect(debits).toHaveLength(1);
    expect(debits[0].nextPaymentDate).toBe('2026-10-03');
    expect(debits[0].dueByDate).toBeUndefined();
  });

  it('round-trips the due-by date through local storage', () => {
    const money = {
      ...getDefaultMoneyState(),
      directDebits: [makeDebit({ dueByDate: '2026-10-10' })],
    };
    saveMoneyState(money);

    const reloaded = loadMoneyState();
    expect(reloaded.directDebits[0].dueByDate).toBe('2026-10-10');
  });

  it('includes the due-by date in a full backup', () => {
    const money = {
      ...getDefaultMoneyState(),
      directDebits: [makeDebit({ dueByDate: '2026-10-10' })],
    };
    saveMoneyState(money);

    const backup = createBackup();
    expect(backup.data.money.directDebits[0].dueByDate).toBe('2026-10-10');
  });
});
