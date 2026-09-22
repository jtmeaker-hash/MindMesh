import { describe, expect, it } from 'vitest';
import { createSmartEngine } from '../services/smartEngine';
import { createDirectDebitProposal, createReminderProposal, detectIntent, parseAmount, parseDateTime, parseRecurrence } from '../services/smartEngineParsing';

const referenceDate = new Date(2026, 8, 21, 9, 0, 0);

describe('MindMesh Smart Engine Stage 02 parsing', () => {
  it('detects a clear reminder command without writing', () => {
    const result = createSmartEngine().interpret('assistant-command', 'Remind me to pay rego next Friday');
    expect(result.operation).toBe('assistant-command');
    expect(result.proposal?.type).toBe('create-reminder');
    expect((result.proposal as { fields?: Record<string, { value?: unknown }> }).fields?.title.value).toBe('pay rego');
  });

  it('creates a reminder proposal with title and next weekday', () => {
    const proposal = createReminderProposal('Remind me to pay rego next Friday', referenceDate);
    expect(proposal.type).toBe('create-reminder');
    expect(proposal.fields.title.value).toBe('pay rego');
    expect(proposal.fields.dueDate.value).toBe('2026-09-25');
    expect(proposal.missingFields).toEqual([]);
    expect(proposal.validation.canWrite).toBe(false);
  });

  it('parses direct debit name, amount, monthly frequency, and payment day', () => {
    const proposal = createDirectDebitProposal('Netflix is $25.99 every month on the 16th', referenceDate);
    expect(proposal.fields.title.value).toBe('Netflix');
    expect(proposal.fields.amount.value).toBe(25.99);
    expect(proposal.fields.frequency.value).toEqual({ frequency: 'monthly', interval: 1 });
    expect(proposal.fields.paymentDay.value).toBe(16);
    expect(proposal.missingFields).toEqual([]);
  });

  it('supports recurrence variations using the existing recurrence shape', () => {
    expect(parseRecurrence('daily').value).toEqual({ frequency: 'daily', interval: 1 });
    expect(parseRecurrence('weekly').value).toEqual({ frequency: 'weekly', interval: 1 });
    expect(parseRecurrence('fortnightly').value).toEqual({ frequency: 'custom', unit: 'week', interval: 2 });
    expect(parseRecurrence('quarterly').value).toEqual({ frequency: 'custom', unit: 'month', interval: 3 });
    expect(parseRecurrence('yearly').value).toEqual({ frequency: 'custom', unit: 'month', interval: 12 });
    expect(parseRecurrence('every 10 days').value).toEqual({ frequency: 'custom', unit: 'day', interval: 10 });
    expect(parseRecurrence('every 3 weeks').value).toEqual({ frequency: 'custom', unit: 'week', interval: 3 });
    expect(parseRecurrence('every 2 months').value).toEqual({ frequency: 'custom', unit: 'month', interval: 2 });
  });

  it('parses relative and explicit local dates and times', () => {
    expect(parseDateTime('tomorrow at 7:30 pm', referenceDate).value).toEqual({ date: '2026-09-22', time: '19:30', approximate: false });
    expect(parseDateTime('in 2 weeks', referenceDate).value?.date).toBe('2026-10-05');
    expect(parseDateTime('05/10/2026', referenceDate).value?.date).toBe('2026-10-05');
    expect(parseDateTime('next Monday', referenceDate).value?.date).toBe('2026-09-28');
  });

  it('marks broad time-of-day as ambiguous instead of inventing an exact time', () => {
    const result = parseDateTime('tomorrow morning', referenceDate);
    expect(result.value?.date).toBe('2026-09-22');
    expect(result.value?.approximate).toBe(true);
    expect(result.ambiguities[0].field).toBe('time');
    expect(result.confidence.score).toBeLessThan(0.7);
  });

  it('does not guess a vague request into a write action', () => {
    const result = createSmartEngine().interpret('assistant-command', 'sort that thing with Josh sometime');
    expect(result.status).toBe('needs-confirmation');
    expect(result.proposal).toBeUndefined();
    expect(result.confidence.score).toBe(0);
  });

  it('returns ambiguity for conflicting command families', () => {
    const result = detectIntent('Remind me to pay the bill every month');
    expect(result.intent).toBe('unknown');
    expect(result.ambiguities[0].field).toBe('intent');
    expect(result.ambiguities[0].options).toContain('create-reminder');
    expect(result.ambiguities[0].options).toContain('create-direct-debit');
  });

  it('requires amount, frequency, and payment timing for incomplete bills', () => {
    const proposal = createDirectDebitProposal('Netflix');
    expect(proposal.missingFields.map((field) => field.field)).toEqual(['amount', 'frequency', 'paymentDay']);
    expect(proposal.confidence.score).toBeLessThan(0.7);
  });

  it('parses amounts without inventing values', () => {
    expect(parseAmount('$25.99').amount).toBe(25.99);
    expect(parseAmount('25 dollars').amount).toBe(25);
    expect(parseAmount('every month').amount).toBeUndefined();
    expect(parseAmount('every month').ambiguities[0].field).toBe('amount');
  });

  it('has no network side effect while interpreting', () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => { calls += 1; throw new Error('network must not be used'); }) as typeof fetch;
    try {
      createSmartEngine().interpret('create-reminder', 'Remind me to pay rego tomorrow');
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
