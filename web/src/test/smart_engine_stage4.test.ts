import { describe, expect, it } from 'vitest';
import { DirectDebitCategory, MoneyState } from '../types/finance';
import { INITIAL_BILL_CATEGORIES, getDefaultMoneyState } from '../utils/sampleFinanceData';
import { calculatePayCycleSummary, toDateString } from '../utils/finance';
import { createSmartEngine } from '../services/smartEngine';
import {
  calculatePayCycleFacts,
  classifyMoneyEntry,
  createBillProposal,
  deriveNextPaymentDate,
  generateMoneyInsights,
  mapRecurrenceToBillFrequency,
  parseNotificationSettings,
  suggestBillCategory,
  summarizeMoney,
} from '../services/moneyIntelligence';

const referenceDate = new Date(2026, 8, 20, 9, 0, 0); // 2026-09-20

const customCategories: DirectDebitCategory[] = [
  ...INITIAL_BILL_CATEGORIES,
  { id: 'bcat-netflix', name: 'Netflix', color: '#EC4899' },
];

function moneyState(overrides: Partial<MoneyState> = {}): MoneyState {
  return { ...getDefaultMoneyState(), billCategories: customCategories, ...overrides };
}

const fortnightlyIncome = {
  id: 'inc-1',
  title: 'Primary Job',
  employmentType: 'full_time' as const,
  frequency: 'fortnightly' as const,
  averagePay: 1200,
  nextPayDate: '2026-09-26',
  createdAt: '2026-09-01',
  updatedAt: '2026-09-01',
};

const phoneBill = {
  id: 'b1',
  title: 'Phone Bill',
  amount: 80,
  categoryId: 'bcat-phone',
  frequency: 'monthly' as const,
  nextPaymentDate: '2026-09-22',
  active: true,
  createdAt: '2026-09-01',
  updatedAt: '2026-09-01',
};

describe('MindMesh Smart Engine Stage 04 money intelligence', () => {
  it('parses monthly, fortnightly, and custom bill frequencies into existing bill fields', () => {
    const monthly = createBillProposal('Netflix is $25.99 every month on the 16th', { categories: customCategories, referenceDate });
    expect(monthly.type).toBe('create-direct-debit');
    expect(monthly.fields.title.value).toBe('Netflix');
    expect(monthly.fields.amount.value).toBe(25.99);
    expect(monthly.fields.frequency.value).toBe('monthly');
    expect(monthly.fields.recurrenceConfig.value).toMatchObject({ interval: 1 });
    expect(monthly.fields.paymentDay.value).toBe(16);
    expect(monthly.fields.nextPaymentDate.value).toBe('2026-10-16');
    expect(monthly.fields.active.value).toBe(true);
    expect(monthly.fields.categoryId.value).toBe('bcat-netflix');

    const fortnightly = createBillProposal('Gym membership $22 fortnightly', { categories: customCategories, referenceDate });
    expect(fortnightly.fields.frequency.value).toBe('fortnightly');
    expect(fortnightly.fields.recurrenceConfig.value).toMatchObject({ interval: 1 });

    const custom = createBillProposal('Water service $90 every 10 days', { categories: customCategories, referenceDate });
    expect(custom.fields.frequency.value).toBe('every_x_days');
    expect(custom.fields.recurrenceConfig.value).toMatchObject({ interval: 1, customDays: 10 });
    expect(custom.fields.categoryId.value).toBe('bcat-util');
  });

  it('maps recurrence rules onto the app bill frequency model without double-scaling intervals', () => {
    expect(mapRecurrenceToBillFrequency({ frequency: 'custom', unit: 'week', interval: 2 })).toMatchObject({ frequency: 'fortnightly', recurrenceConfig: { interval: 1 } });
    expect(mapRecurrenceToBillFrequency({ frequency: 'custom', unit: 'month', interval: 3 })).toMatchObject({ frequency: 'quarterly', recurrenceConfig: { interval: 1 } });
    expect(mapRecurrenceToBillFrequency({ frequency: 'custom', unit: 'month', interval: 12 })).toMatchObject({ frequency: 'annually', recurrenceConfig: { interval: 1 } });
    expect(mapRecurrenceToBillFrequency({ frequency: 'custom', unit: 'week', interval: 3 })).toMatchObject({ frequency: 'every_x_weeks', recurrenceConfig: { interval: 3 } });
    expect(mapRecurrenceToBillFrequency({ frequency: 'none' })).toBeUndefined();
  });

  it('reports a missing amount instead of inventing one', () => {
    const proposal = createBillProposal('Netflix every month on the 16th', { categories: customCategories, referenceDate });
    expect(proposal.fields.amount.value).toBeUndefined();
    expect(proposal.missingFields.map((item) => item.field)).toContain('amount');
    expect(proposal.confidence.score).toBeLessThan(0.7);
    expect(proposal.validation.canWrite).toBe(false);
  });

  it('keeps conflicting explicit dates ambiguous rather than picking one', () => {
    const proposal = createBillProposal('Insurance $120 monthly on 2026-11-01 until 2027-01-31', { categories: customCategories, referenceDate });
    expect(proposal.fields.nextPaymentDate.value).toBeUndefined();
    expect(proposal.ambiguities.map((item) => item.field)).toContain('nextPaymentDate');
    expect(proposal.missingFields.map((item) => item.field)).toContain('nextPaymentDate');
  });

  it('derives a next payment date from a payment day and flags it for confirmation', () => {
    expect(deriveNextPaymentDate(16, referenceDate)).toBe('2026-10-16');
    expect(deriveNextPaymentDate(5, referenceDate)).toBe('2026-10-05');
    expect(deriveNextPaymentDate(25, referenceDate)).toBe('2026-09-25');
    expect(deriveNextPaymentDate(0, referenceDate)).toBeUndefined();

    const proposal = createBillProposal('Spotify $12.99 monthly on the 16th', { categories: customCategories, referenceDate });
    expect(proposal.ambiguities.map((item) => item.field)).toContain('nextPaymentDate');
  });

  it('prioritises existing user bill categories before default and domain matches', () => {
    const userCategory = suggestBillCategory('Netflix subscription', customCategories);
    expect(userCategory.category?.id).toBe('bcat-netflix');

    const domain = suggestBillCategory('rego renewal', customCategories);
    expect(domain.category?.id).toBe('bcat-car');

    const unknown = suggestBillCategory('something completely unclear', customCategories);
    expect(unknown.category).toBeUndefined();
    expect(unknown.confidence.reason).toBe('unknown');
  });

  it('reads explicit notes, end dates, paused state, and notification settings', () => {
    const proposal = createBillProposal('Rent $450 monthly on the 1st until 2027-06-30 notes: paid from joint account', { categories: customCategories, referenceDate });
    expect(proposal.fields.notes.value).toBe('paid from joint account');
    expect(proposal.fields.endDate.value).toBe('2027-06-30');

    const paused = createBillProposal('Gym $22 fortnightly paused', { categories: customCategories, referenceDate });
    expect(paused.fields.active.value).toBe(false);
    expect(paused.fields.active.confidence.reason).toBe('explicit-pattern');

    expect(parseNotificationSettings('notify me 3 days before')).toEqual([{ id: expect.any(String), type: '3_days_before', customValue: undefined, enabled: true }]);
    expect(parseNotificationSettings('remind me 12 hours before').map((item) => item.type)).toEqual(['custom_hours_before']);
    expect(parseNotificationSettings('Netflix $12 monthly')).toEqual([]);
  });

  it('proposes a reminder link without creating or scheduling anything', () => {
    const proposal = createBillProposal('Netflix $25.99 every month on the 16th, remind me to pay it', { categories: customCategories, referenceDate });
    expect(proposal.fields.linkReminderRequested.value).toBe(true);
    expect(proposal.fields.linkedReminderId.value).toBeUndefined();
    expect(proposal.fields.linkedReminderTitle.value).toBe('Netflix');
    expect(proposal.preview).toContain('linked reminder');
    expect(proposal.validation.canWrite).toBe(false);
  });

  it('classifies money entries into existing supported types', () => {
    expect(classifyMoneyEntry('payday $1200').kind).toBe('income-pay');
    expect(classifyMoneyEntry('sold an old bike on marketplace').kind).toBe('extra-income');
    expect(classifyMoneyEntry('$60 in tips tonight').kind).toBe('tip');
    expect(classifyMoneyEntry('Rent direct debit $450 monthly', { billCategories: customCategories }).kind).toBe('direct-debit');
    expect(classifyMoneyEntry('worked a 6 hour shift').kind).toBe('shift');
    expect(classifyMoneyEntry('something vague').kind).toBe('unknown');

    const extraIncome = classifyMoneyEntry('sold an old bike on marketplace', { extraIncomeCategories: getDefaultMoneyState().extraIncomeCategories });
    expect(extraIncome.kind).toBe('extra-income');
    expect(extraIncome.suggestedExtraIncomeCategoryId).toBe('xcat-market');
  });

  it('suggests an existing bill category for a classified bill without fabricating a transaction', () => {
    const classification = classifyMoneyEntry('Electricity bill $120 monthly', { billCategories: customCategories });
    expect(classification.kind).toBe('direct-debit');
    expect(classification.suggestedBillCategoryId).toBe('bcat-util');
    expect(classification.ambiguities).toEqual([]);
  });

  it('returns ambiguity instead of a coin-flip when wording matches two entry types', () => {
    const classification = classifyMoneyEntry('electricity bill and tips');
    expect(classification.kind).toBe('unknown');
    expect(classification.confidence.reason).toBe('ambiguous');
    expect(classification.ambiguities[0].options).toContain('tip');
    expect(classification.ambiguities[0].options).toContain('direct-debit');
  });

  it('calculates pay-cycle facts that match the existing finance calculators', () => {
    const state = moneyState({ incomeConfig: fortnightlyIncome, directDebits: [phoneBill] });
    const facts = calculatePayCycleFacts(state, '2026-09-20');
    const summary = calculatePayCycleSummary(fortnightlyIncome, [phoneBill], [], undefined, '2026-09-20');

    expect(facts.hasIncomeConfig).toBe(true);
    expect(facts.daysUntilNextPay).toBe(6);
    expect(facts.nextPayDate).toBe('2026-09-26');
    expect(facts.previousPayDate).toBe('2026-09-12');
    expect(facts.expectedPay).toBe(summary.expectedPay);
    expect(facts.billsTotal).toBe(summary.billsTotal);
    expect(facts.billsTotal).toBe(80);
    expect(facts.remainingAfterBills).toBe(summary.remainingAfterBills);
    expect(facts.remainingAfterBills).toBe(1120);
    expect(facts.billsDue).toEqual([{ title: 'Phone Bill', amount: 80, date: '2026-09-22' }]);
  });

  it('handles pay-cycle boundary dates on the pay day itself', () => {
    const state = moneyState({ incomeConfig: fortnightlyIncome, directDebits: [phoneBill] });
    const facts = calculatePayCycleFacts(state, '2026-09-26');
    expect(facts.nextPayDate).toBe('2026-09-26');
    expect(facts.daysUntilNextPay).toBe(0);
    expect(facts.billsTotal).toBe(0);
    expect(facts.billsDue).toEqual([]);
  });

  it('reports zero and negative remaining amounts using calculated values', () => {
    const exact = moneyState({
      incomeConfig: { ...fortnightlyIncome, averagePay: 80 },
      directDebits: [phoneBill],
    });
    const exactFacts = calculatePayCycleFacts(exact, '2026-09-20');
    expect(exactFacts.remainingAfterBills).toBe(0);
    expect(generateMoneyInsights(exact, '2026-09-20').map((insight) => insight.id)).toContain('money-fully-allocated');

    const shortfall = moneyState({
      incomeConfig: { ...fortnightlyIncome, averagePay: 50 },
      directDebits: [phoneBill],
    });
    const shortfallFacts = calculatePayCycleFacts(shortfall, '2026-09-20');
    expect(shortfallFacts.remainingAfterBills).toBe(-30);
    expect(shortfallFacts.shortfall).toBe(true);
    const shortfallInsight = generateMoneyInsights(shortfall, '2026-09-20').find((insight) => insight.id === 'money-shortfall');
    expect(shortfallInsight?.text).toContain('exceed');
    expect(shortfallInsight?.facts.shortfallAmount).toBe(30);
  });

  it('does not invent income or bills when nothing is configured', () => {
    const empty = moneyState();
    const facts = calculatePayCycleFacts(empty, '2026-09-20');
    expect(facts.hasIncomeConfig).toBe(false);
    expect(facts.expectedPay).toBeUndefined();
    expect(facts.billsTotal).toBeUndefined();
    expect(facts.remainingAfterBills).toBeUndefined();

    const insights = generateMoneyInsights(empty, '2026-09-20');
    expect(insights).toHaveLength(1);
    expect(insights[0].text).toContain('No income configuration');
    expect(insights[0].facts.expectedPay).toBeUndefined();

    const insightsWithBills = generateMoneyInsights(moneyState({ directDebits: [phoneBill] }), '2026-09-20');
    expect(insightsWithBills.map((insight) => insight.id)).toContain('money-active-bills');
    expect(insightsWithBills.some((insight) => insight.text.includes('remaining'))).toBe(false);
  });

  it('states that no bills are due instead of fabricating a total', () => {
    const state = moneyState({ incomeConfig: fortnightlyIncome });
    const facts = calculatePayCycleFacts(state, '2026-09-20');
    expect(facts.billsTotal).toBe(0);
    expect(facts.billsDue).toEqual([]);
    const insights = generateMoneyInsights(state, '2026-09-20');
    expect(insights.map((insight) => insight.id)).toContain('money-no-bills-due');
    expect(insights[0].text).toContain('No active direct debits');
  });

  it('includes extra income and tips only when existing rules count them', () => {
    const state = moneyState({
      incomeConfig: fortnightlyIncome,
      directDebits: [phoneBill],
      extraIncomeList: [
        { id: 'x1', title: 'Cash job', amount: 150, date: '2026-09-21', categoryId: 'xcat-cash', includeInCurrentPayCycle: true, createdAt: '2026-09-20' },
        { id: 'x2', title: 'Old sale', amount: 500, date: '2026-08-01', categoryId: 'xcat-market', includeInCurrentPayCycle: true, createdAt: '2026-08-01' },
      ],
      tipEntries: [
        { id: 't1', amount: 40, date: '2026-09-21', createdAt: '2026-09-21' },
        { id: 't2', amount: 60, date: '2026-09-01', createdAt: '2026-09-01' },
      ],
    });
    const facts = calculatePayCycleFacts(state, '2026-09-20');
    expect(facts.extraIncomeTotal).toBe(150);
    expect(facts.tipsTotal).toBe(40);
    // Extra income is counted by the existing rule; tips remain informational.
    expect(facts.remainingAfterBills).toBe(1200 + 150 - 80);

    const insightIds = generateMoneyInsights(state, '2026-09-20').map((insight) => insight.id);
    expect(insightIds).toContain('money-extra-income');
    expect(insightIds).toContain('money-tips');
  });

  it('produces insight numbers that match the calculator output exactly', () => {
    const state = moneyState({ incomeConfig: fortnightlyIncome, directDebits: [phoneBill] });
    const reference = toDateString(referenceDate);
    const summary = calculatePayCycleSummary(fortnightlyIncome, [phoneBill], [], undefined, reference);
    const money = summarizeMoney(state, reference);
    const billsInsight = money.insights.find((insight) => insight.id === 'money-bills-before-pay');
    const remainingInsight = money.insights.find((insight) => insight.id === 'money-remaining-after-bills');

    expect(billsInsight?.facts.billsTotal).toBe(summary.billsTotal);
    expect(remainingInsight?.facts.expectedPay).toBe(summary.expectedPay);
    expect(remainingInsight?.facts.remainingAfterBills).toBe(summary.remainingAfterBills);
    expect(money.text).toContain(summary.billsTotal.toFixed(0));
  });

  it('routes bills, money summaries, and classification through the existing facade', () => {
    const state = moneyState({ incomeConfig: fortnightlyIncome, directDebits: [phoneBill] });
    const engine = createSmartEngine({ billCategories: customCategories, moneyState: state, referenceDate });

    const bill = engine.interpret('create-direct-debit', 'Electricity bill $120 monthly on the 21st');
    expect(bill.proposal?.type).toBe('create-direct-debit');
    expect(bill.proposal?.validation.canWrite).toBe(false);
    expect((bill.proposal as { fields: Record<string, { value?: unknown }> }).fields.categoryId.value).toBe('bcat-util');

    const query = engine.interpret('assistant-command', 'how much is left before payday');
    expect(query.status).toBe('ok');
    expect((query.value as { facts: { billsTotal?: number } }).facts.billsTotal).toBe(80);

    const classification = engine.interpret('classify-money', '$60 in tips tonight');
    expect(classification.operation).toBe('classify-money');
    expect((classification.value as { kind: string }).kind).toBe('tip');

    const noMoneyData = createSmartEngine({ billCategories: customCategories });
    expect(noMoneyData.interpret('assistant-command', 'what is left before payday').status).toBe('unknown');
  });

  it('never touches storage, repositories, or the network while interpreting', () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls += 1; throw new Error('network must not be used'); }) as typeof fetch;
    try {
      const state = moneyState({ incomeConfig: fortnightlyIncome, directDebits: [phoneBill] });
      const before = JSON.stringify(state);
      const engine = createSmartEngine({ billCategories: customCategories, moneyState: state, referenceDate });
      engine.interpret('create-direct-debit', 'Netflix $25.99 every month on the 16th');
      engine.interpret('assistant-command', 'what bills are due before payday');
      engine.interpret('classify-money', 'payday $1200');
      expect(JSON.stringify(state)).toBe(before);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
