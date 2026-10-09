import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MoneyModule } from '../components/money/MoneyModule';
import { IncomeConfig, MoneyState, Shift } from '../types/finance';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';

const makeShift = (overrides: Partial<Shift> = {}): Shift => ({
  id: overrides.id || 'shift',
  date: '2026-10-01',
  startTime: '09:00',
  endTime: '17:00',
  breakMinutes: 30,
  rateType: 'base',
  hourlyRate: 30,
  paidHours: 7.5,
  estimatedPay: 225,
  createdAt: '2026-09-30',
  ...overrides,
});

const makeIncome = (nextPayDate: string): IncomeConfig => ({
  id: 'inc-1',
  title: 'Work',
  employmentType: 'casual_hourly',
  frequency: 'fortnightly',
  averagePay: 2000,
  nextPayDate,
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
});

const renderIncomeTab = (state: MoneyState) => {
  render(
    <MoneyModule moneyState={state} reminders={[]} onUpdateMoneyState={() => {}} />
  );
  fireEvent.click(screen.getByRole('tab', { name: /Income & Pay/i }));
};

/** Reads the value shown next to a stats-strip label. */
const statValue = (label: string) => screen.getByText(label).parentElement?.textContent ?? '';

describe('MoneyModule shift log cycle grouping', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-05T12:00:00'));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('shows only active cycle stats and groups completed cycles as collapsed rows', () => {
    const state: MoneyState = {
      ...getDefaultMoneyState(),
      incomeConfig: makeIncome('2026-10-09'),
      shifts: [
        makeShift({ id: 'current', date: '2026-10-01', paidHours: 7.5, estimatedPay: 225 }),
        makeShift({ id: 'prev-1', date: '2026-09-20', paidHours: 4, estimatedPay: 120 }),
        makeShift({ id: 'prev-2', date: '2026-09-18', paidHours: 6, estimatedPay: 180 }),
        makeShift({ id: 'older', date: '2026-09-05', paidHours: 3, estimatedPay: 90 }),
      ],
    };

    renderIncomeTab(state);

    // Stats reflect only the active cycle (7.5 hrs / $225), not all logged shifts.
    expect(statValue('Logged Hours (This Cycle)')).toContain('7.5 hrs');
    expect(statValue('Estimated Shift Pay (This Cycle)')).toContain('$225');
    expect(statValue('Logged Hours (This Cycle)')).not.toContain('20.5 hrs');
    expect(statValue('Estimated Shift Pay (This Cycle)')).not.toContain('$615');

    // Two completed cycles are collapsed into summary rows.
    const groupRows = screen.getAllByText(/Pay cycle ended/);
    expect(groupRows).toHaveLength(2);

    // The two shifts in the most recent completed cycle are grouped: their
    // individual dates are hidden until the group is expanded.
    expect(screen.queryByText(/20\/09\/2026/)).toBeNull();
    fireEvent.click(groupRows[0]);

    expect(screen.getByText(/20\/09\/2026/)).toBeInTheDocument();
    expect(screen.getByText(/18\/09\/2026/)).toBeInTheDocument();
  });

  it('resets the stats strip to zero when the active cycle has no shifts', () => {
    const state: MoneyState = {
      ...getDefaultMoneyState(),
      incomeConfig: makeIncome('2026-10-09'),
      shifts: [makeShift({ id: 'ended', date: '2026-09-20', paidHours: 8, estimatedPay: 240 })],
    };

    renderIncomeTab(state);

    expect(statValue('Logged Hours (This Cycle)')).toContain('0 hrs');
    expect(statValue('Estimated Shift Pay (This Cycle)')).toContain('$0');
    expect(screen.getAllByText(/Pay cycle ended/)).toHaveLength(1);
  });
});
