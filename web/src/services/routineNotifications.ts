import { Routine } from '../types/routine';
import { getNativeBridge } from './notifications';
import { getRoutineOccurrencesForDate } from './routineEngine';

declare global {
  interface Window {
    MindMeshRoutineActions?: (id: string, action: string) => void;
    MindMeshRoutineActionQueue?: Array<{ id: string; action: string }>;
  }
}

const scheduledIds = new Set<string>();
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setDate(next.getDate() + days); return next; };

function timestamp(date: string, time?: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hours, minutes] = (time || '09:00').split(':').map(Number);
  return new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0).getTime();
}

function scheduleOne(routine: Routine, id: string, title: string, body: string, fireAt: number, actionKind: string, ongoing = false): void {
  const bridge = getNativeBridge();
  if (!bridge || !routine.notification.enabled) return;
  const options = JSON.stringify({
    kind: 'routine',
    actionKind,
    priority: routine.notification.priority,
    actions: ['start', 'snooze', 'skip', 'failed', 'open'],
    sound: routine.notification.sound !== false,
    vibration: routine.notification.vibration !== false,
    ongoing,
  });
  if (bridge.schedule(id, title, body, fireAt, options)) scheduledIds.add(id);
}

/** Registers the next two weeks of routine starts plus the active session notification. */
export function syncRoutineNativeNotifications(routines: Routine[], now = new Date()): void {
  const bridge = getNativeBridge();
  if (!bridge) return;
  const wanted = new Set<string>();
  for (const routine of routines) {
    if (routine.trashedAt || routine.status === 'disabled' || routine.status === 'archived' || !routine.notification.enabled) continue;
    if (routine.startMode !== 'manual') {
      for (let offset = 0; offset < 14; offset += 1) {
        const date = dateKey(addDays(now, offset));
        for (const occurrence of getRoutineOccurrencesForDate(routine, date)) {
          const base = timestamp(occurrence.date, occurrence.time);
          const warnings = routine.notification.startReminderMinutes?.length ? routine.notification.startReminderMinutes : [0];
          for (const warning of warnings) {
            const id = `routine:${routine.id}:${occurrence.occurrenceKey}:start:${warning}`;
            wanted.add(id);
            scheduleOne(routine, id, routine.name, warning ? `Starts in ${warning} minutes` : 'Routine is ready to start', base - warning * 60_000, routine.startMode);
          }
        }
      }
    }
    const session = routine.activeSession;
    if (session && (session.status === 'running' || session.status === 'paused')) {
      const current = routine.steps.find((step) => step.id === session.currentStepId);
      const id = `routine:${routine.id}:session:${session.id}`;
      wanted.add(id);
      const timerTarget = session.stepTimerTargetAt ? Date.parse(session.stepTimerTargetAt) : Date.now() + 1000;
      const timerText = session.stepTimerTargetAt ? ` · timer ends ${new Date(timerTarget).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
      scheduleOne(routine, id, routine.name, `${current?.title || 'Routine in progress'} · ${session.completedStepIds.length}/${routine.steps.length} complete${timerText}`, timerTarget, 'session', true);
    }
  }
  for (const id of scheduledIds) {
    if (!wanted.has(id)) bridge.cancel(id);
  }
  scheduledIds.clear();
  wanted.forEach((id) => scheduledIds.add(id));
}

export function attachRoutineNotificationActions(handler: (routineId: string, action: string) => void): () => void {
  const queued = window.MindMeshRoutineActionQueue || [];
  window.MindMeshRoutineActionQueue = [];
  queued.forEach(({ id, action }) => {
    const routineId = id.split(':')[1];
    if (routineId) handler(routineId, action);
  });
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<{ id?: string; action?: string }>).detail;
    if (!detail?.id?.startsWith('routine:')) return;
    window.MindMeshRoutineActionQueue = (window.MindMeshRoutineActionQueue || []).filter((item) => !(item.id === detail.id && item.action === detail.action));
    const routineId = detail.id.split(':')[1];
    if (routineId) handler(routineId, detail.action || 'open');
  };
  window.addEventListener('mindmesh-routine-action', listener);
  return () => window.removeEventListener('mindmesh-routine-action', listener);
}
