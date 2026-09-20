import {
  BillFrequency,
  DirectDebit,
  IncomeConfig,
  Shift,
  ExtraIncome,
  TipEntry,
  ShiftRateType,
} from '../types/finance';

/**
 * Currency formatter with Australian AUD / $ default.
 */
export function formatCurrency(amount: number, options?: { showCents?: boolean; sign?: boolean }): string {
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  const showCents = options?.showCents !== undefined ? options.showCents : Math.abs(safeAmount % 1) > 0.001;
  const formatted = Math.abs(safeAmount).toLocaleString('en-AU', {
    minimumFractionDigits: showCents ? 2 : 0,
    maximumFractionDigits: 2,
  });

  const prefix = options?.sign ? (safeAmount > 0 ? '+' : safeAmount < 0 ? '-' : '') : safeAmount < 0 ? '-' : '';
  return `${prefix}$${formatted}`;
}

/**
 * Decimal-safe addition
 */
export function addDecimals(a: number, b: number): number {
  return Math.round(((Number(a) || 0) + (Number(b) || 0)) * 100) / 100;
}

/**
 * Decimal-safe subtraction
 */
export function subtractDecimals(a: number, b: number): number {
  return Math.round(((Number(a) || 0) - (Number(b) || 0)) * 100) / 100;
}

/**
 * Format a YYYY-MM-DD date string into an Australian standard DD/MM/YYYY
 */
export function formatDateAU(dateStr?: string): string {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return dateStr;
}

/**
 * Parses YYYY-MM-DD safely into a local Date object (ignoring UTC timezone offsets)
 */
export function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 12, 0, 0);
}

/**
 * Formats a Date object to YYYY-MM-DD string
 */
export function toDateString(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Calculate the difference in calendar days between two dates.
 * positive if target is in the future.
 */
export function daysBetween(fromStr: string, toStr: string): number {
  const d1 = parseLocalDate(fromStr);
  const d2 = parseLocalDate(toStr);
  const diffTime = d2.getTime() - d1.getTime();
  return Math.round(diffTime / (1000 * 60 * 60 * 24));
}

/**
 * Advance a date string by a bill recurrence frequency.
 */
export function getNextBillOccurrence(
  currentDateStr: string,
  frequency: BillFrequency,
  interval = 1,
  customDays?: number
): string {
  const date = parseLocalDate(currentDateStr);

  switch (frequency) {
    case 'weekly':
      date.setDate(date.getDate() + 7 * Math.max(1, interval));
      break;
    case 'fortnightly':
      date.setDate(date.getDate() + 14 * Math.max(1, interval));
      break;
    case 'monthly':
      date.setMonth(date.getMonth() + Math.max(1, interval));
      break;
    case 'quarterly':
      date.setMonth(date.getMonth() + 3 * Math.max(1, interval));
      break;
    case 'annually':
      date.setFullYear(date.getFullYear() + Math.max(1, interval));
      break;
    case 'every_x_days':
      date.setDate(date.getDate() + Math.max(1, customDays || interval));
      break;
    case 'every_x_weeks':
      date.setDate(date.getDate() + 7 * Math.max(1, interval));
      break;
    case 'every_x_months':
      date.setMonth(date.getMonth() + Math.max(1, interval));
      break;
    case 'custom':
      date.setDate(date.getDate() + Math.max(1, customDays || interval || 7));
      break;
    default:
      date.setMonth(date.getMonth() + 1);
  }

  return toDateString(date);
}

/**
 * Computes all occurrences of a recurring direct debit falling within [cycleStart, cycleEnd].
 * Prevents infinite loops by setting a safety limit.
 */
export function getBillOccurrencesInDateRange(
  bill: DirectDebit,
  startDateStr: string,
  endDateStr: string
): { bill: DirectDebit; date: string; amount: number }[] {
  if (!bill.active || bill.amount <= 0) return [];
  if (bill.startDate && bill.startDate > endDateStr) return [];
  if (bill.endDate && bill.endDate < startDateStr) return [];

  const results: { bill: DirectDebit; date: string; amount: number }[] = [];
  let curr = bill.nextPaymentDate;

  // If nextPaymentDate is way in the past, roll it forward up to startDateStr
  const maxIterations = 365;
  let iterations = 0;

  while (curr < startDateStr && iterations < maxIterations) {
    curr = getNextBillOccurrence(
      curr,
      bill.frequency,
      bill.recurrenceConfig?.interval || 1,
      bill.recurrenceConfig?.customDays
    );
    iterations++;
  }

  iterations = 0;
  while (curr <= endDateStr && iterations < maxIterations) {
    if (bill.endDate && curr > bill.endDate) break;

    if (curr >= startDateStr && curr <= endDateStr) {
      results.push({
        bill,
        date: curr,
        amount: bill.amount,
      });
    }

    curr = getNextBillOccurrence(
      curr,
      bill.frequency,
      bill.recurrenceConfig?.interval || 1,
      bill.recurrenceConfig?.customDays
    );
    iterations++;
  }

  return results;
}

/**
 * Calculates current pay cycle bounds based on income configuration.
 * Returns { previousPayDate, nextPayDate, daysUntilNextPay }
 */
export function calculatePayCycleBounds(
  incomeConfig: IncomeConfig,
  referenceDateStr: string = toDateString(new Date())
): { previousPayDate: string; nextPayDate: string; daysUntilNextPay: number } {
  let nextPay = incomeConfig.nextPayDate;
  const cycleDays =
    incomeConfig.frequency === 'weekly'
      ? 7
      : incomeConfig.frequency === 'fortnightly'
      ? 14
      : incomeConfig.frequency === 'monthly'
      ? 30
      : Math.max(1, incomeConfig.customFrequencyDays || 14);

  // If nextPay is in the past, roll it forward until it's >= referenceDateStr
  let iterations = 0;
  while (nextPay < referenceDateStr && iterations < 100) {
    const d = parseLocalDate(nextPay);
    if (incomeConfig.frequency === 'monthly') {
      d.setMonth(d.getMonth() + 1);
    } else {
      d.setDate(d.getDate() + cycleDays);
    }
    nextPay = toDateString(d);
    iterations++;
  }

  // Derive previous pay date from nextPay
  const prevDate = parseLocalDate(nextPay);
  if (incomeConfig.frequency === 'monthly') {
    prevDate.setMonth(prevDate.getMonth() - 1);
  } else {
    prevDate.setDate(prevDate.getDate() - cycleDays);
  }
  const previousPayDate = toDateString(prevDate);

  const daysUntilNextPay = Math.max(0, daysBetween(referenceDateStr, nextPay));

  return {
    previousPayDate,
    nextPayDate: nextPay,
    daysUntilNextPay,
  };
}

/**
 * Calculates bills and remaining pay for a given pay cycle.
 */
export function calculatePayCycleSummary(
  incomeConfig: IncomeConfig | null,
  bills: DirectDebit[],
  extraIncomes: ExtraIncome[] = [],
  overridePay?: number,
  referenceDateStr: string = toDateString(new Date())
) {
  if (!incomeConfig) {
    return {
      hasIncomeConfig: false,
      expectedPay: 0,
      billsTotal: 0,
      extraIncomeTotal: 0,
      remainingAfterBills: 0,
      billsDue: [],
      daysRemaining: 0,
      previousPayDate: '',
      nextPayDate: '',
    };
  }

  const { previousPayDate, nextPayDate, daysUntilNextPay } = calculatePayCycleBounds(
    incomeConfig,
    referenceDateStr
  );

  const expectedPay = overridePay !== undefined && overridePay !== null
    ? overridePay
    : incomeConfig.averagePay;

  // Bills due between now (or previousPayDate) and nextPayDate
  // Specifically: bills falling in the window [referenceDateStr, nextPayDate]
  const billsDue: { bill: DirectDebit; date: string; amount: number }[] = [];
  for (const bill of bills) {
    if (!bill.active) continue;
    const occurrences = getBillOccurrencesInDateRange(bill, referenceDateStr, nextPayDate);
    billsDue.push(...occurrences);
  }

  billsDue.sort((a, b) => a.date.localeCompare(b.date));

  const billsTotal = billsDue.reduce((sum, item) => addDecimals(sum, item.amount), 0);

  // Extra income in this pay cycle
  const extraIncomeInCycle = extraIncomes.filter((item) => {
    if (!item.includeInCurrentPayCycle) return false;
    return item.date >= previousPayDate && item.date <= nextPayDate;
  });

  const extraIncomeTotal = extraIncomeInCycle.reduce((sum, item) => addDecimals(sum, item.amount), 0);

  // Remaining Pay After Bills = Expected Pay + Extra Income - Bills Due
  const remainingAfterBills = subtractDecimals(addDecimals(expectedPay, extraIncomeTotal), billsTotal);

  return {
    hasIncomeConfig: true,
    expectedPay,
    billsTotal,
    extraIncomeTotal,
    remainingAfterBills,
    billsDue,
    daysRemaining: daysUntilNextPay,
    previousPayDate,
    nextPayDate,
  };
}

/**
 * Calculate shift duration in paid hours (subtracting unpaid break).
 */
export function calculateShiftDurationHours(startTime: string, endTime: string, breakMinutes = 0): number {
  if (!startTime || !endTime) return 0;
  const [startH, startM] = startTime.split(':').map(Number);
  const [endH, endM] = endTime.split(':').map(Number);

  const startTotalM = (startH || 0) * 60 + (startM || 0);
  let endTotalM = (endH || 0) * 60 + (endM || 0);

  // If ending on or before start, assumes it passed midnight
  if (endTotalM <= startTotalM) {
    endTotalM += 24 * 60;
  }

  const durationMinutes = Math.max(0, endTotalM - startTotalM - (breakMinutes || 0));
  return Math.round((durationMinutes / 60) * 100) / 100;
}

/**
 * Estimate earnings for a casual shift given rates.
 */
export function calculateShiftEstimate(
  shift: Pick<Shift, 'startTime' | 'endTime' | 'breakMinutes' | 'rateType' | 'customRate' | 'hourlyRate'>
): { paidHours: number; estimatedPay: number } {
  const paidHours = calculateShiftDurationHours(shift.startTime, shift.endTime, shift.breakMinutes);
  const effectiveRate = shift.customRate !== undefined && shift.customRate > 0 ? shift.customRate : shift.hourlyRate;
  const estimatedPay = Math.round(paidHours * effectiveRate * 100) / 100;
  return { paidHours, estimatedPay };
}

/**
 * Resolves the appropriate hourly rate based on rateType from incomeConfig.
 */
export function resolveHourlyRate(
  incomeConfig: IncomeConfig | null,
  rateType: ShiftRateType,
  customRate?: number
): number {
  if (customRate !== undefined && customRate > 0) return customRate;
  if (!incomeConfig?.hourlyRates) return 0;

  const rates = incomeConfig.hourlyRates;
  switch (rateType) {
    case 'base':
      return rates.baseRate;
    case 'saturday':
      return rates.saturdayRate ?? rates.baseRate * 1.5;
    case 'sunday':
      return rates.sundayRate ?? rates.baseRate * 1.75;
    case 'public_holiday':
      return rates.publicHolidayRate ?? rates.baseRate * 2.25;
    case 'evening':
      return rates.eveningRate ?? rates.baseRate * 1.15;
    case 'night':
      return rates.nightRate ?? rates.baseRate * 1.25;
    case 'overtime':
      return rates.overtimeRate ?? rates.baseRate * 1.5;
    default:
      return rates.baseRate;
  }
}

/**
 * Calculates tip summaries across timeframes.
 */
export function calculateTipSummaries(tips: TipEntry[], referenceDateStr: string = toDateString(new Date())) {
  const refDate = parseLocalDate(referenceDateStr);

  const startOfWeek = new Date(refDate);
  const day = startOfWeek.getDay();
  // Monday as start of week (Australian standard)
  const diff = startOfWeek.getDate() - day + (day === 0 ? -6 : 1);
  startOfWeek.setDate(diff);
  const startOfWeekStr = toDateString(startOfWeek);

  const currentMonthStr = referenceDateStr.substring(0, 7); // YYYY-MM
  const currentYearStr = referenceDateStr.substring(0, 4); // YYYY

  let todayTotal = 0;
  let weekTotal = 0;
  let monthTotal = 0;
  let yearTotal = 0;
  const dateMap: Record<string, number> = {};

  for (const tip of tips) {
    const amt = Number(tip.amount) || 0;
    if (tip.date === referenceDateStr) {
      todayTotal = addDecimals(todayTotal, amt);
    }
    if (tip.date >= startOfWeekStr && tip.date <= referenceDateStr) {
      weekTotal = addDecimals(weekTotal, amt);
    }
    if (tip.date.startsWith(currentMonthStr)) {
      monthTotal = addDecimals(monthTotal, amt);
    }
    if (tip.date.startsWith(currentYearStr)) {
      yearTotal = addDecimals(yearTotal, amt);
    }

    dateMap[tip.date] = addDecimals(dateMap[tip.date] || 0, amt);
  }

  // Highest tip day
  let highestTipDay = { date: '', amount: 0 };
  for (const [date, amt] of Object.entries(dateMap)) {
    if (amt > highestTipDay.amount) {
      highestTipDay = { date, amount: amt };
    }
  }

  const averagePerEntry = tips.length > 0
    ? Math.round((yearTotal / tips.length) * 100) / 100
    : 0;

  return {
    todayTotal,
    weekTotal,
    monthTotal,
    yearTotal,
    averagePerEntry,
    highestTipDay,
  };
}

/**
 * Checks if a bill date is overdue or due soon (<= 3 days).
 */
export function isBillOverdueOrDueSoon(
  dueDateStr: string,
  referenceDateStr: string = toDateString(new Date())
): { isOverdue: boolean; isDueSoon: boolean; daysUntilDue: number } {
  const daysUntilDue = daysBetween(referenceDateStr, dueDateStr);
  const isOverdue = daysUntilDue < 0;
  const isDueSoon = daysUntilDue >= 0 && daysUntilDue <= 3;
  return { isOverdue, isDueSoon, daysUntilDue };
}

/**
 * Computes overview totals for direct debits (monthly burn rate, active/paused counts).
 */
export function getDirectDebitsOverview(directDebits: DirectDebit[]) {
  let totalMonthlyCost = 0;
  let activeCount = 0;
  let pausedCount = 0;

  for (const debit of directDebits) {
    if (!debit.active) {
      pausedCount++;
      continue;
    }
    activeCount++;
    const amt = Number(debit.amount) || 0;
    switch (debit.frequency) {
      case 'weekly':
        totalMonthlyCost = addDecimals(totalMonthlyCost, (amt * 52) / 12);
        break;
      case 'fortnightly':
        totalMonthlyCost = addDecimals(totalMonthlyCost, (amt * 26) / 12);
        break;
      case 'monthly':
        totalMonthlyCost = addDecimals(totalMonthlyCost, amt);
        break;
      case 'quarterly':
        totalMonthlyCost = addDecimals(totalMonthlyCost, amt / 3);
        break;
      case 'annually':
        totalMonthlyCost = addDecimals(totalMonthlyCost, amt / 12);
        break;
      case 'every_x_days': {
        const days = debit.recurrenceConfig?.customDays || debit.recurrenceConfig?.interval || 1;
        totalMonthlyCost = addDecimals(totalMonthlyCost, (amt * 365) / days / 12);
        break;
      }
      case 'every_x_weeks': {
        const weeks = debit.recurrenceConfig?.interval || 1;
        totalMonthlyCost = addDecimals(totalMonthlyCost, (amt * 52) / weeks / 12);
        break;
      }
      case 'every_x_months': {
        const months = debit.recurrenceConfig?.interval || 1;
        totalMonthlyCost = addDecimals(totalMonthlyCost, amt / months);
        break;
      }
      default:
        totalMonthlyCost = addDecimals(totalMonthlyCost, amt);
    }
  }

  return {
    totalMonthlyCost: Math.round(totalMonthlyCost * 100) / 100,
    activeCount,
    pausedCount,
  };
}

/**
 * Computes stats for logged casual shifts.
 */
export function computeShiftStats(shifts: Shift[]) {
  let totalHours = 0;
  let totalEarnings = 0;

  for (const shift of shifts) {
    totalHours += shift.paidHours || 0;
    const earnings = shift.actualPay !== undefined && shift.actualPay !== null
      ? shift.actualPay
      : shift.estimatedPay;
    totalEarnings = addDecimals(totalEarnings, earnings || 0);
  }

  return {
    totalHours: Math.round(totalHours * 10) / 10,
    totalEarnings: Math.round(totalEarnings * 100) / 100,
  };
}

/**
 * Computes tip statistics.
 */
export function computeTipStats(tips: TipEntry[]) {
  let totalTips = 0;
  let highestTip = 0;

  for (const tip of tips) {
    const amt = Number(tip.amount) || 0;
    totalTips = addDecimals(totalTips, amt);
    if (amt > highestTip) {
      highestTip = amt;
    }
  }

  const averagePerEntry = tips.length > 0
    ? Math.round((totalTips / tips.length) * 100) / 100
    : 0;

  return {
    totalTips,
    highestTip,
    averagePerEntry,
  };
}

/**
 * Detailed current pay cycle summary for MoneyModule overview and cards.
 */
export function getCurrentPayCycleSummary(moneyState: import('../types/finance').MoneyState) {
  const summary = calculatePayCycleSummary(
    moneyState.incomeConfig,
    moneyState.directDebits,
    moneyState.extraIncomeList,
    moneyState.incomeConfig ? moneyState.payCycleOverrides[moneyState.incomeConfig.nextPayDate] : undefined
  );

  const prevPayDate = summary.previousPayDate;
  const nextPayDate = summary.nextPayDate;

  // Shifts in this pay window
  const shiftsInCycle = (moneyState.shifts || []).filter((s) => {
    if (!prevPayDate || !nextPayDate) return true;
    return s.date >= prevPayDate && s.date <= nextPayDate;
  });

  const shiftsTotalEarnings = shiftsInCycle.reduce((sum, s) => {
    const amt = s.actualPay !== undefined && s.actualPay !== null ? s.actualPay : s.estimatedPay;
    return addDecimals(sum, amt || 0);
  }, 0);

  // Tips in this pay window
  const tipsInCycle = (moneyState.tipEntries || []).filter((t) => {
    if (!prevPayDate || !nextPayDate) return true;
    return t.date >= prevPayDate && t.date <= nextPayDate;
  });

  const tipsTotalThisCycle = tipsInCycle.reduce((sum, t) => addDecimals(sum, Number(t.amount) || 0), 0);

  // Bills Due as flat DirectDebit array for UI convenience
  const billsDueInCycle: DirectDebit[] = summary.billsDue.map((item) => item.bill);

  const expectedPayThisCycle = summary.expectedPay;
  const billsTotalThisCycle = summary.billsTotal;
  const extraIncomeTotalThisCycle = summary.extraIncomeTotal;
  const estimatedRemainingSafe = summary.remainingAfterBills;

  return {
    ...summary,
    cycleStartDate: prevPayDate,
    cycleEndDate: nextPayDate,
    daysRemainingInCycle: summary.daysRemaining,
    daysUntilNextPay: summary.daysRemaining,
    expectedPayThisCycle,
    billsTotalThisCycle,
    extraIncomeTotalThisCycle,
    tipsTotalThisCycle,
    shiftsTotalEarnings,
    shiftsInCycle,
    tipsInCycle,
    billsDueInCycle,
    estimatedRemainingSafe,
  };
}

export interface MoneyTimelineItem {
  id: string;
  date: string;
  dayLabel: string;
  title: string;
  amount: number;
  type: 'income' | 'expense';
  categoryName?: string;
  categoryColor?: string;
  formattedAmount: string;
  badge: string;
  source: 'bill' | 'shift' | 'pay' | 'extra';
  notes?: string;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatTimelineDayLabel(dateStr: string, referenceDateStr: string = toDateString(new Date())): string {
  const diff = daysBetween(referenceDateStr, dateStr);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';

  const d = parseLocalDate(dateStr);
  const weekday = WEEKDAY_NAMES[d.getDay()];
  if (diff > 1 && diff <= 6) {
    return weekday;
  }
  return `${weekday}, ${formatDateAU(dateStr)}`;
}

export function getUpcomingMoneyTimeline(
  moneyState: import('../types/finance').MoneyState,
  referenceDateStr: string = toDateString(new Date()),
  daysAhead = 14
): MoneyTimelineItem[] {
  const items: MoneyTimelineItem[] = [];
  const refDate = parseLocalDate(referenceDateStr);
  const endDate = new Date(refDate);
  endDate.setDate(endDate.getDate() + daysAhead);
  const endDateStr = toDateString(endDate);

  const billCatMap = new Map<string, string>(moneyState.billCategories.map((c) => [c.id, c.name]));
  const billColorMap = new Map<string, string>(moneyState.billCategories.map((c) => [c.id, c.color]));

  // 1. Bills due in [referenceDateStr, endDateStr]
  for (const bill of moneyState.directDebits) {
    if (!bill.active) continue;
    const occurrences = getBillOccurrencesInDateRange(bill, referenceDateStr, endDateStr);
    for (const occ of occurrences) {
      items.push({
        id: `timeline-bill-${bill.id}-${occ.date}`,
        date: occ.date,
        dayLabel: formatTimelineDayLabel(occ.date, referenceDateStr),
        title: bill.title,
        amount: occ.amount,
        type: 'expense',
        categoryName: billCatMap.get(bill.categoryId) || 'Bill',
        categoryColor: billColorMap.get(bill.categoryId) || '#ef4444',
        formattedAmount: `-${formatCurrency(occ.amount)}`,
        badge: 'Expense',
        source: 'bill',
        notes: bill.notes,
      });
    }
  }

  // 2. Upcoming Shifts in [referenceDateStr, endDateStr]
  for (const shift of moneyState.shifts || []) {
    if (shift.date >= referenceDateStr && shift.date <= endDateStr) {
      const amt = shift.actualPay !== undefined && shift.actualPay !== null ? shift.actualPay : shift.estimatedPay;
      items.push({
        id: `timeline-shift-${shift.id}`,
        date: shift.date,
        dayLabel: formatTimelineDayLabel(shift.date, referenceDateStr),
        title: `Estimated shift (${shift.paidHours}h @ ${formatCurrency(shift.hourlyRate)}/hr)`,
        amount: amt,
        type: 'income',
        categoryName: 'Shift Pay',
        categoryColor: '#3b82f6',
        formattedAmount: `+${formatCurrency(amt)}`,
        badge: 'Income',
        source: 'shift',
        notes: shift.notes,
      });
    }
  }

  // 3. Expected Pay if configured and within [referenceDateStr, endDateStr]
  if (moneyState.incomeConfig) {
    const nextPay = moneyState.incomeConfig.nextPayDate;
    if (nextPay >= referenceDateStr && nextPay <= endDateStr) {
      const override = moneyState.payCycleOverrides[nextPay];
      const payAmt = override !== undefined ? override : moneyState.incomeConfig.averagePay;
      items.push({
        id: `timeline-pay-${nextPay}`,
        date: nextPay,
        dayLabel: formatTimelineDayLabel(nextPay, referenceDateStr),
        title: `${moneyState.incomeConfig.title || 'Pay'}${moneyState.incomeConfig.employerName ? ` (${moneyState.incomeConfig.employerName})` : ''}`,
        amount: payAmt,
        type: 'income',
        categoryName: 'Salary/Pay',
        categoryColor: '#10b981',
        formattedAmount: `+${formatCurrency(payAmt)}`,
        badge: 'Income',
        source: 'pay',
      });
    }
  }

  // 4. Extra Income scheduled in [referenceDateStr, endDateStr]
  const extraCatMap = new Map<string, string>(moneyState.extraIncomeCategories.map((c) => [c.id, c.name]));
  const extraColorMap = new Map<string, string>(moneyState.extraIncomeCategories.map((c) => [c.id, c.color]));
  for (const extra of moneyState.extraIncomeList || []) {
    if (extra.date >= referenceDateStr && extra.date <= endDateStr) {
      items.push({
        id: `timeline-extra-${extra.id}`,
        date: extra.date,
        dayLabel: formatTimelineDayLabel(extra.date, referenceDateStr),
        title: extra.title,
        amount: extra.amount,
        type: 'income',
        categoryName: extraCatMap.get(extra.categoryId) || 'Extra Income',
        categoryColor: extraColorMap.get(extra.categoryId) || '#10b981',
        formattedAmount: `+${formatCurrency(extra.amount)}`,
        badge: 'Income',
        source: 'extra',
        notes: extra.notes,
      });
    }
  }

  // Sort chronologically by date
  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}

