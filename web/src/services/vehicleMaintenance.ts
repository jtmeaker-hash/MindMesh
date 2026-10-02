import {
  DEFAULT_SERVICE_TYPES,
  DEFAULT_VEHICLE_NOTIFICATION_SETTINGS,
  DEFAULT_VEHICLE_THRESHOLDS,
  OPEN_KNOWN_ISSUE_STATUSES,
  type KnownIssueSeverity,
  type KnownIssueStatus,
  type KnownVehicleIssue,
  type MaintenanceCategory,
  type MaintenanceItem,
  type MaintenanceItemCondition,
  type NextServiceItem,
  type NextServiceItemSource,
  type NextServiceRequirement,
  type OdometerRecord,
  type PartEstimate,
  type ServiceItemAction,
  type ServiceRecord,
  type ServiceRecordItem,
  type ServiceTypeDefinition,
  type Vehicle,
  type VehicleNotificationJob,
  type VehiclePriority,
  type VehicleServiceStatus,
  type VehicleState,
  type VehicleThresholds,
} from '../types/vehicle';

/* ------------------------------------------------------------------ *\n * Small helpers\n * ------------------------------------------------------------------ */

export function vehicleId(prefix = 'veh'): string {
  const cryptoObj = typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}-${cryptoObj.randomUUID()}`;
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function toIsoDate(input: Date = new Date()): string {
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${input.getFullYear()}-${pad(input.getMonth() + 1)}-${pad(input.getDate())}`;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) {
    const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setMonth(result.getMonth() + months);
  // Clamp for months shorter than the original day (e.g. 31 Jan + 1 month).
  if (result.getDate() < day) result.setDate(0);
  return result;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asNumber(value: unknown): number | undefined {
  if (isFiniteNumber(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function asNonNegative(value: unknown): number | undefined {
  const n = asNumber(value);
  return n === undefined ? undefined : Math.max(0, n);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function asBool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

const PRIORITIES: VehiclePriority[] = ['low', 'medium', 'high', 'critical'];
const SEVERITIES: KnownIssueSeverity[] = ['low', 'medium', 'high', 'critical'];

function asPriority(value: unknown): VehiclePriority {
  return PRIORITIES.includes(value as VehiclePriority) ? (value as VehiclePriority) : 'medium';
}

function asSeverity(value: unknown): KnownIssueSeverity {
  return SEVERITIES.includes(value as KnownIssueSeverity) ? (value as KnownIssueSeverity) : 'medium';
}

const KNOWN_ISSUE_STATUSES: KnownIssueStatus[] = [
  'monitoring',
  'needs_inspection',
  'repair_soon',
  'urgent',
  'booked',
  'repaired',
  'closed',
];

function asIssueStatus(value: unknown): KnownIssueStatus {
  return KNOWN_ISSUE_STATUSES.includes(value as KnownIssueStatus) ? (value as KnownIssueStatus) : 'monitoring';
}

const CATEGORIES: MaintenanceCategory[] = [
  'engine',
  'transmission',
  'brakes',
  'suspension',
  'tyres',
  'electrical',
  'aircon',
  'other',
  'custom',
];

function asCategory(value: unknown): MaintenanceCategory {
  return CATEGORIES.includes(value as MaintenanceCategory) ? (value as MaintenanceCategory) : 'other';
}

/* ------------------------------------------------------------------ *\n * Serviceable items catalogue\n * ------------------------------------------------------------------ */

export interface CatalogEntry {
  name: string;
  category: MaintenanceCategory;
  intervalKm?: number;
  intervalMonths?: number;
}

/**
 * Common serviceable components seeded onto every new vehicle. These are only
 * defaults — the user can edit intervals, delete them, or add custom items.
 */
export const DEFAULT_MAINTENANCE_CATALOG: CatalogEntry[] = [
  // ENGINE
  { name: 'Engine oil', category: 'engine', intervalKm: 10000, intervalMonths: 12 },
  { name: 'Oil filter', category: 'engine', intervalKm: 10000, intervalMonths: 12 },
  { name: 'Air filter', category: 'engine', intervalKm: 30000, intervalMonths: 24 },
  { name: 'Fuel filter', category: 'engine', intervalKm: 40000, intervalMonths: 36 },
  { name: 'Spark plugs', category: 'engine', intervalKm: 60000, intervalMonths: 60 },
  { name: 'Timing belt', category: 'engine', intervalKm: 100000, intervalMonths: 84 },
  { name: 'Timing chain inspection', category: 'engine' },
  { name: 'Drive belts / serpentine belt', category: 'engine', intervalKm: 60000, intervalMonths: 48 },
  { name: 'Coolant', category: 'engine', intervalKm: 80000, intervalMonths: 48 },
  { name: 'Water pump', category: 'engine', intervalKm: 120000 },
  { name: 'Engine mounts', category: 'engine' },
  // TRANSMISSION
  { name: 'Automatic transmission fluid', category: 'transmission', intervalKm: 60000, intervalMonths: 48 },
  { name: 'Manual gearbox oil', category: 'transmission', intervalKm: 80000, intervalMonths: 60 },
  { name: 'Transmission filter', category: 'transmission', intervalKm: 60000, intervalMonths: 48 },
  { name: 'Differential oil', category: 'transmission', intervalKm: 80000, intervalMonths: 60 },
  { name: 'Transfer case fluid', category: 'transmission', intervalKm: 80000, intervalMonths: 60 },
  // BRAKES
  { name: 'Front brake pads', category: 'brakes', intervalKm: 40000 },
  { name: 'Rear brake pads', category: 'brakes', intervalKm: 50000 },
  { name: 'Front brake rotors', category: 'brakes', intervalKm: 80000 },
  { name: 'Rear brake rotors', category: 'brakes', intervalKm: 90000 },
  { name: 'Brake fluid', category: 'brakes', intervalKm: 40000, intervalMonths: 24 },
  { name: 'Handbrake adjustment', category: 'brakes' },
  // SUSPENSION / STEERING
  { name: 'Shock absorbers', category: 'suspension', intervalKm: 80000 },
  { name: 'Struts', category: 'suspension', intervalKm: 80000 },
  { name: 'Bushings', category: 'suspension', intervalKm: 100000 },
  { name: 'Ball joints', category: 'suspension', intervalKm: 100000 },
  { name: 'Tie rod ends', category: 'suspension', intervalKm: 100000 },
  { name: 'Wheel bearings', category: 'suspension', intervalKm: 120000 },
  { name: 'Power steering fluid', category: 'suspension', intervalKm: 80000, intervalMonths: 48 },
  // TYRES / WHEELS
  { name: 'Front tyres', category: 'tyres', intervalKm: 50000 },
  { name: 'Rear tyres', category: 'tyres', intervalKm: 50000 },
  { name: 'Tyre rotation', category: 'tyres', intervalKm: 10000 },
  { name: 'Wheel alignment', category: 'tyres', intervalKm: 20000, intervalMonths: 12 },
  { name: 'Wheel balance', category: 'tyres', intervalKm: 20000 },
  // ELECTRICAL
  { name: 'Battery', category: 'electrical', intervalMonths: 48 },
  { name: 'Alternator', category: 'electrical', intervalKm: 150000 },
  { name: 'Starter motor', category: 'electrical', intervalKm: 150000 },
  { name: 'Headlight bulbs', category: 'electrical' },
  { name: 'Brake light bulbs', category: 'electrical' },
  { name: 'Wiper blades', category: 'electrical', intervalMonths: 12 },
  // AIR CONDITIONING
  { name: 'Cabin filter', category: 'aircon', intervalKm: 20000, intervalMonths: 12 },
  { name: 'A/C inspection', category: 'aircon', intervalMonths: 24 },
  { name: 'Refrigerant service', category: 'aircon', intervalKm: 60000, intervalMonths: 24 },
  // OTHER
  { name: 'Windscreen washer fluid', category: 'other' },
  { name: 'Windscreen', category: 'other' },
  { name: 'Wipers', category: 'other', intervalMonths: 12 },
  { name: 'Exhaust', category: 'other' },
  { name: 'Catalytic converter', category: 'other' },
  { name: 'Fuel system inspection', category: 'other', intervalKm: 60000, intervalMonths: 24 },
  { name: 'PCV valve', category: 'other', intervalKm: 60000 },
];

/** Creates the default tracked components for a newly added vehicle. */
export function seedMaintenanceItemsForVehicle(vehicleIdValue: string, now: string = new Date().toISOString()): MaintenanceItem[] {
  return DEFAULT_MAINTENANCE_CATALOG.map((entry) => ({
    id: vehicleId('maint'),
    vehicleId: vehicleIdValue,
    name: entry.name,
    category: entry.category,
    replacementIntervalKm: entry.intervalKm,
    replacementIntervalMonths: entry.intervalMonths,
    condition: 'unknown' as MaintenanceItemCondition,
    custom: false,
    createdAt: now,
    updatedAt: now,
  }));
}

export function createVehicle(input: Partial<Vehicle> = {}): Vehicle {
  const now = new Date().toISOString();
  const currentKm = asNonNegative(input.currentOdometerKm) ?? 0;
  return {
    id: input.id ?? vehicleId('veh'),
    nickname: input.nickname?.trim() || 'My vehicle',
    make: input.make?.trim() || '',
    model: input.model?.trim() || '',
    year: asNumber(input.year),
    registrationPlate: asString(input.registrationPlate),
    vin: asString(input.vin),
    engine: asString(input.engine),
    currentOdometerKm: currentKm,
    lastOdometerUpdateAt: input.lastOdometerUpdateAt ?? now,
    serviceIntervalKm: asNonNegative(input.serviceIntervalKm) ?? 10000,
    serviceIntervalMonths: asNonNegative(input.serviceIntervalMonths),
    lastServiceKm: asNonNegative(input.lastServiceKm),
    lastServiceDate: asString(input.lastServiceDate),
    notes: asString(input.notes),
    photo: asString(input.photo),
    createdAt: input.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
  };
}

/* ------------------------------------------------------------------ *\n * Normalization / migration\n * ------------------------------------------------------------------ */

export function createDefaultVehicleState(): VehicleState {
  return {
    vehicles: [],
    odometerRecords: [],
    serviceRecords: [],
    maintenanceItems: [],
    knownIssues: [],
    nextServiceItems: [],
    partEstimates: [],
    serviceTypes: DEFAULT_SERVICE_TYPES.map((type) => ({ ...type })),
    thresholds: { ...DEFAULT_VEHICLE_THRESHOLDS },
    notificationSettings: { ...DEFAULT_VEHICLE_NOTIFICATION_SETTINGS },
    notificationJobs: [],
    lastOdometerReminders: {},
  };
}

function normalizeVehicle(input: unknown): Vehicle | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  return createVehicle({
    id: raw.id,
    nickname: asString(raw.nickname),
    make: asString(raw.make),
    model: asString(raw.model),
    year: asNumber(raw.year),
    registrationPlate: asString(raw.registrationPlate),
    vin: asString(raw.vin),
    engine: asString(raw.engine),
    currentOdometerKm: asNonNegative(raw.currentOdometerKm) ?? 0,
    lastOdometerUpdateAt: asString(raw.lastOdometerUpdateAt),
    serviceIntervalKm: asNonNegative(raw.serviceIntervalKm),
    serviceIntervalMonths: asNonNegative(raw.serviceIntervalMonths),
    lastServiceKm: asNonNegative(raw.lastServiceKm),
    lastServiceDate: asString(raw.lastServiceDate),
    notes: asString(raw.notes),
    photo: asString(raw.photo),
    createdAt: asString(raw.createdAt),
    updatedAt: asString(raw.updatedAt),
  });
}

function normalizeOdometerRecord(input: unknown): OdometerRecord | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.vehicleId !== 'string') return null;
  const km = asNonNegative(raw.odometerKm);
  if (km === undefined) return null;
  return {
    id: raw.id,
    vehicleId: raw.vehicleId,
    odometerKm: km,
    recordedAt: asString(raw.recordedAt) ?? new Date().toISOString(),
    note: asString(raw.note),
  };
}

const SERVICE_ITEM_ACTIONS: ServiceItemAction[] = ['inspected', 'replaced', 'repaired', 'recommended'];

function normalizeServiceItem(input: unknown, serviceRecordId: string): ServiceRecordItem | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const name = asString(raw.name);
  if (!name) return null;
  const action = SERVICE_ITEM_ACTIONS.includes(raw.action as ServiceItemAction)
    ? (raw.action as ServiceItemAction)
    : 'inspected';
  return {
    id: asString(raw.id) ?? vehicleId('sitem'),
    serviceRecordId: asString(raw.serviceRecordId) ?? serviceRecordId,
    maintenanceItemId: asString(raw.maintenanceItemId),
    name,
    action,
    category: raw.category !== undefined ? asCategory(raw.category) : undefined,
    labourCost: asNonNegative(raw.labourCost),
    partsCost: asNonNegative(raw.partsCost),
    cost: asNonNegative(raw.cost),
    notes: asString(raw.notes),
  };
}

function normalizeServiceRecord(input: unknown): ServiceRecord | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.vehicleId !== 'string') return null;
  const items = Array.isArray(raw.items)
    ? (raw.items.map((item) => normalizeServiceItem(item, raw.id as string)).filter(Boolean) as ServiceRecordItem[])
    : [];
  const stringList = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((n): n is string => typeof n === 'string' && n.trim() !== '') : [];
  return {
    id: raw.id,
    vehicleId: raw.vehicleId,
    date: asString(raw.date) ?? toIsoDate(),
    odometerKm: asNonNegative(raw.odometerKm) ?? 0,
    serviceTypeId: asString(raw.serviceTypeId) ?? 'svc-standard',
    workshop: asString(raw.workshop),
    totalCost: asNonNegative(raw.totalCost),
    labourCost: asNonNegative(raw.labourCost),
    partsCost: asNonNegative(raw.partsCost),
    notes: asString(raw.notes),
    items,
    inspectedItems: stringList(raw.inspectedItems),
    replacedItems: stringList(raw.replacedItems),
    repairedItems: stringList(raw.repairedItems),
    recommendedWork: stringList(raw.recommendedWork),
    createdAt: asString(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) ?? new Date().toISOString(),
  };
}

function normalizeMaintenanceItem(input: unknown): MaintenanceItem | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.vehicleId !== 'string') return null;
  const name = asString(raw.name);
  if (!name) return null;
  const conditions: MaintenanceItemCondition[] = ['new', 'good', 'worn', 'poor', 'unknown'];
  return {
    id: raw.id,
    vehicleId: raw.vehicleId,
    name,
    category: asCategory(raw.category),
    lastReplacedDate: asString(raw.lastReplacedDate),
    lastReplacedOdometerKm: asNonNegative(raw.lastReplacedOdometerKm),
    replacementIntervalKm: asNonNegative(raw.replacementIntervalKm),
    replacementIntervalMonths: asNonNegative(raw.replacementIntervalMonths),
    brand: asString(raw.brand),
    partNumber: asString(raw.partNumber),
    cost: asNonNegative(raw.cost),
    installedBy: asString(raw.installedBy),
    notes: asString(raw.notes),
    condition: conditions.includes(raw.condition as MaintenanceItemCondition)
      ? (raw.condition as MaintenanceItemCondition)
      : 'unknown',
    custom: raw.custom === true,
    createdAt: asString(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) ?? new Date().toISOString(),
  };
}

function normalizeKnownIssue(input: unknown): KnownVehicleIssue | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.vehicleId !== 'string') return null;
  const title = asString(raw.title);
  if (!title) return null;
  return {
    id: raw.id,
    vehicleId: raw.vehicleId,
    title,
    description: asString(raw.description),
    firstNoticedDate: asString(raw.firstNoticedDate),
    odometerWhenNoticedKm: asNonNegative(raw.odometerWhenNoticedKm),
    severity: asSeverity(raw.severity),
    priority: asPriority(raw.priority),
    estimatedRepairCostLow: asNonNegative(raw.estimatedRepairCostLow),
    estimatedRepairCostHigh: asNonNegative(raw.estimatedRepairCostHigh),
    mechanicDiagnosis: asString(raw.mechanicDiagnosis),
    notes: asString(raw.notes),
    photos: Array.isArray(raw.photos) ? raw.photos.filter((p): p is string => typeof p === 'string') : undefined,
    status: asIssueStatus(raw.status),
    nextServiceItemId: asString(raw.nextServiceItemId),
    resolvedAt: asString(raw.resolvedAt),
    createdAt: asString(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) ?? new Date().toISOString(),
  };
}

const NEXT_SERVICE_SOURCES: NextServiceItemSource[] = ['scheduled', 'mechanic', 'known_issue', 'user', 'recommended'];

function normalizeNextServiceItem(input: unknown): NextServiceItem | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.vehicleId !== 'string') return null;
  const title = asString(raw.title);
  if (!title) return null;
  return {
    id: raw.id,
    vehicleId: raw.vehicleId,
    maintenanceItemId: asString(raw.maintenanceItemId),
    title,
    reason: asString(raw.reason),
    requirement: raw.requirement === 'recommended' ? 'recommended' : 'required',
    estimatedPartCost: asNonNegative(raw.estimatedPartCost),
    estimatedLabourCost: asNonNegative(raw.estimatedLabourCost),
    estimatedTotalCost: asNonNegative(raw.estimatedTotalCost),
    notes: asString(raw.notes),
    priority: asPriority(raw.priority),
    source: NEXT_SERVICE_SOURCES.includes(raw.source as NextServiceItemSource)
      ? (raw.source as NextServiceItemSource)
      : 'user',
    knownIssueId: asString(raw.knownIssueId),
    completed: raw.completed === true,
    createdAt: asString(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) ?? new Date().toISOString(),
  };
}

function normalizePartEstimate(input: unknown): PartEstimate | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  if (typeof raw.id !== 'string' || typeof raw.vehicleId !== 'string') return null;
  const partName = asString(raw.partName);
  if (!partName) return null;
  return {
    id: raw.id,
    vehicleId: raw.vehicleId,
    partName,
    estimatedPartPrice: asNonNegative(raw.estimatedPartPrice),
    estimatedLabour: asNonNegative(raw.estimatedLabour),
    quantity: asNonNegative(raw.quantity) ?? 1,
    supplier: asString(raw.supplier),
    notes: asString(raw.notes),
    actualFinalPrice: asNonNegative(raw.actualFinalPrice),
    nextServiceItemId: asString(raw.nextServiceItemId),
    createdAt: asString(raw.createdAt) ?? new Date().toISOString(),
    updatedAt: asString(raw.updatedAt) ?? new Date().toISOString(),
  };
}

function normalizeServiceType(input: unknown): ServiceTypeDefinition | null {
  if (!input || typeof input !== 'object') return null;
  const raw = input as Record<string, unknown>;
  const name = asString(raw.name);
  if (!name) return null;
  return {
    id: asString(raw.id) ?? vehicleId('svc'),
    name,
    defaultItemNames: Array.isArray(raw.defaultItemNames)
      ? raw.defaultItemNames.filter((n): n is string => typeof n === 'string')
      : undefined,
    isDefault: raw.isDefault === true,
  };
}

function normalizeThresholds(input: unknown): VehicleThresholds {
  const base = { ...DEFAULT_VEHICLE_THRESHOLDS };
  if (!input || typeof input !== 'object') return base;
  const raw = input as Record<string, unknown>;
  const approaching = asNonNegative(raw.approachingKm);
  const urgent = asNonNegative(raw.urgentKm);
  return {
    approachingKm: approaching ?? base.approachingKm,
    urgentKm: urgent ?? base.urgentKm,
  };
}

function normalizeNotificationSettings(input: unknown): VehicleState['notificationSettings'] {
  const base = { ...DEFAULT_VEHICLE_NOTIFICATION_SETTINGS };
  if (!input || typeof input !== 'object') return base;
  const raw = input as Record<string, unknown>;
  const mode = raw.odometerReminderMode;
  return {
    enabled: asBool(raw.enabled, base.enabled),
    odometerReminderMode:
      mode === 'weekly' || mode === 'custom' || mode === 'disabled' ? mode : base.odometerReminderMode,
    odometerReminderIntervalDays: Math.max(1, asNonNegative(raw.odometerReminderIntervalDays) ?? base.odometerReminderIntervalDays),
    serviceApproaching: asBool(raw.serviceApproaching, base.serviceApproaching),
    serviceDue: asBool(raw.serviceDue, base.serviceDue),
    serviceOverdue: asBool(raw.serviceOverdue, base.serviceOverdue),
    maintenanceApproaching: asBool(raw.maintenanceApproaching, base.maintenanceApproaching),
    maintenanceDue: asBool(raw.maintenanceDue, base.maintenanceDue),
    timeBasedMaintenance: asBool(raw.timeBasedMaintenance, base.timeBasedMaintenance),
    knownIssueFollowUp: asBool(raw.knownIssueFollowUp, base.knownIssueFollowUp),
    remindHour: Math.min(23, Math.max(0, asNonNegative(raw.remindHour) ?? base.remindHour)),
  };
}

function normalizeNotificationJobs(input: unknown): VehicleNotificationJob[] {
  if (!Array.isArray(input)) return [];
  const types: VehicleNotificationJob['type'][] = [
    'odometer_update',
    'service_approaching',
    'service_due',
    'service_overdue',
    'maintenance_approaching',
    'maintenance_due',
    'time_based',
    'known_issue',
  ];
  const seen = new Set<string>();
  const jobs: VehicleNotificationJob[] = [];
  for (const item of input) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    if (typeof raw.id !== 'string' || !raw.id) continue;
    if (typeof raw.vehicleId !== 'string') continue;
    if (!types.includes(raw.type as VehicleNotificationJob['type'])) continue;
    if (seen.has(raw.id)) continue;
    seen.add(raw.id);
    jobs.push({
      id: raw.id,
      vehicleId: raw.vehicleId,
      type: raw.type as VehicleNotificationJob['type'],
      title: asString(raw.title) ?? 'Vehicle reminder',
      message: asString(raw.message) ?? '',
      scheduledFor: asString(raw.scheduledFor) ?? new Date().toISOString(),
      firedAt: asString(raw.firedAt),
      status: raw.status === 'fired' || raw.status === 'cancelled' ? raw.status : 'pending',
    });
  }
  return jobs.slice(-500);
}

export function normalizeVehicleState(input: unknown): VehicleState {
  const base = createDefaultVehicleState();
  if (!input || typeof input !== 'object' || Array.isArray(input)) return base;
  const raw = input as Record<string, unknown>;

  const lists = {
    vehicles: Array.isArray(raw.vehicles) ? raw.vehicles.filter(Boolean) : [],
    odometerRecords: Array.isArray(raw.odometerRecords) ? raw.odometerRecords.filter(Boolean) : [],
    serviceRecords: Array.isArray(raw.serviceRecords) ? raw.serviceRecords.filter(Boolean) : [],
    maintenanceItems: Array.isArray(raw.maintenanceItems) ? raw.maintenanceItems.filter(Boolean) : [],
    knownIssues: Array.isArray(raw.knownIssues) ? raw.knownIssues.filter(Boolean) : [],
    nextServiceItems: Array.isArray(raw.nextServiceItems) ? raw.nextServiceItems.filter(Boolean) : [],
    partEstimates: Array.isArray(raw.partEstimates) ? raw.partEstimates.filter(Boolean) : [],
  };

  return {
    vehicles: lists.vehicles.map(normalizeVehicle).filter((v): v is Vehicle => v !== null),
    odometerRecords: lists.odometerRecords
      .map(normalizeOdometerRecord)
      .filter((r): r is OdometerRecord => r !== null),
    serviceRecords: lists.serviceRecords.map(normalizeServiceRecord).filter((r): r is ServiceRecord => r !== null),
    maintenanceItems: lists.maintenanceItems
      .map(normalizeMaintenanceItem)
      .filter((r): r is MaintenanceItem => r !== null),
    knownIssues: lists.knownIssues.map(normalizeKnownIssue).filter((r): r is KnownVehicleIssue => r !== null),
    nextServiceItems: lists.nextServiceItems
      .map(normalizeNextServiceItem)
      .filter((r): r is NextServiceItem => r !== null),
    partEstimates: lists.partEstimates.map(normalizePartEstimate).filter((r): r is PartEstimate => r !== null),
    serviceTypes:
      Array.isArray(raw.serviceTypes) && raw.serviceTypes.length > 0
        ? (raw.serviceTypes.map(normalizeServiceType).filter((t): t is ServiceTypeDefinition => t !== null))
        : base.serviceTypes,
    thresholds: normalizeThresholds(raw.thresholds),
    notificationSettings: normalizeNotificationSettings(raw.notificationSettings),
    notificationJobs: normalizeNotificationJobs(raw.notificationJobs),
    lastOdometerReminders:
      raw.lastOdometerReminders && typeof raw.lastOdometerReminders === 'object'
        ? Object.fromEntries(
            Object.entries(raw.lastOdometerReminders as Record<string, unknown>).filter(
              (entry): entry is [string, string] => typeof entry[1] === 'string'
            )
          )
        : {},
  };
}

/* ------------------------------------------------------------------ *\n * Service / status calculations\n * ------------------------------------------------------------------ */

export interface NextServiceInfo {
  lastServiceKm?: number;
  lastServiceDate?: string;
  nextServiceKm?: number;
  nextServiceDate?: string;
  /** Positive = km remaining; 0 = exactly due; negative = overdue. */
  kmRemaining?: number;
  daysRemaining?: number;
  serviceIntervalKm: number;
  serviceIntervalMonths?: number;
  /** The most recent full service record, when one exists. */
  latestRecord?: ServiceRecord;
}

/** Service records for one vehicle, newest first (odometer, then date). */
export function getVehicleServiceRecords(records: readonly ServiceRecord[], vehicleIdValue: string): ServiceRecord[] {
  return records
    .filter((record) => record.vehicleId === vehicleIdValue)
    .slice()
    .sort((a, b) => {
      if (b.odometerKm !== a.odometerKm) return b.odometerKm - a.odometerKm;
      return Date.parse(b.date) - Date.parse(a.date);
    });
}

export function getLatestServiceRecord(
  records: readonly ServiceRecord[],
  vehicleIdValue: string
): ServiceRecord | undefined {
  return getVehicleServiceRecords(records, vehicleIdValue)[0];
}

/**
 * Calculates the next service point from the latest service plus the vehicle's
 * interval. Never requires the user to enter a "next service" value.
 */
export function computeNextService(
  vehicle: Vehicle,
  serviceRecords: readonly ServiceRecord[]
): NextServiceInfo {
  const latestRecord = getLatestServiceRecord(serviceRecords, vehicle.id);
  const lastServiceKm = latestRecord?.odometerKm ?? vehicle.lastServiceKm;
  const lastServiceDate = latestRecord?.date ?? vehicle.lastServiceDate;
  const intervalKm = vehicle.serviceIntervalKm > 0 ? vehicle.serviceIntervalKm : undefined;

  const nextServiceKm = lastServiceKm !== undefined && intervalKm !== undefined ? lastServiceKm + intervalKm : undefined;
  const kmRemaining = nextServiceKm !== undefined ? nextServiceKm - vehicle.currentOdometerKm : undefined;

  let nextServiceDate: string | undefined;
  let daysRemaining: number | undefined;
  const months = vehicle.serviceIntervalMonths;
  if (lastServiceDate && months && months > 0) {
    const base = parseDate(lastServiceDate);
    if (base) {
      const due = addMonths(base, months);
      nextServiceDate = toIsoDate(due);
      const today = parseDate(toIsoDate())!;
      daysRemaining = daysBetween(today, due);
    }
  }

  return {
    lastServiceKm,
    lastServiceDate,
    nextServiceKm,
    nextServiceDate,
    kmRemaining,
    daysRemaining,
    serviceIntervalKm: vehicle.serviceIntervalKm,
    serviceIntervalMonths: vehicle.serviceIntervalMonths,
    latestRecord,
  };
}

const STATUS_SEVERITY: Record<VehicleServiceStatus, number> = {
  ok: 0,
  approaching: 1,
  urgent: 2,
  due: 3,
  overdue: 4,
};

export interface ServiceStatusInfo {
  status: VehicleServiceStatus;
  kmRemaining?: number;
  kmOverdue?: number;
  daysRemaining?: number;
  daysOverdue?: number;
  label: string;
  message: string;
  dueByKm: boolean;
  dueByTime: boolean;
}

const STATUS_LABELS: Record<VehicleServiceStatus, string> = {
  ok: 'SERVICE OK',
  approaching: 'SERVICE APPROACHING',
  urgent: 'SERVICE URGENT',
  due: 'SERVICE DUE',
  overdue: 'SERVICE OVERDUE',
};

export function formatKm(km: number | undefined | null): string {
  if (km === undefined || km === null || !Number.isFinite(km)) return '—';
  return `${Math.round(Math.abs(km)).toLocaleString('en-AU')} km`;
}

function kmStatusFromRemaining(remaining: number, thresholds: VehicleThresholds): VehicleServiceStatus {
  if (remaining < 0) return 'overdue';
  if (remaining === 0) return 'due';
  if (remaining <= Math.max(0, thresholds.urgentKm)) return 'urgent';
  if (remaining <= Math.max(0, thresholds.approachingKm)) return 'approaching';
  return 'ok';
}

/**
 * Combines the km and time thresholds, whichever is more severe, into a single
 * easily-read status.
 */
export function getVehicleServiceStatus(
  info: NextServiceInfo,
  thresholds: VehicleThresholds
): ServiceStatusInfo {
  let kmStatus: VehicleServiceStatus | null = null;
  if (info.kmRemaining !== undefined) {
    kmStatus = kmStatusFromRemaining(info.kmRemaining, thresholds);
  }

  let timeStatus: VehicleServiceStatus | null = null;
  if (info.daysRemaining !== undefined) {
    const d = info.daysRemaining;
    if (d < 0) timeStatus = 'overdue';
    else if (d === 0) timeStatus = 'due';
    else if (d <= 7) timeStatus = 'urgent';
    else if (d <= 30) timeStatus = 'approaching';
    else timeStatus = 'ok';
  }

  let status: VehicleServiceStatus = 'ok';
  if (kmStatus && timeStatus) status = STATUS_SEVERITY[kmStatus] >= STATUS_SEVERITY[timeStatus] ? kmStatus : timeStatus;
  else status = kmStatus ?? timeStatus ?? 'ok';

  const kmOverdue = info.kmRemaining !== undefined && info.kmRemaining < 0 ? Math.abs(info.kmRemaining) : undefined;
  const daysOverdue = info.daysRemaining !== undefined && info.daysRemaining < 0 ? Math.abs(info.daysRemaining) : undefined;

  const dueByKm = kmStatus !== null && STATUS_SEVERITY[kmStatus] >= STATUS_SEVERITY[timeStatus ?? 'ok'];
  const dueByTime = timeStatus !== null && STATUS_SEVERITY[timeStatus] > STATUS_SEVERITY[kmStatus ?? 'ok'];

  let message: string;
  if (status === 'overdue') {
    const parts: string[] = [];
    if (kmOverdue !== undefined) parts.push(`${formatKm(kmOverdue)} overdue`);
    if (daysOverdue !== undefined && (kmOverdue === undefined || daysOverdue > 0)) {
      parts.push(`${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`);
    }
    message = parts.join(' · ') || 'Service overdue';
  } else if (status === 'due') {
    message = info.kmRemaining !== undefined && info.kmRemaining === 0
      ? `${formatKm(info.nextServiceKm)} reached`
      : 'Service due now';
  } else if (info.kmRemaining !== undefined) {
    message = `${formatKm(info.kmRemaining)} remaining`;
    if (info.daysRemaining !== undefined && info.daysRemaining >= 0) {
      message += ` · due in ${info.daysRemaining} day${info.daysRemaining === 1 ? '' : 's'}`;
    }
  } else if (info.daysRemaining !== undefined) {
    message = `Service due in ${info.daysRemaining} day${info.daysRemaining === 1 ? '' : 's'}`;
  } else {
    message = 'No service interval set';
  }

  return {
    status,
    kmRemaining: info.kmRemaining,
    kmOverdue,
    daysRemaining: info.daysRemaining,
    daysOverdue,
    label: STATUS_LABELS[status],
    message,
    dueByKm,
    dueByTime,
  };
}

export interface MaintenanceItemStatus {
  status: VehicleServiceStatus;
  nextReplacementKm?: number;
  remainingKm?: number;
  kmOverdue?: number;
  nextReplacementDate?: string;
  daysRemaining?: number;
  daysOverdue?: number;
  /** Whole months since the last replacement (for age-based display). */
  ageMonths?: number;
  label: string;
  message: string;
}

export function computeMaintenanceItemStatus(
  item: MaintenanceItem,
  currentOdometerKm: number,
  thresholds: VehicleThresholds,
  now: Date = new Date()
): MaintenanceItemStatus {
  const hasKmSchedule =
    item.lastReplacedOdometerKm !== undefined && item.replacementIntervalKm !== undefined && item.replacementIntervalKm > 0;
  const hasDateSchedule =
    item.lastReplacedDate !== undefined && item.replacementIntervalMonths !== undefined && item.replacementIntervalMonths > 0;

  let kmStatus: VehicleServiceStatus | null = null;
  let nextReplacementKm: number | undefined;
  let remainingKm: number | undefined;
  let kmOverdue: number | undefined;

  if (hasKmSchedule) {
    nextReplacementKm = (item.lastReplacedOdometerKm as number) + (item.replacementIntervalKm as number);
    remainingKm = nextReplacementKm - currentOdometerKm;
    kmStatus = kmStatusFromRemaining(remainingKm, thresholds);
    if (remainingKm < 0) kmOverdue = Math.abs(remainingKm);
  }

  let timeStatus: VehicleServiceStatus | null = null;
  let nextReplacementDate: string | undefined;
  let daysRemaining: number | undefined;
  let daysOverdue: number | undefined;
  let ageMonths: number | undefined;

  if (item.lastReplacedDate) {
    const base = parseDate(item.lastReplacedDate);
    if (base) {
      const nowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      ageMonths = Math.max(0, (nowDate.getFullYear() - base.getFullYear()) * 12 + (nowDate.getMonth() - base.getMonth()));
      if (hasDateSchedule) {
        const due = addMonths(base, item.replacementIntervalMonths as number);
        nextReplacementDate = toIsoDate(due);
        daysRemaining = daysBetween(nowDate, due);
        if (daysRemaining < 0) timeStatus = 'overdue';
        else if (daysRemaining === 0) timeStatus = 'due';
        else if (daysRemaining <= 7) timeStatus = 'urgent';
        else if (daysRemaining <= 30) timeStatus = 'approaching';
        else timeStatus = 'ok';
        if (daysRemaining < 0) daysOverdue = Math.abs(daysRemaining);
      }
    }
  }

  let status: VehicleServiceStatus;
  if (kmStatus && timeStatus) status = STATUS_SEVERITY[kmStatus] >= STATUS_SEVERITY[timeStatus] ? kmStatus : timeStatus;
  else status = kmStatus ?? timeStatus ?? 'ok';

  let message: string;
  if (hasKmSchedule && remainingKm !== undefined) {
    if (remainingKm >= 0) message = `${formatKm(remainingKm)} remaining`;
    else message = `${formatKm(remainingKm)} overdue`;
  } else if (hasDateSchedule && daysRemaining !== undefined) {
    message = daysRemaining >= 0
      ? `Due in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`
      : `${Math.abs(daysRemaining)} day${Math.abs(daysRemaining) === 1 ? '' : 's'} overdue`;
  } else if (item.lastReplacedDate) {
    const years = ageMonths !== undefined ? Math.floor(ageMonths / 12) : 0;
    const months = ageMonths !== undefined ? ageMonths % 12 : 0;
    message = `Age: ${years} year${years === 1 ? '' : 's'} ${months} month${months === 1 ? '' : 's'}`;
  } else {
    message = 'No replacement record';
  }

  return {
    status,
    nextReplacementKm,
    remainingKm,
    kmOverdue,
    nextReplacementDate,
    daysRemaining,
    daysOverdue,
    ageMonths,
    label: STATUS_LABELS[status],
    message,
  };
}

/* ------------------------------------------------------------------ *\n * Driving-rate estimate\n * ------------------------------------------------------------------ */

export function averageKmPerWeek(records: readonly OdometerRecord[]): number | undefined {
  const sorted = records
    .slice()
    .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));
  if (sorted.length < 2) return undefined;
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const days = (Date.parse(last.recordedAt) - Date.parse(first.recordedAt)) / DAY_MS;
  const distance = last.odometerKm - first.odometerKm;
  if (!Number.isFinite(days) || days < 1 || distance <= 0) return undefined;
  return (distance / days) * 7;
}

export function estimateWeeksForKm(remainingKm: number | undefined, kmPerWeek: number | undefined): number | undefined {
  if (remainingKm === undefined || kmPerWeek === undefined || kmPerWeek <= 0 || remainingKm < 0) return undefined;
  return remainingKm / kmPerWeek;
}

export function estimateDateForKm(
  remainingKm: number | undefined,
  kmPerWeek: number | undefined,
  from: Date = new Date()
): string | undefined {
  const weeks = estimateWeeksForKm(remainingKm, kmPerWeek);
  if (weeks === undefined) return undefined;
  const date = new Date(from.getTime() + weeks * 7 * DAY_MS);
  return toIsoDate(date);
}

/* ------------------------------------------------------------------ *\n * Cost summaries\n * ------------------------------------------------------------------ */

export interface ItemCostBreakdown {
  estimated?: number;
  hasEstimate: boolean;
}

/** Resolves a plan item's estimated total, treating "no estimate" as unknown. */
export function resolveItemEstimatedTotal(item: NextServiceItem): ItemCostBreakdown {
  if (item.estimatedTotalCost !== undefined && item.estimatedTotalCost !== null) {
    return { estimated: item.estimatedTotalCost, hasEstimate: true };
  }
  const part = item.estimatedPartCost;
  const labour = item.estimatedLabourCost;
  if (part === undefined && labour === undefined) return { hasEstimate: false };
  return { estimated: (part ?? 0) + (labour ?? 0), hasEstimate: true };
}

export interface NextServiceCostSummary {
  scheduled: number;
  knownIssues: number;
  recommended: number;
  total: number;
  /** Number of plan items with no cost estimate at all. */
  unknownCount: number;
  hasUnknowns: boolean;
  /** e.g. "$605 + 2 items with no estimate". */
  display: string;
}

export function nextServiceCostSummary(items: readonly NextServiceItem[]): NextServiceCostSummary {
  let scheduled = 0;
  let knownIssues = 0;
  let recommended = 0;
  let unknownCount = 0;

  for (const item of items) {
    if (item.completed) continue;
    const { estimated, hasEstimate } = resolveItemEstimatedTotal(item);
    if (!hasEstimate) {
      unknownCount += 1;
      continue;
    }
    const value = estimated ?? 0;
    if (item.source === 'known_issue') knownIssues += value;
    else if (item.source === 'recommended' || item.source === 'mechanic') recommended += value;
    else scheduled += value;
  }

  const total = scheduled + knownIssues + recommended;
  const hasUnknowns = unknownCount > 0;
  const base = `$${total.toLocaleString('en-AU')}`;
  const display = hasUnknowns
    ? `${base} + ${unknownCount} item${unknownCount === 1 ? '' : 's'} with no estimate`
    : base;

  return { scheduled, knownIssues, recommended, total, unknownCount, hasUnknowns, display };
}

/* ------------------------------------------------------------------ *\n * Mutations (pure)\n * ------------------------------------------------------------------ */

function upsert<T extends { id: string }>(list: T[], record: T): T[] {
  const index = list.findIndex((entry) => entry.id === record.id);
  if (index < 0) return [...list, record];
  return list.map((entry) => (entry.id === record.id ? record : entry));
}

export function addVehicle(state: VehicleState, vehicle: Vehicle): VehicleState {
  const now = new Date().toISOString();
  const seeded = seedMaintenanceItemsForVehicle(vehicle.id, now);
  return {
    ...state,
    vehicles: upsert(state.vehicles, vehicle),
    maintenanceItems: [...state.maintenanceItems, ...seeded.filter((item) => !state.maintenanceItems.some((e) => e.vehicleId === vehicle.id && e.name === item.name))],
    odometerRecords:
      vehicle.currentOdometerKm > 0
        ? upsert(state.odometerRecords, {
            id: vehicleId('odo'),
            vehicleId: vehicle.id,
            odometerKm: vehicle.currentOdometerKm,
            recordedAt: vehicle.lastOdometerUpdateAt ?? now,
            note: 'Initial odometer reading',
          })
        : state.odometerRecords,
  };
}

export function saveVehicle(state: VehicleState, vehicle: Vehicle): VehicleState {
  return { ...state, vehicles: upsert(state.vehicles, { ...vehicle, updatedAt: new Date().toISOString() }) };
}

/** Removes a vehicle and all of its linked records. */
export function deleteVehicle(state: VehicleState, vehicleIdValue: string): VehicleState {
  return {
    ...state,
    vehicles: state.vehicles.filter((v) => v.id !== vehicleIdValue),
    odometerRecords: state.odometerRecords.filter((r) => r.vehicleId !== vehicleIdValue),
    serviceRecords: state.serviceRecords.filter((r) => r.vehicleId !== vehicleIdValue),
    maintenanceItems: state.maintenanceItems.filter((r) => r.vehicleId !== vehicleIdValue),
    knownIssues: state.knownIssues.filter((r) => r.vehicleId !== vehicleIdValue),
    nextServiceItems: state.nextServiceItems.filter((r) => r.vehicleId !== vehicleIdValue),
    partEstimates: state.partEstimates.filter((r) => r.vehicleId !== vehicleIdValue),
    notificationJobs: state.notificationJobs.filter((job) => job.vehicleId !== vehicleIdValue),
  };
}

/**
 * Records an odometer reading. Previous readings are never overwritten: the new
 * reading is appended and the vehicle's current value is updated to match.
 */
export function recordOdometer(
  state: VehicleState,
  vehicleIdValue: string,
  odometerKm: number,
  recordedAt: string = new Date().toISOString(),
  note?: string
): VehicleState {
  const km = Math.max(0, Math.round(odometerKm));
  const vehicle = state.vehicles.find((v) => v.id === vehicleIdValue);
  if (!vehicle) return state;
  const record: OdometerRecord = {
    id: vehicleId('odo'),
    vehicleId: vehicleIdValue,
    odometerKm: km,
    recordedAt,
    note,
  };
  return {
    ...state,
    vehicles: state.vehicles.map((v) =>
      v.id === vehicleIdValue ? { ...v, currentOdometerKm: km, lastOdometerUpdateAt: recordedAt, updatedAt: recordedAt } : v
    ),
    odometerRecords: [...state.odometerRecords, record],
  };
}

/* ------------------------------------------------------------------ *\n * Service completion (fully derived & edit-safe)\n * ------------------------------------------------------------------ */

export interface ServiceCompletionResult {
  state: VehicleState;
  itemUpdates: { maintenanceItemId: string; lastReplacedOdometerKm: number; lastReplacedDate: string; cost?: number }[];
  resolvedIssueIds: string[];
  completedNextServiceItemIds: string[];
}

/**
 * Applies a service record to the state.
 *
 * Everything is re-derived from the complete service history, so editing or
 * adding a missed service recalculates correctly and past records are never
 * deleted or overwritten.
 */
export function applyServiceCompletion(state: VehicleState, record: ServiceRecord): ServiceCompletionResult {
  const normalized: ServiceRecord = {
    ...record,
    items: record.items.map((item) => ({ ...item, serviceRecordId: record.id })),
    updatedAt: new Date().toISOString(),
  };

  const serviceRecords = upsert(state.serviceRecords, normalized);

  // 1. Re-derive each maintenance item's replacement point from the service
  //    that most recently replaced it (highest odometer, then latest date).
  const replacementByItem = new Map<string, { service: ServiceRecord; item: ServiceRecordItem }>();
  for (const service of serviceRecords) {
    for (const item of service.items) {
      if (!item.maintenanceItemId) continue;
      if (item.action !== 'replaced' && item.action !== 'repaired') continue;
      const existing = replacementByItem.get(item.maintenanceItemId);
      if (
        !existing ||
        service.odometerKm > existing.service.odometerKm ||
        (service.odometerKm === existing.service.odometerKm && Date.parse(service.date) > Date.parse(existing.service.date))
      ) {
        replacementByItem.set(item.maintenanceItemId, { service, item });
      }
    }
  }

  const itemUpdates: ServiceCompletionResult['itemUpdates'] = [];
  const maintenanceItems = state.maintenanceItems.map((maintenance) => {
    const replacement = replacementByItem.get(maintenance.id);
    if (!replacement) return maintenance;
    const { service, item } = replacement;
    const cost = item.cost ?? ((item.partsCost ?? 0) + (item.labourCost ?? 0) || undefined);
    itemUpdates.push({
      maintenanceItemId: maintenance.id,
      lastReplacedOdometerKm: service.odometerKm,
      lastReplacedDate: service.date,
      cost,
    });
    return {
      ...maintenance,
      lastReplacedOdometerKm: service.odometerKm,
      lastReplacedDate: service.date,
      cost: cost ?? maintenance.cost,
      condition: 'good' as MaintenanceItemCondition,
      updatedAt: new Date().toISOString(),
    };
  });

  // 2. Mark next-service plan items completed when the work was done.
  const servicedMaintenanceIds = new Set(replacementByItem.keys());
  // Plan items without a tracked-component link (e.g. promoted known issues) fall
  // back to matching the name of a replaced/repaired service item.
  const servicedNames = new Set(
    serviceRecords
      .flatMap((service) => service.items)
      .filter((item) => item.action === 'replaced' || item.action === 'repaired')
      .map((item) => item.name.trim().toLowerCase())
  );

  const completedNextServiceItemIds: string[] = [];
  const nextServiceItems = state.nextServiceItems.map((planItem) => {
    if (planItem.completed) return planItem;
    const matchesMaintenance = planItem.maintenanceItemId && servicedMaintenanceIds.has(planItem.maintenanceItemId);
    const matchesName = servicedNames.has(planItem.title.trim().toLowerCase());
    if (matchesMaintenance || matchesName) {
      completedNextServiceItemIds.push(planItem.id);
      return { ...planItem, completed: true, updatedAt: new Date().toISOString() };
    }
    return planItem;
  });

  // 3. Resolve known issues whose promoted plan item was completed.
  const completedIds = new Set(completedNextServiceItemIds);
  const resolvedIssueIds: string[] = [];
  const knownIssues = state.knownIssues.map((issue) => {
    const promoted = issue.nextServiceItemId && completedIds.has(issue.nextServiceItemId);
    if (promoted && OPEN_KNOWN_ISSUE_STATUSES.includes(issue.status)) {
      resolvedIssueIds.push(issue.id);
      return { ...issue, status: 'repaired' as KnownIssueStatus, resolvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
    return issue;
  });

  // 4. A service above the current odometer advances the vehicle's reading.
  const vehicles = state.vehicles.map((vehicle) => {
    if (vehicle.id !== record.vehicleId) return vehicle;
    const shouldAdvance = serviceRecords.some((s) => s.vehicleId === vehicle.id && s.odometerKm > vehicle.currentOdometerKm);
    if (!shouldAdvance) return vehicle;
    const maxKm = Math.max(...serviceRecords.filter((s) => s.vehicleId === vehicle.id).map((s) => s.odometerKm));
    return { ...vehicle, currentOdometerKm: maxKm, updatedAt: new Date().toISOString() };
  });

  return {
    state: { ...state, serviceRecords, maintenanceItems, nextServiceItems, knownIssues, vehicles },
    itemUpdates,
    resolvedIssueIds,
    completedNextServiceItemIds,
  };
}

/**
 * Promotes a known issue into the next-service plan, creating a linked plan
 * item when one does not already exist.
 */
export function promoteKnownIssueToNextService(state: VehicleState, issueId: string): VehicleState {
  const issue = state.knownIssues.find((entry) => entry.id === issueId);
  if (!issue) return state;
  const existing = state.nextServiceItems.find((item) => item.knownIssueId === issue.id && !item.completed);
  if (existing) return state;

  const now = new Date().toISOString();
  const planItem: NextServiceItem = {
    id: vehicleId('nsi'),
    vehicleId: issue.vehicleId,
    title: issue.title,
    reason: issue.mechanicDiagnosis ?? issue.description,
    requirement: issue.priority === 'high' || issue.priority === 'critical' || issue.severity === 'high' || issue.severity === 'critical'
      ? 'required'
      : 'recommended',
    estimatedPartCost: undefined,
    estimatedLabourCost: issue.estimatedRepairCostLow,
    estimatedTotalCost: undefined,
    notes: issue.notes,
    priority: issue.priority,
    source: 'known_issue',
    knownIssueId: issue.id,
    completed: false,
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...state,
    nextServiceItems: [...state.nextServiceItems, planItem],
    knownIssues: state.knownIssues.map((entry) =>
      entry.id === issue.id
        ? { ...entry, nextServiceItemId: planItem.id, status: entry.status === 'monitoring' ? 'repair_soon' : entry.status, updatedAt: now }
        : entry
    ),
  };
}

export function reopenKnownIssue(state: VehicleState, issueId: string, status: KnownIssueStatus = 'monitoring'): VehicleState {
  return {
    ...state,
    knownIssues: state.knownIssues.map((issue) =>
      issue.id === issueId ? { ...issue, status, resolvedAt: undefined, updatedAt: new Date().toISOString() } : issue
    ),
  };
}

export function isIssueOpen(issue: KnownVehicleIssue): boolean {
  return OPEN_KNOWN_ISSUE_STATUSES.includes(issue.status);
}

export function countOpenIssues(issues: readonly KnownVehicleIssue[], vehicleIdValue: string): number {
  return issues.filter((issue) => issue.vehicleId === vehicleIdValue && isIssueOpen(issue)).length;
}

export const ALL_MAINTENANCE_CATEGORIES = CATEGORIES;
export type { NextServiceRequirement, NextServiceItemSource };
