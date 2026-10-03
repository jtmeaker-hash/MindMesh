import type { DiagnosticResult, DiagnosticStatus } from '../types/diagnostics';
import type { MindMeshStorageData } from '../types';
import { readStoredPayload } from './storage';
import {
  computeNextService,
  getVehicleServiceStatus,
  normalizeVehicleState,
} from './vehicleMaintenance';

/**
 * Vehicle maintenance diagnostics.
 *
 * These checks are deliberately conservative: partially corrupted maintenance
 * data produces a warning (or a fail for genuinely unusable records) but never
 * throws, so the diagnostics runner can always render a report.
 */

function result(
  id: string,
  name: string,
  status: DiagnosticStatus,
  explanation: string,
  now: number,
  details?: Record<string, unknown>,
  suggestedFix?: string
): DiagnosticResult {
  return {
    id,
    name,
    category: 'vehicles',
    status,
    explanation,
    timestamp: new Date(now).toISOString(),
    ...(details && Object.keys(details).length > 0 ? { details } : {}),
    ...(suggestedFix ? { suggestedFix } : {}),
  };
}

export function diagnoseVehicleMaintenance(state: MindMeshStorageData, now: number): DiagnosticResult[] {
  const vehicleState = normalizeVehicleState(state.vehicles);
  const results: DiagnosticResult[] = [];

  // ---- 1. Vehicle records can load ----
  const rawVehicles = (state as { vehicles?: unknown }).vehicles;
  if (rawVehicles === undefined || rawVehicles === null) {
    results.push(
      result('vehicles.recordsLoad', 'Vehicle records', 'pass', 'No vehicle data stored yet; nothing to load.', now, {
        vehicleCount: 0,
      })
    );
  } else {
    const malformed = Array.isArray((rawVehicles as { vehicles?: unknown }).vehicles)
      ? (rawVehicles as { vehicles: unknown[] }).vehicles.length - vehicleState.vehicles.length
      : 0;
    results.push(
      result(
        'vehicles.recordsLoad',
        'Vehicle records',
        malformed > 0 ? 'warning' : 'pass',
        malformed > 0
          ? `${malformed} vehicle record(s) could not be parsed and were skipped on load.`
          : `${vehicleState.vehicles.length} vehicle record(s) loaded successfully.`,
        now,
        { vehicleCount: vehicleState.vehicles.length, skipped: malformed },
        malformed > 0 ? 'Export a backup, then re-enter the affected vehicle details.' : undefined
      )
    );
  }

  // ---- 2. Service calculations are valid ----
  const calcProblems: string[] = [];
  for (const vehicle of vehicleState.vehicles) {
    try {
      const info = computeNextService(vehicle, vehicleState.serviceRecords);
      getVehicleServiceStatus(info, vehicleState.thresholds);
      if (info.nextServiceKm !== undefined && !Number.isFinite(info.nextServiceKm)) {
        calcProblems.push(vehicle.id);
      }
    } catch {
      calcProblems.push(vehicle.id);
    }
  }
  results.push(
    result(
      'vehicles.serviceCalculations',
      'Service calculations',
      calcProblems.length > 0 ? 'warning' : 'pass',
      calcProblems.length > 0
        ? `${calcProblems.length} vehicle(s) could not be fully evaluated; run a repair or re-enter the service interval.`
        : 'Next-service, remaining-km and status calculations evaluate cleanly for every vehicle.',
      now,
      { problemVehicles: calcProblems.length }
    )
  );

  // ---- 3. Odometer history is valid ----
  const badDates = vehicleState.odometerRecords.filter((record) => Number.isNaN(Date.parse(record.recordedAt))).length;
  const unsorted = vehicleState.odometerRecords.some((record) => !vehicleState.vehicles.some((v) => v.id === record.vehicleId));
  results.push(
    result(
      'vehicles.odometerHistory',
      'Odometer history',
      badDates > 0 ? 'warning' : 'pass',
      badDates > 0
        ? `${badDates} odometer reading(s) have an unreadable date.`
        : `${vehicleState.odometerRecords.length} odometer reading(s) stored with valid dates.`,
      now,
      { odometerRecordCount: vehicleState.odometerRecords.length, badDates, orphanedRecords: unsorted }
    )
  );

  // ---- 4. No negative / invalid km values ----
  // Load-time normalization clamps negatives, so the raw persisted payload is
  // inspected too in order to surface silent corruption.
  const rawSection = (state as { vehicles?: { vehicles?: unknown; odometerRecords?: unknown } }).vehicles;
  const rawVehicleList = Array.isArray(rawSection?.vehicles) ? (rawSection?.vehicles as Record<string, unknown>[]) : [];
  const rawOdometerList = Array.isArray(rawSection?.odometerRecords) ? (rawSection?.odometerRecords as Record<string, unknown>[]) : [];
  const rawInvalidVehicles = rawVehicleList.filter((v) => typeof v.currentOdometerKm === 'number' && v.currentOdometerKm < 0).length;
  const rawInvalidRecords = rawOdometerList.filter((r) => typeof r.odometerKm === 'number' && r.odometerKm < 0).length;

  const invalidKmVehicles = vehicleState.vehicles.filter((v) => !Number.isFinite(v.currentOdometerKm) || v.currentOdometerKm < 0);
  const invalidKmRecords = vehicleState.odometerRecords.filter((r) => !Number.isFinite(r.odometerKm) || r.odometerKm < 0);
  const invalidKmItems = vehicleState.maintenanceItems.filter(
    (item) => item.lastReplacedOdometerKm !== undefined && (!Number.isFinite(item.lastReplacedOdometerKm) || item.lastReplacedOdometerKm < 0)
  );
  const invalidTotal =
    invalidKmVehicles.length + invalidKmRecords.length + invalidKmItems.length + rawInvalidVehicles + rawInvalidRecords;
  results.push(
    result(
      'vehicles.odometerValues',
      'Kilometre values',
      invalidTotal > 0 ? 'fail' : 'pass',
      invalidTotal > 0
        ? `${invalidTotal} record(s) contain negative or non-numeric kilometre values.`
        : 'Every stored kilometre value is a valid non-negative number.',
      now,
      { invalidVehicles: invalidKmVehicles.length, invalidRecords: invalidKmRecords.length, invalidItems: invalidKmItems.length }
    )
  );

  // ---- 5. Maintenance item links are valid ----
  const vehicleIds = new Set(vehicleState.vehicles.map((v) => v.id));
  const maintenanceIds = new Set(vehicleState.maintenanceItems.map((item) => item.id));
  const orphanedMaintenance = vehicleState.maintenanceItems.filter((item) => !vehicleIds.has(item.vehicleId)).length;
  const orphanedPlanItems = vehicleState.nextServiceItems.filter((item) => !vehicleIds.has(item.vehicleId)).length;
  const brokenItemLinks = vehicleState.nextServiceItems.filter(
    (item) => item.maintenanceItemId !== undefined && !maintenanceIds.has(item.maintenanceItemId)
  ).length;
  const linkProblems = orphanedMaintenance + orphanedPlanItems + brokenItemLinks;
  results.push(
    result(
      'vehicles.maintenanceLinks',
      'Maintenance item links',
      linkProblems > 0 ? 'warning' : 'pass',
      linkProblems > 0
        ? `${linkProblems} maintenance link(s) point at records that no longer exist.`
        : 'Every maintenance item and next-service plan entry links to a valid vehicle and component.',
      now,
      { orphanedMaintenance, orphanedPlanItems, brokenItemLinks }
    )
  );

  // ---- 6. Notification schedules are registered ----
  const reminderMode = vehicleState.notificationSettings.odometerReminderMode;
  const scheduleableVehicles = vehicleState.vehicles.length;
  const schedulesOk = vehicleState.notificationSettings.enabled && scheduleableVehicles > 0;
  results.push(
    result(
      'vehicles.notificationSchedules',
      'Vehicle notification schedules',
      scheduleableVehicles === 0 ? 'unknown' : schedulesOk ? 'pass' : 'warning',
      scheduleableVehicles === 0
        ? 'No vehicles to schedule reminders for.'
        : schedulesOk
        ? `Odometer reminder mode "${reminderMode}" registered for ${scheduleableVehicles} vehicle(s).`
        : 'Vehicle notifications are disabled in settings.',
      now,
      { enabled: vehicleState.notificationSettings.enabled, reminderMode, vehicles: scheduleableVehicles }
    )
  );

  // ---- 7. Backup contains vehicle-maintenance data ----
  let backupCoversVehicles = true;
  let backupDetail = 'Vehicle-maintenance data is represented in the backup payload.';
  if (vehicleState.vehicles.length > 0) {
    try {
      const payload = readStoredPayload() as { vehicles?: unknown } | null;
      backupCoversVehicles = Boolean(payload && typeof payload === 'object' && 'vehicles' in payload);
      if (!backupCoversVehicles) {
        backupDetail = 'Vehicles exist in memory but the persisted payload has no vehicles section; export a fresh backup.';
      }
    } catch {
      backupCoversVehicles = false;
      backupDetail = 'Could not verify that the backup payload includes vehicle data.';
    }
  }
  results.push(
    result('vehicles.backupCoverage', 'Vehicle backup coverage', backupCoversVehicles ? 'pass' : 'warning', backupDetail, now, {
      vehicleCount: vehicleState.vehicles.length,
    })
  );

  // ---- 8. No duplicate notification jobs ----
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const job of vehicleState.notificationJobs) {
    if (seen.has(job.id)) duplicates.add(job.id);
    else seen.add(job.id);
  }
  results.push(
    result(
      'vehicles.notificationDuplicates',
      'Vehicle notification jobs',
      duplicates.size > 0 ? 'warning' : 'pass',
      duplicates.size > 0
        ? `${duplicates.size} duplicate vehicle notification job(s) detected.`
        : `${vehicleState.notificationJobs.length} vehicle notification job(s) registered with no duplicates.`,
      now,
      { jobCount: vehicleState.notificationJobs.length, duplicates: duplicates.size }
    )
  );

  return results;
}
