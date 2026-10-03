import { beforeEach, describe, expect, it } from 'vitest';
import { PluginManager } from '../plugins/core/manager';
import { createEmptyRegistryState, type MindMeshHostAPI, type PluginContext } from '../plugins/core/types';
import { registerBuiltinPlugins } from '../plugins/registerBuiltins';
import {
  MONEY_MANAGEMENT_PLUGIN_ID,
  createMoneyManagementPlugin,
} from '../plugins/money-management';
import { MONEY_LEGACY_HYDRATION_ID } from '../plugins/money-management/migrations';
import { CAR_MAINTENANCE_PLUGIN_ID } from '../plugins/car-maintenance';
import { CAR_LEGACY_HYDRATION_ID } from '../plugins/car-maintenance/migrations';
import type { MoneyState } from '../types/finance';
import type { VehicleState } from '../types/vehicle';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import {
  addVehicle,
  createDefaultVehicleState,
  createVehicle,
  recordOdometer,
} from '../services/vehicleMaintenance';
import {
  getDefaultState,
  loadMoneyState,
  loadVehicleState,
  saveAllData,
  saveMoneyState,
  saveVehicleState,
} from '../services/storage';
import { createBackup, restoreBackup } from '../services/backup';

const ISO = '2026-06-01T09:00:00.000Z';

/** A realistic, fully populated Money state — not a default/empty fixture. */
function populatedMoneyState(): MoneyState {
  const base = getDefaultMoneyState();
  return {
    ...base,
    incomeConfig: {
      id: 'inc-1',
      title: 'Primary Job',
      employmentType: 'casual_hourly',
      frequency: 'fortnightly',
      averagePay: 1800,
      nextPayDate: '2026-07-03',
      employerName: 'Acme',
      createdAt: '2026-01-01',
      updatedAt: '2026-01-01',
    },
    directDebits: [
      {
        id: 'dd-1',
        title: 'Internet',
        amount: 80,
        categoryId: 'bill-internet',
        frequency: 'monthly',
        nextPaymentDate: '2026-07-05',
        dueByDate: '2026-07-10',
        active: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
      {
        id: 'dd-2',
        title: 'Rent',
        amount: 450,
        categoryId: 'bill-rent',
        frequency: 'fortnightly',
        nextPaymentDate: '2026-07-01',
        active: true,
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ],
    extraIncomeList: [
      {
        id: 'ei-1',
        title: 'Cash job',
        amount: 120,
        date: '2026-06-20',
        categoryId: 'extra-cash',
        sourceType: 'cash_job',
        createdAt: '2026-06-20T00:00:00.000Z',
      },
    ],
    tipEntries: [
      {
        id: 'tip-1',
        amount: 45,
        date: '2026-06-21',
        shiftType: 'evening',
        venue: 'Bistro',
        createdAt: '2026-06-21T00:00:00.000Z',
      },
    ],
    shifts: [
      {
        id: 'sh-1',
        date: '2026-06-21',
        startTime: '17:00',
        endTime: '23:00',
        breakMinutes: 30,
        rateType: 'base',
        hourlyRate: 35,
        paidHours: 5.5,
        estimatedPay: 192.5,
        createdAt: '2026-06-21T00:00:00.000Z',
      },
    ],
    expenses: [
      {
        id: 'ex-1',
        title: 'Fuel',
        amount: 70,
        date: '2026-06-22',
        categoryId: 'exp-fuel',
        merchant: 'BP',
        paymentMethod: 'card',
        createdAt: '2026-06-22T00:00:00.000Z',
        updatedAt: '2026-06-22T00:00:00.000Z',
      },
      {
        id: 'ex-2',
        title: 'Groceries',
        amount: 150,
        categoryId: 'exp-food',
        repeat: 'per_pay_cycle',
        estimated: true,
        createdAt: '2026-06-22T00:00:00.000Z',
        updatedAt: '2026-06-22T00:00:00.000Z',
      },
    ],
    payCycleOverrides: { '2026-07-03': 1950 },
  };
}

/** A realistic, fully populated Car state built through the real service helpers. */
function populatedVehicleState(): VehicleState {
  let state = createDefaultVehicleState();
  state = addVehicle(
    state,
    createVehicle({
      id: 'v1',
      nickname: 'Daily driver',
      make: 'Toyota',
      model: 'Corolla',
      year: 2018,
      registrationPlate: 'ABC-123',
      vin: 'VIN00000000000001',
      engine: '1.8L petrol',
      currentOdometerKm: 126420,
      serviceIntervalKm: 10000,
      serviceIntervalMonths: 12,
      lastServiceKm: 120300,
      lastServiceDate: '2026-03-01',
      lastOdometerUpdateAt: ISO,
      notes: 'Family car',
      photo: 'data:image/png;base64,AAAA',
    })
  );
  state = recordOdometer(state, 'v1', 126420, ISO);
  state = recordOdometer(state, 'v1', 129000, '2026-09-20T09:00:00.000Z');

  state.serviceRecords = [
    {
      id: 'svc-1',
      vehicleId: 'v1',
      date: '2026-03-01',
      odometerKm: 120300,
      serviceTypeId: 'svc-minor',
      workshop: 'Local mechanic',
      totalCost: 320,
      labourCost: 120,
      partsCost: 200,
      notes: 'Routine service',
      items: [],
      inspectedItems: ['Engine oil', 'Oil filter'],
      replacedItems: ['Engine oil', 'Oil filter'],
      repairedItems: [],
      recommendedWork: ['Brake fluid flush'],
      createdAt: ISO,
      updatedAt: ISO,
    },
  ];
  state.knownIssues = [
    {
      id: 'issue-1',
      vehicleId: 'v1',
      title: 'Slight oil leak',
      severity: 'medium',
      priority: 'high',
      status: 'monitoring',
      createdAt: ISO,
      updatedAt: ISO,
    },
  ];
  state.nextServiceItems = [
    {
      id: 'ns-1',
      vehicleId: 'v1',
      title: 'Brake fluid flush',
      requirement: 'recommended',
      priority: 'medium',
      source: 'scheduled',
      estimatedTotalCost: 90,
      createdAt: ISO,
      updatedAt: ISO,
    },
  ];
  state.partEstimates = [
    {
      id: 'pe-1',
      vehicleId: 'v1',
      partName: 'Brake fluid',
      quantity: 1,
      estimatedPartPrice: 40,
      supplier: 'AutoBarn',
      createdAt: ISO,
      updatedAt: ISO,
    },
  ];
  return state;
}

function makeHost(money: MoneyState, vehicle: VehicleState): MindMeshHostAPI {
  return {
    moneyState: money,
    onUpdateMoneyState: () => undefined,
    vehicleState: vehicle,
    onUpdateVehicleState: () => undefined,
    reminders: [],
    categories: [],
    onUpdateReminders: () => undefined,
    onUpdateCategories: () => undefined,
    notificationSettings: { enabled: true, historyLimit: 50 } as MindMeshHostAPI['notificationSettings'],
    onOpenReminder: () => undefined,
    navigateToTab: () => undefined,
  };
}

async function bootMigratedManager(money: MoneyState, vehicle: VehicleState) {
  const manager = new PluginManager(createEmptyRegistryState());
  manager.setHost(makeHost(money, vehicle));
  registerBuiltinPlugins(manager);
  await manager.initialize();
  return manager;
}

beforeEach(() => {
  localStorage.clear();
  saveAllData(getDefaultState());
});

describe('populated Money data through the plugin migration', () => {
  it('adopts a fully populated money slice without losing any records', async () => {
    const seeded = populatedMoneyState();
    saveMoneyState(seeded);

    const manager = await bootMigratedManager(seeded, createDefaultVehicleState());

    const money = loadMoneyState();
    expect(money.incomeConfig?.title).toBe('Primary Job');
    expect(money.incomeConfig?.employerName).toBe('Acme');
    expect(money.directDebits).toHaveLength(2);
    expect(money.directDebits.map((bill) => bill.title)).toEqual(['Internet', 'Rent']);
    expect(money.directDebits[0].dueByDate).toBe('2026-07-10');
    expect(money.extraIncomeList).toHaveLength(1);
    expect(money.tipEntries).toHaveLength(1);
    expect(money.shifts).toHaveLength(1);
    expect(money.expenses).toHaveLength(2);
    expect(money.expenses.find((expense) => expense.id === 'ex-2')?.repeat).toBe('per_pay_cycle');
    expect(money.payCycleOverrides['2026-07-03']).toBe(1950);

    // Migration recorded, plugin enabled, data available.
    expect(manager.getState().plugins[MONEY_MANAGEMENT_PLUGIN_ID].completedMigrations).toContain(
      MONEY_LEGACY_HYDRATION_ID
    );
    expect(manager.isEnabled(MONEY_MANAGEMENT_PLUGIN_ID)).toBe(true);
  });

  it('is idempotent: re-running the legacy hydration never changes populated data', async () => {
    const seeded = populatedMoneyState();
    saveMoneyState(seeded);
    await bootMigratedManager(seeded, createDefaultVehicleState());

    const before = JSON.stringify(loadMoneyState());
    const [migration] = createMoneyManagementPlugin().migrations ?? [];
    for (let i = 0; i < 2; i += 1) {
      await migration.run({} as PluginContext);
    }
    expect(JSON.stringify(loadMoneyState())).toBe(before);
  });
});

describe('populated Car data through the plugin migration', () => {
  it('adopts a fully populated vehicle slice without losing any records', async () => {
    const seeded = populatedVehicleState();
    saveVehicleState(seeded);

    const manager = await bootMigratedManager(getDefaultMoneyState(), seeded);

    const vehicles = loadVehicleState();
    expect(vehicles.vehicles).toHaveLength(1);
    expect(vehicles.vehicles[0].nickname).toBe('Daily driver');
    expect(vehicles.vehicles[0].registrationPlate).toBe('ABC-123');
    expect(vehicles.vehicles[0].currentOdometerKm).toBe(129000);
    expect(vehicles.odometerRecords.length).toBeGreaterThanOrEqual(2);
    expect(vehicles.maintenanceItems.length).toBeGreaterThan(0);
    expect(vehicles.serviceRecords).toHaveLength(1);
    expect(vehicles.serviceRecords[0].workshop).toBe('Local mechanic');
    expect(vehicles.knownIssues).toHaveLength(1);
    expect(vehicles.nextServiceItems).toHaveLength(1);
    expect(vehicles.partEstimates).toHaveLength(1);

    expect(manager.getState().plugins[CAR_MAINTENANCE_PLUGIN_ID].completedMigrations).toContain(
      CAR_LEGACY_HYDRATION_ID
    );
    expect(manager.isEnabled(CAR_MAINTENANCE_PLUGIN_ID)).toBe(true);
  });
});

describe('populated plugin data survives lifecycle and backup', () => {
  it('keeps populated Money and Car data through disable → enable', async () => {
    const money = populatedMoneyState();
    const vehicle = populatedVehicleState();
    saveMoneyState(money);
    saveVehicleState(vehicle);
    const manager = await bootMigratedManager(money, vehicle);

    await manager.disable(MONEY_MANAGEMENT_PLUGIN_ID);
    await manager.disable(CAR_MAINTENANCE_PLUGIN_ID);
    expect(loadMoneyState().directDebits).toHaveLength(2);
    expect(loadVehicleState().vehicles).toHaveLength(1);

    await manager.enable(MONEY_MANAGEMENT_PLUGIN_ID);
    await manager.enable(CAR_MAINTENANCE_PLUGIN_ID);
    expect(loadMoneyState().expenses).toHaveLength(2);
    expect(loadVehicleState().knownIssues).toHaveLength(1);
  });

  it('round-trips populated Money and Car data through a real backup', async () => {
    const money = populatedMoneyState();
    const vehicle = populatedVehicleState();
    saveMoneyState(money);
    saveVehicleState(vehicle);
    await bootMigratedManager(money, vehicle);

    const backup = createBackup();
    expect(backup.data.plugins?.[MONEY_MANAGEMENT_PLUGIN_ID]).toBeTruthy();
    expect(backup.data.plugins?.[CAR_MAINTENANCE_PLUGIN_ID]).toBeTruthy();

    // Wipe the live slices, then restore.
    saveMoneyState(getDefaultMoneyState());
    saveVehicleState(createDefaultVehicleState());
    const restore = restoreBackup(backup);
    expect(restore.success).toBe(true);

    expect(loadMoneyState().incomeConfig?.title).toBe('Primary Job');
    expect(loadMoneyState().directDebits).toHaveLength(2);
    expect(loadMoneyState().payCycleOverrides['2026-07-03']).toBe(1950);
    expect(loadVehicleState().vehicles[0].nickname).toBe('Daily driver');
    expect(loadVehicleState().serviceRecords).toHaveLength(1);
    expect(loadVehicleState().partEstimates).toHaveLength(1);
  });
});
