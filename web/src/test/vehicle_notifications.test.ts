import { describe, it, expect, beforeEach } from 'vitest';
import { reconcileNotifications } from '../services/notifications';
import { buildDesiredVehicleNotifications } from '../services/vehicleNotifications';
import { DEFAULT_NOTIFICATION_SETTINGS, type AppNotificationSettings, type NotificationHistoryEntry } from '../types/notifications';
import {
  addVehicle,
  createDefaultVehicleState,
  createVehicle,
} from '../services/vehicleMaintenance';
import { createBackup, restoreBackup, serializeBackup, validateBackup } from '../services/backup';
import { loadAllData, saveAllData } from '../services/storage';

const DAY = 24 * 60 * 60 * 1000;

const settings: AppNotificationSettings = {
  ...DEFAULT_NOTIFICATION_SETTINGS,
  enabled: true,
  missedGraceMinutes: 60 * 24 * 30,
};

function vehicleState(overrides: Partial<Parameters<typeof createVehicle>[0]> = {}) {
  const vehicle = createVehicle({
    id: 'v1',
    nickname: 'Corolla',
    make: 'Toyota',
    model: 'Corolla',
    currentOdometerKm: 100000,
    serviceIntervalKm: 0,
    lastOdometerUpdateAt: new Date(Date.now() - 8 * DAY).toISOString(),
    ...overrides,
  });
  return addVehicle(createDefaultVehicleState(), vehicle);
}

function weeklyOdometerState(overrides: Partial<Parameters<typeof createVehicle>[0]> = {}) {
  const state = vehicleState(overrides);
  return {
    ...state,
    notificationSettings: { ...state.notificationSettings, odometerReminderMode: 'weekly' as const },
  };
}

describe('Vehicle notifications: shared engine integration', () => {
  it('schedules the recurring odometer reminder through the shared reconcile pipeline', () => {
    const state = weeklyOdometerState();
    const now = Date.now();
    const desired = buildDesiredVehicleNotifications(state, true, new Date(now));
    expect(desired.length).toBeGreaterThanOrEqual(2);

    const result = reconcileNotifications([], {
      reminders: [],
      settings,
      permission: 'granted',
      vehicleNotifications: desired,
      now,
    });

    // The elapsed cycle delivers now; the upcoming cycle is scheduled ahead so it
    // fires even if the app is closed when the native scheduler is available.
    expect(result.toDeliver.length).toBeGreaterThanOrEqual(1);
    expect(result.toSchedule.length).toBeGreaterThanOrEqual(1);
    expect(result.history.every((entry) => entry.id.startsWith('odometer_update::'))).toBe(true);
  });

  it('never duplicates a vehicle notification that has already fired', () => {
    const state = weeklyOdometerState();
    const now = Date.now();
    const desired = buildDesiredVehicleNotifications(state, true, new Date(now));
    const due = desired.find((job) => job.fireAt <= now)!;

    const fired: NotificationHistoryEntry = {
      id: due.id,
      reminderId: due.reminderId,
      reminderTitle: due.reminderTitle,
      scheduledFor: new Date(due.fireAt).toISOString(),
      offsetMinutes: 0,
      status: 'fired',
      firedAt: new Date(now).toISOString(),
    };

    const result = reconcileNotifications([fired], {
      reminders: [],
      settings,
      permission: 'granted',
      vehicleNotifications: desired,
      now,
    });

    expect(result.toDeliver.map((item) => item.id)).not.toContain(due.id);
    expect(result.toSchedule.map((item) => item.id)).not.toContain(due.id);
  });

  it('cancels vehicle schedules that are no longer desired', () => {
    const now = Date.now();
    const stale: NotificationHistoryEntry = {
      id: 'service_approaching::v1::stale',
      reminderId: 'vehicle:v1',
      reminderTitle: 'Corolla — Service approaching',
      scheduledFor: new Date(now + 60_000).toISOString(),
      offsetMinutes: 0,
      status: 'pending',
    };

    const result = reconcileNotifications([stale], {
      reminders: [],
      settings,
      permission: 'granted',
      vehicleNotifications: [],
      now,
    });

    expect(result.toCancel).toContain(stale.id);
  });

  it('replaces a service schedule when the service state changes', () => {
    const disabledOdometer = { ...createDefaultVehicleState().notificationSettings, odometerReminderMode: 'disabled' as const };
    const approaching = {
      ...vehicleState({ currentOdometerKm: 129300, serviceIntervalKm: 10000, lastServiceKm: 120300 }),
      notificationSettings: disabledOdometer,
    };
    const now = Date.now();
    const approachJob = buildDesiredVehicleNotifications(approaching, true, new Date(now)).find(
      (job) => job.type === 'service_approaching'
    );
    expect(approachJob).toBeDefined();

    const overdue = {
      ...approaching,
      vehicles: approaching.vehicles.map((vehicle) => ({ ...vehicle, currentOdometerKm: 131000 })),
    };
    const overdueDesired = buildDesiredVehicleNotifications(overdue, true, new Date(now));
    expect(overdueDesired.some((job) => job.type === 'service_overdue')).toBe(true);

    const pending: NotificationHistoryEntry = {
      id: approachJob!.id,
      reminderId: approachJob!.reminderId,
      reminderTitle: approachJob!.reminderTitle,
      scheduledFor: new Date(now + 60_000).toISOString(),
      offsetMinutes: 0,
      status: 'pending',
    };

    const result = reconcileNotifications([pending], {
      reminders: [],
      settings,
      permission: 'granted',
      vehicleNotifications: overdueDesired,
      now,
    });
    expect(result.toCancel).toContain(approachJob!.id);
  });

  it('produces nothing when the global notification master switch is off', () => {
    const state = weeklyOdometerState();
    expect(buildDesiredVehicleNotifications(state, false, new Date())).toHaveLength(0);

    const result = reconcileNotifications([], {
      reminders: [],
      settings: { ...settings, enabled: false },
      permission: 'granted',
      vehicleNotifications: [],
      now: Date.now(),
    });
    expect(result.history).toHaveLength(0);
    expect(result.toSchedule).toHaveLength(0);
  });
});

describe('Vehicle notifications: restored backup data', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('re-reconciles schedules from a restored backup', () => {
    const base = loadAllData();
    let restoredState = addVehicle(
      createDefaultVehicleState(),
      createVehicle({
        id: 'v-restore',
        nickname: 'Ute',
        make: 'Ford',
        model: 'Ranger',
        currentOdometerKm: 50000,
        serviceIntervalKm: 0,
        lastOdometerUpdateAt: new Date(Date.now() - 9 * DAY).toISOString(),
      })
    );
    restoredState = {
      ...restoredState,
      notificationSettings: { ...restoredState.notificationSettings, odometerReminderMode: 'weekly' },
    };
    saveAllData({ ...base, vehicles: restoredState });

    const json = serializeBackup(createBackup());
    const validation = validateBackup(json);
    expect(validation.valid).toBe(true);
    expect(restoreBackup(validation.backupFile!).success).toBe(true);

    const after = loadAllData().vehicles!;
    const now = Date.now();
    const desired = buildDesiredVehicleNotifications(after, true, new Date(now));
    expect(desired.some((job) => job.type === 'odometer_update')).toBe(true);

    const result = reconcileNotifications([], {
      reminders: [],
      settings,
      permission: 'granted',
      vehicleNotifications: desired,
      now,
    });
    expect(result.toSchedule.length + result.toDeliver.length).toBeGreaterThan(0);
  });
});
