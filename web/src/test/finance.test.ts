import { describe, it, expect } from 'vitest';
import {
  formatCurrency,
  formatDateAU,
  addDecimals,
  subtractDecimals,
  daysBetween,
  getNextBillOccurrence,
  getBillOccurrencesInDateRange,
  calculatePayCycleBounds,
  calculatePayCycleSummary,
  calculateShiftDurationHours,
  calculateShiftEstimate,
  resolveHourlyRate,
  calculateTipSummaries,
  getDirectDebitsOverview,
  computeShiftStats,
  computeTipStats,
  getCurrentPayCycleSummary,
  getUpcomingMoneyTimeline,
} from '../utils/finance';
import { DirectDebit, IncomeConfig, MoneyState } from '../types/finance';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';

describe('Finance Utilities', () => {
  it('formats currency with AUD sign and decimal precision', () => {
    expect(formatCurrency(120)).toBe('$120');
    expect(formatCurrency(120.5)).toBe('$120.50');
    expect(formatCurrency(-45.2)).toBe('-$45.20');
    expect(formatCurrency(0)).toBe('$0');
  });

  it('performs decimal safe arithmetic', () => {
    expect(addDecimals(0.1, 0.2)).toBe(0.3);
    expect(subtractDecimals(1.0, 0.9)).toBe(0.1);
  });

  it('formats Australian date (DD/MM/YYYY)', () => {
    expect(formatDateAU('2026-10-05')).toBe('05/10/2026');
    expect(formatDateAU('')).toBe('');
  });

  it('computes days between dates correctly', () => {
    expect(daysBetween('2026-09-20', '2026-09-25')).toBe(5);
    expect(daysBetween('2026-09-25', '2026-09-20')).toBe(-5);
    expect(daysBetween('2026-09-20', '2026-09-20')).toBe(0);
  });

  it('computes next bill occurrences across different frequencies', () => {
    expect(getNextBillOccurrence('2026-09-01', 'weekly')).toBe('2026-09-08');
    expect(getNextBillOccurrence('2026-09-01', 'fortnightly')).toBe('2026-09-15');
    expect(getNextBillOccurrence('2026-09-01', 'monthly')).toBe('2026-10-01');
    expect(getNextBillOccurrence('2026-09-01', 'quarterly')).toBe('2026-12-01');
    expect(getNextBillOccurrence('2026-09-01', 'every_x_days', 1, 10)).toBe('2026-09-11');
  });

  it('computes occurrences within date range without infinite loops', () => {
    const bill: DirectDebit = {
      id: 'b1',
      title: 'Rent',
      amount: 450,
      categoryId: 'bcat-rent',
      frequency: 'weekly',
      nextPaymentDate: '2026-09-20',
      active: true,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
    };

    const occurrences = getBillOccurrencesInDateRange(bill, '2026-09-20', '2026-10-05');
    expect(occurrences.length).toBe(3);
    expect(occurrences.map((o) => o.date)).toEqual(['2026-09-20', '2026-09-27', '2026-10-04']);
  });

  it('calculates pay cycle bounds and summary', () => {
    const incomeConfig: IncomeConfig = {
      id: 'inc-1',
      title: 'Primary Job',
      employmentType: 'casual_hourly',
      frequency: 'fortnightly',
      averagePay: 1200,
      nextPayDate: '2026-09-26',
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
    };

    const bounds = calculatePayCycleBounds(incomeConfig, '2026-09-20');
    expect(bounds.nextPayDate).toBe('2026-09-26');
    expect(bounds.previousPayDate).toBe('2026-09-12');
    expect(bounds.daysUntilNextPay).toBe(6);

    const bill: DirectDebit = {
      id: 'b1',
      title: 'Phone Bill',
      amount: 80,
      categoryId: 'bcat-phone',
      frequency: 'monthly',
      nextPaymentDate: '2026-09-22',
      active: true,
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
    };

    const summary = calculatePayCycleSummary(incomeConfig, [bill], [], undefined, '2026-09-20');
    expect(summary.expectedPay).toBe(1200);
    expect(summary.billsTotal).toBe(80);
    expect(summary.remainingAfterBills).toBe(1120);
    expect(summary.billsDue.length).toBe(1);
  });

  it('calculates shift hours and estimates accurately', () => {
    const duration = calculateShiftDurationHours('16:00', '23:30', 30);
    expect(duration).toBe(7); // 7.5 hrs - 0.5 break = 7

    const overnightDuration = calculateShiftDurationHours('22:00', '06:00', 60);
    expect(overnightDuration).toBe(7); // 8 hrs - 1 hr break = 7

    const estimate = calculateShiftEstimate({
      startTime: '10:00',
      endTime: '16:00',
      breakMinutes: 0,
      rateType: 'base',
      hourlyRate: 35,
    });
    expect(estimate.paidHours).toBe(6);
    expect(estimate.estimatedPay).toBe(210);
  });

  it('resolves penalty rates correctly', () => {
    const incomeConfig: IncomeConfig = {
      id: 'inc-1',
      title: 'Barista',
      employmentType: 'casual_hourly',
      frequency: 'weekly',
      averagePay: 800,
      nextPayDate: '2026-09-25',
      hourlyRates: {
        baseRate: 30,
        saturdayRate: 38,
        sundayRate: 45,
      },
      createdAt: '2026-09-01',
      updatedAt: '2026-09-01',
    };

    expect(resolveHourlyRate(incomeConfig, 'base')).toBe(30);
    expect(resolveHourlyRate(incomeConfig, 'saturday')).toBe(38);
    expect(resolveHourlyRate(incomeConfig, 'sunday')).toBe(45);
    expect(resolveHourlyRate(incomeConfig, 'custom', 50)).toBe(50);
  });

  it('aggregates tips correctly', () => {
    const tips = [
      { id: 't1', amount: 25, date: '2026-09-20', createdAt: '2026-09-20' },
      { id: 't2', amount: 50, date: '2026-09-20', createdAt: '2026-09-20' },
      { id: 't3', amount: 30, date: '2026-09-18', createdAt: '2026-09-18' },
    ];

    const summaries = calculateTipSummaries(tips, '2026-09-20');
    expect(summaries.todayTotal).toBe(75);
    expect(summaries.monthTotal).toBe(105);
    expect(summaries.highestTipDay.amount).toBe(75);

    const stats = computeTipStats(tips);
    expect(stats.totalTips).toBe(105);
    expect(stats.highestTip).toBe(50);
    expect(stats.averagePerEntry).toBe(35);
  });

  it('computes monthly burn rate for direct debits', () => {
    const debits: DirectDebit[] = [
      {
        id: 'd1',
        title: 'Rent',
        amount: 300,
        categoryId: 'bcat-rent',
        frequency: 'weekly',
        nextPaymentDate: '2026-09-21',
        active: true,
        createdAt: '2026-09-01',
        updatedAt: '2026-09-01',
      },
      {
        id: 'd2',
        title: 'Gym',
        amount: 50,
        categoryId: 'bcat-health',
        frequency: 'monthly',
        nextPaymentDate: '2026-09-28',
        active: false,
        createdAt: '2026-09-01',
        updatedAt: '2026-09-01',
      },
    ];

    const overview = getDirectDebitsOverview(debits);
    expect(overview.activeCount).toBe(1);
    expect(overview.pausedCount).toBe(1);
    expect(overview.totalMonthlyCost).toBe(1300); // 300 * 52 / 12 = 1300
  });

  it('computes shift statistics', () => {
    const shifts = [
      {
        id: 's1',
        date: '2026-09-21',
        startTime: '09:00',
        endTime: '17:00',
        breakMinutes: 30,
        rateType: 'base' as const,
        hourlyRate: 30,
        paidHours: 7.5,
        estimatedPay: 225,
        createdAt: '2026-09-20',
      },
    ];

    const stats = computeShiftStats(shifts);
    expect(stats.totalHours).toBe(7.5);
    expect(stats.totalEarnings).toBe(225);
  });

  it('computes current pay cycle summary with active overrides', () => {
    const state: MoneyState = {
      ...getDefaultMoneyState(),
      incomeConfig: {
        id: 'inc-1',
        title: 'Work',
        employmentType: 'full_time',
        frequency: 'fortnightly',
        averagePay: 2000,
        nextPayDate: '2026-09-25',
        createdAt: '2026-09-01',
        updatedAt: '2026-09-01',
      },
      payCycleOverrides: {
        '2026-09-25': 2200,
      },
    };

    const cycleSummary = getCurrentPayCycleSummary(state);
    expect(cycleSummary.expectedPayThisCycle).toBe(2200);
  });

  it('generates upcoming money timeline', () => {
    const state: MoneyState = {
      ...getDefaultMoneyState(),
      directDebits: [
        {
          id: 'd1',
          title: 'Electricity',
          amount: 120,
          categoryId: 'bcat-util',
          frequency: 'monthly',
          nextPaymentDate: '2026-09-22',
          active: true,
          createdAt: '2026-09-01',
          updatedAt: '2026-09-01',
        },
      ],
      shifts: [
        {
          id: 's1',
          date: '2026-09-21',
          startTime: '09:00',
          endTime: '17:00',
          breakMinutes: 30,
          rateType: 'base',
          hourlyRate: 32,
          paidHours: 7.5,
          estimatedPay: 240,
          createdAt: '2026-09-20',
        },
      ],
    };

    const timeline = getUpcomingMoneyTimeline(state, '2026-09-20', 7);
    expect(timeline.length).toBe(2);
    expect(timeline[0].type).toBe('income'); // 2026-09-21 shift
    expect(timeline[1].type).toBe('expense'); // 2026-09-22 electricity
  });
});
