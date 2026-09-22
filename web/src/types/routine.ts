export type RoutineStatus = 'draft' | 'active' | 'paused' | 'archived' | 'disabled';
export type RoutineExecutionMode = 'sequential' | 'flexible';
export type RoutinePriority = 'low' | 'medium' | 'high' | 'critical';
export type RoutineStartMode = 'manual' | 'automatic' | 'notification';
export type RoutineOccurrenceStatus = 'active' | 'completed' | 'skipped' | 'overdue' | 'failed' | 'expired';
export type RoutineExpiryBehaviour = 'overdue' | 'failed';
export type RoutineMissedOccurrenceBehaviour = 'skip' | 'overdue' | 'failed' | 'create-late';
export type RoutineStepCompletionRule = 'all-children' | 'manual' | 'any-child';
export type RoutineStepKind = 'task' | 'sub-routine' | 'condition' | 'branch';
export type RoutineRecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';
export type RoutineRecurrenceUnit = 'day' | 'week' | 'month';

export interface RoutineRecurrence {
  frequency: RoutineRecurrenceFrequency;
  interval?: number;
  daysOfWeek?: number[];
  specificDates?: string[];
  unit?: RoutineRecurrenceUnit;
  endDate?: string;
  endAfterOccurrences?: number;
  repeatForever?: boolean;
  customExpression?: string;
}

export interface RoutineSchedule {
  recurrence: RoutineRecurrence;
  startDate?: string;
  endDate?: string;
  startTime?: string;
  deadline?: string;
  durationTargetMinutes?: number;
  timesPerDay?: string[];
  exceptions?: string[];
  overrides?: Record<string, { enabled?: boolean; startTime?: string; deadline?: string }>;
}

export interface RoutineDependency {
  id: string;
  stepId: string;
  dependsOnStepId: string;
  required: boolean;
  condition?: string;
}

export interface RoutineCondition {
  id: string;
  stepId: string;
  expression: string;
  trueNextStepId?: string;
  falseNextStepId?: string;
}

export type RoutineLinkCompletionBehaviour = 'complete-step' | 'open-target' | 'ask-first';

export interface RoutineStepLinks {
  reminderId?: string;
  contactId?: string;
  directDebitId?: string;
  routineId?: string;
  completionBehaviour?: RoutineLinkCompletionBehaviour;
  syncChanges?: boolean;
  broken?: boolean;
  brokenReason?: string;
}

export interface RoutineStep {
  id: string;
  routineId: string;
  parentStepId?: string | null;
  title: string;
  description?: string;
  kind: RoutineStepKind;
  order: number;
  depth: number;
  completed: boolean;
  optional: boolean;
  durationTargetMinutes?: number;
  timerMinutes?: number;
  minimumVersion?: boolean;
  minimumCompleted?: boolean;
  permanent: boolean;
  position?: { x: number; y: number };
  links?: RoutineStepLinks;
  dependencyIds?: string[];
  conditionId?: string;
  tags?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface RoutineNotificationConfig {
  enabled: boolean;
  priority: 'default' | 'low' | 'high' | 'max';
  startReminderMinutes?: number[];
  followUpMinutes?: number[];
  expiryWarningMinutes?: number[];
  alarmStyle?: boolean;
  sound?: boolean;
  vibration?: boolean;
}

export interface RoutineOccurrence {
  id: string;
  routineId: string;
  scheduledFor?: string;
  startedAt?: string;
  completedAt?: string;
  expiresAt?: string;
  status: RoutineOccurrenceStatus;
  currentStepId?: string;
  completedStepIds: string[];
  skippedStepIds: string[];
  failureReason?: string;
  skipReason?: string;
  expectedDurationMinutes?: number;
  actualDurationMinutes?: number;
  createdAt: string;
}

export interface RoutineSession {
  id: string;
  routineId: string;
  occurrenceId: string;
  status: 'running' | 'paused' | 'expired' | 'completed';
  currentStepId?: string;
  startedAt: string;
  pausedAt?: string;
  expiresAt?: string;
  completedStepIds: string[];
  temporaryStepIds: string[];
  timerStepId?: string;
  stepTimerTargetAt?: string;
  keepScreenAwake?: boolean;
  updatedAt: string;
}

export interface RoutineHistoryEntry {
  id: string;
  routineId: string;
  occurrenceId?: string;
  stepId?: string;
  event: 'completed' | 'skipped' | 'failed' | 'started' | 'paused' | 'resumed' | 'edited';
  at: string;
  reason?: string;
  durationMinutes?: number;
}

export interface RoutineStats {
  completionCount: number;
  skipCount: number;
  overdueCount: number;
  failedCount: number;
  totalDurationMinutes: number;
  lastCompletedAt?: string;
}

export interface RoutineVersionSnapshot {
  id: string;
  routineId: string;
  version: number;
  createdAt: string;
  reason?: string;
  name: string;
  description?: string;
  steps: RoutineStep[];
}

export interface RoutineVisualSettings {
  /** Optional routine-specific visual treatment; undefined inherits global MindMesh appearance. */
  color?: string;
  icon?: string;
  inheritCategoryColor?: boolean;
  performanceMode?: boolean;
  showInSpatialGraph?: boolean;
}

export interface RoutineTemplateData {
  templateId?: string;
  templateName?: string;
  isTemplate: boolean;
  source?: 'starter' | 'user' | 'ai';
}

export interface RoutineTemplate {
  id: string;
  name: string;
  description?: string;
  source: 'starter' | 'user' | 'ai';
  routine: Routine;
  keepScheduleByDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export type RoutineAiAction = 'create' | 'suggest' | 'breakdown' | 'rewrite' | 'history';
export interface RoutineAiChange {
  id: string;
  type: 'add-step' | 'edit-step' | 'delete-step' | 'edit-routine';
  description: string;
  before?: string;
  after?: string;
  stepId?: string;
  requiresConfirmation?: boolean;
}
export interface RoutineAiProposal {
  id: string;
  action: RoutineAiAction;
  routineId?: string;
  prompt: string;
  changes: RoutineAiChange[];
  proposedRoutine?: Routine;
  provider: 'offline' | 'native' | 'unavailable';
  createdAt: string;
}

export interface RoutineDraftRecovery {
  savedAt: string;
  reason?: string;
  name: string;
  description?: string;
  steps: RoutineStep[];
}

export interface Routine {
  id: string;
  name: string;
  description?: string;
  categoryId: string;
  categoryIds?: string[];
  subcategoryId?: string;
  tags?: string[];
  priority: RoutinePriority;
  status: RoutineStatus;
  executionMode: RoutineExecutionMode;
  startMode: RoutineStartMode;
  schedule: RoutineSchedule;
  expiryBehaviour: RoutineExpiryBehaviour;
  missedOccurrenceBehaviour: RoutineMissedOccurrenceBehaviour;
  completionRule: RoutineStepCompletionRule;
  notification: RoutineNotificationConfig;
  steps: RoutineStep[];
  dependencies: RoutineDependency[];
  conditions: RoutineCondition[];
  occurrences: RoutineOccurrence[];
  activeSession?: RoutineSession;
  history: RoutineHistoryEntry[];
  stats: RoutineStats;
  template: RoutineTemplateData;
  version: number;
  versionHistory: RoutineVersionSnapshot[];
  archivedAt?: string;
  trashedAt?: string;
  draftRecovery?: RoutineDraftRecovery;
  brokenLink?: boolean;
  visual?: RoutineVisualSettings;
  createdAt: string;
  updatedAt: string;
}

export interface RoutineNormalizationResult {
  routines: Routine[];
  quarantined: RoutineQuarantineEntry[];
}

export interface RoutineQuarantineEntry {
  id: string;
  reason: string;
  raw?: unknown;
}

const now = (): string => new Date().toISOString();

export function createRoutineStep(input: Partial<RoutineStep> & Pick<RoutineStep, 'id' | 'routineId' | 'title'>): RoutineStep {
  const timestamp = input.createdAt || now();
  return {
    id: input.id,
    routineId: input.routineId,
    parentStepId: input.parentStepId ?? null,
    title: input.title,
    description: input.description,
    kind: input.kind || 'task',
    order: typeof input.order === 'number' && Number.isFinite(input.order) ? input.order : 0,
    depth: typeof input.depth === 'number' && Number.isFinite(input.depth) ? input.depth : 0,
    completed: input.completed === true,
    optional: input.optional === true,
    durationTargetMinutes: input.durationTargetMinutes,
    timerMinutes: input.timerMinutes,
    minimumVersion: input.minimumVersion === true,
    minimumCompleted: input.minimumCompleted === true,
    permanent: input.permanent !== false,
    position: input.position,
    links: input.links,
    dependencyIds: input.dependencyIds || [],
    conditionId: input.conditionId,
    tags: input.tags || [],
    createdAt: timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}

export function createEmptyRoutine(input: Pick<Routine, 'id' | 'name' | 'categoryId'> & Partial<Routine>): Routine {
  const timestamp = input.createdAt || now();
  return {
    id: input.id,
    name: input.name,
    description: input.description,
    categoryId: input.categoryId,
    categoryIds: input.categoryIds || [input.categoryId],
    subcategoryId: input.subcategoryId,
    tags: input.tags || [],
    priority: input.priority || 'medium',
    status: input.status || 'draft',
    executionMode: input.executionMode || 'sequential',
    startMode: input.startMode || 'manual',
    schedule: input.schedule || { recurrence: { frequency: 'none' } },
    expiryBehaviour: input.expiryBehaviour || 'overdue',
    missedOccurrenceBehaviour: input.missedOccurrenceBehaviour || 'overdue',
    completionRule: input.completionRule || 'all-children',
    notification: input.notification || { enabled: false, priority: 'default' },
    steps: input.steps || [],
    dependencies: input.dependencies || [],
    conditions: input.conditions || [],
    occurrences: input.occurrences || [],
    activeSession: input.activeSession,
    history: input.history || [],
    stats: input.stats || { completionCount: 0, skipCount: 0, overdueCount: 0, failedCount: 0, totalDurationMinutes: 0 },
    template: input.template || { isTemplate: false },
    version: input.version || 1,
    versionHistory: input.versionHistory || [],
    archivedAt: input.archivedAt,
    trashedAt: input.trashedAt,
    draftRecovery: input.draftRecovery,
    brokenLink: input.brokenLink,
    visual: input.visual,
    createdAt: timestamp,
    updatedAt: input.updatedAt || timestamp,
  };
}

function validString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeRoutine(value: unknown): Routine {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Routine record is not an object');
  const raw = value as Partial<Routine>;
  if (!validString(raw.id) || !validString(raw.name) || !validString(raw.categoryId)) {
    throw new Error('Routine requires id, name, and categoryId');
  }

  const routineId = raw.id as string;
  const routineName = raw.name as string;
  const categoryId = raw.categoryId as string;
  const routine = createEmptyRoutine({
    ...(raw as Routine),
    id: routineId,
    name: routineName,
    categoryId,
    categoryIds: Array.isArray(raw.categoryIds) && raw.categoryIds.length > 0 ? raw.categoryIds.filter(validString) : [categoryId],
    steps: Array.isArray(raw.steps)
      ? raw.steps.filter((step): step is RoutineStep => Boolean(step && typeof step === 'object' && validString((step as RoutineStep).id) && validString((step as RoutineStep).title))).map((step) => createRoutineStep({ ...step, routineId: routineId }))
      : [],
    dependencies: Array.isArray(raw.dependencies) ? raw.dependencies : [],
    conditions: Array.isArray(raw.conditions) ? raw.conditions : [],
    occurrences: Array.isArray(raw.occurrences) ? raw.occurrences : [],
    history: Array.isArray(raw.history) ? raw.history : [],
    versionHistory: Array.isArray(raw.versionHistory) ? raw.versionHistory : [],
  });

  routine.steps = routine.steps.map((step, index) => ({ ...step, order: Number.isFinite(step.order) ? step.order : index }));
  return routine;
}

export function normalizeRoutines(input: unknown): RoutineNormalizationResult {
  if (!Array.isArray(input)) return { routines: [], quarantined: [] };
  const routines: Routine[] = [];
  const quarantined: RoutineQuarantineEntry[] = [];
  const ids = new Set<string>();
  input.forEach((value) => {
    try {
      const routine = normalizeRoutine(value);
      if (ids.has(routine.id)) throw new Error(`Duplicate routine id: ${routine.id}`);
      ids.add(routine.id);
      routines.push(routine);
    } catch (error) {
      const raw = value as { id?: unknown };
      quarantined.push({
        id: validString(raw?.id) ? raw.id : `quarantined-${quarantined.length + 1}`,
        reason: error instanceof Error ? error.message : 'Routine could not be normalized',
        raw: value,
      });
    }
  });
  return { routines, quarantined };
}

export function duplicateRoutine(source: Routine, newId: string, stepId: (step: RoutineStep, index: number) => string): Routine {
  const timestamp = now();
  const stepIds = new Map(source.steps.map((step, index) => [step.id, stepId(step, index)]));
  const steps = source.steps.map((step, _index) => ({
    ...step,
    id: stepIds.get(step.id)!,
    routineId: newId,
    parentStepId: step.parentStepId ? stepIds.get(step.parentStepId) || null : null,
    dependencyIds: (step.dependencyIds || []).map((id) => stepIds.get(id)).filter((id): id is string => Boolean(id)),
    completed: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }));
  return createEmptyRoutine({
    ...source,
    id: newId,
    name: `${source.name} copy`,
    status: 'draft',
    steps,
    dependencies: source.dependencies.map((dependency) => ({ ...dependency, id: `${newId}-dependency-${dependency.id}`, stepId: stepIds.get(dependency.stepId) || dependency.stepId, dependsOnStepId: stepIds.get(dependency.dependsOnStepId) || dependency.dependsOnStepId })),
    conditions: source.conditions.map((condition) => ({ ...condition, id: `${newId}-condition-${condition.id}`, stepId: stepIds.get(condition.stepId) || condition.stepId, trueNextStepId: condition.trueNextStepId ? stepIds.get(condition.trueNextStepId) : undefined, falseNextStepId: condition.falseNextStepId ? stepIds.get(condition.falseNextStepId) : undefined })),
    occurrences: [],
    activeSession: undefined,
    history: [],
    stats: { completionCount: 0, skipCount: 0, overdueCount: 0, failedCount: 0, totalDurationMinutes: 0 },
    version: 1,
    versionHistory: [],
    archivedAt: undefined,
    trashedAt: undefined,
    draftRecovery: undefined,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}
