import { Routine, RoutineOccurrence, RoutineSession, RoutineStep } from '../types/routine';

export interface RoutineOccurrencePreview {
  date: string;
  time?: string;
  occurrenceKey: string;
}

export interface RoutineRuntimeOptions {
  now?: Date;
  allowDependencyOverride?: boolean;
}

const isoDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function atLocalDate(date: string, time = '09:00'): Date {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, (month || 1) - 1, day || 1, hours || 0, minutes || 0, 0, 0);
}

function isWithinSchedule(routine: Routine, date: string): boolean {
  const schedule = routine.schedule;
  if (schedule.startDate && date < schedule.startDate) return false;
  if (schedule.endDate && date > schedule.endDate) return false;
  if (schedule.exceptions?.includes(date)) return false;
  const override = schedule.overrides?.[date];
  if (override?.enabled === false) return false;
  return true;
}

/** Returns whether a routine has an occurrence on a local calendar date. */
export function isRoutineScheduledOn(routine: Routine, date: string): boolean {
  if (routine.status === 'archived' || routine.status === 'disabled' || routine.trashedAt) return false;
  if (!isWithinSchedule(routine, date)) return false;
  const recurrence = routine.schedule.recurrence;
  if (recurrence.specificDates?.length) return recurrence.specificDates.includes(date);
  if (recurrence.frequency === 'none' || recurrence.frequency === 'custom' && recurrence.customExpression) {
    return recurrence.frequency === 'none' ? (!routine.schedule.startDate || routine.schedule.startDate === date) : evaluateCustomRecurrence(recurrence.customExpression || '', date);
  }
  const current = atLocalDate(date);
  const anchor = atLocalDate(scheduleAnchor(routine));
  const diffDays = Math.floor((current.getTime() - anchor.getTime()) / 86_400_000);
  if (diffDays < 0) return false;
  const interval = Math.max(1, recurrence.interval || 1);
  if (recurrence.frequency === 'daily') return diffDays % interval === 0;
  if (recurrence.frequency === 'weekly') {
    const days = recurrence.daysOfWeek?.length ? recurrence.daysOfWeek : [anchor.getDay()];
    const weekDiff = Math.floor(diffDays / 7);
    return weekDiff % interval === 0 && days.includes(current.getDay());
  }
  if (recurrence.frequency === 'monthly') {
    const months = (current.getFullYear() - anchor.getFullYear()) * 12 + current.getMonth() - anchor.getMonth();
    return months >= 0 && months % interval === 0 && current.getDate() === anchor.getDate();
  }
  if (recurrence.frequency === 'custom') {
    const unit = recurrence.unit || 'day';
    if (unit === 'day') return diffDays % interval === 0;
    if (unit === 'week') return Math.floor(diffDays / 7) % interval === 0 && (recurrence.daysOfWeek || [anchor.getDay()]).includes(current.getDay());
    const months = (current.getFullYear() - anchor.getFullYear()) * 12 + current.getMonth() - anchor.getMonth();
    return months >= 0 && months % interval === 0 && current.getDate() === anchor.getDate();
  }
  return false;
}

function scheduleAnchor(routine: Routine): string {
  return routine.schedule.startDate || routine.createdAt.slice(0, 10);
}

function evaluateCustomRecurrence(expression: string, date: string): boolean {
  // Safe local subset: weekdays (`mon`, `wed`) and simple `*/N` day intervals.
  const lower = expression.trim().toLowerCase();
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'short' }).toLowerCase().slice(0, 3);
  if (/^(sun|mon|tue|wed|thu|fri|sat)(,(sun|mon|tue|wed|thu|fri|sat))*$/.test(lower)) return lower.split(',').includes(weekday);
  const interval = lower.match(/^\*\/(\d+)\s*(day|days)?$/);
  if (interval) return Number(date.slice(-2)) % Math.max(1, Number(interval[1])) === 0;
  return false;
}

/** Lists all daily occurrences, including multiple times, without mutating the routine. */
export function getRoutineOccurrencesForDate(routine: Routine, date: string): RoutineOccurrencePreview[] {
  if (!isRoutineScheduledOn(routine, date)) return [];
  const override = routine.schedule.overrides?.[date];
  const times = routine.schedule.timesPerDay?.length ? routine.schedule.timesPerDay : [override?.startTime || routine.schedule.startTime];
  return times.map((time, index) => ({ date, ...(time ? { time } : {}), occurrenceKey: `${routine.id}:${date}:${time || 'any'}:${index}` }));
}

export function getNextRoutineOccurrence(routine: Routine, from = new Date()): RoutineOccurrencePreview | undefined {
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  for (let i = 0; i < 370; i += 1) {
    const date = isoDate(cursor);
    const occurrence = getRoutineOccurrencesForDate(routine, date)[0];
    if (occurrence) return occurrence;
    cursor.setDate(cursor.getDate() + 1);
  }
  return undefined;
}

function childSteps(routine: Routine, parentId: string | null | undefined): RoutineStep[] {
  return routine.steps.filter((step) => (step.parentStepId || null) === (parentId || null)).sort((a, b) => a.order - b.order);
}

function conditionAllows(routine: Routine, step: RoutineStep): boolean {
  const condition = step.conditionId ? routine.conditions.find((item) => item.id === step.conditionId) : undefined;
  if (!condition || !condition.expression.trim()) return true;
  const expression = condition.expression.trim().toLowerCase();
  return !['false', 'no', '0', 'never'].includes(expression);
}

export function getEligibleRoutineSteps(routine: Routine, options: RoutineRuntimeOptions = {}): RoutineStep[] {
  const session = routine.activeSession;
  const completed = new Set(session?.completedStepIds || []);
  return routine.steps.filter((step) => {
    if (completed.has(step.id) || !conditionAllows(routine, step)) return false;
    const dependencyIds = step.dependencyIds || [];
    if (!options.allowDependencyOverride && dependencyIds.some((dependencyId) => !completed.has(dependencyId))) return false;
    return true;
  }).sort((a, b) => a.order - b.order);
}

function completionSatisfied(routine: Routine, session: RoutineSession): boolean {
  const completed = new Set(session.completedStepIds);
  const required = routine.steps.filter((step) => !step.optional && !step.minimumVersion);
  return routine.completionRule === 'any-child'
    ? required.length === 0 || required.some((step) => completed.has(step.id))
    : required.every((step) => completed.has(step.id));
}

function updateRuntime(routine: Routine, updater: (copy: Routine) => void): Routine {
  const next = clone(routine);
  updater(next);
  next.updatedAt = new Date().toISOString();
  return next;
}

/** Starts a persisted occurrence and selects the first eligible step. */
export function startRoutine(routine: Routine, options: RoutineRuntimeOptions = {}): Routine {
  const now = options.now || new Date();
  const date = isoDate(now);
  const occurrence = getRoutineOccurrencesForDate(routine, date)[0] || { date, time: routine.schedule.startTime, occurrenceKey: `${routine.id}:${date}:manual` };
  return updateRuntime(routine, (next) => {
    const occurrenceRecord: RoutineOccurrence = {
      id: id('occurrence'), routineId: next.id, scheduledFor: `${occurrence.date}T${occurrence.time || '09:00'}`,
      status: 'active', completedStepIds: [], skippedStepIds: [], createdAt: now.toISOString(), expectedDurationMinutes: next.schedule.durationTargetMinutes,
    };
    const session: RoutineSession = {
      id: id('session'), routineId: next.id, occurrenceId: occurrenceRecord.id, status: 'running', startedAt: now.toISOString(),
      currentStepId: next.executionMode === 'sequential' ? childSteps(next, null)[0]?.id : getEligibleRoutineSteps(next)[0]?.id,
      completedStepIds: [], temporaryStepIds: [], updatedAt: now.toISOString(),
    };
    next.occurrences = [occurrenceRecord, ...next.occurrences.filter((item) => item.status !== 'active')];
    next.activeSession = session;
    next.status = 'active';
  });
}

function withSession(routine: Routine, updater: (session: RoutineSession, occurrence: RoutineOccurrence, next: Routine) => void, options: RoutineRuntimeOptions = {}): Routine {
  if (!routine.activeSession) return startRoutine(routine, options);
  return updateRuntime(routine, (next) => {
    const session = next.activeSession!;
    const occurrence = next.occurrences.find((item) => item.id === session.occurrenceId) || next.occurrences[0];
    if (!occurrence) return;
    updater(session, occurrence, next);
    session.updatedAt = (options.now || new Date()).toISOString();
  });
}

function finishIfComplete(next: Routine, session: RoutineSession, occurrence: RoutineOccurrence, now: Date): void {
  if (!completionSatisfied(next, session)) return;
  session.status = 'completed';
  session.currentStepId = undefined;
  occurrence.status = 'completed';
  occurrence.completedAt = now.toISOString();
  occurrence.actualDurationMinutes = Math.max(0, Math.round((now.getTime() - Date.parse(session.startedAt)) / 60_000));
  next.stats.completionCount += 1;
  next.stats.totalDurationMinutes += occurrence.actualDurationMinutes;
  next.stats.lastCompletedAt = now.toISOString();
}

export function completeRoutineStep(routine: Routine, stepId?: string, options: RoutineRuntimeOptions = {}): Routine {
  const now = options.now || new Date();
  return withSession(routine, (session, occurrence, next) => {
    const step = stepId ? routine.steps.find((item) => item.id === stepId) : routine.steps.find((item) => item.id === session.currentStepId);
    if (!step) return;
    const eligible = getEligibleRoutineSteps(next, options).some((item) => item.id === step.id);
    if (!eligible && !options.allowDependencyOverride) throw new Error('Complete dependencies before this step');
    session.completedStepIds = [...new Set([...session.completedStepIds, step.id])];
    occurrence.completedStepIds = session.completedStepIds;
    next.history.unshift({ id: id('history'), routineId: next.id, occurrenceId: occurrence.id, stepId: step.id, event: 'completed', at: now.toISOString(), durationMinutes: step.durationTargetMinutes });
    if (next.executionMode === 'sequential') session.currentStepId = getEligibleRoutineSteps({ ...next, activeSession: session }, options)[0]?.id;
    finishIfComplete(next, session, occurrence, now);
  }, options);
}

export function skipRoutineStep(routine: Routine, stepId?: string, reason = 'Skipped', options: RoutineRuntimeOptions = {}): Routine {
  const now = options.now || new Date();
  return withSession(routine, (session, occurrence, next) => {
    const resolved = stepId || session.currentStepId;
    if (!resolved) return;
    session.completedStepIds = [...new Set([...session.completedStepIds, resolved])];
    occurrence.skippedStepIds = [...new Set([...occurrence.skippedStepIds, resolved])];
    next.stats.skipCount += 1;
    next.history.unshift({ id: id('history'), routineId: next.id, occurrenceId: occurrence.id, stepId: resolved, event: 'skipped', at: now.toISOString(), reason });
    if (next.executionMode === 'sequential') session.currentStepId = getEligibleRoutineSteps({ ...next, activeSession: session }, options)[0]?.id;
    finishIfComplete(next, session, occurrence, now);
  }, options);
}

export function pauseRoutineSession(routine: Routine, paused = true, options: RoutineRuntimeOptions = {}): Routine {
  return withSession(routine, (session) => { session.status = paused ? 'paused' : 'running'; session.pausedAt = paused ? (options.now || new Date()).toISOString() : undefined; }, options);
}

export function snoozeRoutineSession(routine: Routine, minutes: number, options: RoutineRuntimeOptions = {}): Routine {
  const until = new Date((options.now || new Date()).getTime() + Math.max(1, minutes) * 60_000).toISOString();
  return withSession(routine, (session) => { session.status = 'paused'; session.expiresAt = until; }, options);
}

export function expireRoutineSession(routine: Routine, options: RoutineRuntimeOptions = {}): Routine {
  const now = options.now || new Date();
  if (!routine.activeSession) return routine;
  return updateRuntime(routine, (next) => {
    const session = next.activeSession!;
    const occurrence = next.occurrences.find((item) => item.id === session.occurrenceId);
    if (session.status === 'completed' || !occurrence) return;
    session.status = 'expired';
    occurrence.status = next.expiryBehaviour === 'failed' ? 'failed' : 'overdue';
    if (occurrence.status === 'failed') next.stats.failedCount += 1; else next.stats.overdueCount += 1;
    next.history.unshift({ id: id('history'), routineId: next.id, occurrenceId: occurrence.id, event: 'failed', at: now.toISOString(), reason: next.expiryBehaviour });
  });
}

export function startRoutineStepTimer(routine: Routine, stepId?: string, minutes?: number, options: RoutineRuntimeOptions = {}): Routine {
  const now = options.now || new Date();
  return updateRuntime(routine, (next) => {
    const session = next.activeSession;
    const step = next.steps.find((item) => item.id === (stepId || session?.currentStepId));
    if (!session || !step) return;
    const duration = Math.max(1, minutes || step.timerMinutes || step.durationTargetMinutes || 5);
    session.timerStepId = step.id;
    session.stepTimerTargetAt = new Date(now.getTime() + duration * 60_000).toISOString();
  });
}

export function addRoutineStepTime(routine: Routine, minutes: number, _options: RoutineRuntimeOptions = {}): Routine {
  return updateRuntime(routine, (next) => {
    const target = next.activeSession?.stepTimerTargetAt;
    if (!target || !next.activeSession) return;
    const base = Math.max(Date.now(), Date.parse(target));
    next.activeSession.stepTimerTargetAt = new Date(base + Math.max(1, minutes) * 60_000).toISOString();
  });
}

export function clearRoutineStepTimer(routine: Routine): Routine {
  return updateRuntime(routine, (next) => {
    if (!next.activeSession) return;
    next.activeSession.timerStepId = undefined;
    next.activeSession.stepTimerTargetAt = undefined;
  });
}

export function getRoutineTimerRemainingMs(routine: Routine, now = new Date()): number | undefined {
  const target = routine.activeSession?.stepTimerTargetAt;
  if (!target) return undefined;
  return Math.max(0, Date.parse(target) - now.getTime());
}

export function addRuntimeStep(routine: Routine, title: string, permanent = false, options: RoutineRuntimeOptions = {}): Routine {
  const now = (options.now || new Date()).toISOString();
  return updateRuntime(routine, (next) => {
    const step = { id: id('step'), routineId: next.id, title: title.trim() || 'New step', kind: 'task' as const, order: next.steps.length, depth: 0, completed: false, optional: true, permanent, createdAt: now, updatedAt: now };
    next.steps.push(step);
    if (!permanent && next.activeSession) next.activeSession.temporaryStepIds.push(step.id);
  });
}

export function canTriggerRoutine(routines: Routine[], sourceRoutineId: string, targetRoutineId: string): boolean {
  if (sourceRoutineId === targetRoutineId) return false;
  const adjacency = new Map<string, string[]>();
  routines.forEach((routine) => routine.steps.forEach((step) => { if (step.links?.routineId) adjacency.set(routine.id, [...(adjacency.get(routine.id) || []), step.links.routineId]); }));
  const seen = new Set<string>();
  const visit = (current: string): boolean => {
    if (current === sourceRoutineId) return true;
    if (seen.has(current)) return false;
    seen.add(current);
    return (adjacency.get(current) || []).some(visit);
  };
  return !visit(targetRoutineId);
}

export function reorderTodayRoutineIds(routineIds: string[], movedId: string, targetIndex: number): string[] {
  const next = routineIds.filter((idValue) => idValue !== movedId);
  next.splice(Math.max(0, Math.min(targetIndex, next.length)), 0, movedId);
  return next;
}

export type RoutineRuntimeAction = 'complete' | 'skip' | 'pause' | 'resume' | 'snooze' | 'expire';

export function applyRoutineRuntimeAction(routine: Routine, action: RoutineRuntimeAction, options: RoutineRuntimeOptions = {}): Routine {
  switch (action) {
    case 'complete': return completeRoutineStep(routine, undefined, options);
    case 'skip': return skipRoutineStep(routine, undefined, 'Skipped once', options);
    case 'pause': return pauseRoutineSession(routine, true, options);
    case 'resume': return pauseRoutineSession(routine, false, options);
    case 'snooze': return snoozeRoutineSession(routine, 10, options);
    case 'expire': return expireRoutineSession(routine, options);
    default: return routine;
  }
}
