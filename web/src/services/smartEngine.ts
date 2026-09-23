import { Category, Reminder } from '../types';
import { Contact } from '../types/contact';
import { DiagnosticReport, LogEntry } from '../types/diagnostics';
import { DirectDebitCategory, MoneyState } from '../types/finance';
import { toDateString } from '../utils/finance';
import { detectIntent, SmartIntent } from './smartEngineParsing';
import {
  createCategoryProposal,
  createEditReminderProposal,
  createIntelligentReminderProposal,
  createSubcategoryProposal,
  enhanceReminderLocally,
  ReminderProposalContext,
} from './reminderIntelligence';
import { analyzeDiagnostics, DiagnosticsAnalytics } from './smartEngineDiagnostics';
import { classifyMoneyEntry, createBillProposal, MoneyEntryClassification, summarizeMoney } from './moneyIntelligence';
import { DashboardAnalytics, analyzeDashboard } from './dashboardIntelligence';
import { ContactMatchResult, matchContactByName } from './contactIntelligence';
import {
  ActionValidationResult,
  Ambiguity,
  Confidence,
  CreateDirectDebitProposal,
  CreateReminderProposal,
  DEFAULT_SMART_ENGINE_SETTINGS,
  isSmartAssistanceFeatureEnabled,
  isWriteConfirmationRequired,
  normalizeSmartEngineSettings,
  ProposedAction,
  SmartAssistanceFeature,
  SmartEngineActionValidator,
  SmartEngineContextProvider,
  SmartEngineOperation,
  SmartEngineResult,
  SmartEngineSettings,
} from '../types/smartEngine';

const UNKNOWN_CONFIDENCE: Confidence = { score: 0, reason: 'unknown' };

export class DefaultSmartEngineContextProvider implements SmartEngineContextProvider {
  public constructor(private readonly categories: readonly Category[] = []) {}

  getCategories() {
    return this.categories;
  }

  getSubcategories(parentCategoryId?: string) {
    return this.categories.filter((category) => category.parentCategoryId === parentCategoryId);
  }
}

export class DefaultSmartEngineActionValidator implements SmartEngineActionValidator {
  validate(action: ProposedAction, settings: SmartEngineSettings): ActionValidationResult {
    const reasons: string[] = [];
    if (!action.preview.trim()) reasons.push('A human-readable preview is required.');
    if (action.missingFields.some((field) => field.required)) reasons.push('Required fields are missing.');
    if (action.ambiguities.length > 0) reasons.push('Ambiguous fields require confirmation.');
    if (action.confidence.score < settings.minimumConfidenceForWrites) reasons.push('Confidence is below the write threshold.');
    // `valid` describes the proposal's shape; `canWrite` is a separate permission
    // and is always false because confirmation is mandatory and cannot be bypassed.
    return {
      valid: reasons.length === 0,
      canWrite: reasons.length === 0 && !isWriteConfirmationRequired(settings),
      reasons,
    };
  }
}

export interface SmartEngineOptions {
  settings?: Partial<SmartEngineSettings>;
  contextProvider?: SmartEngineContextProvider;
  actionValidator?: SmartEngineActionValidator;
  reminders?: readonly Reminder[];
  /** Latest local diagnostics report; only read, never executed. */
  diagnosticsReport?: DiagnosticReport;
  /** Retained log entries, scanned for known patterns only. */
  logs?: readonly LogEntry[];
  /** Existing bill categories used for suggestion; nothing is created automatically. */
  billCategories?: readonly DirectDebitCategory[];
  /** Stored money data used for pay-cycle summaries. Never mutated. */
  moneyState?: MoneyState;
  /** Injectable reference date so interpretation stays deterministic in tests. */
  referenceDate?: Date;
  /** Local contacts used only when the contact-context permission is enabled. Never written. */
  contacts?: readonly Contact[];
  /**
   * Reminders used as completed-history context. Defaults to `reminders`, so a
   * caller that already passes everything gets history for free.
   */
  completedReminders?: readonly Reminder[];
}

/**
 * Deterministic, local-only facade. It intentionally does not call fetch,
 * mutate storage, schedule notifications, or invoke any repository directly.
 */
export class SmartEngine {
  public readonly settings: SmartEngineSettings;
  private readonly contextProvider: SmartEngineContextProvider;
  private readonly actionValidator: SmartEngineActionValidator;
  private readonly reminders: readonly Reminder[];
  private readonly billCategories: readonly DirectDebitCategory[];
  private readonly moneyState?: MoneyState;
  private readonly referenceDate: Date;
  private readonly contacts: readonly Contact[];
  private readonly completedReminders: readonly Reminder[];
  private readonly diagnosticsReport?: DiagnosticReport;
  private readonly logs: readonly LogEntry[];

  public constructor(options: SmartEngineOptions = {}) {
    this.settings = normalizeSmartEngineSettings({ ...DEFAULT_SMART_ENGINE_SETTINGS, ...options.settings });
    this.contextProvider = options.contextProvider ?? new DefaultSmartEngineContextProvider();
    this.actionValidator = options.actionValidator ?? new DefaultSmartEngineActionValidator();
    this.reminders = options.reminders ?? [];
    this.billCategories = options.billCategories ?? [];
    this.moneyState = options.moneyState;
    this.referenceDate = options.referenceDate ?? new Date();
    this.contacts = options.contacts ?? [];
    this.completedReminders = options.completedReminders ?? options.reminders ?? [];
    this.diagnosticsReport = options.diagnosticsReport;
    this.logs = options.logs ?? [];
  }

  public interpret(operation: SmartEngineOperation, input: string): SmartEngineResult {
    const normalized = input.trim();
    if (!this.settings.enabled) return this.unknown(operation, 'Smart Assistance is disabled in settings.');
    if (!normalized) return this.unknown(operation, 'No input was provided; nothing can be safely inferred.');

    if (operation === 'assistant-command') return this.routeCommand(normalized);
    if (operation === 'dashboard-summary') return this.dashboardSummaryResult(operation);
    if (operation === 'match-contact') return this.matchContactResult(operation, normalized);
    if (operation === 'diagnostics-suggestion') return this.diagnosticsSuggestionResult(operation);
    if (operation === 'enhance-description') return this.enhanceDescriptionResult(operation, normalized);
    if (operation === 'create-reminder') {
      if (/\b(?:someday|sometime|that thing)\b/i.test(normalized)) return this.unknown(operation, 'The request is too vague to create a safe reminder; provide a concrete action and date; support is not implemented for that vague form.');
      return this.proposalResult(operation, this.buildReminderProposal(normalized));
    }
    if (operation === 'edit-reminder') return this.proposalResult(operation, createEditReminderProposal(normalized, this.reminders, this.referenceDate));
    if (operation === 'create-category') return this.proposalResult(operation, createCategoryProposal(normalized));
    if (operation === 'create-subcategory') return this.proposalResult(operation, createSubcategoryProposal(normalized, this.contextProvider.getCategories() as Category[]));
    if (operation === 'create-direct-debit') {
      if (!this.isFeatureEnabled('moneySmartFeatures')) return this.unknown(operation, 'Money smart features are turned off in Smart Assistance settings.');
      return this.proposalResult(operation, this.buildBillProposal(normalized));
    }
    if (operation === 'classify-money') return this.classifyMoney(normalized);

    const detected = detectIntent(normalized);
    if (detected.intent === 'create-reminder') return this.proposalResult('create-reminder', this.buildReminderProposal(normalized));
    if (detected.intent === 'edit-reminder') return this.proposalResult('edit-reminder', createEditReminderProposal(normalized, this.reminders, this.referenceDate));
    if (detected.intent === 'create-category') return this.proposalResult('create-category', createCategoryProposal(normalized));
    if (detected.intent === 'create-subcategory') return this.proposalResult('create-subcategory', createSubcategoryProposal(normalized, this.contextProvider.getCategories() as Category[]));
    if (detected.intent === 'create-direct-debit') {
      if (!this.isFeatureEnabled('moneySmartFeatures')) return this.unknown(operation, 'Money smart features are turned off in Smart Assistance settings.');
      return this.proposalResult('create-direct-debit', this.buildBillProposal(normalized));
    }
    if (detected.intent === 'query-money') {
      if (!this.isFeatureEnabled('moneySmartFeatures')) return this.unknown(operation, 'Money smart features are turned off in Smart Assistance settings.');
      return this.moneySummaryResult(operation);
    }
    if (detected.intent === 'query-dashboard') return this.dashboardSummaryResult(operation);
    if (detected.intent === 'search-contact') return this.matchContactResult(operation, normalized);
    if (detected.intent === 'diagnostics-help') return this.diagnosticsSuggestionResult(operation);
    if (detected.intent === 'query-reminders') return this.reminderQueryResult(operation, normalized);
    if (detected.intent !== 'unknown') {
      return {
        status: detected.ambiguities.length ? 'needs-confirmation' : 'ok',
        operation,
        confidence: detected.confidence,
        ambiguities: detected.ambiguities,
        missingFields: [],
        message: `Detected ${detected.intent}. Domain query/action handling is routed for a later stage.`,
      };
    }
    return this.unknown(operation, 'No supported command pattern matched; no action was taken.');
  }

  private routeCommand(input: string): SmartEngineResult {
    const detected = detectIntent(input);
    if (detected.intent === 'unknown') {
      return { status: 'needs-confirmation', operation: 'assistant-command', confidence: detected.confidence, ambiguities: detected.ambiguities, missingFields: [], message: detected.ambiguities[0]?.message || 'I could not identify a safe command.' };
    }
    if (detected.intent === 'create-reminder') {
      if (/\b(?:someday|sometime|that thing)\b/i.test(input)) return this.unknown('assistant-command', 'The request is too vague to create a safe reminder; provide a concrete action and date; support is not implemented for that vague form.');
      return this.proposalResult('assistant-command', this.buildReminderProposal(input));
    }
    if (detected.intent === 'edit-reminder') return this.proposalResult('assistant-command', createEditReminderProposal(input, this.reminders, this.referenceDate));
    if (detected.intent === 'create-category') return this.proposalResult('assistant-command', createCategoryProposal(input));
    if (detected.intent === 'create-subcategory') return this.proposalResult('assistant-command', createSubcategoryProposal(input, this.contextProvider.getCategories() as Category[]));
    if (detected.intent === 'create-direct-debit') {
      if (!this.isFeatureEnabled('moneySmartFeatures')) return this.unknown('assistant-command', 'Money smart features are turned off in Smart Assistance settings.');
      return this.proposalResult('assistant-command', this.buildBillProposal(input));
    }
    if (detected.intent === 'query-money') {
      if (!this.isFeatureEnabled('moneySmartFeatures')) return this.unknown('assistant-command', 'Money smart features are turned off in Smart Assistance settings.');
      return this.moneySummaryResult('assistant-command');
    }
    if (detected.intent === 'query-dashboard') return this.dashboardSummaryResult('assistant-command');
    if (detected.intent === 'search-contact') return this.matchContactResult('assistant-command', input);
    if (detected.intent === 'diagnostics-help') return this.diagnosticsSuggestionResult('assistant-command');
    if (detected.intent === 'query-reminders') return this.reminderQueryResult('assistant-command', input);
    return { status: 'ok', operation: 'assistant-command', confidence: detected.confidence, ambiguities: [], missingFields: [], value: { intent: detected.intent as SmartIntent }, message: `Routed to ${detected.intent}. No data was changed.` };
  }

  /** Local context that is only handed to interpreters when its permission is on. */
  private reminderContext(): ReminderProposalContext {
    const useHistory = this.isFeatureEnabled('useCompletedHistory');
    const useContactContext = this.isFeatureEnabled('useContactContext');
    return {
      useHistory,
      useContactContext,
      completedReminders: useHistory ? this.completedReminders : [],
      contacts: useContactContext ? this.contacts : [],
    };
  }

  private buildReminderProposal(input: string) {
    return this.applyReminderFeatureGates(
      createIntelligentReminderProposal(
        input,
        this.contextProvider.getCategories() as Category[],
        this.referenceDate,
        this.reminderContext()
      )
    );
  }

  /**
   * Honours the per-feature Smart Assistance gates by removing suggestions the
   * user turned off. It only ever removes suggested fields — never invents or
   * keeps anything the gate disabled — and records why in the ambiguities so the
   * confirmation UI can ask the user directly.
   */
  private applyReminderFeatureGates(proposal: CreateReminderProposal): CreateReminderProposal {
    const suppressed: Ambiguity[] = [];
    const fields = { ...proposal.fields };

    if (!this.isFeatureEnabled('autoDetectDates')) {
      if (fields.dueDate?.value !== undefined || fields.dueTime?.value !== undefined) {
        delete fields.dueDate;
        delete fields.dueTime;
        suppressed.push({ field: 'dueDate', message: 'Date detection is turned off in Smart Assistance settings; enter the date yourself.' });
      } else {
        delete fields.dueDate;
        delete fields.dueTime;
      }
    }
    if (!this.isFeatureEnabled('detectRecurrence')) {
      delete fields.recurrence;
      suppressed.push({ field: 'recurrence', message: 'Recurrence detection is turned off in Smart Assistance settings; set the repeat yourself.' });
    }
    if (!this.isFeatureEnabled('suggestCategories')) {
      delete fields.categoryId;
      delete fields.categoryName;
      delete fields.categorySource;
      suppressed.push({ field: 'categoryId', message: 'Category suggestions are turned off in Smart Assistance settings.' });
    }
    if (!this.isFeatureEnabled('suggestSubtasks')) {
      delete fields.suggestedSubtasks;
      suppressed.push({ field: 'suggestedSubtasks', message: 'Subtask suggestions are turned off in Smart Assistance settings.' });
    }

    if (suppressed.length === 0) return proposal;
    return {
      ...proposal,
      fields,
      ambiguities: [...proposal.ambiguities, ...suppressed],
      preview: `${proposal.preview} · ${suppressed.length} suggestion group${suppressed.length === 1 ? '' : 's'} turned off in settings`,
    };
  }

  /** Deterministic local description enhancement, gated by settings. */
  public enhanceDescription(title: string, description?: string, category?: string): SmartEngineResult<string> {
    if (!this.isFeatureEnabled('suggestDescriptions')) {
      return this.unknown('enhance-description', 'Title and description suggestions are turned off in Smart Assistance settings.');
    }
    const enhanced = enhanceReminderLocally(title.trim(), description?.trim(), category);
    return {
      status: enhanced ? 'ok' : 'unknown',
      operation: 'enhance-description',
      value: enhanced || undefined,
      confidence: { score: 0.9, reason: 'derived' },
      ambiguities: [],
      missingFields: enhanced ? [] : [{ field: 'title', label: 'Reminder title', required: true }],
      message: enhanced || 'There is no supplied text to tidy up; nothing was invented.',
    };
  }

  private enhanceDescriptionResult(operation: SmartEngineOperation, input: string): SmartEngineResult<string> {
    return { ...this.enhanceDescription(input), operation };
  }

  /** Structured dashboard facts and deterministic summaries built from stored data. */
  public analyzeDashboardSummary(): DashboardAnalytics {
    return analyzeDashboard(
      this.reminders,
      this.contextProvider.getCategories() as Category[],
      this.moneyState,
      toDateString(this.referenceDate)
    );
  }

  /** Matches a name against the local contact book without creating anything. */
  public matchContacts(query: string): ContactMatchResult {
    return matchContactByName(query, this.contacts);
  }

  /** Diagnostics explanation built from an already-run report. Never runs a fix. */
  public analyzeDiagnosticsSummary(): DiagnosticsAnalytics {
    if (!this.diagnosticsReport) {
      return {
        suggestions: [],
        text: 'No diagnostics have been run in this context yet.',
        facts: { total: 0, failures: 0, warnings: 0, autoFixable: 0, requiresConfirmation: 0, remindersWithoutTrigger: 0 },
      };
    }
    return analyzeDiagnostics(this.diagnosticsReport, { reminders: this.reminders, logs: this.logs });
  }

  private isFeatureEnabled(feature: SmartAssistanceFeature): boolean {
    return isSmartAssistanceFeatureEnabled(this.settings, feature);
  }

  private dashboardSummaryResult(operation: SmartEngineOperation): SmartEngineResult<DashboardAnalytics> {
    if (!this.isFeatureEnabled('dashboardSummaries')) {
      return this.unknown(operation, 'Dashboard summaries are turned off in Smart Assistance settings.');
    }
    const analytics = this.analyzeDashboardSummary();
    return {
      status: 'ok',
      operation,
      value: analytics,
      confidence: { score: 0.98, reason: 'exact-match' },
      ambiguities: [],
      missingFields: [],
      message: analytics.text,
    };
  }

  private reminderQueryResult(operation: SmartEngineOperation, input: string): SmartEngineResult {
    const analytics = this.analyzeDashboardSummary();
    const wanted = /\boverdue\b/i.test(input)
      ? ['dashboard-overdue', 'dashboard-not-overdue', 'dashboard-reminders']
      : ['dashboard-reminders', 'dashboard-overdue', 'dashboard-not-overdue', 'dashboard-due'];
    const insights = analytics.insights.filter((insight) => wanted.includes(insight.id));
    const facts = insights.reduce<Record<string, number | string | boolean>>((accumulator, insight) => ({ ...accumulator, ...insight.facts }), {});
    return {
      status: 'ok',
      operation,
      value: { query: input, facts, insights },
      confidence: { score: 0.98, reason: 'exact-match' },
      ambiguities: [],
      missingFields: [],
      message: insights.map((insight) => insight.text).join(' ') || 'No reminder statistics are available yet.',
    };
  }

  private matchContactResult(operation: SmartEngineOperation, input: string): SmartEngineResult<ContactMatchResult> {
    if (!this.isFeatureEnabled('useContactContext')) {
      return this.unknown(operation, 'Contact context is turned off in Smart Assistance settings.');
    }
    if (this.contacts.length === 0) {
      return this.unknown(operation, 'No contacts are loaded in this context, so nothing was matched.');
    }
    const result = matchContactByName(input, this.contacts);
    return {
      status: result.best ? 'ok' : result.ambiguities.length ? 'needs-confirmation' : 'unknown',
      operation,
      value: result,
      confidence: result.confidence,
      ambiguities: result.ambiguities,
      missingFields: [],
      message: result.message,
    };
  }

  private diagnosticsSuggestionResult(operation: SmartEngineOperation): SmartEngineResult<DiagnosticsAnalytics> {
    if (!this.isFeatureEnabled('diagnosticsSuggestions')) {
      return this.unknown(operation, 'Diagnostics suggestions are turned off in Smart Assistance settings.');
    }
    if (!this.diagnosticsReport) {
      return this.unknown(operation, 'Run diagnostics first; this engine only explains results it can actually inspect.');
    }
    const analytics = this.analyzeDiagnosticsSummary();
    return {
      status: 'ok',
      operation,
      value: analytics,
      confidence: { score: 0.95, reason: 'derived' },
      ambiguities: [],
      missingFields: [],
      message: analytics.text,
    };
  }

  private buildBillProposal(input: string): CreateDirectDebitProposal {
    return createBillProposal(input, {
      categories: this.billCategories,
      reminders: this.reminders,
      referenceDate: this.referenceDate,
    });
  }

  private classifyMoney(input: string): SmartEngineResult<MoneyEntryClassification> {
    if (!this.isFeatureEnabled('moneySmartFeatures')) {
      return this.unknown('classify-money', 'Money smart features are turned off in Smart Assistance settings.');
    }
    const classification = classifyMoneyEntry(input, {
      billCategories: this.billCategories,
      extraIncomeCategories: this.moneyState?.extraIncomeCategories,
    });
    return {
      status: classification.ambiguities.length ? 'needs-confirmation' : classification.kind === 'unknown' ? 'unknown' : 'ok',
      operation: 'classify-money',
      value: classification,
      confidence: classification.confidence,
      ambiguities: classification.ambiguities,
      missingFields: [],
      message: classification.kind === 'unknown'
        ? 'No supported money entry type matched; no transaction was created.'
        : `Classified as ${classification.kind}. No transaction was created.`,
    };
  }

  private moneySummaryResult(operation: SmartEngineOperation): SmartEngineResult {
    if (!this.moneyState) {
      return this.unknown(operation, 'Money data is not loaded in this context, so no pay-cycle totals can be calculated.');
    }
    const summary = summarizeMoney(this.moneyState, toDateString(this.referenceDate));
    return {
      status: summary.facts.hasIncomeConfig ? 'ok' : 'needs-confirmation',
      operation,
      value: summary,
      confidence: { score: summary.facts.hasIncomeConfig ? 1 : 0.4, reason: summary.facts.hasIncomeConfig ? 'exact-match' : 'unknown' },
      ambiguities: [],
      missingFields: summary.facts.hasIncomeConfig ? [] : [{ field: 'incomeConfig', label: 'Income configuration', required: true }],
      message: summary.text,
    };
  }

  private proposalResult(operation: SmartEngineOperation, proposal: ProposedAction): SmartEngineResult {
    const validation = this.validateProposal(proposal);
    const status = proposal.missingFields.some((field) => field.required) || proposal.ambiguities.length > 0 ? 'needs-confirmation' : 'ok';
    return { status, operation, proposal: { ...proposal, validation }, confidence: proposal.confidence, ambiguities: proposal.ambiguities, missingFields: proposal.missingFields, message: proposal.preview };
  }

  public validateProposal(action: ProposedAction): ActionValidationResult {
    return this.actionValidator.validate(action, this.settings);
  }

  public getContextProvider(): SmartEngineContextProvider {
    return this.contextProvider;
  }

  private unknown<T = unknown>(operation: SmartEngineOperation, message: string): SmartEngineResult<T> {
    const ambiguities: Ambiguity[] = [];
    return {
      status: 'unknown',
      operation,
      confidence: UNKNOWN_CONFIDENCE,
      ambiguities,
      missingFields: [],
      message,
    };
  }
}

export function createSmartEngine(options: SmartEngineOptions = {}): SmartEngine {
  return new SmartEngine(options);
}
