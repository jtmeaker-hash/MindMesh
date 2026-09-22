import { describe, expect, it, beforeEach } from 'vitest';
import { createEmptyRoutine, createRoutineStep } from '../types/routine';
import { starterTemplates, saveRoutineAsTemplate, instantiateRoutineTemplate } from '../services/routineTemplates';
import { createRoutineAiProposal, applyApprovedAiChanges } from '../services/routineAi';
import { repairRoutineLinks, validateRoutineLinks } from '../services/routineIntegrations';

beforeEach(() => localStorage.clear());

function routine() {
  const now = new Date().toISOString();
  return createEmptyRoutine({
    id: 'routine-1', name: 'Reset', categoryId: 'cat-1',
    steps: [createRoutineStep({ id: 'step-1', routineId: 'routine-1', title: 'Clear desk', order: 0, completed: true })],
    history: [{ id: 'history-1', routineId: 'routine-1', event: 'completed', at: now }],
  });
}

describe('Routine Builder Stage 5', () => {
  it('provides starter templates and omits runtime history when saving one', () => {
    const source = routine();
    const template = saveRoutineAsTemplate(source);
    const instance = instantiateRoutineTemplate(template);
    expect(starterTemplates('cat-1').length).toBeGreaterThan(0);
    expect(instance.history).toEqual([]);
    expect(instance.activeSession).toBeUndefined();
    expect(instance.steps[0].completed).toBe(false);
  });

  it('creates an offline proposal without changing the routine until approval', async () => {
    const source = routine();
    const proposal = await createRoutineAiProposal('suggest', 'Gather supplies, do the small version', source);
    expect(proposal.provider).toBe('offline');
    expect(source.steps).toHaveLength(1);
    const accepted = applyApprovedAiChanges(source, proposal, [proposal.changes[0].id]);
    expect(accepted.steps).toHaveLength(2);
    expect(source.steps).toHaveLength(1);
  });

  it('marks missing linked targets and repairs only the broken reference', () => {
    const source = { ...routine(), steps: [{ ...routine().steps[0], links: { reminderId: 'missing-reminder', contactId: 'contact-1' } }] };
    const broken = validateRoutineLinks([source], { reminders: [], contacts: [{ id: 'contact-1', fullName: 'A', phoneNumber: '', relationship: 'Friend', createdAt: '', updatedAt: '' }], directDebits: [] });
    expect(broken).toHaveLength(1);
    const repaired = repairRoutineLinks(source, { reminders: [], contacts: [], directDebits: [] });
    expect(repaired.steps[0].links?.reminderId).toBeUndefined();
    expect(repaired.steps[0].links?.contactId).toBeUndefined();
    expect(repaired.brokenLink).toBe(false);
  });
});
