import { Routine, RoutineAiAction, RoutineAiChange, RoutineAiProposal, RoutineStep, createRoutineStep } from '../types/routine';

const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function offlineSteps(prompt: string): string[] {
  const words = prompt.split(/[,;\n]|\band then\b|\bthen\b/i).map((item) => item.trim()).filter(Boolean);
  return (words.length > 1 ? words : ['Prepare the space', 'Do the smallest useful version', 'Close out and note what helped']).slice(0, 8);
}

export async function createRoutineAiProposal(action: RoutineAiAction, prompt: string, routine: Routine): Promise<RoutineAiProposal> {
  const titles = offlineSteps(prompt);
  const changes: RoutineAiChange[] = titles.map((title, index) => ({ id: id('change'), type: 'add-step', description: `Add step “${title}”`, after: title, requiresConfirmation: false, stepId: `proposed-${index}` }));
  if (action === 'rewrite' && routine.description) changes.push({ id: id('change'), type: 'edit-routine', description: 'Rewrite the routine description for clarity', before: routine.description, after: `${routine.description.trim()} Start with the smallest visible action.`, requiresConfirmation: false });
  return { id: id('ai-proposal'), action, routineId: routine.id, prompt, changes, provider: 'offline', createdAt: new Date().toISOString() };
}

export function applyApprovedAiChanges(routine: Routine, proposal: RoutineAiProposal, acceptedChangeIds: string[], confirmDeletes = false): Routine {
  const accepted = new Set(acceptedChangeIds);
  const next = { ...routine, steps: [...routine.steps] };
  for (const change of proposal.changes) {
    if (!accepted.has(change.id)) continue;
    if (change.type === 'delete-step') {
      if (!confirmDeletes || !change.stepId) continue;
      next.steps = next.steps.filter((step) => step.id !== change.stepId);
    } else if (change.type === 'add-step' && change.after) {
      const step: RoutineStep = createRoutineStep({ id: id('step'), routineId: routine.id, title: change.after, order: next.steps.length });
      next.steps.push(step);
    } else if (change.type === 'edit-step' && change.stepId && change.after) {
      next.steps = next.steps.map((step) => step.id === change.stepId ? { ...step, title: change.after!, updatedAt: new Date().toISOString() } : step);
    } else if (change.type === 'edit-routine' && change.after) next.description = change.after;
  }
  return { ...next, updatedAt: new Date().toISOString() };
}
