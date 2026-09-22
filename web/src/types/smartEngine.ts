/** Local-only Smart Engine contracts. This foundation deliberately does not claim to be a generative model. */

export type SmartEngineStatus = 'ok' | 'unknown' | 'unsupported' | 'needs-confirmation' | 'invalid';
export type SmartEngineOperation =
  | 'enhance-description'
  | 'generate-summary'
  | 'create-reminder'
  | 'edit-reminder'
  | 'suggest-category'
  | 'suggest-subcategory'
  | 'suggest-subtasks'
  | 'create-category'
  | 'create-subcategory'
  | 'create-direct-debit'
  | 'classify-money'
  | 'dashboard-summary'
  | 'graph-summary'
  | 'assistant-command';

export interface Confidence {
  score: number;
  /** Stable reason that can be shown in confirmation UI or tests. */
  reason: 'exact-match' | 'explicit-pattern' | 'derived' | 'fuzzy-match' | 'ambiguous' | 'unknown';
}

export interface Ambiguity {
  field: string;
  message: string;
  options?: string[];
}

export interface MissingField {
  field: string;
  label: string;
  required: boolean;
}

export interface SmartEngineField<T> {
  value?: T;
  confidence: Confidence;
  ambiguities?: Ambiguity[];
}

export interface ProposedActionBase {
  id: string;
  preview: string;
  confidence: Confidence;
  missingFields: MissingField[];
  ambiguities: Ambiguity[];
  validation: ActionValidationResult;
}

export interface CreateReminderProposal extends ProposedActionBase {
  type: 'create-reminder';
  fields: Record<string, SmartEngineField<unknown>>;
}

export interface EditReminderProposal extends ProposedActionBase {
  type: 'edit-reminder';
  reminderId?: string;
  fields: Record<string, SmartEngineField<unknown>>;
}

export interface CreateCategoryProposal extends ProposedActionBase {
  type: 'create-category';
  name: SmartEngineField<string>;
  parentCategoryId: SmartEngineField<string | null>;
}

export interface CreateSubcategoryProposal extends ProposedActionBase {
  type: 'create-subcategory';
  name: SmartEngineField<string>;
  parentCategoryId: SmartEngineField<string>;
}

export interface CreateDirectDebitProposal extends ProposedActionBase {
  type: 'create-direct-debit';
  fields: Record<string, SmartEngineField<unknown>>;
}

export type ProposedAction =
  | CreateReminderProposal
  | EditReminderProposal
  | CreateCategoryProposal
  | CreateSubcategoryProposal
  | CreateDirectDebitProposal;

export interface SmartEngineResult<T = unknown> {
  status: SmartEngineStatus;
  operation: SmartEngineOperation;
  value?: T;
  proposal?: ProposedAction;
  confidence: Confidence;
  ambiguities: Ambiguity[];
  missingFields: MissingField[];
  message: string;
}

export interface SmartEngineSettings {
  enabled: boolean;
  /** Individual feature gates are opt-in for future write-capable integrations. */
  featureToggles: Record<string, boolean>;
  requireConfirmationForWrites: boolean;
  minimumConfidenceForSuggestions: number;
  minimumConfidenceForWrites: number;
}

export const DEFAULT_SMART_ENGINE_SETTINGS: SmartEngineSettings = {
  enabled: true,
  featureToggles: {},
  requireConfirmationForWrites: true,
  minimumConfidenceForSuggestions: 0.7,
  minimumConfidenceForWrites: 0.9,
};

export function normalizeSmartEngineSettings(input: unknown): SmartEngineSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { ...DEFAULT_SMART_ENGINE_SETTINGS, featureToggles: {} };
  const raw = input as Record<string, unknown>;
  const numberInRange = (value: unknown, fallback: number) => {
    const number = typeof value === 'number' ? value : Number(value);
    return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : fallback;
  };
  const featureToggles = raw.featureToggles && typeof raw.featureToggles === 'object' && !Array.isArray(raw.featureToggles)
    ? Object.fromEntries(Object.entries(raw.featureToggles).filter(([, value]) => typeof value === 'boolean'))
    : {};
  return {
    enabled: raw.enabled !== false,
    featureToggles,
    requireConfirmationForWrites: raw.requireConfirmationForWrites !== false,
    minimumConfidenceForSuggestions: numberInRange(raw.minimumConfidenceForSuggestions, DEFAULT_SMART_ENGINE_SETTINGS.minimumConfidenceForSuggestions),
    minimumConfidenceForWrites: numberInRange(raw.minimumConfidenceForWrites, DEFAULT_SMART_ENGINE_SETTINGS.minimumConfidenceForWrites),
  };
}

export interface SmartEngineContextProvider {
  getCategories(): readonly { id: string; name: string; parentCategoryId?: string | null }[];
  getSubcategories(parentCategoryId?: string): readonly { id: string; name: string; parentCategoryId?: string | null }[];
}

export interface ActionValidationResult {
  valid: boolean;
  canWrite: boolean;
  reasons: string[];
}

export interface SmartEngineActionValidator {
  validate(action: ProposedAction, settings: SmartEngineSettings): ActionValidationResult;
}
