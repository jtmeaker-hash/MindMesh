import { Category, Reminder } from '../types';
import { MoneyState } from '../types/finance';
import { Confidence } from '../types/smartEngine';
import { computeDashboardMetrics } from '../utils/dashboard';
import { formatCurrency, parseLocalDate, toDateString } from '../utils/finance';

/**
 * Deterministic, local-only dashboard intelligence.
 *
 * Every number here comes from the app's existing dashboard/statistics
 * calculator (`computeDashboardMetrics`) or from stored reminder data. Nothing is
 * written, and no trend or cause is ever invented.
 */

const EXACT: Confidence = { score: 0.98, reason: 'exact-match' };
const DERIVED: Confidence = { score: 0.86, reason: 'derived' };

export interface DashboardCategoryCounts {
  categoryId: string;
  categoryName: string;
  activeCount: number;
  completedCount: number;
  totalCount: number;
}

export interface DashboardCategoryAverage {
  categoryId: string;
  categoryName: string;
  completedCount: number;
  averageCompletionHours: number;
  formatted: string;
}

export interface DashboardOverdueItem {
  reminderId: string;
  title: string;
  dueDate: string;
  daysOverdue: number;
  categoryName?: string;
}

export interface DashboardFacts {
  referenceDate: string;
  totalCount: number;
  activeCount: number;
  completedCount: number;
  /** Active reminders are the uncompleted ones; kept explicit for the UI. */
  uncompletedCount: number;
  overdueCount: number;
  overdueItems: DashboardOverdueItem[];
  oldestOverdueDays: number;
  dueTodayCount: number;
  dueThisWeekCount: number;
  recurringActiveCount: number;
  recurringCompletedCount: number;
  completedTodayCount: number;
  completedThisWeekCount: number;
  /** Only defined when at least one reminder exists, so 0% is never implied. */
  completionRatePercent?: number;
  completionRateAvailable: boolean;
  /** Only defined when real completion timestamps exist. */
  averageCompletionHours?: number;
  averageCompletionFormatted?: string;
  averageCompletionAvailable: boolean;
  averageCompletionByCategory: DashboardCategoryAverage[];
  categoryCounts: DashboardCategoryCounts[];
  mostActiveCategory?: { name: string; count: number };
  hasMoneyConfig: boolean;
  upcomingBillsCount: number;
  billsBeforePayCount: number;
  billsBeforePayTotal: number;
  remainingAfterBills: number;
}

export interface DashboardInsight {
  id: string;
  text: string;
  /** Every number quoted in `text` is also available here so it can be traced. */
  facts: Record<string, number | string | boolean>;
  confidence: Confidence;
}

export interface DashboardAnalytics {
  facts: DashboardFacts;
  insights: DashboardInsight[];
  text: string;
}

function hasUsableCompletionTimestamp(reminder: Reminder): boolean {
  if (!reminder.completed || !reminder.completedAt) return false;
  const created = new Date(reminder.createdAt).getTime();
  const completed = new Date(reminder.completedAt).getTime();
  return Number.isFinite(created) && Number.isFinite(completed) && completed >= created;
}

/**
 * Builds structured dashboard facts by wrapping the existing dashboard
 * calculator. Per-category counts and overdue detail come from stored reminders
 * so nothing is recomputed twice.
 */
export function buildDashboardFacts(
  reminders: readonly Reminder[],
  categories: readonly Category[] = [],
  moneyState?: MoneyState | null,
  referenceDateStr: string = toDateString(new Date())
): DashboardFacts {
  const list = [...reminders];
  const categoryList = [...categories];
  const metrics = computeDashboardMetrics(list, categoryList, moneyState ?? undefined, 'all', null, referenceDateStr);

  const categoryNames = new Map(categoryList.map((category) => [category.id, category.name]));
  const reference = parseLocalDate(referenceDateStr).getTime();

  const overdueItems: DashboardOverdueItem[] = metrics.overdueRemindersList
    .filter((reminder) => Boolean(reminder.dueDate))
    .map((reminder) => {
      const due = parseLocalDate(reminder.dueDate as string).getTime();
      const daysOverdue = Number.isFinite(due) ? Math.round((reference - due) / 86_400_000) : 0;
      return {
        reminderId: reminder.id,
        title: reminder.title,
        dueDate: reminder.dueDate as string,
        daysOverdue,
        categoryName: categoryNames.get(reminder.categoryId),
      };
    })
    .sort((a, b) => b.daysOverdue - a.daysOverdue);

  const countsByCategory = new Map<string, { active: number; completed: number }>();
  for (const reminder of list) {
    const entry = countsByCategory.get(reminder.categoryId) ?? { active: 0, completed: 0 };
    if (reminder.completed) entry.completed += 1;
    else entry.active += 1;
    countsByCategory.set(reminder.categoryId, entry);
  }

  const categoryCounts: DashboardCategoryCounts[] = categoryList
    .map((category) => {
      const counts = countsByCategory.get(category.id) ?? { active: 0, completed: 0 };
      return {
        categoryId: category.id,
        categoryName: category.name,
        activeCount: counts.active,
        completedCount: counts.completed,
        totalCount: counts.active + counts.completed,
      };
    })
    .filter((entry) => entry.totalCount > 0)
    .sort((a, b) => b.totalCount - a.totalCount);

  const averageCompletionByCategory: DashboardCategoryAverage[] = metrics.categoryStats.map((stat) => ({
    categoryId: stat.categoryId,
    categoryName: stat.categoryName,
    completedCount: stat.completedCount,
    averageCompletionHours: stat.averageDurationHours,
    formatted: stat.formattedDuration,
  }));

  const completionRateAvailable = metrics.totalTasks > 0;
  const averageCompletionAvailable = list.some(hasUsableCompletionTimestamp);

  return {
    referenceDate: referenceDateStr,
    totalCount: metrics.totalTasks,
    activeCount: metrics.activeTasks,
    completedCount: metrics.completedTasks,
    uncompletedCount: metrics.activeTasks,
    overdueCount: metrics.overdueCount,
    overdueItems,
    oldestOverdueDays: metrics.oldestOverdueDays,
    dueTodayCount: metrics.dueTodayCount,
    dueThisWeekCount: metrics.dueThisWeekCount,
    recurringActiveCount: metrics.recurringCount,
    recurringCompletedCount: metrics.completedRecurringCount,
    completedTodayCount: metrics.tasksCompletedToday,
    completedThisWeekCount: metrics.tasksCompletedThisWeek,
    completionRatePercent: completionRateAvailable ? metrics.completionRate : undefined,
    completionRateAvailable,
    averageCompletionHours: averageCompletionAvailable ? metrics.overallAverageDurationHours : undefined,
    averageCompletionFormatted: averageCompletionAvailable ? metrics.formattedOverallDuration : undefined,
    averageCompletionAvailable,
    averageCompletionByCategory,
    categoryCounts,
    mostActiveCategory: metrics.mostActiveCategory ?? undefined,
    hasMoneyConfig: metrics.hasFinancialConfig,
    upcomingBillsCount: metrics.upcomingBillsCount,
    billsBeforePayCount: metrics.billsBeforePayCount,
    billsBeforePayTotal: metrics.billsBeforePayTotal,
    remainingAfterBills: metrics.remainingAfterBills,
  };
}

/**
 * Turns dashboard facts into short, neutral sentences. A statement is only
 * produced when its underlying statistic exists.
 */
export function summarizeDashboardFacts(facts: DashboardFacts): DashboardInsight[] {
  const insights: DashboardInsight[] = [];

  if (facts.totalCount === 0) {
    insights.push({
      id: 'dashboard-empty',
      text: 'No reminders are stored yet, so there are no statistics to summarise.',
      facts: { totalCount: 0 },
      confidence: EXACT,
    });
    return insights;
  }

  insights.push({
    id: 'dashboard-reminders',
    text: `${facts.activeCount} active reminder${facts.activeCount === 1 ? '' : 's'} and ${facts.completedCount} completed.`,
    facts: { activeCount: facts.activeCount, completedCount: facts.completedCount, totalCount: facts.totalCount },
    confidence: EXACT,
  });

  if (facts.overdueCount > 0) {
    insights.push({
      id: 'dashboard-overdue',
      text: `${facts.overdueCount} reminder${facts.overdueCount === 1 ? ' is' : 's are'} overdue; the oldest is ${facts.oldestOverdueDays} day${facts.oldestOverdueDays === 1 ? '' : 's'} past due.`,
      facts: { overdueCount: facts.overdueCount, oldestOverdueDays: facts.oldestOverdueDays },
      confidence: EXACT,
    });
  } else {
    insights.push({
      id: 'dashboard-not-overdue',
      text: 'Nothing is overdue right now.',
      facts: { overdueCount: 0 },
      confidence: EXACT,
    });
  }

  if (facts.completionRateAvailable) {
    insights.push({
      id: 'dashboard-completion-rate',
      text: `Completion rate is ${facts.completionRatePercent}% (${facts.completedCount} of ${facts.totalCount} reminders).`,
      facts: {
        completionRatePercent: facts.completionRatePercent ?? 0,
        completedCount: facts.completedCount,
        totalCount: facts.totalCount,
      },
      confidence: EXACT,
    });
  } else {
    insights.push({
      id: 'dashboard-completion-rate-unavailable',
      text: 'Completion rate is not available yet because no reminders are stored.',
      facts: { completionRateAvailable: false },
      confidence: EXACT,
    });
  }

  if (facts.averageCompletionAvailable) {
    insights.push({
      id: 'dashboard-average-completion',
      text: `Average time from creation to completion is ${facts.averageCompletionFormatted}.`,
      facts: { averageCompletionHours: facts.averageCompletionHours ?? 0 },
      confidence: EXACT,
    });
  } else {
    insights.push({
      id: 'dashboard-average-completion-unavailable',
      text: 'Average completion time is not available yet; no completed reminders have usable timestamps.',
      facts: { averageCompletionAvailable: false },
      confidence: EXACT,
    });
  }

  for (const stat of facts.averageCompletionByCategory.slice(0, 5)) {
    insights.push({
      id: `dashboard-category-average:${stat.categoryId}`,
      text: `Average completion time for ${stat.categoryName} is ${stat.formatted} across ${stat.completedCount} completed reminder${stat.completedCount === 1 ? '' : 's'}.`,
      facts: {
        categoryId: stat.categoryId,
        categoryName: stat.categoryName,
        averageCompletionHours: stat.averageCompletionHours,
        completedCount: stat.completedCount,
      },
      confidence: EXACT,
    });
  }

  if (facts.mostActiveCategory) {
    insights.push({
      id: 'dashboard-most-active-category',
      text: `Most reminders are in ${facts.mostActiveCategory.name} (${facts.mostActiveCategory.count}).`,
      facts: { categoryName: facts.mostActiveCategory.name, count: facts.mostActiveCategory.count },
      confidence: EXACT,
    });
  }

  if (facts.recurringActiveCount > 0) {
    insights.push({
      id: 'dashboard-recurring',
      text: `${facts.recurringActiveCount} active reminder${facts.recurringActiveCount === 1 ? '' : 's'} repeat on a schedule.`,
      facts: { recurringActiveCount: facts.recurringActiveCount, recurringCompletedCount: facts.recurringCompletedCount },
      confidence: EXACT,
    });
  }

  if (facts.completedTodayCount > 0 || facts.completedThisWeekCount > 0) {
    insights.push({
      id: 'dashboard-completed-recently',
      // The window is always the past week; no extra number is quoted so every
      // figure in a sentence is traceable to a computed statistic.
      text: `${facts.completedTodayCount} completed today and ${facts.completedThisWeekCount} over the past week.`,
      facts: { completedTodayCount: facts.completedTodayCount, completedThisWeekCount: facts.completedThisWeekCount },
      confidence: EXACT,
    });
  }

  if (facts.dueTodayCount > 0 || facts.dueThisWeekCount > 0) {
    insights.push({
      id: 'dashboard-due',
      text: `${facts.dueTodayCount} due today and ${facts.dueThisWeekCount} due within the next week.`,
      facts: { dueTodayCount: facts.dueTodayCount, dueThisWeekCount: facts.dueThisWeekCount },
      confidence: EXACT,
    });
  }

  if (facts.hasMoneyConfig) {
    insights.push({
      id: 'dashboard-money',
      text: `${facts.upcomingBillsCount} active direct debit${facts.upcomingBillsCount === 1 ? '' : 's'}; ${formatCurrency(facts.billsBeforePayTotal)} falls due before your next pay, with ${formatCurrency(facts.remainingAfterBills)} remaining after bills.`,
      facts: {
        upcomingBillsCount: facts.upcomingBillsCount,
        billsBeforePayCount: facts.billsBeforePayCount,
        billsBeforePayTotal: facts.billsBeforePayTotal,
        remainingAfterBills: facts.remainingAfterBills,
      },
      confidence: DERIVED,
    });
  }

  return insights;
}

export function analyzeDashboard(
  reminders: readonly Reminder[],
  categories: readonly Category[] = [],
  moneyState?: MoneyState | null,
  referenceDateStr: string = toDateString(new Date())
): DashboardAnalytics {
  const facts = buildDashboardFacts(reminders, categories, moneyState, referenceDateStr);
  const insights = summarizeDashboardFacts(facts);
  return { facts, insights, text: insights.map((insight) => insight.text).join(' ') };
}
