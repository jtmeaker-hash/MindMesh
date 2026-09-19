import { Reminder, Category, DashboardTimeFilter } from '../types';
import { MoneyState } from '../types/finance';
import { parseLocalDate, toDateString, addDecimals } from './finance';

export interface CategoryCompletionStat {
  categoryId: string;
  categoryName: string;
  color: string;
  completedCount: number;
  averageDurationHours: number;
  formattedDuration: string;
}

export interface DashboardMetrics {
  completionRate: number; // 0 to 100
  totalActive: number;
  totalCompleted: number;
  activeCategoriesCount: number;
  dueTodayCount: number;
  dueThisWeekCount: number;
  recurringCount: number;
  completedRecurringCount: number;
  overdueCount: number;
  oldestOverdueDays: number;
  oldestOverdueReminder: Reminder | null;
  overdueCategoryNames: string[];
  tasksCompletedToday: number;
  tasksCompletedThisWeek: number;
  overallAverageDurationHours: number;
  formattedOverallDuration: string;
  categoryStats: CategoryCompletionStat[];
  mostActiveCategory: { name: string; count: number } | null;

  // Financial metrics (when money configured)
  hasFinancialConfig: boolean;
  upcomingBillsCount: number;
  billsBeforePayCount: number;
  billsBeforePayTotal: number;
  remainingAfterBills: number;
  incomeThisMonth: number;
  extraIncomeThisMonth: number;
  tipsThisMonth: number;
}

/**
 * Formats duration in hours into a human-readable string (e.g., "7 hours", "1.4 days", "3.8 days").
 */
export function formatDurationHuman(hours: number): string {
  if (hours <= 0 || !Number.isFinite(hours)) return '0 mins';
  if (hours < 1) {
    const mins = Math.round(hours * 60);
    return `${mins} min${mins === 1 ? '' : 's'}`;
  }
  if (hours < 24) {
    const roundedHours = Math.round(hours * 10) / 10;
    return `${roundedHours} hour${roundedHours === 1 ? '' : 's'}`;
  }
  const days = Math.round((hours / 24) * 10) / 10;
  return `${days} day${days === 1 ? '' : 's'}`;
}

/**
 * Filters reminders by DashboardTimeFilter.
 * For completed tasks, checks completedAt. For active, checks createdAt or dueDate.
 */
export function filterRemindersByTime(
  reminders: Reminder[],
  filter: DashboardTimeFilter,
  referenceDateStr: string = toDateString(new Date())
): Reminder[] {
  if (filter === 'all') return reminders;

  const refDate = parseLocalDate(referenceDateStr);
  const cutoff = new Date(refDate);

  if (filter === 'today') {
    cutoff.setHours(0, 0, 0, 0);
  } else if (filter === '7days') {
    cutoff.setDate(cutoff.getDate() - 7);
  } else if (filter === '30days') {
    cutoff.setDate(cutoff.getDate() - 30);
  } else if (filter === '3months') {
    cutoff.setMonth(cutoff.getMonth() - 3);
  }

  const cutoffTime = cutoff.getTime();

  return reminders.filter((r) => {
    const timestampToCheck = r.completedAt ? new Date(r.completedAt).getTime() : new Date(r.createdAt).getTime();
    return timestampToCheck >= cutoffTime;
  });
}

/**
 * Computes all dashboard statistics.
 */
export function computeDashboardMetrics(
  allReminders: Reminder[],
  categories: Category[],
  moneyState?: MoneyState | null,
  timeFilter: DashboardTimeFilter = 'all',
  selectedCategoryId: string | null = null,
  referenceDateStr: string = toDateString(new Date())
): DashboardMetrics {
  // Apply category filter if selected
  let scopedReminders = selectedCategoryId
    ? allReminders.filter((r) => r.categoryId === selectedCategoryId)
    : allReminders;

  // Apply time filter
  scopedReminders = filterRemindersByTime(scopedReminders, timeFilter, referenceDateStr);

  const activeReminders = scopedReminders.filter((r) => !r.completed);
  const completedReminders = scopedReminders.filter((r) => r.completed);

  const totalActive = activeReminders.length;
  const totalCompleted = completedReminders.length;
  const totalScoped = totalActive + totalCompleted;
  const completionRate = totalScoped > 0 ? Math.round((totalCompleted / totalScoped) * 100) : 0;

  // Active categories
  const activeCategoryIds = new Set(activeReminders.map((r) => r.categoryId));
  const activeCategoriesCount = activeCategoryIds.size;

  // Due today and this week
  const refDate = parseLocalDate(referenceDateStr);
  const endOfWeek = new Date(refDate);
  endOfWeek.setDate(endOfWeek.getDate() + 7);
  const endOfWeekStr = toDateString(endOfWeek);

  const dueTodayCount = activeReminders.filter((r) => r.dueDate === referenceDateStr).length;
  const dueThisWeekCount = activeReminders.filter(
    (r) => r.dueDate && r.dueDate >= referenceDateStr && r.dueDate <= endOfWeekStr
  ).length;

  // Recurring counts
  const recurringCount = scopedReminders.filter((r) => r.recurrence && r.recurrence.frequency !== 'none').length;
  const completedRecurringCount = completedReminders.filter(
    (r) => r.recurrence && r.recurrence.frequency !== 'none'
  ).length;

  // Overdue
  const overdueList = activeReminders.filter((r) => r.dueDate && r.dueDate < referenceDateStr);
  const overdueCount = overdueList.length;

  let oldestOverdueDays = 0;
  let oldestOverdueReminder: Reminder | null = null;
  const overdueCatIds = new Set<string>();

  for (const r of overdueList) {
    if (r.dueDate) {
      overdueCatIds.add(r.categoryId);
      const days = Math.round(
        (parseLocalDate(referenceDateStr).getTime() - parseLocalDate(r.dueDate).getTime()) /
          (1000 * 60 * 60 * 24)
      );
      if (days > oldestOverdueDays) {
        oldestOverdueDays = days;
        oldestOverdueReminder = r;
      }
    }
  }

  const categoryMap = new Map<string, Category>(categories.map((c) => [c.id, c]));
  const overdueCategoryNames = Array.from(overdueCatIds)
    .map((id) => categoryMap.get(id)?.name)
    .filter((n): n is string => Boolean(n));

  // Completed today & this week
  const startOfWeek = new Date(refDate);
  const day = startOfWeek.getDay();
  startOfWeek.setDate(startOfWeek.getDate() - day + (day === 0 ? -6 : 1));
  const startOfWeekTime = startOfWeek.getTime();

  let tasksCompletedToday = 0;
  let tasksCompletedThisWeek = 0;
  let totalDurationMs = 0;
  let validCompletedCount = 0;

  const categoryCompletionData: Record<string, { count: number; totalMs: number }> = {};

  for (const r of completedReminders) {
    if (!r.completedAt) continue;
    const completedDate = new Date(r.completedAt);
    const completedDateStr = toDateString(completedDate);

    if (completedDateStr === referenceDateStr) {
      tasksCompletedToday++;
    }
    if (completedDate.getTime() >= startOfWeekTime) {
      tasksCompletedThisWeek++;
    }

    const createdTime = new Date(r.createdAt).getTime();
    const completedTime = completedDate.getTime();
    if (completedTime >= createdTime) {
      const durationMs = completedTime - createdTime;
      totalDurationMs += durationMs;
      validCompletedCount++;

      if (!categoryCompletionData[r.categoryId]) {
        categoryCompletionData[r.categoryId] = { count: 0, totalMs: 0 };
      }
      categoryCompletionData[r.categoryId].count++;
      categoryCompletionData[r.categoryId].totalMs += durationMs;
    }
  }

  const overallAverageDurationHours =
    validCompletedCount > 0
      ? Math.round((totalDurationMs / validCompletedCount / (1000 * 60 * 60)) * 10) / 10
      : 0;

  const categoryStats: CategoryCompletionStat[] = [];
  for (const cat of categories) {
    const data = categoryCompletionData[cat.id];
    if (data && data.count > 0) {
      const avgHours = Math.round((data.totalMs / data.count / (1000 * 60 * 60)) * 10) / 10;
      categoryStats.push({
        categoryId: cat.id,
        categoryName: cat.name,
        color: cat.color,
        completedCount: data.count,
        averageDurationHours: avgHours,
        formattedDuration: formatDurationHuman(avgHours),
      });
    }
  }

  // Most active category by total reminders count
  const catCounts: Record<string, number> = {};
  for (const r of scopedReminders) {
    catCounts[r.categoryId] = (catCounts[r.categoryId] || 0) + 1;
  }
  let mostActiveCategory: { name: string; count: number } | null = null;
  let maxCount = 0;
  for (const [cId, cnt] of Object.entries(catCounts)) {
    if (cnt > maxCount) {
      maxCount = cnt;
      const cat = categoryMap.get(cId);
      if (cat) mostActiveCategory = { name: cat.name, count: cnt };
    }
  }

  // Financial Metrics
  const hasFinancialConfig = Boolean(moneyState?.incomeConfig || (moneyState?.directDebits && moneyState.directDebits.length > 0));
  let upcomingBillsCount = 0;
  let billsBeforePayCount = 0;
  let billsBeforePayTotal = 0;
  let remainingAfterBills = 0;
  let incomeThisMonth = 0;
  let extraIncomeThisMonth = 0;
  let tipsThisMonth = 0;

  if (moneyState) {
    const currentMonthPrefix = referenceDateStr.substring(0, 7);

    // Active bills
    upcomingBillsCount = moneyState.directDebits.filter((b) => b.active).length;

    // Monthly totals
    if (moneyState.incomeConfig) {
      incomeThisMonth = moneyState.incomeConfig.averagePay;
    }

    extraIncomeThisMonth = moneyState.extraIncomeList
      .filter((e) => e.date.startsWith(currentMonthPrefix))
      .reduce((sum, e) => addDecimals(sum, e.amount), 0);

    tipsThisMonth = moneyState.tipEntries
      .filter((t) => t.date.startsWith(currentMonthPrefix))
      .reduce((sum, t) => addDecimals(sum, t.amount), 0);
  }

  return {
    completionRate,
    totalActive,
    totalCompleted,
    activeCategoriesCount,
    dueTodayCount,
    dueThisWeekCount,
    recurringCount,
    completedRecurringCount,
    overdueCount,
    oldestOverdueDays,
    oldestOverdueReminder,
    overdueCategoryNames,
    tasksCompletedToday,
    tasksCompletedThisWeek,
    overallAverageDurationHours,
    formattedOverallDuration: formatDurationHuman(overallAverageDurationHours),
    categoryStats,
    mostActiveCategory,

    hasFinancialConfig,
    upcomingBillsCount,
    billsBeforePayCount,
    billsBeforePayTotal,
    remainingAfterBills,
    incomeThisMonth,
    extraIncomeThisMonth,
    tipsThisMonth,
  };
}
