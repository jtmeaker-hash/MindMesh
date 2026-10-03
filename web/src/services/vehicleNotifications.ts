import type { Vehicle, VehicleState } from '../types/vehicle';
import {
  computeMaintenanceItemStatus,
  computeNextService,
  formatKm,
  getVehicleServiceStatus,
  isIssueOpen,
} from './vehicleMaintenance';

/**
 * Vehicle reminders, expressed as *desired notifications* for the shared
 * MindMesh notification engine (`services/notifications.ts`).
 *
 * This module deliberately owns no scheduling, no history and no timers of its
 * own. It only answers one pure question: "given the current vehicle state and
 * the current time, which vehicle notifications should exist right now?" The
 * generic engine then reconciles that answer against the platform's native
 * scheduler, so vehicle reminders survive the app being closed exactly like
 * ordinary reminder notifications, are cancelled when they stop being desired,
 * and never duplicate.
 *
 * Every job is derived from the current state plus a stable cycle key. Re-running
 * the builder can therefore never duplicate a notification, never re-fire one, and
 * never leave a repeating reminder permanently "overdue": once a cycle is done the
 * next cycle is a brand new id and appears automatically as time passes.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

export type VehicleNotificationType =
  | 'odometer_update'
  | 'service_approaching'
  | 'service_due'
  | 'service_overdue'
  | 'maintenance_approaching'
  | 'maintenance_due'
  | 'time_based'
  | 'known_issue';

/** A vehicle reminder the shared notification engine should schedule. */
export interface DesiredVehicleNotification {
  /** Deterministic id: `<type>::<vehicleId>::<cycleKey>`. */
  id: string;
  vehicleId: string;
  type: VehicleNotificationType;
  /** Notification title shown by the OS / browser. */
  title: string;
  /** Notification body shown by the OS / browser. */
  body: string;
  /** Epoch milliseconds the notification targets. */
  fireAt: number;
  /** Stable key for one cycle of this notification. */
  cycleKey: string;
  /** Reminder namespace used to group vehicle entries in notification history. */
  reminderId: string;
  /** Short title recorded in notification history. */
  reminderTitle: string;
}

function vehicleLabel(vehicle: Vehicle): string {
  const nickname = vehicle.nickname?.trim();
  if (nickname) return nickname;
  const makeModel = [vehicle.make, vehicle.model].filter(Boolean).join(' ').trim();
  return makeModel || 'Vehicle';
}

function make(
  type: VehicleNotificationType,
  vehicleId: string,
  cycleKey: string,
  title: string,
  body: string,
  fireAt: number
): DesiredVehicleNotification {
  return {
    id: `${type}::${vehicleId}::${cycleKey}`,
    vehicleId,
    type,
    title,
    body,
    fireAt,
    cycleKey,
    reminderId: `vehicle:${vehicleId}`,
    reminderTitle: title,
  };
}

/**
 * Recurring odometer reminder.
 *
 * Produces the current due cycle (if one has elapsed) plus the upcoming cycle,
 * so a native scheduler can deliver the reminder with the app closed and the
 * cycle keeps rolling forward without any manual reset. When the user records a
 * new reading the base timestamp changes, every derived id changes, and the
 * engine cancels the now-obsolete schedules automatically.
 */
function odometerNotifications(
  vehicle: Vehicle,
  intervalDays: number,
  now: Date
): DesiredVehicleNotification[] {
  const intervalMs = intervalDays * DAY_MS;
  const base = Date.parse(vehicle.lastOdometerUpdateAt ?? vehicle.createdAt);
  if (!Number.isFinite(base) || intervalMs <= 0) return [];

  const elapsed = now.getTime() - base;
  const completed = Math.max(0, Math.floor(elapsed / intervalMs));
  const label = vehicleLabel(vehicle);
  const body = `${label}: last recorded ${formatKm(vehicle.currentOdometerKm)}. Tap to update the odometer.`;
  const title = 'Update your vehicle odometer';

  const jobs: DesiredVehicleNotification[] = [];
  const cycleKeyFor = (cycle: number) => `${base}-${cycle}`;

  // The cycle that is due now (only once at least one full interval has elapsed).
  if (completed >= 1) {
    const fireAt = base + completed * intervalMs;
    jobs.push(make('odometer_update', vehicle.id, cycleKeyFor(completed), title, body, fireAt));
  }
  // The upcoming cycle, scheduled ahead so the recurrence is automatic.
  const nextFireAt = base + (completed + 1) * intervalMs;
  jobs.push(make('odometer_update', vehicle.id, cycleKeyFor(completed + 1), title, body, nextFireAt));

  return jobs;
}

/**
 * Builds every vehicle notification that should currently exist. Pure: the same
 * state + time always produces the same list, which is what makes the engine's
 * reconciliation deduplicate and cancel correctly.
 */
export function buildDesiredVehicleNotifications(
  state: VehicleState,
  appNotificationsEnabled: boolean = true,
  now: Date = new Date()
): DesiredVehicleNotification[] {
  if (!appNotificationsEnabled || !state.notificationSettings.enabled) return [];

  const settings = state.notificationSettings;
  const nowMs = now.getTime();
  const jobs: DesiredVehicleNotification[] = [];

  for (const vehicle of state.vehicles) {
    const label = vehicleLabel(vehicle);

    // --- Service status (a single notification for the most severe stage) ---
    const info = computeNextService(vehicle, state.serviceRecords);
    const status = getVehicleServiceStatus(info, state.thresholds);
    const servicePoint = `${status.status}:${info.nextServiceKm ?? 'd'}:${info.nextServiceDate ?? 'n'}`;
    if (status.status === 'overdue' && settings.serviceOverdue) {
      jobs.push(make('service_overdue', vehicle.id, servicePoint, `${label} — Service overdue`, status.message, nowMs));
    } else if (status.status === 'due' && settings.serviceDue) {
      jobs.push(make('service_due', vehicle.id, servicePoint, `${label} — Service due`, status.message, nowMs));
    } else if ((status.status === 'approaching' || status.status === 'urgent') && settings.serviceApproaching) {
      jobs.push(make('service_approaching', vehicle.id, servicePoint, `${label} — Service approaching`, status.message, nowMs));
    }

    // --- Tracked serviceable items ---
    for (const item of state.maintenanceItems) {
      if (item.vehicleId !== vehicle.id) continue;
      const itemStatus = computeMaintenanceItemStatus(item, vehicle.currentOdometerKm, state.thresholds, now);
      const point = `${item.id}:${itemStatus.nextReplacementKm ?? 'd'}:${itemStatus.nextReplacementDate ?? 'n'}`;
      const timeBinding =
        itemStatus.nextReplacementDate !== undefined &&
        itemStatus.daysRemaining !== undefined &&
        itemStatus.daysRemaining <= 0 &&
        (itemStatus.nextReplacementKm === undefined || (itemStatus.remainingKm ?? 1) > 0);

      if (itemStatus.status === 'overdue' || itemStatus.status === 'due') {
        if (timeBinding && settings.timeBasedMaintenance) {
          jobs.push(make('time_based', vehicle.id, point, `${label} — ${item.name} due`, itemStatus.message, nowMs));
        } else if (settings.maintenanceDue) {
          jobs.push(make('maintenance_due', vehicle.id, point, `${label} — ${item.name} due`, itemStatus.message, nowMs));
        }
      } else if ((itemStatus.status === 'approaching' || itemStatus.status === 'urgent') && settings.maintenanceApproaching) {
        jobs.push(make('maintenance_approaching', vehicle.id, point, `${label} — ${item.name} due soon`, itemStatus.message, nowMs));
      }
    }

    // --- Known issue follow-ups ---
    if (settings.knownIssueFollowUp) {
      for (const issue of state.knownIssues) {
        if (issue.vehicleId !== vehicle.id || !isIssueOpen(issue)) continue;
        if (issue.status === 'monitoring') continue;
        jobs.push(
          make(
            'known_issue',
            vehicle.id,
            `${issue.id}:${issue.status}`,
            `${label} — ${issue.title}`,
            `Known issue is currently "${issue.status.replace(/_/g, ' ')}".`,
            nowMs
          )
        );
      }
    }

    // --- Recurring odometer reminder ---
    if (settings.odometerReminderMode !== 'disabled') {
      const intervalDays =
        settings.odometerReminderMode === 'weekly' ? 7 : Math.max(1, settings.odometerReminderIntervalDays);
      jobs.push(...odometerNotifications(vehicle, intervalDays, now));
    }
  }

  return jobs;
}
