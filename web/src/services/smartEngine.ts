import { Category } from '../types';
import {
  createDirectDebitProposal,
  createReminderProposal,
  detectIntent,
  SmartIntent,
} from './smartEngineParsing';
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
}

/**
 * Deterministic, local-only facade. It intentionally does not call fetch,
 * mutate storage, schedule notifications, or invoke any repository directly.
 */
export class SmartEngine {
  public readonly settings: SmartEngineSettings;
  private readonly contextProvider: SmartEngineContextProvider;
  private readonly actionValidator: SmartEngineActionValidator;

  public constructor(options: SmartEngineOptions = {}) {
    this.settings = normalizeSmartEngineSettings({ ...DEFAULT_SMART_ENGINE_SETTINGS, ...options.settings });
    this.contextProvider = options.contextProvider ?? new DefaultSmartEngineContextProvider();
    this.actionValidator = options.actionValidator ?? new DefaultSmartEngineActionValidator();
  }

  public interpret(operation: SmartEngineOperation, input: string): SmartEngineResult {
    const normalized = input.trim();
    if (!this.settings.enabled) return this.unknown(operation, 'Smart Assistance is disabled in settings.');
    if (!normalized) return this.unknown(operation, 'No input was provided; nothing can be safely inferred.');

    if (operation === 'assistant-command') return this.routeCommand(normalized);
    if (operation === 'create-reminder') {
      if (/\b(?:someday|sometime|that thing)\b/i.test(normalized)) return this.unknown(operation, 'The request is too vague to create a safe reminder; provide a concrete action and date; support is not implemented for that vague form.');
      return this.proposalResult(operation, createReminderProposal(normalized));
    }
    if (operation === 'create-direct-debit') return this.proposalResult(operation, createDirectDebitProposal(normalized));

    const detected = detectIntent(normalized);
    if (detected.intent === 'create-reminder') return this.proposalResult('create-reminder', createReminderProposal(normalized));
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
      return this.proposalResult('assistant-command', createReminderProposal(input));
    }
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
