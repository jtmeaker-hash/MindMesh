import { Category } from '../types';
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
    if (!this.settings.enabled) {
      return this.unknown(operation, 'Smart Assistance is disabled in settings.');
    }
    if (!normalized) return this.unknown(operation, 'No input was provided; nothing can be safely inferred.');

    // Stage 01 establishes the contract without guessing. Parsers are added in
    // later stages behind this same facade.
    return this.unknown(operation, `Local Smart Engine support for ${operation} is not implemented yet.`);
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
