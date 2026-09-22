import { Routine, RoutineTemplate, duplicateRoutine } from '../types/routine';
import { loadPreferences, savePreferences } from './storage';

const TEMPLATE_KEY = 'routineTemplates';
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function storedTemplates(): RoutineTemplate[] {
  const value = loadPreferences()[TEMPLATE_KEY];
  return Array.isArray(value) ? value as RoutineTemplate[] : [];
}

function withoutRuntime(source: Routine, keepSchedule: boolean): Routine {
  const copy = duplicateRoutine(source, id('template-routine'), (step, index) => id(`template-step-${index}`));
  return {
    ...copy,
    name: source.name,
    description: source.description,
    schedule: keepSchedule ? source.schedule : { recurrence: { frequency: 'none' } },
    status: 'draft',
    template: { isTemplate: true, source: 'user' },
  };
}

export function starterTemplates(categoryId: string): RoutineTemplate[] {
  const now = new Date().toISOString();
  const starters = [
    ['Morning reset', 'A gentle start with a few visible wins.', ['Drink water', 'Open curtains', 'Choose the first priority']],
    ['Bedtime landing', 'Close the day without needing perfection.', ['Put essentials away', 'Set tomorrow’s alarm', 'Choose a calming finish']],
    ['Weekly reset', 'A small weekly reset for your space and plans.', ['Clear one surface', 'Review the next seven days', 'Choose one helpful preparation']],
  ] as const;
  return starters.map(([name, description, steps], index) => {
    const routineId = `starter-${index}`;
    const routine = {
      id: routineId,
      name,
      description,
      categoryId,
      priority: 'medium' as const,
      status: 'draft' as const,
      executionMode: 'sequential' as const,
      startMode: 'manual' as const,
      schedule: { recurrence: { frequency: 'none' as const } },
      expiryBehaviour: 'overdue' as const,
      missedOccurrenceBehaviour: 'overdue' as const,
      completionRule: 'all-children' as const,
      notification: { enabled: false, priority: 'default' as const },
      steps: steps.map((title, stepIndex) => ({
        id: `${routineId}-step-${stepIndex}`, routineId, parentStepId: null, title, kind: 'task' as const,
        order: stepIndex, depth: 0, completed: false, optional: false, permanent: true,
        dependencyIds: [], tags: [], createdAt: now, updatedAt: now,
      })),
      dependencies: [], conditions: [], occurrences: [], history: [],
      stats: { completionCount: 0, skipCount: 0, overdueCount: 0, failedCount: 0, totalDurationMinutes: 0 },
      template: { isTemplate: true, source: 'starter', templateId: routineId, templateName: name },
      version: 1, versionHistory: [], createdAt: now, updatedAt: now,
    } satisfies Routine;
    return { id: routineId, name, description, source: 'starter' as const, routine, keepScheduleByDefault: false, createdAt: now, updatedAt: now };
  });
}

export function listRoutineTemplates(categoryId = 'uncategorized'): RoutineTemplate[] {
  return [...starterTemplates(categoryId), ...storedTemplates()];
}

export function saveRoutineAsTemplate(source: Routine, name = source.name, keepScheduleByDefault = false): RoutineTemplate {
  const now = new Date().toISOString();
  const template: RoutineTemplate = { id: id('template'), name, description: source.description, source: 'user', routine: withoutRuntime(source, keepScheduleByDefault), keepScheduleByDefault, createdAt: now, updatedAt: now };
  savePreferences({ ...loadPreferences(), [TEMPLATE_KEY]: [...storedTemplates(), template] });
  return template;
}

export function deleteRoutineTemplate(templateId: string): boolean {
  const templates = storedTemplates();
  const next = templates.filter((template) => template.id !== templateId);
  if (next.length === templates.length) return false;
  savePreferences({ ...loadPreferences(), [TEMPLATE_KEY]: next });
  return true;
}

export function instantiateRoutineTemplate(template: RoutineTemplate, categoryId = template.routine.categoryId, keepSchedule = template.keepScheduleByDefault): Routine {
  const routine = withoutRuntime({ ...template.routine, categoryId }, keepSchedule);
  return { ...routine, name: template.name, template: { isTemplate: false, source: template.source, templateId: template.id, templateName: template.name } };
}
