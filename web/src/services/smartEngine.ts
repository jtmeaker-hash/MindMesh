import { Category, Reminder } from '../types';
import {
  createDirectDebitProposal,
  detectIntent,
  SmartIntent,
} from './smartEngineParsing';
import { createCategoryProposal, createEditReminderProposal, createIntelligentReminderProposal, createSubcategoryProposal } from './reminderIntelligence';
import {
  ActionValidationResult,
  Ambiguity,
  Confidence,
  DEFAULT_SMART_ENGINE_SETTINGS,
  normalizeSmartEngineSettings,
  ProposedAction,
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
    return {
      valid: reasons.length === 0,
      canWrite: reasons.length === 0 && !settings.requireConfirmationForWrites,
      reasons,
    };
  }
}

export interface SmartEngineOptions {
  settings?: Partial<SmartEngineSettings>;
  contextProvider?: SmartEngineContextProvider;
  actionValidator?: SmartEngineActionValidator;
  reminders?: readonly Reminder[];
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

  public constructor(options: SmartEngineOptions = {}) {
    this.settings = normalizeSmartEngineSettings({ ...DEFAULT_SMART_ENGINE_SETTINGS, ...options.settings });
    this.contextProvider = options.contextProvider ?? new DefaultSmartEngineContextProvider();
    this.actionValidator = options.actionValidator ?? new DefaultSmartEngineActionValidator();
    this.reminders = options.reminders ?? [];
  }

  public interpret(operation: SmartEngineOperation, input: string): SmartEngineResult {
    const normalized = input.trim();
    if (!this.settings.enabled) return this.unknown(operation, 'Smart Assistance is disabled in settings.');
    if (!normalized) return this.unknown(operation, 'No input was provided; nothing can be safely inferred.');

    if (operation === 'assistant-command') return this.routeCommand(normalized);
    if (operation === 'create-reminder') {
      if (/\b(?:someday|sometime|that thing)\b/i.test(normalized)) return this.unknown(operation, 'The request is too vague to create a safe reminder; provide a concrete action and date; support is not implemented for that vague form.');
      return this.proposalResult(operation, createIntelligentReminderProposal(normalized, this.contextProvider.getCategories() as Category[]));
    }
    if (operation === 'edit-reminder') return this.proposalResult(operation, createEditReminderProposal(normalized, this.reminders));
    if (operation === 'create-category') return this.proposalResult(operation, createCategoryProposal(normalized));
    if (operation === 'create-subcategory') return this.proposalResult(operation, createSubcategoryProposal(normalized, this.contextProvider.getCategories() as Category[]));
    if (operation === 'create-direct-debit') return this.proposalResult(operation, createDirectDebitProposal(normalized));

    const detected = detectIntent(normalized);
    if (detected.intent === 'create-reminder') return this.proposalResult('create-reminder', createIntelligentReminderProposal(normalized, this.contextProvider.getCategories() as Category[]));
    if (detected.intent === 'edit-reminder') return this.proposalResult('edit-reminder', createEditReminderProposal(normalized, this.reminders));
    if (detected.intent === 'create-category') return this.proposalResult('create-category', createCategoryProposal(normalized));
    if (detected.intent === 'create-subcategory') return this.proposalResult('create-subcategory', createSubcategoryProposal(normalized, this.contextProvider.getCategories() as Category[]));
    if (detected.intent === 'create-direct-debit') return this.proposalResult('create-direct-debit', createDirectDebitProposal(normalized));
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
      return this.proposalResult('assistant-command', createIntelligentReminderProposal(input, this.contextProvider.getCategories() as Category[]));
    }
    if (detected.intent === 'edit-reminder') return this.proposalResult('assistant-command', createEditReminderProposal(input, this.reminders));
    if (detected.intent === 'create-category') return this.proposalResult('assistant-command', createCategoryProposal(input));
    if (detected.intent === 'create-subcategory') return this.proposalResult('assistant-command', createSubcategoryProposal(input, this.contextProvider.getCategories() as Category[]));
    if (detected.intent === 'create-direct-debit') return this.proposalResult('assistant-command', createDirectDebitProposal(input));
    return { status: 'ok', operation: 'assistant-command', confidence: detected.confidence, ambiguities: [], missingFields: [], value: { intent: detected.intent as SmartIntent }, message: `Routed to ${detected.intent}. No data was changed.` };
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

  private unknown(operation: SmartEngineOperation, message: string): SmartEngineResult {
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
