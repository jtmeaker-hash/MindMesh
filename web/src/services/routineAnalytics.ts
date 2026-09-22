import { Reminder, Routine, RoutineHistoryEntry } from '../types';
import { DirectDebit } from '../types/finance';
import { getRoutineOccurrencesForDate, isRoutineScheduledOn } from './routineEngine';

export type RoutineReason = 'Forgot' | 'No time' | 'Too tired' | 'Not needed today' | 'Schedule changed' | 'Blocked by something else' | 'Custom';
export type RoutineGamification = 'none' | 'light' | 'badges' | 'xp';
export interface RoutineAnalyticsSettings { showAnalytics: boolean; showStreaks: boolean; graceDays: number; skipBreaksStreak: boolean; goalPerWeek?: number; goalCompletionPercent?: number; monthlyTarget?: number; gamification: RoutineGamification; overdueIntensity: 'soft' | 'normal' | 'strong'; }
export const DEFAULT_ROUTINE_ANALYTICS_SETTINGS: RoutineAnalyticsSettings = { showAnalytics: true, showStreaks: true, graceDays: 0, skipBreaksStreak: true, gamification: 'light', overdueIntensity: 'normal' };

export interface RoutineAnalytics { routineId: string; completionRate: number; completed: number; expected: number; averageDurationMinutes: number; averageExpectedMinutes: number; skips: number; overdue: number; failed: number; minimumCompleted: number; timeOfDay: Record<string, number>; stepStats: Record<string, { completed: number; skipped: number; averageDurationMinutes: number; skipRate: number }>; bottleneckStepIds: string[]; unrealisticDuration: boolean; streak: number; consistencyPercent: number; }

const day = (value: string) => value.slice(0, 10);
function entries(routine: Routine, event: RoutineHistoryEntry['event']): RoutineHistoryEntry[] { return routine.history.filter((entry) => entry.event === event); }

export function analyzeRoutine(routine: Routine, from = new Date(Date.now() - 30 * 86_400_000), to = new Date()): RoutineAnalytics {
  const start = from.getTime(); const end = to.getTime();
  const history = routine.history.filter((entry) => { const time = Date.parse(entry.at); return Number.isFinite(time) && time >= start && time <= end; });
  const completed = history.filter((entry) => entry.event === 'completed');
  const skips = history.filter((entry) => entry.event === 'skipped');
  const failed = history.filter((entry) => entry.event === 'failed');
  const expectedDates = new Set<string>();
  for (let cursor = new Date(from); cursor <= to; cursor.setDate(cursor.getDate() + 1)) { const date = cursor.toISOString().slice(0, 10); if (isRoutineScheduledOn(routine, date)) expectedDates.add(date); }
  const completedOccurrences = routine.occurrences.filter((occurrence) => occurrence.status === 'completed' && (!occurrence.completedAt || Date.parse(occurrence.completedAt) >= start));
  const stepStats: RoutineAnalytics['stepStats'] = {};
  for (const step of routine.steps) {
    const stepCompleted = completed.filter((entry) => entry.stepId === step.id);
    const stepSkipped = skips.filter((entry) => entry.stepId === step.id);
    const durations = stepCompleted.map((entry) => entry.durationMinutes).filter((value): value is number => typeof value === 'number');
    stepStats[step.id] = { completed: stepCompleted.length, skipped: stepSkipped.length, averageDurationMinutes: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0, skipRate: stepCompleted.length + stepSkipped.length ? Math.round((stepSkipped.length / (stepCompleted.length + stepSkipped.length)) * 100) : 0 };
  }
  const bottleneckStepIds = Object.entries(stepStats).filter(([, stat]) => stat.skipRate >= 40 || stat.averageDurationMinutes > 0 && stat.averageDurationMinutes > (routine.schedule.durationTargetMinutes || Infinity) / Math.max(1, routine.steps.length) * 1.5).map(([id]) => id);
  const durations = completedOccurrences.map((occurrence) => occurrence.actualDurationMinutes).filter((value): value is number => typeof value === 'number');
  const expectedDurations = completedOccurrences.map((occurrence) => occurrence.expectedDurationMinutes).filter((value): value is number => typeof value === 'number');
  const timeOfDay: Record<string, number> = {};
  completed.forEach((entry) => { const hour = new Date(entry.at).getHours(); const bucket = `${String(hour).padStart(2, '0')}:00`; timeOfDay[bucket] = (timeOfDay[bucket] || 0) + 1; });
  return { routineId: routine.id, completionRate: expectedDates.size ? Math.round((completedOccurrences.length / expectedDates.size) * 100) : completedOccurrences.length ? 100 : 0, completed: completedOccurrences.length, expected: expectedDates.size, averageDurationMinutes: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0, averageExpectedMinutes: expectedDurations.length ? Math.round(expectedDurations.reduce((sum, value) => sum + value, 0) / expectedDurations.length) : routine.schedule.durationTargetMinutes || 0, skips: skips.length, overdue: routine.occurrences.filter((occurrence) => occurrence.status === 'overdue').length, failed: failed.length + routine.occurrences.filter((occurrence) => occurrence.status === 'failed').length, minimumCompleted: routine.history.filter((entry) => entry.reason === 'minimum-completed').length, timeOfDay, stepStats, bottleneckStepIds, unrealisticDuration: durations.length > 0 && expectedDurations.length > 0 && durations.reduce((sum, value) => sum + value, 0) / durations.length > (expectedDurations.reduce((sum, value) => sum + value, 0) / expectedDurations.length) * 1.5, streak: calculateStreak(routine), consistencyPercent: expectedDates.size ? Math.round((new Set(completed.map((entry) => day(entry.at))).size / expectedDates.size) * 100) : 0 };
}

export function calculateStreak(routine: Routine, settings: Pick<RoutineAnalyticsSettings, 'graceDays' | 'skipBreaksStreak'> = DEFAULT_ROUTINE_ANALYTICS_SETTINGS): number {
  const doneDays = new Set(entries(routine, 'completed').map((entry) => day(entry.at)));
  let streak = 0; const cursor = new Date(); cursor.setHours(0, 0, 0, 0);
  let grace = settings.graceDays;
  for (let i = 0; i < 366; i += 1) { const date = cursor.toISOString().slice(0, 10); if (doneDays.has(date)) streak += 1; else if (settings.skipBreaksStreak && routine.history.some((entry) => entry.event === 'skipped' && day(entry.at) === date) || grace > 0) grace -= 1; else break; cursor.setDate(cursor.getDate() - 1); }
  return streak;
}

export function getRoutineReasonOptions(): RoutineReason[] { return ['Forgot', 'No time', 'Too tired', 'Not needed today', 'Schedule changed', 'Blocked by something else', 'Custom']; }
export function getRoutineGoalProgress(routines: Routine[], settings: RoutineAnalyticsSettings, now = new Date()): { weeklyCompleted: number; monthlyCompleted: number; completionPercent: number; targetMet: boolean } { const weekStart = new Date(now); weekStart.setDate(now.getDate() - 6); const month = now.toISOString().slice(0, 7); const completed = routines.flatMap((routine) => routine.occurrences.filter((occurrence) => occurrence.status === 'completed')); const weeklyCompleted = completed.filter((occurrence) => occurrence.completedAt && Date.parse(occurrence.completedAt) >= weekStart.getTime()).length; const monthlyCompleted = completed.filter((occurrence) => occurrence.completedAt?.startsWith(month)).length; const expected = routines.reduce((sum, routine) => sum + routine.occurrences.filter((occurrence) => occurrence.status !== 'active').length, 0); const completionPercent = expected ? Math.round((completed.length / expected) * 100) : 0; return { weeklyCompleted, monthlyCompleted, completionPercent, targetMet: Boolean((settings.goalPerWeek && weeklyCompleted >= settings.goalPerWeek) || (settings.monthlyTarget && monthlyCompleted >= settings.monthlyTarget) || (settings.goalCompletionPercent && completionPercent >= settings.goalCompletionPercent)) }; }

export type TodayPlanItem = { id: string; title: string; type: 'routine' | 'reminder' | 'bill'; time?: string; priority?: string; routineId?: string; completed?: boolean; };
export function buildTodayPlan(routines: Routine[], reminders: Reminder[], directDebits: DirectDebit[], date = new Date().toISOString().slice(0, 10)): TodayPlanItem[] { const items: TodayPlanItem[] = []; routines.forEach((routine) => { const occurrence = getRoutineOccurrencesForDate(routine, date)[0]; if (occurrence) items.push({ id: `routine-${routine.id}`, title: routine.name, type: 'routine', time: occurrence.time, routineId: routine.id, completed: routine.activeSession?.status === 'completed' }); }); reminders.filter((reminder) => reminder.dueDate === date && !reminder.completed).forEach((reminder) => items.push({ id: `reminder-${reminder.id}`, title: reminder.title, type: 'reminder', time: reminder.dueTime, priority: reminder.priority, completed: reminder.completed })); directDebits.filter((bill) => bill.active && bill.nextPaymentDate === date).forEach((bill) => items.push({ id: `bill-${bill.id}`, title: bill.title, type: 'bill', time: undefined })); return items.sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99')); }

export function exportRoutineHistoryJson(routine: Routine): string { return JSON.stringify({ routineId: routine.id, name: routine.name, exportedAt: new Date().toISOString(), history: routine.history, occurrences: routine.occurrences }, null, 2); }
export function exportRoutineHistoryCsv(routine: Routine): string { const rows = [['at', 'event', 'stepId', 'reason', 'durationMinutes'], ...routine.history.map((entry) => [entry.at, entry.event, entry.stepId || '', entry.reason || '', String(entry.durationMinutes ?? '')])]; return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n'); }
