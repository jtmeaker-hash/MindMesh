import { Reminder } from '../types';

export type ReminderAiOperation = 'enhance-description' | 'generate-summary';

export interface ReminderAiRequest {
  operation: ReminderAiOperation;
  title: string;
  description?: string;
  summary?: string;
  category?: string;
  subtasks?: string[];
}

export class ReminderAiError extends Error {
  constructor(message: string, public readonly code: 'unavailable' | 'failed' | 'empty' | 'cancelled') {
    super(message);
    this.name = 'ReminderAiError';
  }
}

/**
 * Calls the optional server-side AI adapter. The browser never receives a
 * provider key; deployments can implement POST /api/ai/reminder (or override
 * the endpoint) without changing the reminder editor.
 */
export async function enhanceReminderText(
  request: ReminderAiRequest,
  signal?: AbortSignal,
  endpoint = '/api/ai/reminder'
): Promise<string> {
  if (typeof fetch !== 'function') {
    throw new ReminderAiError('AI enhancement is unavailable offline.', 'unavailable');
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
      throw new ReminderAiError('AI enhancement cancelled.', 'cancelled');
    }
    throw new ReminderAiError('AI enhancement is unavailable. You can continue editing manually.', 'unavailable');
  }

  if (!response.ok) {
    throw new ReminderAiError(`AI enhancement failed (${response.status}).`, 'failed');
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new ReminderAiError('AI enhancement returned an unreadable response.', 'failed');
  }

  const text = payload && typeof payload === 'object' && typeof (payload as { text?: unknown }).text === 'string'
    ? (payload as { text: string }).text.trim()
    : '';
  if (!text) throw new ReminderAiError('AI enhancement returned no text.', 'empty');
  return text;
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
