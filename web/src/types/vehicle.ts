/**
 * Vehicle Maintenance & Service Tracking data model.
 *
 * The whole module is derived from four stored facts per vehicle:
 *   current odometer + service history + maintenance intervals + component
 *   replacement history. Every "next service", "remaining km", "due date" and
 *   cost figure is calculated from those facts, never typed in by the user.
 *
 * All records are stored flat in {@link VehicleState} and linked by id so a
 * vehicle can be replaced/edited without orphaning its history, and so the
 * backup layer can migrate each collection independently.
 */

export type VehicleServiceStatus = 'ok' | 'approaching' | 'urgent' | 'due' | 'overdue';

export type VehiclePriority = 'low' | 'medium' | 'high' | 'critical';

export type MaintenanceCategory =
  | 'engine'
  | 'transmission'
  | 'brakes'
  | 'suspension'
  | 'tyres'
  | 'electrical'
  | 'aircon'
  | 'other'
  | 'custom';

export const MAINTENANCE_CATEGORIES: { id: MaintenanceCategory; label: string }[] = [
  { id: 'engine', label: 'Engine' },
  { id: 'transmission', label: 'Transmission' },
  { id: 'brakes', label: 'Brakes' },
  { id: 'suspension', label: 'Suspension / Steering' },
  { id: 'tyres', label: 'Tyres / Wheels' },
  { id: 'electrical', label: 'Electrical' },
  { id: 'aircon', label: 'Air Conditioning' },
  { id: 'other', label: 'Other' },
  { id: 'custom', label: 'Custom' },
];

/** Where a next-service plan item came from. */
export type NextServiceItemSource =
  | 'scheduled'
  | 'mechanic'
  | 'known_issue'
  | 'user'
  | 'recommended';

export type NextServiceRequirement = 'required' | 'recommended';

export type KnownIssueStatus =
  | 'monitoring'
  | 'needs_inspection'
  | 'repair_soon'
  | 'urgent'
  | 'booked'
  | 'repaired'
  | 'closed';

export const KNOWN_ISSUE_STATUS_LABELS: Record<KnownIssueStatus, string> = {
  monitoring: 'Monitoring',
  needs_inspection: 'Needs inspection',
  repair_soon: 'Repair soon',
  urgent: 'Urgent',
  booked: 'Booked',
  repaired: 'Repaired',
  closed: 'Closed',
};

/** An issue is "open" until it has been repaired or closed. */
export const OPEN_KNOWN_ISSUE_STATUSES: KnownIssueStatus[] = [
  'monitoring',
  'needs_inspection',
  'repair_soon',
  'urgent',
  'booked',
];

export type MaintenanceItemCondition = 'new' | 'good' | 'worn' | 'poor' | 'unknown';

export type OdometerReminderMode = 'disabled' | 'weekly' | 'custom';

export interface Vehicle {
  id: string;
  /** Friendly name shown throughout the UI (e.g. "Daily driver"). */
  nickname: string;
  make: string;
  model: string;
  year?: number;
  registrationPlate?: string;
  vin?: string;
  engine?: string;
  /** The single source of truth for "where is this vehicle right now". */
  currentOdometerKm: number;
  /** ISO timestamp of the last odometer update. */
  lastOdometerUpdateAt?: string;
  /** Default service interval in kilometres (e.g. 10000). */
  serviceIntervalKm: number;
  /** Optional time-based interval in months. */
  serviceIntervalMonths?: number;
  /**
   * Baseline odometer of the last service when it was recorded outside the app
   * (e.g. a previous owner's logbook). The latest {@link ServiceRecord} always
   * takes precedence; these are only a fallback so a brand new vehicle can still
   * calculate its next service before any history is entered.
   */
  lastServiceKm?: number;
  /** Date of that baseline service (YYYY-MM-DD). */
  lastServiceDate?: string;
  notes?: string;
  /** Data URL or remote URL for an optional vehicle photo. */
  photo?: string;
  createdAt: string;
  updatedAt: string;
}

/** A single date | km reading. Never overwritten; corrections append. */
export interface OdometerRecord {
  id: string;
  vehicleId: string;
  odometerKm: number;
  /** ISO timestamp the reading was taken / recorded. */
  recordedAt: string;
  note?: string;
}

/** One maintenance item action recorded inside a service. */
export type ServiceItemAction = 'inspected' | 'replaced' | 'repaired' | 'recommended';

export interface ServiceRecordItem {
  id: string;
  serviceRecordId: string;
  /** Links to a {@link MaintenanceItem} when the service completed/checked one. */
  maintenanceItemId?: string;
  name: string;
  action: ServiceItemAction;
  category?: MaintenanceCategory;
  labourCost?: number;
  partsCost?: number;
  cost?: number;
  notes?: string;
}

/**
 * A completed service. Records are append-only: creating a new service never
 * edits or deletes an older one.
 */
export interface ServiceRecord {
  id: string;
  vehicleId: string;
  /** YYYY-MM-DD */
  date: string;
  odometerKm: number;
  serviceTypeId: string;
  workshop?: string;
  totalCost?: number;
  labourCost?: number;
  partsCost?: number;
  notes?: string;
  /** Structured items (drives last-replaced updates + next-replacement maths). */
  items: ServiceRecordItem[];
  /** Human-readable roll-ups kept for display and backwards compatibility. */
  inspectedItems: string[];
  replacedItems: string[];
  repairedItems: string[];
  recommendedWork: string[];
  createdAt: string;
  updatedAt: string;
}

/**
 * A serviceable component tracked per vehicle. Next replacement km/date are
 * always calculated from the last replacement + interval, never stored.
 */
export interface MaintenanceItem {
  id: string;
  vehicleId: string;
  name: string;
  category: MaintenanceCategory;
  /** YYYY-MM-DD the item was last replaced/checked. */
  lastReplacedDate?: string;
  lastReplacedOdometerKm?: number;
  replacementIntervalKm?: number;
  replacementIntervalMonths?: number;
  brand?: string;
  partNumber?: string;
  /** Cost of the last replacement. */
  cost?: number;
  installedBy?: string;
  notes?: string;
  condition?: MaintenanceItemCondition;
  /** True for user-created items (vs. the seeded catalogue). */
  custom?: boolean;
  createdAt: string;
  updatedAt: string;
}

export type KnownIssueSeverity = 'low' | 'medium' | 'high' | 'critical';

export interface KnownVehicleIssue {
  id: string;
  vehicleId: string;
  title: string;
  description?: string;
  /** YYYY-MM-DD first noticed. */
  firstNoticedDate?: string;
  odometerWhenNoticedKm?: number;
  severity: KnownIssueSeverity;
  priority: VehiclePriority;
  estimatedRepairCostLow?: number;
  estimatedRepairCostHigh?: number;
  mechanicDiagnosis?: string;
  notes?: string;
  photos?: string[];
  status: KnownIssueStatus;
  /** Set when the issue was promoted into the next-service plan. */
  nextServiceItemId?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

/** A planned item for the next service. */
export interface NextServiceItem {
  id: string;
  vehicleId: string;
  /** Links to the tracked component that will be replaced, if any. */
  maintenanceItemId?: string;
  title: string;
  reason?: string;
  requirement: NextServiceRequirement;
  estimatedPartCost?: number;
  estimatedLabourCost?: number;
  /** Explicit override for the total; otherwise part + labour. */
  estimatedTotalCost?: number;
  notes?: string;
  priority: VehiclePriority;
  source: NextServiceItemSource;
  /** Set when this item originated from a known issue. */
  knownIssueId?: string;
  completed?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** A pre-service estimate for a part, tracking actual cost once completed. */
export interface PartEstimate {
  id: string;
  vehicleId: string;
  partName: string;
  estimatedPartPrice?: number;
  estimatedLabour?: number;
  quantity: number;
  supplier?: string;
  notes?: string;
  /** Filled in once the work is completed. */
  actualFinalPrice?: number;
  /** Optional link to a next-service plan item. */
  nextServiceItemId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ServiceTypeDefinition {
  id: string;
  name: string;
  /** Names of catalogue items that usually belong to this service type. */
  defaultItemNames?: string[];
  isDefault?: boolean;
}

export interface VehicleThresholds {
  /** Remaining km at/below which a service is "approaching". Default 2000. */
  approachingKm: number;
  /** Remaining km at/below which a service is "urgent". Default 500. */
  urgentKm: number;
}

export interface VehicleNotificationSettings {
  /** Only ever runs when the app-wide notification master switch is on. */
  enabled: boolean;
  odometerReminderMode: OdometerReminderMode;
  /** Used when mode is 'custom'. */
  odometerReminderIntervalDays: number;
  serviceApproaching: boolean;
  serviceDue: boolean;
  serviceOverdue: boolean;
  maintenanceApproaching: boolean;
  maintenanceDue: boolean;
  timeBasedMaintenance: boolean;
  knownIssueFollowUp: boolean;
  /** Hour of day (0-23) reminders should be raised. */
  remindHour: number;
}

/** One persisted notification job, keyed so cycles can never duplicate. */
export interface VehicleNotificationJob {
  /** Stable id: `<type>::<vehicleId>::<cycleKey>`. */
  id: string;
  vehicleId: string;
  type:
    | 'odometer_update'
    | 'service_approaching'
    | 'service_due'
    | 'service_overdue'
    | 'maintenance_approaching'
    | 'maintenance_due'
    | 'time_based'
    | 'known_issue';
  title: string;
  message: string;
  /** ISO timestamp the job targets. */
  scheduledFor: string;
  /** ISO timestamp it was last raised (undefined while pending). */
  firedAt?: string;
  /** Status mirrors the reminder notification history vocabulary. */
  status: 'pending' | 'fired' | 'cancelled';
}

export interface VehicleState {
  vehicles: Vehicle[];
  odometerRecords: OdometerRecord[];
  serviceRecords: ServiceRecord[];
  maintenanceItems: MaintenanceItem[];
  knownIssues: KnownVehicleIssue[];
  nextServiceItems: NextServiceItem[];
  partEstimates: PartEstimate[];
  serviceTypes: ServiceTypeDefinition[];
  thresholds: VehicleThresholds;
  notificationSettings: VehicleNotificationSettings;
  /** Persisted job log so a recalculating sweep can never duplicate or re-fire. */
  notificationJobs: VehicleNotificationJob[];
  /** Per-vehicle timestamp of the last odometer reminder that was raised. */
  lastOdometerReminders: Record<string, string>;
}

export const DEFAULT_VEHICLE_THRESHOLDS: VehicleThresholds = {
  approachingKm: 2000,
  urgentKm: 500,
};

export const DEFAULT_VEHICLE_NOTIFICATION_SETTINGS: VehicleNotificationSettings = {
  enabled: true,
  odometerReminderMode: 'disabled',
  odometerReminderIntervalDays: 7,
  serviceApproaching: true,
  serviceDue: true,
  serviceOverdue: true,
  maintenanceApproaching: true,
  maintenanceDue: true,
  timeBasedMaintenance: true,
  knownIssueFollowUp: true,
  remindHour: 9,
};

export const DEFAULT_SERVICE_TYPES: ServiceTypeDefinition[] = [
  { id: 'svc-minor', name: 'Minor service', isDefault: true, defaultItemNames: ['Engine oil', 'Oil filter'] },
  {
    id: 'svc-standard',
    name: 'Standard service',
    isDefault: true,
    defaultItemNames: ['Engine oil', 'Oil filter', 'Air filter', 'Brake inspection'],
  },
  {
    id: 'svc-major',
    name: 'Major service',
    isDefault: true,
    defaultItemNames: ['Engine oil', 'Oil filter', 'Air filter', 'Fuel filter', 'Spark plugs', 'Brake fluid', 'Coolant'],
  },
  { id: 'svc-inspection', name: 'Inspection', isDefault: true, defaultItemNames: [] },
  { id: 'svc-repair', name: 'Repair', isDefault: true, defaultItemNames: [] },
  { id: 'svc-tyres', name: 'Tyres', isDefault: true, defaultItemNames: ['Tyre rotation', 'Wheel alignment'] },
  { id: 'svc-brakes', name: 'Brakes', isDefault: true, defaultItemNames: ['Front brake pads', 'Rear brake pads'] },
  { id: 'svc-electrical', name: 'Electrical', isDefault: true, defaultItemNames: ['Battery', 'Alternator'] },
  { id: 'svc-emergency', name: 'Emergency repair', isDefault: true, defaultItemNames: [] },
  { id: 'svc-custom', name: 'Custom', isDefault: true, defaultItemNames: [] },
];
