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
  | 'match-contact'
  | 'diagnostics-suggestion'
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

/**
 * User-facing privacy statement for the local Smart Assistance surface.
 * Keep this in sync with the real behaviour: interpretation is on-device and
 * makes no network request, so this is a description, not a promise about
 * features that do not exist.
 */
export const SMART_ASSISTANCE_PRIVACY_NOTE =
  'Smart Assistance runs entirely on this device. It parses your text, calculates from your stored data and proposes actions using plain rules and templates — there is no AI model, no API key and no network request. Your reminders, contacts, money data and history never leave the device, and nothing is written until you confirm a proposal.';

/** Short label used by settings UI for the master switch. */
export const SMART_ASSISTANCE_MASTER_LABEL = 'Smart Assistance';

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
    // Never bypassable: a stored or restored `false` is normalised back to true.
    requireConfirmationForWrites: true,
    minimumConfidenceForSuggestions: numberInRange(raw.minimumConfidenceForSuggestions, DEFAULT_SMART_ENGINE_SETTINGS.minimumConfidenceForSuggestions),
    minimumConfidenceForWrites: numberInRange(raw.minimumConfidenceForWrites, DEFAULT_SMART_ENGINE_SETTINGS.minimumConfidenceForWrites),
  };
}

/**
 * Named feature gates for the local Smart Engine. Values live in
 * `SmartEngineSettings.featureToggles`; an absent key falls back to the
 * documented default so older settings and backups stay valid.
 */
export type SmartAssistanceFeature =
  | 'autoDetectDates'
  | 'detectRecurrence'
  | 'suggestDescriptions'
  | 'suggestCategories'
  | 'suggestSubcategories'
  | 'suggestSubtasks'
  | 'moneySmartFeatures'
  | 'dashboardSummaries'
  | 'useCompletedHistory'
  | 'useContactContext'
  | 'diagnosticsSuggestions';

export type SmartAssistanceFeatureGroup = 'language' | 'money' | 'context' | 'diagnostics';

export interface SmartAssistanceFeatureGroupDefinition {
  group: SmartAssistanceFeatureGroup;
  label: string;
  description: string;
}

export const SMART_ASSISTANCE_FEATURE_GROUPS: readonly SmartAssistanceFeatureGroupDefinition[] = [
  {
    group: 'language',
    label: 'Language & reminder suggestions',
    description: 'Parse dates, recurrence and wording, and propose reminder fields. Suggestions are always optional.',
  },
  {
    group: 'money',
    label: 'Money',
    description: 'Interpret bills and classify money entries, and summarise your stored pay-cycle facts.',
  },
  {
    group: 'context',
    label: 'Local context',
    description: 'Let suggestions and summaries use data already stored on this device.',
  },
  {
    group: 'diagnostics',
    label: 'Diagnostics',
    description: 'Explain detected notification and configuration problems and point at the existing repair actions.',
  },
];

export interface SmartAssistanceFeatureDefinition {
  feature: SmartAssistanceFeature;
  label: string;
  description: string;
  group: SmartAssistanceFeatureGroup;
  /** Applied when no toggle has been stored yet. */
  defaultEnabled: boolean;
}

export const SMART_ASSISTANCE_FEATURES: readonly SmartAssistanceFeatureDefinition[] = [
  {
    feature: 'autoDetectDates',
    label: 'Detect dates automatically',
    description: 'Recognise dates and times in your text and suggest a due date for confirmation.',
    group: 'language',
    defaultEnabled: true,
  },
  {
    feature: 'detectRecurrence',
    label: 'Detect recurrence',
    description: 'Recognise daily, weekly, fortnightly, monthly, quarterly, yearly and every-X patterns.',
    group: 'language',
    defaultEnabled: true,
  },
  {
    feature: 'suggestDescriptions',
    label: 'Suggest titles & descriptions',
    description: 'Tidy up wording you already typed. Never invents people, places or costs.',
    group: 'language',
    defaultEnabled: true,
  },
  {
    feature: 'suggestCategories',
    label: 'Suggest categories',
    description: 'Match your text against your existing categories and known domain keywords.',
    group: 'language',
    defaultEnabled: true,
  },
  {
    feature: 'suggestSubcategories',
    label: 'Suggest subcategories',
    description: 'Match your text against your existing subcategories. Only your own are used.',
    group: 'language',
    defaultEnabled: true,
  },
  {
    feature: 'suggestSubtasks',
    label: 'Suggest subtasks',
    description: 'Offer optional checklist steps for known task types. Nothing is added automatically.',
    group: 'language',
    defaultEnabled: true,
  },
  {
    feature: 'moneySmartFeatures',
    label: 'Money smart features',
    description: 'Interpret bills, classify money entries and summarise stored pay-cycle facts.',
    group: 'money',
    defaultEnabled: true,
  },
  {
    feature: 'dashboardSummaries',
    label: 'Dashboard summaries',
    description: 'Summarise your stored dashboard statistics and overdue/completion facts locally.',
    group: 'context',
    defaultEnabled: true,
  },
  {
    feature: 'useCompletedHistory',
    label: 'Completed-history context',
    description: 'Use completed reminders already on this device to improve suggestions and summaries. Nothing is recreated.',
    group: 'context',
    defaultEnabled: true,
  },
  {
    feature: 'useContactContext',
    label: 'Contact context',
    description: 'Match names against your local contact book. Contacts are never created, edited or deleted.',
    group: 'context',
    defaultEnabled: true,
  },
  {
    feature: 'diagnosticsSuggestions',
    label: 'Diagnostics suggestions',
    description: 'Explain detected notification or configuration problems and route to the existing repair actions.',
    group: 'diagnostics',
    defaultEnabled: true,
  },
];

export const SMART_ASSISTANCE_FEATURE_DEFAULTS: Record<SmartAssistanceFeature, boolean> = SMART_ASSISTANCE_FEATURES.reduce(
  (accumulator, definition) => {
    accumulator[definition.feature] = definition.defaultEnabled;
    return accumulator;
  },
  {} as Record<SmartAssistanceFeature, boolean>
);

export function getSmartAssistanceFeatureDefinition(
  feature: SmartAssistanceFeature
): SmartAssistanceFeatureDefinition | undefined {
  return SMART_ASSISTANCE_FEATURES.find((definition) => definition.feature === feature);
}

export function getSmartAssistanceFeaturesForGroup(
  group: SmartAssistanceFeatureGroup
): readonly SmartAssistanceFeatureDefinition[] {
  return SMART_ASSISTANCE_FEATURES.filter((definition) => definition.group === group);
}

/** Resolves a stored toggle, falling back to its documented default. */
export function isSmartAssistanceFeatureEnabled(settings: SmartEngineSettings, feature: SmartAssistanceFeature): boolean {
  const stored = settings?.featureToggles?.[feature];
  if (typeof stored === 'boolean') return stored;
  return SMART_ASSISTANCE_FEATURE_DEFAULTS[feature] ?? true;
}

export function getEffectiveSmartAssistanceFeatures(settings: SmartEngineSettings): Record<SmartAssistanceFeature, boolean> {
  return SMART_ASSISTANCE_FEATURES.reduce((accumulator, definition) => {
    accumulator[definition.feature] = isSmartAssistanceFeatureEnabled(settings, definition.feature);
    return accumulator;
  }, {} as Record<SmartAssistanceFeature, boolean>);
}

/** Returns a new settings object with one feature toggle written. */
export function setSmartAssistanceFeature(settings: SmartEngineSettings, feature: SmartAssistanceFeature, enabled: boolean): SmartEngineSettings {
  const base = normalizeSmartEngineSettings(settings);
  return normalizeSmartEngineSettings({ ...base, featureToggles: { ...base.featureToggles, [feature]: enabled } });
}

/**
 * Writes are always confirmation-gated. `requireConfirmationForWrites` is kept
 * in the stored settings for compatibility, but it can never be turned off —
 * neither from settings nor from a restored backup.
 */
export function isWriteConfirmationRequired(_settings?: SmartEngineSettings): boolean {
  return true;
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
