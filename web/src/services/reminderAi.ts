import { Reminder } from '../types';
import { enhanceReminderLocally } from './reminderIntelligence';

export type ReminderAiOperation = 'enhance-description' | 'generate-summary';

export interface ReminderAiRequest {
  operation: ReminderAiOperation;
  title: string;
  description?: string;
  summary?: string;
  category?: string;
  subtasks?: string[];
}

export function reminderAiRequest(reminder: Pick<Reminder, 'title' | 'description' | 'summary' | 'subtasks'> & { category?: string }, operation: ReminderAiOperation): ReminderAiRequest {
  return {
    operation,
    title: reminder.title,
    description: reminder.description,
    summary: reminder.summary,
    category: reminder.category,
    subtasks: reminder.subtasks.map((step) => step.title),
  };
}

/**
 * Deterministic local replacement for the existing enhancement UI. It only
 * rearranges text already supplied by the user and never performs I/O.
 */
export function enhanceReminderTextLocally(request: ReminderAiRequest): string {
  const title = request.title.trim();
  const description = request.description?.trim();
  const subtasks = (request.subtasks || []).map((item) => item.trim()).filter(Boolean);
  if (request.operation === 'generate-summary') {
    if (description) return description.split(/[.!?]+/)[0].trim().slice(0, 140);
    return subtasks.length > 0 ? `${title}: ${subtasks.slice(0, 3).join(' · ')}` : title;
  }
  const enhanced = enhanceReminderLocally(title, description, request.category);
  return subtasks.length > 0 ? `${enhanced} Steps: ${subtasks.join('; ')}.` : enhanced;
}
