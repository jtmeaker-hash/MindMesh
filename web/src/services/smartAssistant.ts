import { Category, Reminder, RecurrenceRule, Subtask } from '../types';
import { Contact } from '../types/contact';
import { DiagnosticReport, LogEntry } from '../types/diagnostics';
import {
  BillFrequency,
  BillRecurrenceConfig,
  DirectDebit,
  DirectDebitCategory,
  MoneyState,
  NotificationSetting,
} from '../types/finance';
import { ReminderNotificationSettings } from '../types/notifications';
import { formatCurrency } from '../utils/finance';
import { formatRecurrenceLabel } from './recurrence';
import { parseNotificationSettings } from './moneyIntelligence';
import { parseRecurrence } from './smartEngineParsing';
import {
  createSmartEngine,
  DefaultSmartEngineActionValidator,
  DefaultSmartEngineContextProvider,
  SmartEngine,
} from './smartEngine';
import {
  ActionValidationResult,
  Confidence,
  CreateCategoryProposal,
  CreateDirectDebitProposal,
  CreateReminderProposal,
  CreateSubcategoryProposal,
  EditReminderProposal,
  ProposedAction,
  SmartEngineResult,
  SmartEngineSettings,
  normalizeSmartEngineSettings,
} from '../types/smartEngine';

/**
 * Stage 07 — the deterministic, fully local layer between the Smart Engine and
 * the app's existing services.
 *
 * The engine stays a pure interpreter: it never writes. This module turns a
 * proposal into a human-readable preview, asks only for the fields that are
 * missing or ambiguous, and — only after an explicit confirmation — maps the
 * resolved proposal onto the existing models and calls the app's existing write
 * callbacks. There is no network access and no hidden write path.
 */

/* ------------------------------------------------------------------ */
/* Preview rows                                                        */
/* ------------------------------------------------------------------ */

export interface AssistantPreviewRow {
  field: string;
  label: string;
  value: string;
  confidence?: Confidence;
  uncertain: boolean;
}

export interface ProposalPreviewOptions {
  command?: string;
  reminders?: readonly Reminder[];
}

const BILL_FREQUENCY_LABELS: Record<BillFrequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  every_x_days: 'Every X days',
  every_x_weeks: 'Every X weeks',
  every_x_months: 'Every X months',
  annually: 'Annually',
  custom: 'Custom',
};

const NOTIFICATION_OFFSET_MINUTES: Partial<Record<NotificationSetting['type'], number>> = {
  '1_day_before': 1440,
  '2_days_before': 2880,
  '3_days_before': 4320,
  '1_week_before': 10080,
};

function notificationOffsetLabel(setting: NotificationSetting): string {
  switch (setting.type) {
    case 'on_day': return 'On the day';
    case '1_day_before': return '1 day before';
    case '2_days_before': return '2 days before';
    case '3_days_before': return '3 days before';
    case '1_week_before': return '1 week before';
    case 'custom_days_before': return `${setting.customValue ?? 1} day(s) before`;
    case 'custom_hours_before': return `${setting.customValue ?? 1} hour(s) before`;
    default: return setting.type;
  }
}

/** True when a value should not be trusted without asking the user first. */
export function isUncertain(confidence?: Confidence): boolean {
  if (!confidence) return true;
  if (confidence.reason === 'ambiguous' || confidence.reason === 'unknown') return true;
  return confidence.score < 0.7;
}

function describeConfidence(confidence: Confidence): string {
  const percent = `${Math.round(confidence.score * 100)}%`;
  if (confidence.score >= 0.9) return `${percent} — high`;
  if (confidence.score >= 0.7) return `${percent} — likely`;
  if (confidence.score >= 0.4) return `${percent} — uncertain, please confirm`;
  return `${percent} — unknown`;
}

function formatFieldValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return 'Not provided';
  if (field === 'amount' && typeof value === 'number') return formatCurrency(value);
  if (field === 'recurrence') return formatRecurrenceLabel(value as RecurrenceRule);
  if (field === 'frequency') return BILL_FREQUENCY_LABELS[value as BillFrequency] ?? String(value);
  if (field === 'active') return value ? 'Active' : 'Paused';
  if (Array.isArray(value)) {
    if (value.length === 0) return 'None';
    if (field === 'notificationSettings') return value.map((item) => notificationOffsetLabel(item as NotificationSetting)).join(', ');
    return value.map((item) => (typeof item === 'string' ? item : JSON.stringify(item))).join(', ');
  }
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

type EngineField = { value?: unknown; confidence: Confidence };

/** Builds the ordered preview rows shown before any mutation happens. */
export function buildProposalPreview(proposal: ProposedAction, options: ProposalPreviewOptions = {}): AssistantPreviewRow[] {
  const rows: AssistantPreviewRow[] = [];

  const push = (field: string, label: string, engineField?: EngineField, fallback?: string) => {
    const value = engineField?.value;
    rows.push({
      field,
      label,
      value: value === undefined ? (fallback ?? 'Not provided') : formatFieldValue(field, value),
      confidence: engineField?.confidence,
      uncertain: engineField ? isUncertain(engineField.confidence) : true,
    });
  };

  if (proposal.type === 'create-reminder') {
    const fields = proposal.fields;
    push('title', 'Title', fields.title);
    push('description', 'Description', fields.description, 'None');
    push('categoryId', 'Category / subcategory', fields.categoryName ?? fields.categoryId, 'Ask to choose');
    push('dueDate', 'Due date', fields.dueDate, 'None');
    push('dueTime', 'Due time', fields.dueTime, 'None');
    push('recurrence', 'Repeats', fields.recurrence, 'Once');
    if (options.command) {
      const offsets = parseNotificationSettings(options.command);
      rows.push({
        field: 'notificationSettings',
        label: 'Notification offset',
        value: offsets.length ? offsets.map(notificationOffsetLabel).join(', ') : 'App default',
        uncertain: false,
      });
    }
    push('suggestedSubtasks', 'Suggested subtasks', fields.suggestedSubtasks, 'None');
    if (fields.suggestedContactName?.value) push('suggestedContactName', 'Contact', fields.suggestedContactName);
  } else if (proposal.type === 'create-direct-debit') {
    const fields = proposal.fields;
    push('title', 'Bill name', fields.title);
    push('amount', 'Amount', fields.amount);
    push('categoryId', 'Category', fields.categoryName ?? fields.categoryId, 'Ask to choose');
    push('frequency', 'Frequency', fields.frequency);
    push('nextPaymentDate', 'Next payment', fields.nextPaymentDate, 'Needed');
    push('active', 'Status', fields.active);
    if (fields.linkedReminderId?.value || fields.linkedReminderTitle?.value) {
      push('linkedReminderId', 'Linked reminder', fields.linkedReminderTitle ?? fields.linkedReminderId);
    }
    if (fields.notificationSettings?.value) push('notificationSettings', 'Notifications', fields.notificationSettings);
    push('notes', 'Notes', fields.notes, 'None');
  } else if (proposal.type === 'create-category') {
    push('name', 'Category name', proposal.name);
    rows.push({ field: 'parentCategoryId', label: 'Parent', value: 'Top level', confidence: proposal.parentCategoryId.confidence, uncertain: false });
  } else if (proposal.type === 'create-subcategory') {
    push('name', 'Subcategory name', proposal.name);
    push('parentCategoryId', 'Parent category', proposal.parentCategoryId, 'Ask to choose');
  } else {
    const fields = proposal.fields;
    const target = options.reminders?.find((reminder) => reminder.id === proposal.reminderId);
    rows.push({
      field: 'reminderId',
      label: 'Reminder',
      value: target?.title ?? (proposal.reminderId ? proposal.reminderId : 'Ask to choose'),
      uncertain: !target,
    });
    push('title', 'New title', fields.title, 'Unchanged');
    push('dueDate', 'New due date', fields.dueDate, 'Unchanged');
    push('dueTime', 'New due time', fields.dueTime, 'Unchanged');
    push('recurrence', 'New repeat', fields.recurrence, 'Unchanged');
  }

  rows.push({
    field: 'confidence',
    label: 'Confidence',
    value: describeConfidence(proposal.confidence),
    confidence: proposal.confidence,
    uncertain: isUncertain(proposal.confidence),
  });
  return rows;
}

/* ------------------------------------------------------------------ */
/* Missing / ambiguous information                                     */
/* ------------------------------------------------------------------ */

export interface ResolutionOption { value: string; label: string; }

export interface AssistantResolutionPrompt {
  field: string;
  label: string;
  message: string;
  required: boolean;
  options: ResolutionOption[];
  freeText: boolean;
  /** A value already known for this field that the user may accept as-is. */
  currentValue?: string;
}

export interface ResolutionContext {
  categories?: readonly Category[];
  billCategories?: readonly DirectDebitCategory[];
  reminders?: readonly Reminder[];
  contacts?: readonly Contact[];
}

export type ProposalResolution = Record<string, string>;

const RECURRENCE_OPTIONS: ResolutionOption[] = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'fortnightly', label: 'Fortnightly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'yearly', label: 'Yearly' },
];

const BILL_FREQUENCY_OPTIONS: ResolutionOption[] = (Object.keys(BILL_FREQUENCY_LABELS) as BillFrequency[])
  .map((value) => ({ value, label: BILL_FREQUENCY_LABELS[value] }));

const FREE_TEXT_FIELDS = new Set([
  'title', 'name', 'description', 'dueDate', 'dueTime', 'nextPaymentDate', 'paymentDay',
  'endDate', 'notes', 'amount', 'startDate',
]);

const FIELD_LABELS: Record<string, string> = {
  title: 'Title',
  name: 'Name',
  description: 'Description',
  categoryId: 'Category',
  parentCategoryId: 'Parent category',
  dueDate: 'Due date',
  dueTime: 'Due time',
  recurrence: 'Repeat',
  recurrenceConfig: 'Recurrence details',
  frequency: 'Frequency',
  paymentDay: 'Payment day',
  nextPaymentDate: 'Next payment date',
  amount: 'Amount',
  reminderId: 'Reminder',
  linkedReminderId: 'Linked reminder',
  linkedContactId: 'Contact',
  suggestedContactId: 'Contact',
  intent: 'Command type',
  active: 'Status',
  notes: 'Notes',
  endDate: 'End date',
};

function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toUpperCase());
}

function currentFieldValue(proposal: ProposedAction, field: string): string | undefined {
  if (proposal.type === 'edit-reminder' && field === 'reminderId') return proposal.reminderId;
  if (proposal.type === 'create-category' || proposal.type === 'create-subcategory') {
    if (field === 'name') return proposal.name.value as string | undefined;
    if (field === 'parentCategoryId') return proposal.parentCategoryId.value ? String(proposal.parentCategoryId.value) : undefined;
  }
  if (proposal.type === 'edit-reminder' || proposal.type === 'create-reminder' || proposal.type === 'create-direct-debit') {
    const value = proposal.fields[field]?.value;
    return value === undefined || value === null ? undefined : String(value);
  }
  return undefined;
}

function optionsForField(field: string, proposal: ProposedAction, context: ResolutionContext): ResolutionOption[] {
  if (field === 'reminderId') return (context.reminders ?? []).map((reminder) => ({ value: reminder.id, label: reminder.title }));
  if (field === 'linkedReminderId') return (context.reminders ?? []).map((reminder) => ({ value: reminder.id, label: reminder.title }));
  if (field === 'categoryId') {
    const source = proposal.type === 'create-direct-debit' ? context.billCategories : context.categories;
    return (source ?? []).map((category) => ({ value: category.id, label: category.name }));
  }
  if (field === 'parentCategoryId') {
    return (context.categories ?? []).filter((category) => !category.parentCategoryId).map((category) => ({ value: category.id, label: category.name }));
  }
  if (field === 'suggestedContactId' || field === 'linkedContactId') {
    return (context.contacts ?? []).map((contact) => ({ value: contact.id, label: contact.fullName }));
  }
  if (field === 'frequency') return BILL_FREQUENCY_OPTIONS;
  if (field === 'recurrence') return RECURRENCE_OPTIONS;
  return [];
}

/** Only asks for what is missing or ambiguous — never re-parses into a fabricated answer. */
export function buildResolutionPrompts(result: SmartEngineResult, context: ResolutionContext = {}): AssistantResolutionPrompt[] {
  const proposal = result.proposal;
  if (!proposal) return [];

  const prompts: AssistantResolutionPrompt[] = [];
  const seen = new Set<string>();

  const add = (field: string, message: string, required: boolean) => {
    if (seen.has(field)) return;
    seen.add(field);
    const options = optionsForField(field, proposal, context);
    prompts.push({
      field,
      label: fieldLabel(field),
      message,
      required,
      options,
      freeText: options.length === 0 || FREE_TEXT_FIELDS.has(field),
      currentValue: currentFieldValue(proposal, field),
    });
  };

  for (const missing of proposal.missingFields) {
    add(missing.field, `${fieldLabel(missing.field)} is needed before this can be written.`, missing.required);
  }
  for (const ambiguity of proposal.ambiguities) {
    add(ambiguity.field, ambiguity.message, true);
  }

  // A reminder or bill must belong to one of the user's own categories.
  if (proposal.type === 'create-reminder' && proposal.fields.categoryId?.value === undefined) {
    add('categoryId', 'Choose which category this reminder belongs to.', true);
  }
  if (proposal.type === 'create-direct-debit' && proposal.fields.categoryId?.value === undefined) {
    add('categoryId', 'Choose which bill category this belongs to.', true);
  }
  if (proposal.type === 'create-subcategory' && !proposal.parentCategoryId?.value) {
    add('parentCategoryId', 'Choose the parent category.', true);
  }

  return prompts;
}

function lookupCategoryName(id: string, categories?: readonly { id: string; name: string }[]): string | undefined {
  return categories?.find((category) => category.id === id)?.name;
}

function coerceFieldValue(field: string, raw: string): unknown {
  if (field === 'amount' || field === 'paymentDay') {
    const numeric = Number(raw.replace(/[^0-9.]/g, ''));
    return Number.isFinite(numeric) ? numeric : raw.trim();
  }
  if (field === 'recurrence') {
    if (/^(none|once|no repeat|never)$/i.test(raw.trim())) return undefined;
    return parseRecurrence(raw).value;
  }
  return raw.trim();
}

function finalizeProposal(proposal: ProposedAction): ProposedAction {
  const ready = !proposal.missingFields.some((field) => field.required) && proposal.ambiguities.length === 0;
  if (!ready) return proposal;
  const reason: Confidence['reason'] =
    proposal.confidence.reason === 'ambiguous' || proposal.confidence.reason === 'unknown'
      ? 'explicit-pattern'
      : proposal.confidence.reason;
  return { ...proposal, confidence: { score: Math.max(proposal.confidence.score, 0.9), reason } };
}

function patchProposalField(
  proposal: ProposedAction,
  field: string,
  rawValue: string,
  context: ResolutionContext
): ProposedAction {
  const value = coerceFieldValue(field, rawValue);
  const resolvedConfidence: Confidence = { score: 0.95, reason: 'explicit-pattern' };
  const missingFields = proposal.missingFields.filter((missing) => missing.field !== field);
  const ambiguities = proposal.ambiguities.filter((ambiguity) => ambiguity.field !== field);
  const cleared = { missingFields, ambiguities };

  if (proposal.type === 'create-category' && field === 'name') {
    return finalizeProposal({ ...proposal, name: { value: String(value), confidence: resolvedConfidence }, ...cleared });
  }
  if (proposal.type === 'create-category' && field === 'parentCategoryId') {
    return finalizeProposal({ ...proposal, parentCategoryId: { value: value ? String(value) : null, confidence: resolvedConfidence }, ...cleared });
  }
  if (proposal.type === 'create-subcategory' && field === 'name') {
    return finalizeProposal({ ...proposal, name: { value: String(value), confidence: resolvedConfidence }, ...cleared });
  }
  if (proposal.type === 'create-subcategory' && field === 'parentCategoryId') {
    return finalizeProposal({ ...proposal, parentCategoryId: { value: String(value), confidence: resolvedConfidence }, ...cleared });
  }
  if (proposal.type === 'edit-reminder' && field === 'reminderId') {
    return finalizeProposal({
      ...proposal,
      reminderId: String(value),
      fields: { ...proposal.fields, reminderId: { value: String(value), confidence: resolvedConfidence } },
      ...cleared,
    });
  }
  if (proposal.type === 'edit-reminder' || proposal.type === 'create-reminder' || proposal.type === 'create-direct-debit') {
    const fields: Record<string, EngineField> = { ...proposal.fields, [field]: { value, confidence: resolvedConfidence } };
    if (field === 'categoryId') {
      const candidateName = lookupCategoryName(
        String(value),
        proposal.type === 'create-direct-debit' ? context.billCategories : context.categories
      );
      fields.categoryName = { value: candidateName, confidence: resolvedConfidence };
    }
    if (field === 'linkedReminderId') {
      const title = context.reminders?.find((reminder) => reminder.id === value)?.title;
      fields.linkedReminderTitle = { value: title, confidence: resolvedConfidence };
    }
    return finalizeProposal({ ...proposal, fields, ...cleared } as ProposedAction);
  }
  return finalizeProposal({ ...proposal, ...cleared });
}

function describeProposalState(proposal: ProposedAction) {
  const ready = !proposal.missingFields.some((field) => field.required) && proposal.ambiguities.length === 0;
  return {
    status: ready ? ('ok' as const) : ('needs-confirmation' as const),
    confidence: proposal.confidence,
    ambiguities: proposal.ambiguities,
    missingFields: proposal.missingFields,
    message: proposal.preview,
  };
}

/** Applies only the user's answers to missing/ambiguous fields and re-describes the result. */
export function resolveProposal(
  result: SmartEngineResult,
  resolutions: ProposalResolution,
  context: ResolutionContext = {}
): SmartEngineResult {
  if (!result.proposal) return result;
  let proposal = result.proposal;
  for (const [field, raw] of Object.entries(resolutions)) {
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    proposal = patchProposalField(proposal, field, String(raw), context);
  }
  return { ...result, proposal, ...describeProposalState(proposal) };
}

/* ------------------------------------------------------------------ */
/* Proposal → existing models                                          */
/* ------------------------------------------------------------------ */

export type EntityIdFactory = (prefix: string) => string;

export function defaultEntityIdFactory(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const NOTIFICATION_OFFSET_TYPE_MINUTES: Partial<Record<NotificationSetting['type'], number>> = NOTIFICATION_OFFSET_MINUTES;

/** Turns any recognised notification phrasing into the reminder's existing settings shape. */
export function reminderNotificationsFromCommand(command?: string): ReminderNotificationSettings | undefined {
  if (!command) return undefined;
  const parsed = parseNotificationSettings(command);
  if (!parsed.length) return undefined;
  const advanceMinutes = parsed
    .map((setting) => {
      if (setting.type === 'custom_days_before') return (setting.customValue ?? 1) * 1440;
      if (setting.type === 'custom_hours_before') return (setting.customValue ?? 1) * 60;
      return NOTIFICATION_OFFSET_TYPE_MINUTES[setting.type] ?? 0;
    })
    .filter((minutes) => minutes > 0);
  const notifyAtDueTime = parsed.some((setting) => setting.type === 'on_day') || advanceMinutes.length === 0;
  return {
    enabled: true,
    notifyAtDueTime,
    advanceMinutes: [...new Set(advanceMinutes)].sort((a, b) => a - b),
  };
}

export interface ReminderMapOptions {
  command?: string;
  categories: readonly Category[];
  contacts?: readonly Contact[];
  now?: string;
  createId?: EntityIdFactory;
}

export function reminderFromProposal(proposal: CreateReminderProposal, options: ReminderMapOptions): Reminder {
  const fields = proposal.fields;
  const now = options.now ?? new Date().toISOString();
  const createId = options.createId ?? defaultEntityIdFactory;
  const id = createId('rem');
  const subtasks: Subtask[] = ((fields.suggestedSubtasks?.value as string[] | undefined) ?? []).map((title) => ({
    id: createId('sub'),
    reminderId: id,
    title,
    completed: false,
    createdAt: now,
  }));
  return {
    id,
    categoryId: String(fields.categoryId?.value ?? options.categories[0]?.id ?? ''),
    title: String(fields.title?.value ?? '').trim(),
    description: (fields.description?.value as string | undefined) || undefined,
    dueDate: (fields.dueDate?.value as string | undefined) || undefined,
    dueTime: (fields.dueTime?.value as string | undefined) || undefined,
    priority: 'medium',
    completed: false,
    createdAt: now,
    recurrence: (fields.recurrence?.value as RecurrenceRule | undefined) || undefined,
    subtasks,
    linkedContactId: (fields.suggestedContactId?.value as string | undefined) || undefined,
    notifications: reminderNotificationsFromCommand(options.command),
  };
}

export interface DirectDebitMapOptions {
  billCategories: readonly DirectDebitCategory[];
  now?: string;
  createId?: EntityIdFactory;
}

export function directDebitFromProposal(proposal: CreateDirectDebitProposal, options: DirectDebitMapOptions): DirectDebit {
  const fields = proposal.fields;
  const now = options.now ?? new Date().toISOString();
  const createId = options.createId ?? defaultEntityIdFactory;
  return {
    id: createId('debit'),
    title: String(fields.title?.value ?? '').trim(),
    amount: Number(fields.amount?.value ?? 0),
    categoryId: String(fields.categoryId?.value ?? options.billCategories[0]?.id ?? ''),
    frequency: (fields.frequency?.value as BillFrequency) ?? 'monthly',
    recurrenceConfig: (fields.recurrenceConfig?.value as BillRecurrenceConfig | undefined) || undefined,
    nextPaymentDate: String(fields.nextPaymentDate?.value ?? ''),
    endDate: (fields.endDate?.value as string | undefined) || undefined,
    notes: (fields.notes?.value as string | undefined) || undefined,
    active: fields.active?.value !== false,
    notificationSettings: (fields.notificationSettings?.value as NotificationSetting[] | undefined) || undefined,
    linkedReminderId: (fields.linkedReminderId?.value as string | undefined) || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export interface CategoryMapOptions {
  now?: string;
  createId?: EntityIdFactory;
  color?: string;
}

export function categoryFromProposal(
  proposal: CreateCategoryProposal | CreateSubcategoryProposal,
  options: CategoryMapOptions = {}
): Category {
  const now = options.now ?? new Date().toISOString();
  const createId = options.createId ?? defaultEntityIdFactory;
  const parentId = proposal.parentCategoryId.value ? String(proposal.parentCategoryId.value) : null;
  return {
    id: createId('cat'),
    name: String(proposal.name.value ?? '').trim(),
    color: options.color ?? '#06B6D4',
    createdAt: now,
    updatedAt: now,
    parentCategoryId: parentId,
  };
}

function applyEditToReminder(existing: Reminder, proposal: EditReminderProposal): Reminder {
  const fields = proposal.fields;
  const next: Reminder = { ...existing };
  if (fields.title?.value) next.title = String(fields.title.value);
  if (fields.dueDate?.value !== undefined) next.dueDate = fields.dueDate.value ? String(fields.dueDate.value) : undefined;
  if (fields.dueTime?.value !== undefined) next.dueTime = fields.dueTime.value ? String(fields.dueTime.value) : undefined;
  if (fields.recurrence?.value !== undefined) next.recurrence = (fields.recurrence.value as RecurrenceRule | undefined) ?? undefined;
  return next;
}

/* ------------------------------------------------------------------ */
/* Confirmation session                                                */
/* ------------------------------------------------------------------ */

export interface SmartAssistantHandlers {
  /** Existing reminder write path (create or edit). */
  saveReminder(reminder: Reminder): void;
  /** Existing category write path. */
  saveCategory(category: Category): void;
  /** Existing direct-debit write path, optionally linking an existing reminder. */
  saveDirectDebit(debit: DirectDebit, linkedReminder?: Reminder): void;
}

export interface SmartAssistantWriteOutcome {
  success: boolean;
  duplicate: boolean;
  actionType?: ProposedAction['type'];
  entityId?: string;
  message: string;
  validation: ActionValidationResult;
  reasons: string[];
}

export interface SmartAssistantSessionOptions {
  settings: SmartEngineSettings;
  categories?: readonly Category[];
  reminders?: readonly Reminder[];
  moneyState?: MoneyState;
  contacts?: readonly Contact[];
  diagnosticsReport?: DiagnosticReport;
  logs?: readonly LogEntry[];
  referenceDate?: Date;
  handlers: SmartAssistantHandlers;
  createId?: EntityIdFactory;
  now?: () => string;
  /**
   * Optional shared guard so a proposal can never be written twice even when a
   * fresh session is built on a later render.
   */
  completedProposalIds?: Set<string>;
}

const NO_PROPOSAL_VALIDATION: ActionValidationResult = {
  valid: false,
  canWrite: false,
  reasons: ['There is no proposed action to confirm.'],
};

/**
 * Drives one assistant interaction. Interpretation and confirmation are separate
 * steps: `confirm` is the only method that can write, it re-validates the
 * (optionally resolved) proposal first, it never writes twice for the same
 * proposal, and it reports success/failure from the real result of the write.
 */
export class SmartAssistantSession {
  private readonly options: SmartAssistantSessionOptions;
  private readonly settings: SmartEngineSettings;
  private readonly engine: SmartEngine;
  private readonly validator = new DefaultSmartEngineActionValidator();
  private readonly completedProposalIds: Set<string>;
  private lastCommand = '';

  public constructor(options: SmartAssistantSessionOptions) {
    this.options = options;
    this.completedProposalIds = options.completedProposalIds ?? new Set<string>();
    this.settings = normalizeSmartEngineSettings(options.settings);
    this.engine = createSmartEngine({
      settings: this.settings,
      contextProvider: new DefaultSmartEngineContextProvider(options.categories ?? []),
      reminders: options.reminders ?? [],
      moneyState: options.moneyState,
      billCategories: options.moneyState?.billCategories ?? [],
      contacts: options.contacts ?? [],
      completedReminders: options.reminders ?? [],
      diagnosticsReport: options.diagnosticsReport,
      logs: options.logs,
      referenceDate: options.referenceDate,
    });
  }

  public getSettings(): SmartEngineSettings {
    return this.settings;
  }

  public isEnabled(): boolean {
    return this.settings.enabled;
  }

  public interpret(command: string): SmartEngineResult {
    this.lastCommand = command;
    return this.engine.interpret('assistant-command', command);
  }

  public resolve(result: SmartEngineResult, resolutions: ProposalResolution): SmartEngineResult {
    return resolveProposal(result, resolutions, this.resolutionContext());
  }

  public preview(result: SmartEngineResult): AssistantPreviewRow[] {
    if (!result.proposal) return [];
    return buildProposalPreview(result.proposal, { command: this.lastCommand, reminders: this.options.reminders });
  }

  public resolutionPrompts(result: SmartEngineResult): AssistantResolutionPrompt[] {
    return buildResolutionPrompts(result, this.resolutionContext());
  }

  public confirm(
    result: SmartEngineResult,
    options: { resolutions?: ProposalResolution; command?: string } = {}
  ): SmartAssistantWriteOutcome {
    const command = options.command ?? this.lastCommand;
    const resolved = options.resolutions ? this.resolve(result, options.resolutions) : result;
    const proposal = resolved.proposal;
    const validation = proposal
      ? this.validator.validate(proposal, {
          ...this.settings,
          // The user has just supplied an explicit confirmation, so the remaining
          // gate is the "do not write a guess" suggestion floor, not the
          // autonomous-write threshold (which can never be satisfied here).
          minimumConfidenceForWrites: this.settings.minimumConfidenceForSuggestions,
        })
      : NO_PROPOSAL_VALIDATION;

    if (!this.settings.enabled) return this.fail('Smart Assistance is turned off in settings, so nothing was written.', validation);
    if (!proposal) return this.fail('There is no proposed action to confirm.', validation);

    const key = `${proposal.type}:${proposal.id}`;
    if (this.completedProposalIds.has(key)) {
      return { ...this.fail('This proposal was already applied, so it was not written again.', validation), duplicate: true, actionType: proposal.type };
    }

    const blocking = this.resolutionPrompts(resolved).filter((prompt) => prompt.required);
    if (blocking.length) {
      return this.fail(`Still needed before writing: ${blocking.map((prompt) => prompt.label).join(', ')}.`, validation, proposal.type);
    }
    if (!validation.valid) {
      return this.fail(validation.reasons.join(' ') || 'The proposal is not ready to write.', validation, proposal.type);
    }

    try {
      const written = this.write(proposal, command);
      this.completedProposalIds.add(key);
      return { success: true, duplicate: false, actionType: proposal.type, entityId: written.entityId, message: written.message, validation, reasons: [] };
    } catch (error) {
      return this.fail(
        `The write failed: ${error instanceof Error ? error.message : String(error)}`,
        validation,
        proposal.type
      );
    }
  }

  private resolutionContext(): ResolutionContext {
    return {
      categories: this.options.categories,
      billCategories: this.options.moneyState?.billCategories,
      reminders: this.options.reminders,
      contacts: this.options.contacts,
    };
  }

  private fail(
    message: string,
    validation: ActionValidationResult,
    actionType?: ProposedAction['type'],
    reasons: string[] = []
  ): SmartAssistantWriteOutcome {
    return { success: false, duplicate: false, actionType, message, validation, reasons: reasons.length ? reasons : validation.reasons };
  }

  private createId = (prefix: string): string => (this.options.createId ?? defaultEntityIdFactory)(prefix);

  private now = (): string => (this.options.now ? this.options.now() : new Date().toISOString());

  private write(proposal: ProposedAction, command: string): { entityId: string; message: string } {
    const context = this.resolutionContext();

    if (proposal.type === 'create-reminder') {
      const categories = context.categories ?? [];
      if (!proposal.fields.categoryId?.value && categories.length === 0) {
        throw new Error('a category is required and none exist yet');
      }
      const reminder = reminderFromProposal(proposal, {
        command,
        categories,
        contacts: context.contacts,
        now: this.now(),
        createId: this.createId,
      });
      this.options.handlers.saveReminder(reminder);
      return { entityId: reminder.id, message: `Created reminder “${reminder.title}”.` };
    }

    if (proposal.type === 'edit-reminder') {
      const existing = (this.options.reminders ?? []).find((reminder) => reminder.id === proposal.reminderId);
      if (!existing) throw new Error('the reminder to edit no longer exists');
      const updated = applyEditToReminder(existing, proposal);
      this.options.handlers.saveReminder(updated);
      return { entityId: updated.id, message: `Updated reminder “${updated.title}”.` };
    }

    if (proposal.type === 'create-category' || proposal.type === 'create-subcategory') {
      const category = categoryFromProposal(proposal, { now: this.now(), createId: this.createId });
      this.options.handlers.saveCategory(category);
      return { entityId: category.id, message: `Created category “${category.name}”.` };
    }

    const billCategories = context.billCategories ?? [];
    if (!proposal.fields.categoryId?.value && billCategories.length === 0) {
      throw new Error('a bill category is required and none exist yet');
    }
    const debit = directDebitFromProposal(proposal, { billCategories, now: this.now(), createId: this.createId });
    const linkedReminderId = proposal.fields.linkedReminderId?.value as string | undefined;
    const linkedReminder = linkedReminderId
      ? (this.options.reminders ?? []).find((reminder) => reminder.id === linkedReminderId)
      : undefined;
    this.options.handlers.saveDirectDebit(debit, linkedReminder);
    return { entityId: debit.id, message: `Created recurring bill “${debit.title}”.` };
  }
}

export function createSmartAssistantSession(options: SmartAssistantSessionOptions): SmartAssistantSession {
  return new SmartAssistantSession(options);
}
