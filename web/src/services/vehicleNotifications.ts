import type { VehicleNotificationJob, VehicleState } from '../types/vehicle';
import {
  computeMaintenanceItemStatus,
  computeNextService,
  formatKm,
  getVehicleServiceStatus,
  isIssueOpen,
  toIsoDate,
} from './vehicleMaintenance';

/**
 * Deterministic recurring vehicle notifications.
 *
 * Rather than firing one-shot alarms that must be manually reset, every job is
 * derived from the current state plus a stable cycle key. Re-running a sweep can
 * therefore never duplicate, never re-fire, and never leave a repeating reminder
 * permanently "overdue": once a cycle is recorded, the next cycle is a brand new
 * id and appears automatically as time passes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface VehicleNotificationSweep {
  state: VehicleState;
  /** Jobs that became due during this sweep (newly fired). */
  fired: VehicleNotificationJob[];
  /** Every job currently due but not yet recorded as fired. */
  pending: VehicleNotificationJob[];
}

interface CandidateContext {
  state: VehicleState;
  now: Date;
  nowIso: string;
}

function candidateJobs(ctx: CandidateContext): VehicleNotificationJob[] {
  const { state, now, nowIso } = ctx;
  const settings = state.notificationSettings;
  const jobs: VehicleNotificationJob[] = [];

  for (const vehicle of state.vehicles) {
    const label = vehicle.nickname?.trim() || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';

    // --- Service status (one notification for the most severe current stage) ---
    const info = computeNextService(vehicle, state.serviceRecords);
    const status = getVehicleServiceStatus(info, state.thresholds);
    const servicePoint = `${info.nextServiceKm ?? 'd'}:${info.nextServiceDate ?? 'n'}`;
    if (status.status === 'overdue' && settings.serviceOverdue) {
      jobs.push(makeJob('service_overdue', vehicle.id, servicePoint, nowIso, `${label} — Service overdue`, status.message));
    } else if (status.status === 'due' && settings.serviceDue) {
      jobs.push(makeJob('service_due', vehicle.id, servicePoint, nowIso, `${label} — Service due`, status.message));
    } else if ((status.status === 'approaching' || status.status === 'urgent') && settings.serviceApproaching) {
      jobs.push(makeJob('service_approaching', vehicle.id, servicePoint, nowIso, `${label} — Service approaching`, status.message));
    }

    // --- Tracked serviceable items ---
    for (const item of state.maintenanceItems) {
      if (item.vehicleId !== vehicle.id) continue;
      const itemStatus = computeMaintenanceItemStatus(item, vehicle.currentOdometerKm, state.thresholds, now);
      const point = `${itemStatus.nextReplacementKm ?? 'd'}:${itemStatus.nextReplacementDate ?? 'n'}`;
      const timeBinding =
        itemStatus.nextReplacementDate !== undefined &&
        itemStatus.daysRemaining !== undefined &&
        itemStatus.daysRemaining <= 0 &&
        (itemStatus.nextReplacementKm === undefined || (itemStatus.remainingKm ?? 1) > 0);

      if (itemStatus.status === 'overdue' || itemStatus.status === 'due') {
        if (timeBinding && settings.timeBasedMaintenance) {
          jobs.push(makeJob('time_based', vehicle.id, `${item.id}:${point}`, nowIso, `${label} — ${item.name} due`, itemStatus.message));
        } else if (settings.maintenanceDue) {
          jobs.push(makeJob('maintenance_due', vehicle.id, `${item.id}:${point}`, nowIso, `${label} — ${item.name} due`, itemStatus.message));
        }
      } else if ((itemStatus.status === 'approaching' || itemStatus.status === 'urgent') && settings.maintenanceApproaching) {
        jobs.push(makeJob('maintenance_approaching', vehicle.id, `${item.id}:${point}`, nowIso, `${label} — ${item.name} due soon`, itemStatus.message));
      }
    }

    // --- Known issue follow-ups ---
    if (settings.knownIssueFollowUp) {
      for (const issue of state.knownIssues) {
        if (issue.vehicleId !== vehicle.id || !isIssueOpen(issue)) continue;
        if (issue.status === 'monitoring') continue;
        jobs.push(
          makeJob('known_issue', vehicle.id, `${issue.id}:${issue.status}`, nowIso, `${label} — ${issue.title}`, `Known issue is currently "${issue.status.replace(/_/g, ' ')}".`)
        );
      }
    }

    // --- Recurring odometer reminder ---
    if (settings.odometerReminderMode !== 'disabled') {
      const intervalDays = settings.odometerReminderMode === 'weekly' ? 7 : Math.max(1, settings.odometerReminderIntervalDays);
      const cycle = odometerCycle(vehicle.lastOdometerUpdateAt ?? vehicle.createdAt, intervalDays, now);
      if (cycle) {
        jobs.push(
          makeJob(
            'odometer_update',
            vehicle.id,
            cycle.cycleKey,
            new Date(cycle.dueAt).toISOString(),
            'Update your vehicle odometer',
            `${label}: Last recorded ${formatKm(vehicle.currentOdometerKm)}. Tap to update.`
          )
        );
      }
    }
  }

  return jobs;
}

function makeJob(
  type: VehicleNotificationJob['type'],
  vehicleId: string,
  cycleKey: string,
  scheduledFor: string,
  title: string,
  message: string
): VehicleNotificationJob {
  return {
    id: `${type}::${vehicleId}::${cycleKey}`,
    vehicleId,
    type,
    title,
    message,
    scheduledFor,
    status: 'pending',
  };
}

/** Latest elapsed odometer reminder cycle, or null when not yet due. */
function odometerCycle(
  lastUpdateIso: string,
  intervalDays: number,
  now: Date
): { dueAt: number; cycleKey: string } | null {
  const base = Date.parse(lastUpdateIso);
  if (!Number.isFinite(base)) return null;
  const intervalMs = intervalDays * DAY_MS;
  const elapsed = now.getTime() - base;
  if (elapsed < intervalMs) return null;
  const cycles = Math.floor(elapsed / intervalMs);
  const dueAt = base + cycles * intervalMs;
  return { dueAt, cycleKey: toIsoDate(new Date(dueAt)) };
}

/** Vehicle notification jobs currently due that have not yet been recorded. */
export function collectDueVehicleNotifications(state: VehicleState, now: Date = new Date()): VehicleNotificationJob[] {
  const firedIds = new Set(state.notificationJobs.filter((job) => job.status === 'fired').map((job) => job.id));
  return candidateJobs({ state, now, nowIso: now.toISOString() }).filter((job) => !firedIds.has(job.id));
}

/**
 * Runs a full sweep: records every currently due job as fired and returns the
 * new jobs plus the updated state. Safe to call on every render — repeated calls
 * with no state change produce an empty `fired` list.
 */
export function runVehicleNotificationSweep(
  state: VehicleState,
  now: Date = new Date(),
  appNotificationsEnabled: boolean = true
): VehicleNotificationSweep {
  if (!appNotificationsEnabled || !state.notificationSettings.enabled) {
    return { state, fired: [], pending: [] };
  }

  const pending = collectDueVehicleNotifications(state, now);
  if (pending.length === 0) return { state, fired: [], pending: [] };

  const firedAt = now.toISOString();
  const fired = pending.map((job) => ({ ...job, status: 'fired' as const, firedAt }));

  // Preserve any non-fired history the caller may hold, then append the new jobs.
  const existing = state.notificationJobs.filter((job) => job.status !== 'pending');
  const notificationJobs = [...existing, ...fired].slice(-500);

  return {
    state: { ...state, notificationJobs },
    fired,
    pending,
  };
}

/** Converts fired vehicle jobs into MindMesh notification-history entries. */
export function toNotificationHistoryEntries(
  jobs: readonly VehicleNotificationJob[]
): {
  id: string;
  reminderId: string;
  reminderTitle: string;
  scheduledFor: string;
  firedAt: string;
  offsetMinutes: number;
  status: 'fired';
}[] {
  return jobs.map((job) => ({
    id: job.id,
    reminderId: `vehicle:${job.vehicleId}`,
    reminderTitle: job.title,
    scheduledFor: job.scheduledFor,
    firedAt: job.firedAt ?? new Date().toISOString(),
    offsetMinutes: 0,
    status: 'fired' as const,
  }));
}
