import { describe, expect, it } from 'vitest';
import { Category, Reminder } from '../types';
import { Contact } from '../types/contact';
import {
  DEFAULT_SMART_ENGINE_SETTINGS,
  SMART_ASSISTANCE_FEATURES,
  getEffectiveSmartAssistanceFeatures,
  isSmartAssistanceFeatureEnabled,
  setSmartAssistanceFeature,
} from '../types/smartEngine';
import { computeDashboardMetrics } from '../utils/dashboard';
import { formatCurrency } from '../utils/finance';
import { createSmartEngine } from '../services/smartEngine';
import { analyzeDashboard, buildDashboardFacts, summarizeDashboardFacts } from '../services/dashboardIntelligence';
import {
  CONTACT_FUZZY_THRESHOLD,
  matchContactByName,
  normalizeContactName,
  scoreContactName,
} from '../services/contactIntelligence';
import {
  detectRepeatedTaskPattern,
  findSimilarCompletedReminders,
  normalizeHistoryTitle,
  scoreTitleSimilarity,
  suggestCategoryFromHistory,
  summarizeCompletedHistory,
} from '../services/historyIntelligence';

const referenceDateStr = '2026-09-20';

const categories: Category[] = [
  { id: 'errands', name: 'Errands', color: '#38bdf8', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'car', name: 'Car', color: '#06b6d4', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'health', name: 'Health', color: '#22c55e', createdAt: '2026-01-01T00:00:00.000Z' },
];

function reminder(overrides: Partial<Reminder> & { id: string; title: string }): Reminder {
  return {
    categoryId: 'errands',
    priority: 'medium',
    completed: false,
    createdAt: '2026-09-01T00:00:00.000Z',
    subtasks: [],
    ...overrides,
  };
}

const activeReminders: Reminder[] = [
  reminder({ id: 'a-overdue', title: 'Return library books', dueDate: '2026-09-16' }),
  reminder({ id: 'a-due-today', title: 'Take out recycling', dueDate: referenceDateStr }),
  reminder({ id: 'a-upcoming', title: 'Post parcel', dueDate: '2026-09-25' }),
  reminder({
    id: 'a-recurring',
    title: 'Water plants',
    dueDate: '2026-09-22',
    recurrence: { frequency: 'weekly', interval: 1 },
    recurringSeriesId: 'series-water',
  }),
];

const completedReminders: Reminder[] = [
  reminder({
    id: 'c-car-1',
    title: 'Book car service',
    categoryId: 'car',
    completed: true,
    createdAt: '2026-09-01T00:00:00.000Z',
    completedAt: '2026-09-03T00:00:00.000Z',
  }),
  reminder({
    id: 'c-car-2',
    title: 'Book car service',
    categoryId: 'car',
    completed: true,
    createdAt: '2026-08-01T00:00:00.000Z',
    completedAt: '2026-08-02T00:00:00.000Z',
  }),
  reminder({
    id: 'c-errand-1',
    title: 'Buy groceries',
    completed: true,
    createdAt: '2026-09-10T00:00:00.000Z',
    completedAt: '2026-09-10T12:00:00.000Z',
  }),
];

const allReminders: Reminder[] = [...activeReminders, ...completedReminders];

const contextProvider = {
  getCategories: () => categories,
  getSubcategories: () => categories,
};

const contacts: Contact[] = [
  { id: 'ct-josh', fullName: 'Josh Smith', firstName: 'Josh', lastName: 'Smith', phoneNumber: '0400 000 001', relationship: 'Friend', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'ct-josh-jones', fullName: 'Josh Jones', firstName: 'Josh', lastName: 'Jones', phoneNumber: '0400 000 002', relationship: 'Coworker', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
  { id: 'ct-priya', fullName: 'Priya Patel', firstName: 'Priya', lastName: 'Patel', phoneNumber: '0400 000 003', relationship: 'Medical', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' },
];

/** Numbers in a sentence must be traceable to the computed facts next to it. */
function quotedNumbers(text: string): number[] {
  return (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe('MindMesh Smart Engine Stage 05 dashboard, history and contacts', () => {
  it('wraps the existing dashboard calculator instead of recomputing statistics', () => {
    const facts = buildDashboardFacts(allReminders, categories, null, referenceDateStr);
    const metrics = computeDashboardMetrics(allReminders, categories, undefined, 'all', null, referenceDateStr);

    expect(facts.totalCount).toBe(metrics.totalTasks);
    expect(facts.activeCount).toBe(metrics.activeTasks);
    expect(facts.completedCount).toBe(metrics.completedTasks);
    expect(facts.overdueCount).toBe(metrics.overdueCount);
    expect(facts.completionRatePercent).toBe(metrics.completionRate);
    expect(facts.averageCompletionHours).toBe(metrics.overallAverageDurationHours);
    expect(facts.averageCompletionFormatted).toBe(metrics.formattedOverallDuration);
    expect(facts.mostActiveCategory).toEqual(metrics.mostActiveCategory ?? undefined);
  });

  it('reports no statistics at all for an empty history rather than zero results', () => {
    const analytics = analyzeDashboard([], categories, null, referenceDateStr);
    expect(analytics.facts.totalCount).toBe(0);
    expect(analytics.facts.completionRatePercent).toBeUndefined();
    expect(analytics.facts.averageCompletionHours).toBeUndefined();
    expect(analytics.insights.map((insight) => insight.id)).toEqual(['dashboard-empty']);
    expect(analytics.text).toContain('No reminders are stored yet');
    expect(analytics.text).not.toMatch(/\b0%\b/);
  });

  it('keeps overdue boundaries exact: due today is not overdue, yesterday is', () => {
    const facts = buildDashboardFacts(allReminders, categories, null, referenceDateStr);
    expect(facts.overdueCount).toBe(1);
    expect(facts.overdueItems).toEqual([
      { reminderId: 'a-overdue', title: 'Return library books', dueDate: '2026-09-16', daysOverdue: 4, categoryName: 'Errands' },
    ]);
    expect(facts.oldestOverdueDays).toBe(4);
    expect(facts.dueTodayCount).toBe(1);
    expect(facts.overdueItems.some((item) => item.reminderId === 'a-due-today')).toBe(false);
  });

  it('exposes per-category and overall average completion times from real timestamps', () => {
    const facts = buildDashboardFacts(allReminders, categories, null, referenceDateStr);
    const car = facts.averageCompletionByCategory.find((stat) => stat.categoryId === 'car');
    const errands = facts.averageCompletionByCategory.find((stat) => stat.categoryId === 'errands');

    expect(car).toMatchObject({ completedCount: 2, averageCompletionHours: 36, formatted: '1.5 days' });
    expect(errands).toMatchObject({ completedCount: 1, averageCompletionHours: 12, formatted: '12 hours' });
    expect(facts.averageCompletionHours).toBe(28);
  });

  it('summarises dashboard facts without quoting a number that was not computed', () => {
    const facts = buildDashboardFacts(allReminders, categories, null, referenceDateStr);
    const insights = summarizeDashboardFacts(facts);

    for (const insight of insights) {
      // Duration sentences quote the formatted duration, which is asserted separately.
      if (/^dashboard-(average-completion|category-average)/.test(insight.id)) continue;
      const numbers = quotedNumbers(insight.text);
      const available = Object.values(insight.facts).filter((value): value is number => typeof value === 'number');
      for (const number of numbers) {
        expect(available).toContain(number);
      }
    }

    const average = insights.find((insight) => insight.id === 'dashboard-average-completion');
    expect(average?.facts.averageCompletionHours).toBe(facts.averageCompletionHours);
    expect(average?.text).toContain(facts.averageCompletionFormatted as string);

    const carAverage = insights.find((insight) => insight.id === 'dashboard-category-average:car');
    expect(carAverage?.facts.averageCompletionHours).toBe(36);
    expect(carAverage?.text).toContain('1.5 days');

    const overdue = insights.find((insight) => insight.id === 'dashboard-overdue');
    expect(overdue?.text).toContain('1 reminder is overdue');
    expect(overdue?.facts.oldestOverdueDays).toBe(4);
  });

  it('does not invent trends, causes or advice in summaries', () => {
    const analytics = analyzeDashboard(allReminders, categories, null, referenceDateStr);
    expect(analytics.text).not.toMatch(/procrastinat|because you|stress|should|advice|recommend/i);
  });

  it('reports money facts only when financial data exists, using the app formatter', () => {
    const withoutMoney = analyzeDashboard(allReminders, categories, null, referenceDateStr);
    expect(withoutMoney.insights.some((insight) => insight.id === 'dashboard-money')).toBe(false);

    const moneyState = {
      incomeConfig: null,
      directDebits: [
        { id: 'b1', title: 'Phone', amount: 45.5, categoryId: 'bill-phone', frequency: 'monthly' as const, nextPaymentDate: '2026-09-25', active: true, createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ],
      billCategories: [],
      extraIncomeList: [],
      extraIncomeCategories: [],
      tipEntries: [],
      shifts: [],
      payCycleOverrides: {},
    };
    const withMoney = analyzeDashboard(allReminders, categories, moneyState, referenceDateStr);
    const moneyInsight = withMoney.insights.find((insight) => insight.id === 'dashboard-money');
    expect(moneyInsight).toBeDefined();
    expect(moneyInsight?.facts.billsBeforePayTotal).toBe(withMoney.facts.billsBeforePayTotal);
    expect(moneyInsight?.text).toContain(formatCurrency(withMoney.facts.billsBeforePayTotal));
  });

  it('handles a large history without losing accuracy', () => {
    const large: Reminder[] = [];
    for (let index = 0; index < 500; index += 1) {
      large.push(
        reminder({
          id: `large-${index}`,
          title: `Completed task ${index}`,
          categoryId: index % 2 === 0 ? 'errands' : 'car',
          completed: true,
          createdAt: '2026-08-01T00:00:00.000Z',
          completedAt: '2026-08-02T00:00:00.000Z',
        })
      );
    }
    const facts = buildDashboardFacts([...large, ...activeReminders], categories, null, referenceDateStr);
    expect(facts.completedCount).toBe(500);
    expect(facts.activeCount).toBe(4);
    expect(facts.completionRatePercent).toBe(99);
    expect(facts.averageCompletionHours).toBe(24);
    expect(facts.categoryCounts.reduce((sum, entry) => sum + entry.totalCount, 0)).toBeGreaterThanOrEqual(500);
  });

  it('scores completed-history similarity conservatively', () => {
    expect(scoreTitleSimilarity('book car service', 'Book car service')).toMatchObject({ score: 0.98, reason: 'exact-match' });
    expect(scoreTitleSimilarity('water the plants', 'Water plants')).toMatchObject({ reason: 'derived' });
    const fuzzy = scoreTitleSimilarity('Book car servce', 'Book car service');
    expect(fuzzy).toMatchObject({ reason: 'fuzzy-match' });
    expect(fuzzy?.score).toBeGreaterThanOrEqual(0.82);
    expect(scoreTitleSimilarity('call the plumber', 'Book car service')).toBeUndefined();
    expect(normalizeHistoryTitle('  Book  the CAR service! ')).toBe('book the car service');
  });

  it('uses completed history for category fallback and similar-task context', () => {
    const history = [
      reminder({ id: 'h1', title: 'Renew gym membership', categoryId: 'health', completed: true, completedAt: '2026-07-01T00:00:00.000Z' }),
      reminder({ id: 'h2', title: 'Renew gym membership', categoryId: 'health', completed: true, completedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    const engine = createSmartEngine({ reminders: history, contextProvider, referenceDate: new Date(2026, 8, 20) });
    const result = engine.interpret('create-reminder', 'Remind me to renew gym membership next Monday');
    const fields = (result.proposal as { fields: Record<string, { value?: unknown }> }).fields;

    expect(fields.categoryId.value).toBe('health');
    expect(fields.categorySource.value).toBe('completed-history');
    expect((fields.historyContext.value as { completedMatches: number }).completedMatches).toBe(2);
    expect(result.proposal?.preview).toContain('similar completed reminders');
    expect(result.proposal?.validation.canWrite).toBe(false);
  });

  it('does not use completed history when the permission is disabled', () => {
    const history = [
      reminder({ id: 'h1', title: 'Renew gym membership', categoryId: 'health', completed: true, completedAt: '2026-07-01T00:00:00.000Z' }),
      reminder({ id: 'h2', title: 'Renew gym membership', categoryId: 'health', completed: true, completedAt: '2026-06-01T00:00:00.000Z' }),
    ];
    const engine = createSmartEngine({
      reminders: history,
      contextProvider,
      settings: { featureToggles: { useCompletedHistory: false } },
      referenceDate: new Date(2026, 8, 20),
    });
    const result = engine.interpret('create-reminder', 'Remind me to renew gym membership next Monday');
    const fields = (result.proposal as { fields: Record<string, { value?: unknown }> }).fields;

    expect(fields.categoryId.value).toBeUndefined();
    expect(fields.historyContext.value).toBeUndefined();
    expect(result.proposal?.preview).not.toContain('similar completed reminders');
  });

  it('only suggests a repeated pattern when completions are evenly spaced', () => {
    const weekly = [0, 7, 14].map((offsetDay, index) =>
      reminder({
        id: `p-${index}`,
        title: 'Water plants',
        completed: true,
        createdAt: '2026-05-01T00:00:00.000Z',
        completedAt: new Date(Date.UTC(2026, 4, 1 + offsetDay, 0, 0, 0)).toISOString(),
      })
    );
    expect(detectRepeatedTaskPattern('Water plants', weekly)).toMatchObject({ occurrenceCount: 3, intervalDays: 7, unit: 'week' });
    expect(detectRepeatedTaskPattern('Water plants', weekly.slice(0, 2))).toBeUndefined();

    const uneven = [0, 3, 19].map((offsetDay, index) =>
      reminder({
        id: `u-${index}`,
        title: 'Water plants',
        completed: true,
        createdAt: '2026-05-01T00:00:00.000Z',
        completedAt: new Date(Date.UTC(2026, 4, 1 + offsetDay, 0, 0, 0)).toISOString(),
      })
    );
    expect(detectRepeatedTaskPattern('Water plants', uneven)).toBeUndefined();
  });

  it('summarises completed history and empty history from stored data only', () => {
    const empty = summarizeCompletedHistory([], categories);
    expect(empty).toEqual({ completedCount: 0, withTimestampsCount: 0, averageAvailable: false, byCategory: [] });

    const summary = summarizeCompletedHistory(allReminders, categories);
    expect(summary.completedCount).toBe(3);
    expect(summary.withTimestampsCount).toBe(3);
    expect(summary.averageAvailable).toBe(true);
    expect(summary.averageCompletionHours).toBe(28);
    expect(summary.byCategory.map((entry) => entry.categoryName).sort()).toEqual(['Car', 'Errands']);
  });

  it('suggests a history category from exact and conservative title matches only', () => {
    const suggestion = suggestCategoryFromHistory('Renew gym membership', [
      reminder({ id: 'h1', title: 'Renew gym membership', categoryId: 'health', completed: true }),
    ], categories);
    expect(suggestion).toMatchObject({ categoryId: 'health', categoryName: 'Health', evidenceCount: 1 });
    expect(suggestion?.confidence.reason).toBe('derived');

    expect(suggestCategoryFromHistory('Call the plumber', allReminders, categories)).toBeUndefined();
    expect(findSimilarCompletedReminders('buy groceries', allReminders).map((entry) => entry.reminderId)).toContain('c-errand-1');
  });

  it('matches contacts exactly, by first name and conservatively fuzzy', () => {
    expect(normalizeContactName('  Priyá   PaTel ')).toBe('priya patel');
    expect(matchContactByName('Josh Smith', contacts).best).toMatchObject({ contactId: 'ct-josh', score: 0.98, reason: 'exact-match' });
    expect(matchContactByName('Josh Jones', contacts).best?.contactId).toBe('ct-josh-jones');
    expect(matchContactByName('Priya Patell', contacts)).toMatchObject({ confidence: { reason: 'fuzzy-match' } });
    expect(matchContactByName('Priya Patell', contacts).best?.contactId).toBe('ct-priya');
    // An exact first-name match is high confidence, not a fuzzy guess.
    expect(scoreContactName('josh', contacts[0])).toMatchObject({ score: 0.94, reason: 'exact-match', matchedOn: 'first name' });
    // A full name mentioned inside longer text stays below an exact match.
    expect(scoreContactName('Josh Smith from work', contacts[0])).toMatchObject({ score: 0.88, reason: 'derived' });
  });

  it('reports ambiguity when several contacts match equally instead of guessing', () => {
    const result = matchContactByName('Josh', contacts);
    expect(result.best).toBeUndefined();
    expect(result.confidence.reason).toBe('ambiguous');
    expect(result.ambiguities[0].field).toBe('contactId');
    expect(result.ambiguities[0].options).toEqual(['Josh Smith', 'Josh Jones']);
    expect(result.message).toContain('More than one contact matches');
  });

  it('never guesses a contact below the conservative threshold and creates nothing', () => {
    const before = JSON.stringify(contacts);
    const result = matchContactByName('Zephyr Quill', contacts);
    expect(result.matches).toEqual([]);
    expect(result.best).toBeUndefined();
    expect(result.confidence.reason).toBe('unknown');
    expect(result.message).toContain('no contact was created');
    expect(JSON.stringify(contacts)).toBe(before);
    expect(CONTACT_FUZZY_THRESHOLD).toBeGreaterThan(0.8);
  });

  it('gates contact matching and contact context behind the Smart Assistance permission', () => {
    const enabled = createSmartEngine({ contacts, referenceDate: new Date(2026, 8, 20) });
    const matched = enabled.interpret('match-contact', 'Josh Smith');
    expect(matched.status).toBe('ok');
    expect((matched.value as { best?: { contactId: string } }).best?.contactId).toBe('ct-josh');

    const ambiguous = createSmartEngine({ contacts });
    expect(ambiguous.interpret('match-contact', 'Josh').status).toBe('needs-confirmation');

    const disabled = createSmartEngine({ contacts, settings: { featureToggles: { useContactContext: false } } });
    const blocked = disabled.interpret('match-contact', 'Josh Smith');
    expect(blocked.status).toBe('unknown');
    expect(blocked.message).toContain('turned off');

    const proposal = disabled.interpret('create-reminder', 'Remind me to call Josh Smith tomorrow');
    const fields = (proposal.proposal as { fields: Record<string, { value?: unknown }> }).fields;
    expect(fields.suggestedContactId.value).toBeUndefined();

    const withContext = enabled.interpret('create-reminder', 'Remind me to call Josh Smith tomorrow');
    const contactFields = (withContext.proposal as { fields: Record<string, { value?: unknown }> }).fields;
    expect(contactFields.suggestedContactName.value).toBe('Josh Smith');
  });

  it('routes dashboard and contact commands through the existing facade', () => {
    const engine = createSmartEngine({ reminders: allReminders, contacts, referenceDate: new Date(2026, 8, 20) });

    const dashboard = engine.interpret('assistant-command', 'how am i doing');
    expect(dashboard.status).toBe('ok');
    expect(dashboard.message).toContain('active reminders');
    expect((dashboard.value as { facts: { overdueCount: number } }).facts.overdueCount).toBe(1);

    const overdue = engine.interpret('assistant-command', 'what is overdue');
    expect(overdue.message).toContain('1 reminder is overdue');

    const direct = engine.interpret('dashboard-summary', 'summarise my dashboard');
    expect((direct.value as { facts: { completedCount: number } }).facts.completedCount).toBe(3);

    const disabled = createSmartEngine({ reminders: allReminders, settings: { featureToggles: { dashboardSummaries: false } } });
    const blocked = disabled.interpret('dashboard-summary', 'summarise my dashboard');
    expect(blocked.status).toBe('unknown');
    expect(blocked.message).toContain('turned off');
  });

  it('exposes feature defaults and lets one toggle be changed without touching the others', () => {
    const effective = getEffectiveSmartAssistanceFeatures(DEFAULT_SMART_ENGINE_SETTINGS);
    // Every registered feature resolves to its documented default, and the
    // resolved set matches the registry exactly (no missing or stray keys).
    expect(Object.keys(effective).sort()).toEqual(SMART_ASSISTANCE_FEATURES.map((definition) => definition.feature).sort());
    for (const definition of SMART_ASSISTANCE_FEATURES) {
      expect(effective[definition.feature]).toBe(definition.defaultEnabled);
    }
    expect(effective.dashboardSummaries).toBe(true);
    expect(effective.useCompletedHistory).toBe(true);
    expect(effective.useContactContext).toBe(true);
    expect(isSmartAssistanceFeatureEnabled({ ...DEFAULT_SMART_ENGINE_SETTINGS, featureToggles: {} }, 'useContactContext')).toBe(true);

    const changed = setSmartAssistanceFeature(DEFAULT_SMART_ENGINE_SETTINGS, 'useContactContext', false);
    expect(changed.featureToggles).toEqual({ useContactContext: false });
    expect(isSmartAssistanceFeatureEnabled(changed, 'useContactContext')).toBe(false);
    expect(isSmartAssistanceFeatureEnabled(changed, 'useCompletedHistory')).toBe(true);
    expect(changed.requireConfirmationForWrites).toBe(true);
  });

  it('stays offline and never mutates stored data while analysing', () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls += 1; throw new Error('network must not be used'); }) as typeof fetch;
    try {
      const snapshot = JSON.stringify({ allReminders, contacts, categories });
      const engine = createSmartEngine({ reminders: allReminders, contacts, referenceDate: new Date(2026, 8, 20) });
      engine.interpret('dashboard-summary', 'dashboard');
      engine.interpret('match-contact', 'Priya Patel');
      engine.interpret('assistant-command', 'what is overdue');
      engine.interpret('create-reminder', 'Remind me to call Josh Smith tomorrow');
      summarizeCompletedHistory(allReminders, categories);
      expect(calls).toBe(0);
      expect(JSON.stringify({ allReminders, contacts, categories })).toBe(snapshot);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
