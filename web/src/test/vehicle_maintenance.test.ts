import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_VEHICLE_THRESHOLDS,
  type KnownVehicleIssue,
  type NextServiceItem,
  type ServiceRecord,
  type VehicleState,
} from '../types/vehicle';
import {
  addVehicle,
  applyServiceCompletion,
  averageKmPerWeek,
  computeMaintenanceItemStatus,
  computeNextService,
  createDefaultVehicleState,
  createVehicle,
  getVehicleServiceStatus,
  nextServiceCostSummary,
  normalizeVehicleState,
  promoteKnownIssueToNextService,
  recordOdometer,
} from '../services/vehicleMaintenance';
import { buildDesiredVehicleNotifications } from '../services/vehicleNotifications';
import { diagnoseVehicleMaintenance } from '../services/vehicleDiagnostics';
import {
  createBackup,
  restoreBackup,
  serializeBackup,
  validateBackup,
} from '../services/backup';
import { loadAllData, saveAllData } from '../services/storage';

const ISO = '2026-09-14T09:00:00.000Z';

function seedVehicle(state: VehicleState, overrides: Partial<Parameters<typeof createVehicle>[0]> = {}) {
  const vehicle = createVehicle({
    id: 'v1',
    nickname: 'Corolla',
    make: 'Toyota',
    model: 'Corolla',
    year: 2018,
    currentOdometerKm: 126420,
    serviceIntervalKm: 10000,
    serviceIntervalMonths: 12,
    lastServiceKm: 120300,
    lastServiceDate: '2026-09-14',
    lastOdometerUpdateAt: ISO,
    ...overrides,
  });
  return addVehicle(state, vehicle);
}

describe('Vehicle maintenance: next service calculation', () => {
  it('calculates next service and remaining km from the last service + interval', () => {
    const state = seedVehicle(createDefaultVehicleState());
    const vehicle = state.vehicles[0];
    const info = computeNextService(vehicle, state.serviceRecords);
    expect(info.lastServiceKm).toBe(120300);
    expect(info.nextServiceKm).toBe(130300);
    expect(info.kmRemaining).toBe(3880);
    expect(info.nextServiceDate).toBe('2027-09-14');
  });

  it('updates remaining km after an odometer reading without overwriting history', () => {
    let state = seedVehicle(createDefaultVehicleState());
    const before = state.odometerRecords.length;
    state = recordOdometer(state, 'v1', 129000, '2026-10-01T00:00:00.000Z');
    expect(state.odometerRecords.length).toBe(before + 1);
    expect(state.vehicles[0].currentOdometerKm).toBe(129000);
    const info = computeNextService(state.vehicles[0], state.serviceRecords);
    expect(info.kmRemaining).toBe(1300);
  });

  it('reports the correct status thresholds', () => {
    const base = createVehicle({ currentOdometerKm: 0, serviceIntervalKm: 10000, lastServiceKm: 0 });
    const at = (remaining: number) => {
      const vehicle = { ...base, currentOdometerKm: 10000 - remaining };
      return getVehicleServiceStatus(computeNextService(vehicle, []), DEFAULT_VEHICLE_THRESHOLDS).status;
    };
    expect(at(3000)).toBe('ok');
    expect(at(1500)).toBe('approaching');
    expect(at(300)).toBe('urgent');
    expect(at(0)).toBe('due');
    expect(at(-740)).toBe('overdue');
  });
});

describe('Vehicle maintenance: serviceable item calculations', () => {
  it('calculates the next replacement from last replacement + interval', () => {
    const state = seedVehicle(createDefaultVehicleState());
    const oil = state.maintenanceItems.find((i) => i.vehicleId === 'v1' && i.name === 'Engine oil')!;
    oil.lastReplacedOdometerKm = 92000;
    oil.replacementIntervalKm = 60000;
    const status = computeMaintenanceItemStatus(oil, 126420, DEFAULT_VEHICLE_THRESHOLDS);
    expect(status.nextReplacementKm).toBe(152000);
    expect(status.remainingKm).toBe(25580);
  });

  it('never treats unknown costs as zero', () => {
    const items: NextServiceItem[] = [
      { id: 'a', vehicleId: 'v1', title: 'Oil', requirement: 'required', estimatedTotalCost: 75, priority: 'medium', source: 'scheduled', createdAt: ISO, updatedAt: ISO },
      { id: 'b', vehicleId: 'v1', title: 'Mystery', requirement: 'required', priority: 'medium', source: 'recommended', createdAt: ISO, updatedAt: ISO },
    ];
    const summary = nextServiceCostSummary(items);
    expect(summary.total).toBe(75);
    expect(summary.unknownCount).toBe(1);
    expect(summary.hasUnknowns).toBe(true);
    expect(summary.display).toContain('no estimate');
  });
});

describe('Vehicle maintenance: odometer driving rate', () => {
  it('averages km per week from odometer history', () => {
    let state = seedVehicle(createDefaultVehicleState());
    state = recordOdometer(state, 'v1', 125000, '2026-09-01T00:00:00.000Z');
    state = recordOdometer(state, 'v1', 128000, '2026-09-15T00:00:00.000Z');
    const rate = averageKmPerWeek(state.odometerRecords.filter((r) => r.vehicleId === 'v1'));
    expect(rate).toBeCloseTo(1500, 0);
  });
});

describe('Vehicle maintenance: service completion', () => {
  it('updates replaced components, completes plan items and resolves promoted issues', () => {
    let state = seedVehicle(createDefaultVehicleState(), { currentOdometerKm: 120000 });
    const oil = state.maintenanceItems.find((i) => i.vehicleId === 'v1' && i.name === 'Engine oil')!;

    const issue: KnownVehicleIssue = {
      id: 'issue-1',
      vehicleId: 'v1',
      title: 'Oil leak',
      severity: 'medium',
      priority: 'high',
      status: 'needs_inspection',
      createdAt: ISO,
      updatedAt: ISO,
    };
    state = { ...state, knownIssues: [issue] };
    state = promoteKnownIssueToNextService(state, 'issue-1');
    const promoted = state.nextServiceItems.find((i) => i.knownIssueId === 'issue-1')!;

    const record: ServiceRecord = {
      id: 'svc-1',
      vehicleId: 'v1',
      date: '2026-10-01',
      odometerKm: 126420,
      serviceTypeId: 'svc-standard',
      items: [
        { id: 'si-1', serviceRecordId: 'svc-1', maintenanceItemId: oil.id, name: 'Engine oil', action: 'replaced', partsCost: 50, labourCost: 25 },
        { id: 'si-2', serviceRecordId: 'svc-1', name: 'Oil leak', action: 'repaired', cost: 120 },
      ],
      inspectedItems: [],
      replacedItems: ['Engine oil'],
      repairedItems: ['Oil leak'],
      recommendedWork: [],
      createdAt: ISO,
      updatedAt: ISO,
    };

    const result = applyServiceCompletion(state, record);
    const updatedOil = result.state.maintenanceItems.find((i) => i.id === oil.id)!;
    expect(updatedOil.lastReplacedOdometerKm).toBe(126420);
    expect(updatedOil.lastReplacedDate).toBe('2026-10-01');
    expect(result.completedNextServiceItemIds).toContain(promoted.id);
    expect(result.resolvedIssueIds).toContain('issue-1');
    expect(result.state.knownIssues[0].status).toBe('repaired');
    expect(result.state.vehicles[0].currentOdometerKm).toBe(126420);

    // History is preserved, not overwritten.
    expect(result.state.serviceRecords).toHaveLength(1);
  });

  it('does not complete a newly-created plan item from unrelated historical work', () => {
    let state = seedVehicle(createDefaultVehicleState(), { currentOdometerKm: 100000 });

    // 1. A historical service replaced Engine oil (before the plan item existed).
    const historical: ServiceRecord = {
      id: 'svc-old',
      vehicleId: 'v1',
      date: '2026-01-01',
      odometerKm: 90000,
      serviceTypeId: 'svc-minor',
      items: [{ id: 'old-1', serviceRecordId: 'svc-old', name: 'Engine oil', action: 'replaced' }],
      inspectedItems: [],
      replacedItems: ['Engine oil'],
      repairedItems: [],
      recommendedWork: [],
      createdAt: ISO,
      updatedAt: ISO,
    };
    state = applyServiceCompletion(state, historical).state;

    // 2. The user later creates a new Engine-oil next-service plan item.
    const planItem: NextServiceItem = {
      id: 'nsi-oil',
      vehicleId: 'v1',
      title: 'Engine oil',
      requirement: 'required',
      priority: 'medium',
      source: 'user',
      completed: false,
      createdAt: ISO,
      updatedAt: ISO,
    };
    state = { ...state, nextServiceItems: [planItem] };

    // 3. A brake-only service is saved today.
    const brakeOnly: ServiceRecord = {
      id: 'svc-brakes',
      vehicleId: 'v1',
      date: '2026-02-01',
      odometerKm: 101000,
      serviceTypeId: 'svc-brakes',
      items: [{ id: 'b-1', serviceRecordId: 'svc-brakes', name: 'Front brake pads', action: 'replaced' }],
      inspectedItems: [],
      replacedItems: ['Front brake pads'],
      repairedItems: [],
      recommendedWork: [],
      createdAt: ISO,
      updatedAt: ISO,
    };
    const result = applyServiceCompletion(state, brakeOnly);

    // Historical oil work must NOT complete the new Engine-oil plan item.
    expect(result.state.nextServiceItems.find((i) => i.id === 'nsi-oil')!.completed).toBeFalsy();
    expect(result.completedNextServiceItemIds).not.toContain('nsi-oil');

    // A service that actually replaces Engine oil does complete it.
    const oilService: ServiceRecord = {
      ...brakeOnly,
      id: 'svc-oil',
      date: '2026-03-01',
      odometerKm: 102000,
      items: [{ id: 'o-1', serviceRecordId: 'svc-oil', name: 'Engine oil', action: 'replaced' }],
      replacedItems: ['Engine oil'],
    };
    const completed = applyServiceCompletion(result.state, oilService);
    expect(completed.completedNextServiceItemIds).toContain('nsi-oil');

    // Editing the historical service again stays deterministic and does not complete
    // later plan items.
    const edited = applyServiceCompletion(completed.state, { ...historical, notes: 'Corrected odometer' });
    expect(edited.completedNextServiceItemIds).not.toContain('nsi-oil');
  });

  it('only resolves a promoted known issue when the current service performs the linked repair', () => {
    let state = seedVehicle(createDefaultVehicleState(), { currentOdometerKm: 100000 });

    const historical: ServiceRecord = {
      id: 'svc-hist',
      vehicleId: 'v1',
      date: '2026-01-01',
      odometerKm: 90000,
      serviceTypeId: 'svc-repair',
      items: [{ id: 'h-1', serviceRecordId: 'svc-hist', name: 'Brake squeal', action: 'repaired' }],
      inspectedItems: [],
      replacedItems: [],
      repairedItems: ['Brake squeal'],
      recommendedWork: [],
      createdAt: ISO,
      updatedAt: ISO,
    };
    state = applyServiceCompletion(state, historical).state;

    const issue: KnownVehicleIssue = {
      id: 'issue-brake',
      vehicleId: 'v1',
      title: 'Brake squeal',
      severity: 'medium',
      priority: 'high',
      status: 'needs_inspection',
      createdAt: ISO,
      updatedAt: ISO,
    };
    state = { ...state, knownIssues: [issue] };
    state = promoteKnownIssueToNextService(state, 'issue-brake');
    const promoted = state.nextServiceItems.find((i) => i.knownIssueId === 'issue-brake')!;

    // An unrelated (oil-only) service must not resolve the promoted issue.
    const oilOnly: ServiceRecord = {
      id: 'svc-oil',
      vehicleId: 'v1',
      date: '2026-02-01',
      odometerKm: 101000,
      serviceTypeId: 'svc-minor',
      items: [{ id: 'o-1', serviceRecordId: 'svc-oil', name: 'Engine oil', action: 'replaced' }],
      inspectedItems: [],
      replacedItems: ['Engine oil'],
      repairedItems: [],
      recommendedWork: [],
      createdAt: ISO,
      updatedAt: ISO,
    };
    const unrelated = applyServiceCompletion(state, oilOnly);
    expect(unrelated.resolvedIssueIds).not.toContain('issue-brake');
    expect(unrelated.state.knownIssues.find((i) => i.id === 'issue-brake')!.status).toBe('needs_inspection');
    expect(unrelated.state.nextServiceItems.find((i) => i.id === promoted.id)!.completed).toBeFalsy();

    // A service that actually performs the linked repair resolves it.
    const repair: ServiceRecord = {
      ...oilOnly,
      id: 'svc-brake',
      date: '2026-03-01',
      odometerKm: 102000,
      items: [{ id: 'r-1', serviceRecordId: 'svc-brake', name: 'Brake squeal', action: 'repaired' }],
      replacedItems: [],
      repairedItems: ['Brake squeal'],
    };
    const resolved = applyServiceCompletion(unrelated.state, repair);
    expect(resolved.resolvedIssueIds).toContain('issue-brake');
    expect(resolved.state.knownIssues.find((i) => i.id === 'issue-brake')!.status).toBe('repaired');
  });
});

describe('Vehicle notifications: recurring & de-duplicated', () => {
  const DAY = 24 * 60 * 60 * 1000;

  it('produces a due weekly odometer cycle plus the next cycle, without duplicates', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * DAY).toISOString();
    let state = seedVehicle(createDefaultVehicleState(), { lastOdometerUpdateAt: eightDaysAgo });
    state = { ...state, notificationSettings: { ...state.notificationSettings, odometerReminderMode: 'weekly' } };

    const now = new Date();
    const first = buildDesiredVehicleNotifications(state, true, now).filter((job) => job.type === 'odometer_update');
    expect(first).toHaveLength(2); // the elapsed cycle + the upcoming cycle
    expect(new Set(first.map((job) => job.id)).size).toBe(2);

    // Re-running with the same state and time yields identical ids — never duplicated.
    const second = buildDesiredVehicleNotifications(state, true, now).filter((job) => job.type === 'odometer_update');
    expect(second.map((job) => job.id).sort()).toEqual(first.map((job) => job.id).sort());

    // A full interval later the upcoming cycle has become the due cycle (its id is
    // stable) and a brand new upcoming cycle appears — recurring with no manual reset.
    const later = new Date(now.getTime() + 8 * DAY);
    const third = buildDesiredVehicleNotifications(state, true, later).filter((job) => job.type === 'odometer_update');
    expect(third).toHaveLength(2);
    expect(third.some((job) => job.id === first[1].id)).toBe(true);
    expect(third.some((job) => job.id !== first[1].id)).toBe(true);
  });

  it('keeps one service notification per status point and changes it when the service state changes', () => {
    const state = seedVehicle(createDefaultVehicleState(), { currentOdometerKm: 128800, serviceIntervalKm: 10000, lastServiceKm: 120300 });
    const now = new Date();
    const approach = buildDesiredVehicleNotifications(state, true, now).find((job) => job.type === 'service_approaching');
    expect(approach).toBeDefined();

    // Same condition → same deterministic id (the engine de-duplicates on it).
    const again = buildDesiredVehicleNotifications(state, true, now).find((job) => job.type === 'service_approaching');
    expect(again?.id).toBe(approach?.id);

    // The odometer advances into the overdue band → a different notification id, so
    // the engine cancels the stale approaching schedule automatically.
    const advanced = { ...state, vehicles: state.vehicles.map((v) => ({ ...v, currentOdometerKm: 131000 })) };
    const after = buildDesiredVehicleNotifications(advanced, true, now);
    expect(after.some((job) => job.type === 'service_approaching')).toBe(false);
    expect(after.some((job) => job.type === 'service_overdue')).toBe(true);
  });

  it('produces no vehicle notifications when either master switch is off', () => {
    const eightDaysAgo = new Date(Date.now() - 8 * DAY).toISOString();
    const state = {
      ...seedVehicle(createDefaultVehicleState(), { lastOdometerUpdateAt: eightDaysAgo }),
      notificationSettings: {
        ...createDefaultVehicleState().notificationSettings,
        odometerReminderMode: 'weekly' as const,
      },
    };

    // Global app master switch off.
    expect(buildDesiredVehicleNotifications(state, false, new Date())).toHaveLength(0);
    // Vehicle-specific master switch off.
    const vehicleDisabled = { ...state, notificationSettings: { ...state.notificationSettings, enabled: false } };
    expect(buildDesiredVehicleNotifications(vehicleDisabled, true, new Date())).toHaveLength(0);
  });
});

describe('Vehicle maintenance: normalization', () => {
  it('repairs hostile / partial data without throwing and drops invalid records', () => {
    const normalized = normalizeVehicleState({
      vehicles: [{ id: 'v1', make: 'Honda' }, { nope: true }],
      maintenanceItems: [{ id: 'm1', vehicleId: 'v1', name: 'Oil', replacementIntervalKm: -5 }],
      thresholds: { approachingKm: 1500 },
    });
    expect(normalized.vehicles).toHaveLength(1);
    expect(normalized.maintenanceItems).toHaveLength(1);
    expect(normalized.maintenanceItems[0].replacementIntervalKm).toBe(0);
    expect(normalized.thresholds.approachingKm).toBe(1500);
    expect(normalized.thresholds.urgentKm).toBe(DEFAULT_VEHICLE_THRESHOLDS.urgentKm);
  });
});

describe('Vehicle maintenance: backup round trip', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('includes vehicles in the backup and restores full history', () => {
    const base = loadAllData();
    const state = seedVehicle(createDefaultVehicleState(), { currentOdometerKm: 126420 });
    saveAllData({ ...base, vehicles: state });

    const json = serializeBackup(createBackup());
    const validation = validateBackup(json);
    expect(validation.valid).toBe(true);
    expect(validation.summary?.vehicleCount).toBe(1);
    expect(validation.summary?.maintenanceItemCount).toBeGreaterThan(10);

    localStorage.clear();
    const restored = restoreBackup(validation.backupFile!);
    expect(restored.success).toBe(true);

    const after = loadAllData();
    expect(after.vehicles?.vehicles).toHaveLength(1);
    expect(after.vehicles?.vehicles[0].currentOdometerKm).toBe(126420);
    expect(after.vehicles?.maintenanceItems.some((i) => i.name === 'Engine oil')).toBe(true);
  });

  it('keeps older (vehicle-less) backups compatible', () => {
    const base = loadAllData();
    saveAllData({ ...base, vehicles: createDefaultVehicleState() });
    const backup = createBackup();
    // Simulate a pre-vehicle backup by deleting the section.
    const legacy = { ...backup, data: { ...backup.data } as Record<string, unknown> };
    delete (legacy.data as Record<string, unknown>).vehicles;

    const validation = validateBackup(JSON.stringify(legacy));
    expect(validation.valid).toBe(true);
    const restored = restoreBackup(validation.backupFile!);
    expect(restored.success).toBe(true);
    expect(loadAllData().vehicles).toBeDefined();
  });
});

describe('Vehicle maintenance: diagnostics', () => {
  it('reports vehicle checks and warns without crashing on partial data', () => {
    const state = seedVehicle(createDefaultVehicleState());
    const results = diagnoseVehicleMaintenance({ ...loadAllData(), vehicles: state } as never, Date.now());
    const ids = results.map((r) => r.id);
    expect(ids).toContain('vehicles.recordsLoad');
    expect(ids).toContain('vehicles.serviceCalculations');
    expect(ids).toContain('vehicles.odometerValues');
    expect(ids).toContain('vehicles.notificationDuplicates');

    const broken = diagnoseVehicleMaintenance(
      { ...loadAllData(), vehicles: { ...createDefaultVehicleState(), vehicles: [{ id: 'x', vehicleId: 'x', currentOdometerKm: -5 }] as never } } as never,
      Date.now()
    );
    expect(broken.some((r) => r.status === 'fail')).toBe(true);
    expect(broken).toHaveLength(results.length);
  });
});
