import { Category, Reminder, RecurrenceRule } from '../types';
import { Contact } from '../types/contact';
import { formatRecurrenceLabel } from './recurrence';
import { createReminderProposal, parseDateTime, parseRecurrence } from './smartEngineParsing';
import {
  detectRepeatedTaskPattern,
  findSimilarCompletedReminders,
  suggestCategoryFromHistory,
} from './historyIntelligence';
import { findContactMentions } from './contactIntelligence';
import { Ambiguity, Confidence, CreateCategoryProposal, CreateReminderProposal, CreateSubcategoryProposal, EditReminderProposal, MissingField, SmartEngineField } from '../types/smartEngine';

export interface ReminderSummary {
  text: string;
  overdue: boolean;
  completed: boolean;
}

export interface ReminderGraphSummaryFacts {
  id: string;
  title: string;
  summary?: string;
  description?: string;
  dueDate?: string;
  dueTime?: string;
  categoryId: string;
  categoryName?: string;
  recurrence?: RecurrenceRule;
  recurrenceLabel: string;
  completed: boolean;
  overdue: boolean;
  subtaskCount: number;
  completedSubtaskCount: number;
}

export interface CategorySuggestion {
  category?: Category;
  confidence: Confidence;
  reason: string;
  alternatives: Category[];
}

export interface SubtaskSuggestion {
  title: string;
  confidence: Confidence;
  reason: string;
}

const EXACT: Confidence = { score: 0.98, reason: 'exact-match' };
const KEYWORD: Confidence = { score: 0.84, reason: 'derived' };
const UNKNOWN: Confidence = { score: 0, reason: 'unknown' };

const CATEGORY_ALIASES: Record<string, string[]> = {
  car: ['rego', 'registration', 'fuel', 'petrol', 'diesel', 'tyres', 'tires', 'mechanic', 'service', 'car insurance'],
  health: ['doctor', 'dentist', 'medication', 'medicine', 'script', 'physio', 'appointment', 'prescription'],
  money: ['rent', 'electricity', 'internet', 'subscription', 'insurance', 'phone bill', 'pay bill', 'bill'],
  bills: ['rent', 'electricity', 'internet', 'subscription', 'insurance', 'phone bill', 'pay bill', 'bill'],
  errands: ['buy', 'pick up', 'pickup', 'drop off', 'return', 'groceries', 'shopping'],
  work: ['meeting', 'project', 'client', 'report', 'email', 'office'],
};

function normalize(value: string): string { return value.trim().replace(/\s+/g, ' '); }
function words(value: string): string[] { return normalize(value).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean); }
function titleCase(value: string): string { return normalize(value).replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function confidenceFor(score: number, reason: Confidence['reason']): Confidence { return { score, reason }; }

/** Only reformats supplied text; it never adds facts, dates, people, or places. */
export function enhanceReminderLocally(title: string, description?: string, categoryName?: string): string {
  const cleanTitle = titleCase(title);
  const supplied = normalize(description || '');
  if (supplied) return `${cleanTitle}: ${supplied.replace(/[.!?]+$/, '')}.`;
  const categoryPrefix = categoryName ? `${titleCase(categoryName)} task: ` : '';
  return `${categoryPrefix}Complete ${cleanTitle.toLowerCase()}.`;
}

export function summarizeReminder(reminder: Reminder, categories: readonly Category[] = [], referenceDate: Date = new Date()): ReminderSummary {
  const category = categories.find((item) => item.id === reminder.categoryId)?.name;
  const parts = [reminder.title.trim()];
  if (reminder.description?.trim()) parts.push(reminder.description.trim());
  if (reminder.dueDate) parts.push(`Due ${reminder.dueDate}${reminder.dueTime ? ` at ${reminder.dueTime}` : ''}`);
  if (category) parts.push(`Category: ${category}`);
  if (reminder.recurrence && reminder.recurrence.frequency !== 'none') parts.push(formatRecurrenceLabel(reminder.recurrence));
  if (reminder.subtasks.length) parts.push(`${reminder.subtasks.filter((task) => task.completed).length}/${reminder.subtasks.length} subtasks complete`);
  const overdue = Boolean(reminder.dueDate && !reminder.completed && reminder.dueDate < localDate(referenceDate));
  if (reminder.completed) parts.push('Completed');
  else if (overdue) parts.push('Overdue');
  return { text: parts.join(' · '), overdue, completed: reminder.completed };
}

function localDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function toReminderGraphSummaryFacts(reminder: Reminder, categories: readonly Category[] = [], referenceDate: Date = new Date()): ReminderGraphSummaryFacts {
  const summary = summarizeReminder(reminder, categories, referenceDate);
  return {
    id: reminder.id,
    title: reminder.title,
    summary: reminder.summary,
    description: reminder.description,
    dueDate: reminder.dueDate,
    dueTime: reminder.dueTime,
    categoryId: reminder.categoryId,
    categoryName: categories.find((item) => item.id === reminder.categoryId)?.name,
    recurrence: reminder.recurrence,
    recurrenceLabel: formatRecurrenceLabel(reminder.recurrence),
    completed: reminder.completed,
    overdue: summary.overdue,
    subtaskCount: reminder.subtasks.length,
    completedSubtaskCount: reminder.subtasks.filter((task) => task.completed).length,
  };
}

export interface CategoryMention {
  /** The category name that appears in the text, if any. */
  name?: string;
  category?: Category;
  /** Other equally specific categories, so the caller can ask instead of guessing. */
  alternatives: Category[];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const SCOPE_PHRASE = /\b(?:summari[sz]e|summary of|overview of)\s+(.*)$/i;
const SCOPE_NOUN = /\b(?:reminders?|tasks?|nodes?|graph|mesh|network|branch(?:es)?|categor(?:y|ies))\b/i;

/**
 * Finds a category the user actually named. Matching is whole-word so a category
 * called "Work" is never found inside "homework", and the longest name wins when
 * one name contains another ("Car" vs "Car Insurance").
 *
 * When nothing in the text matches a stored category, the words that were placed
 * before the scope noun are returned as an unmatched `name` ("summarise my Boat
 * branch" -> "Boat") so the caller can say the category does not exist instead of
 * silently answering with everything.
 */
export function findCategoryMention(input: string, categories: readonly Category[]): CategoryMention {
  const matches = categories
    .filter((category) => category.name.trim() && new RegExp(`\\b${escapeRegExp(category.name.trim())}\\b`, 'i').test(input))
    .sort((a, b) => b.name.length - a.name.length);
  if (matches.length > 0) {
    const longest = matches[0].name.length;
    const tied = matches.filter((category) => category.name.length === longest);
    if (tied.length > 1) return { name: matches[0].name, alternatives: tied };
    return { name: matches[0].name, category: matches[0], alternatives: matches.slice(1) };
  }

  const phrase = input.match(SCOPE_PHRASE)?.[1] ?? '';
  const noun = phrase.match(SCOPE_NOUN);
  if (!noun?.index) return { alternatives: [] };
  const candidate = normalize(
    phrase.slice(0, noun.index).replace(/\b(?:my|our|the|all|of|this|that|these|those|a|an)\b/gi, ' ').replace(/[^a-z0-9 &'-]+/gi, ' ')
  );
  return candidate ? { name: titleCase(candidate), alternatives: [] } : { alternatives: [] };
}

/** Structured, deterministic summary of the reminders inside one branch. */
export interface ReminderScopeSummary {
  scope: { categoryId?: string; categoryName?: string; label: string };
  totals: {
    reminders: number;
    active: number;
    completed: number;
    overdue: number;
    subtasks: number;
    completedSubtasks: number;
  };
  nextDue?: { date: string; title: string };
  /** One entry per reminder, ready for the graph view. Ordered by due date then title. */
  nodes: ReminderGraphSummaryFacts[];
  text: string;
}

export interface ReminderScopeRequest {
  /** Restrict to this category and its descendants. */
  categoryId?: string;
  referenceDate?: Date;
}

function descendantIds(categoryId: string, categories: readonly Category[]): Set<string> {
  const ids = new Set<string>([categoryId]);
  let added = true;
  while (added) {
    added = false;
    for (const category of categories) {
      if (category.parentCategoryId && ids.has(category.parentCategoryId) && !ids.has(category.id)) {
        ids.add(category.id);
        added = true;
      }
    }
  }
  return ids;
}

/**
 * Builds the local summary used by the graph-view question answers. It only reads
 * the supplied reminders and categories, so the same input always produces the
 * same totals, ordering and text.
 */
export function summarizeReminderScope(
  reminders: readonly Reminder[],
  categories: readonly Category[] = [],
  request: ReminderScopeRequest = {}
): ReminderScopeSummary {
  const referenceDate = request.referenceDate ?? new Date();
  const scopeCategory = request.categoryId ? categories.find((category) => category.id === request.categoryId) : undefined;
  const scoped = scopeCategory ? reminders.filter((reminder) => descendantIds(scopeCategory.id, categories).has(reminder.categoryId)) : [...reminders];

  const nodes = scoped
    .map((reminder) => toReminderGraphSummaryFacts(reminder, categories, referenceDate))
    .sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99') || a.title.localeCompare(b.title));

  const totals = {
    reminders: nodes.length,
    active: nodes.filter((node) => !node.completed).length,
    completed: nodes.filter((node) => node.completed).length,
    overdue: nodes.filter((node) => node.overdue).length,
    subtasks: nodes.reduce((sum, node) => sum + node.subtaskCount, 0),
    completedSubtasks: nodes.reduce((sum, node) => sum + node.completedSubtaskCount, 0),
  };
  const label = scopeCategory ? scopeCategory.name : 'All reminders';
  const nextNode = nodes.find((node) => !node.completed && node.dueDate);
  const nextDue = nextNode?.dueDate ? { date: nextNode.dueDate, title: nextNode.title } : undefined;

  const parts = [
    `${label}: ${totals.reminders} reminder${totals.reminders === 1 ? '' : 's'}`,
    `${totals.active} active`,
    `${totals.completed} completed`,
  ];
  if (totals.overdue) parts.push(`${totals.overdue} overdue`);
  let text = `${parts.join(', ')}.`;
  if (nextDue) text += ` Next due ${nextDue.date} (${nextDue.title}).`;
  if (totals.subtasks) text += ` Subtasks ${totals.completedSubtasks}/${totals.subtasks} complete.`;

  return { scope: { categoryId: scopeCategory?.id, categoryName: scopeCategory?.name, label }, totals, nextDue, nodes, text };
}

function scoreCategory(category: Category, input: string): number {
  const text = input.toLowerCase();
  const name = category.name.toLowerCase();
  if (text.includes(name)) return 1;
  const aliases = CATEGORY_ALIASES[name] || [];
  return aliases.some((alias) => text.includes(alias)) ? 0.84 : 0;
}

export function suggestCategory(input: string, categories: readonly Category[]): CategorySuggestion {
  const ranked = categories.map((category) => ({ category, score: scoreCategory(category, input) })).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  if (!ranked.length) return { confidence: UNKNOWN, reason: 'No exact or conservative domain match', alternatives: [] };
  const top = ranked[0];
  const tied = ranked.filter((item) => item.score === top.score);
  if (tied.length > 1) return { confidence: confidenceFor(0.55, 'ambiguous'), reason: 'Multiple categories match equally', alternatives: tied.map((item) => item.category) };
  return { category: top.category, confidence: top.score === 1 ? EXACT : KEYWORD, reason: top.score === 1 ? 'Category name appears in input' : 'Known domain keyword', alternatives: ranked.slice(1, 3).map((item) => item.category) };
}

export function suggestSubcategory(input: string, categories: readonly Category[], parentCategoryId?: string): CategorySuggestion {
  const candidates = categories.filter((category) => category.parentCategoryId === parentCategoryId);
  const suggestion = suggestCategory(input, candidates);
  return suggestion;
}

export function suggestSubtasks(input: string): SubtaskSuggestion[] {
  const text = input.toLowerCase();
  const templates: Array<[RegExp, string[]]> = [
    [/\b(?:car|vehicle|auto)\b.*\b(?:service|mechanic|rego|registration)\b|\b(?:service|mechanic)\b.*\bcar\b/, ['Book service', 'Check required service items', 'Arrange drop-off or pick-up']],
    [/\b(?:doctor|dentist|physio|appointment)\b/, ['Confirm appointment time', 'Prepare questions or information', 'Record follow-up instructions']],
    [/\b(?:bill|rent|electricity|internet|subscription)\b/, ['Confirm amount and due date', 'Check payment method', 'Keep payment confirmation']],
    [/\b(?:buy|shopping|groceries)\b/, ['Make a list', 'Check what is already available', 'Complete the purchase']],
  ];
  const match = templates.find(([pattern]) => pattern.test(text));
  return match ? match[1].map((title) => ({ title, confidence: KEYWORD, reason: 'Known deterministic task template' })) : [];
}

function field<T>(value: T | undefined, confidence: Confidence, ambiguities?: Ambiguity[]): SmartEngineField<T> { return { value, confidence, ambiguities }; }

/**
 * Optional local context. Completed history and contacts are only consulted when
 * the matching Smart Assistance permission is enabled, and neither is ever written.
 */
export interface ReminderProposalContext {
  completedReminders?: readonly Reminder[];
  contacts?: readonly Contact[];
  useHistory?: boolean;
  useContactContext?: boolean;
}

export function createIntelligentReminderProposal(
  input: string,
  categories: readonly Category[] = [],
  referenceDate: Date = new Date(),
  context: ReminderProposalContext = {}
): CreateReminderProposal {
  const base = createReminderProposal(input, referenceDate);
  const title = base.fields.title.value as string | undefined;
  const directSuggestion = suggestCategory(input, categories);
  const ambiguities = [...base.ambiguities];

  // Existing user categories and domain keywords always win; completed history is
  // only a fallback and is clearly labelled as coming from past reminders.
  const historySuggestion =
    !directSuggestion.category && context.useHistory && title
      ? suggestCategoryFromHistory(title, context.completedReminders ?? [], categories)
      : undefined;
  const directSuggestedCategory = directSuggestion.category
    ?? (historySuggestion ? categories.find((item) => item.id === historySuggestion.categoryId) : undefined);
  const categoryConfidence: Confidence = directSuggestion.category
    ? directSuggestion.confidence
    : historySuggestion
      ? historySuggestion.confidence
      : UNKNOWN;

  const similarCompleted = context.useHistory && title
    ? findSimilarCompletedReminders(title, context.completedReminders ?? [], { maxResults: 3 })
    : [];
  const repeatedPattern = context.useHistory && title
    ? detectRepeatedTaskPattern(title, context.completedReminders ?? [])
    : undefined;

  // Contact mentions are context only: no contact is created, linked or changed here.
  const contactMentions = context.useContactContext && context.contacts?.length
    ? findContactMentions(input, context.contacts)
    : [];
  const bestContact = contactMentions.find((mention) => mention.best)?.best;
  const contactAmbiguity = contactMentions.length > 1
    ? {
        field: 'linkedContactId',
        message: 'More than one contact is mentioned; choose the intended contact before linking.',
        options: contactMentions.map((mention) => mention.best?.name).filter((name): name is string => Boolean(name)),
      }
    : undefined;

  const subtasks = title ? suggestSubtasks(input) : [];
  const fields = {
    ...base.fields,
    categoryId: field(directSuggestedCategory?.id, categoryConfidence),
    categoryName: field(directSuggestedCategory?.name, categoryConfidence),
    suggestedSubtasks: field(subtasks.map((item) => item.title), subtasks.length ? KEYWORD : UNKNOWN),
    categorySource: field(
      directSuggestion.category ? 'existing-category' : historySuggestion ? 'completed-history' : undefined,
      categoryConfidence
    ),
    historyContext: field(
      similarCompleted.length
        ? {
            similarCompletedTitles: similarCompleted.map((entry) => entry.title),
            completedMatches: similarCompleted.length,
          }
        : undefined,
      similarCompleted.length ? KEYWORD : UNKNOWN
    ),
    repeatedTaskPattern: field(repeatedPattern, repeatedPattern ? { score: 0.8, reason: 'derived' } : UNKNOWN),
    suggestedContactId: field(bestContact?.contactId, bestContact ? { score: bestContact.score, reason: 'derived' } : UNKNOWN),
    suggestedContactName: field(bestContact?.name, bestContact ? { score: bestContact.score, reason: 'derived' } : UNKNOWN),
  };

  if (categoryConfidence.reason === 'ambiguous' && (directSuggestion.alternatives.length || historySuggestion?.alternatives.length)) {
    ambiguities.push({
      field: 'categoryId',
      message: directSuggestion.category ? directSuggestion.reason : historySuggestion?.reason ?? 'More than one category matches.',
      options: (directSuggestion.alternatives.length ? directSuggestion.alternatives.map((item) => item.name) : historySuggestion?.alternatives ?? []),
    });
  }
  if (contactAmbiguity) ambiguities.push(contactAmbiguity);

  const previewParts = [base.preview];
  if (directSuggestedCategory) previewParts.push(directSuggestedCategory.name);
  if (subtasks.length) previewParts.push(`${subtasks.length} optional subtask suggestions`);
  if (similarCompleted.length) previewParts.push(`${similarCompleted.length} similar completed reminder${similarCompleted.length === 1 ? '' : 's'}`);
  if (bestContact) previewParts.push(`contact ${bestContact.name}`);

  return {
    ...base,
    fields,
    preview: previewParts.filter(Boolean).join(' · '),
    ambiguities,
    confidence: confidenceFor(
      Math.min(base.confidence.score, directSuggestedCategory ? categoryConfidence.score : base.confidence.score),
      ambiguities.length ? 'ambiguous' : base.confidence.reason
    ),
    id: `smart-reminder-${stableHash(input)}`,
  };
}

export function createEditReminderProposal(input: string, reminders: readonly Reminder[], referenceDate: Date = new Date()): EditReminderProposal {
  const text = normalize(input);
  const candidates = reminders.filter((reminder) => words(text).some((word) => word.length > 2 && words(reminder.title).includes(word)));
  // A bare word after "reminder"/"task" is usually normal English ("reminder to
  // Thursday"), so an id only counts when it is asked for explicitly or looks like
  // a real generated id (contains a digit or hyphen, e.g. "rem-1" / "r-dentist").
  const exactId =
    text.match(/\b(?:reminder|task)\s+id\s+([a-z0-9_-]+)\b/i)?.[1] ??
    text.match(/\b(?:reminder|task)\s+([a-z0-9_]*[0-9-][a-z0-9_-]*)\b/i)?.[1];
  const selected = exactId ? reminders.find((reminder) => reminder.id === exactId) : candidates.length === 1 ? candidates[0] : undefined;
  const ambiguities: Ambiguity[] = [];
  const missingFields: MissingField[] = [];
  if (!selected) {
    ambiguities.push({ field: 'reminderId', message: candidates.length ? 'More than one reminder could match; select one before editing.' : 'Select an existing reminder before editing.', options: candidates.slice(0, 5).map((reminder) => reminder.title) });
  }
  const date = parseDateTime(text, referenceDate);
  const recurrence = parseRecurrence(text);
  const titleMatch = text.match(/\b(?:rename|change|update)\s+(?:the\s+)?(?:title|name)\s+(?:to\s+)?["']?(.+?)["']?$/i) || text.match(/\b(?:rename|change|update)\s+(?:reminder|task)\s+(?:[a-z0-9_-]+\s+)?to\s+["']?(.+?)["']?$/i);
  const fields: Record<string, SmartEngineField<unknown>> = {
    reminderId: field(selected?.id, selected ? EXACT : confidenceFor(0.4, 'ambiguous'), ambiguities),
    dueDate: field(date.value?.date, date.confidence, date.ambiguities),
    dueTime: field(date.value?.time, date.confidence),
    recurrence: field(recurrence.value, recurrence.confidence),
    title: field(titleMatch?.[1]?.trim(), titleMatch ? KEYWORD : UNKNOWN),
  };
  if (!date.value?.date && !date.value?.time && !recurrence.value && !titleMatch) missingFields.push({ field: 'change', label: 'A supported change such as title, date, time, or recurrence', required: true });
  const preview = selected ? `Edit reminder “${selected.title}”` : 'Edit reminder (select an existing reminder)';
  return { type: 'edit-reminder', reminderId: selected?.id, fields, id: `smart-edit-${stableHash(text)}`, preview, confidence: confidenceFor(selected && missingFields.length === 0 && ambiguities.length === 0 ? 0.9 : 0.45, ambiguities.length || missingFields.length ? 'ambiguous' : 'derived'), missingFields, ambiguities, validation: { valid: false, canWrite: false, reasons: [] } };
}

export function createCategoryProposal(input: string): CreateCategoryProposal {
  // "Create a category called X" and "create category X" are both natural, so the
  // article is optional and never becomes part of the name.
  const match = normalize(input).match(/\b(?:create|add|new)\s+(?:a\s+|an\s+|the\s+)?categor(?:y|ies)\s+(?:called\s+|named\s+)?["']?(.+?)["']?$/i);
  const name = normalize(match?.[1] || '').replace(/[.!?]+$/, '');
  const missingFields: MissingField[] = name ? [] : [{ field: 'name', label: 'Category name', required: true }];
  const confidenceValue = name ? EXACT : UNKNOWN;
  return { type: 'create-category', id: `smart-category-${stableHash(input)}`, name: field(name || undefined, confidenceValue), parentCategoryId: field(null, confidenceValue), preview: name ? `Create category “${name}”` : 'Create category (name needed)', confidence: confidenceValue, missingFields, ambiguities: [], validation: { valid: false, canWrite: false, reasons: [] } };
}

export function createSubcategoryProposal(input: string, categories: readonly Category[] = []): CreateSubcategoryProposal {
  const normalizedInput = normalize(input);
  const match =
    normalizedInput.match(/\b(?:create|add|new)\s+(?:a\s+|an\s+|the\s+)?subcategor(?:y|ies)\s+(?:called\s+|named\s+)?(.+?)(?:\s+(?:under|in)\s+(.+))?$/i) ??
    // Natural "Add <child> under <parent>" phrasing without the word "subcategory".
    normalizedInput.match(/\b(?:create|add|new)\s+(?:a\s+)?(.+?)\s+under\s+(.+)$/i);
  const name = normalize(match?.[1] || '').replace(/[.!?]+$/, '');
  const parentName = normalize(match?.[2] || '');
  const parents = categories.filter((category) => !category.parentCategoryId && (!parentName || category.name.toLowerCase() === parentName.toLowerCase()));
  const ambiguities: Ambiguity[] = [];
  if (parentName && parents.length > 1) ambiguities.push({ field: 'parentCategoryId', message: 'More than one parent category matches.', options: parents.map((category) => category.name) });
  const parent = parents.length === 1 ? parents[0] : undefined;
  const missingFields: MissingField[] = [];
  if (!name) missingFields.push({ field: 'name', label: 'Subcategory name', required: true });
  if (!parent) missingFields.push({ field: 'parentCategoryId', label: 'Parent category', required: true });
  const confidenceValue = name && parent && !ambiguities.length ? EXACT : confidenceFor(0.45, 'ambiguous');
  return { type: 'create-subcategory', id: `smart-subcategory-${stableHash(input)}`, name: field(name || undefined, name ? EXACT : UNKNOWN), parentCategoryId: field(parent?.id, parent ? EXACT : confidenceValue), preview: name && parent ? `Create subcategory “${name}” under “${parent.name}”` : 'Create subcategory (name and parent needed)', confidence: confidenceValue, missingFields, ambiguities, validation: { valid: false, canWrite: false, reasons: [] } };
}

function stableHash(input: string): number { let hash = 0; for (const char of input) hash = (hash * 31 + char.charCodeAt(0)) | 0; return Math.abs(hash); }
