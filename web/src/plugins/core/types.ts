/**
 * MindMesh Plugin API — runtime contract.
 *
 * React-free metadata types live in `../../types/plugin` so Core storage and
 * backup can reference them without importing the plugin runtime. This file
 * adds the React/application-aware surface: routes, the host bridge, the
 * controlled PluginContext and the MindMeshPlugin contract.
 */
import type { ComponentType, Dispatch, SetStateAction } from 'react';
import type { Category, Reminder } from '../../types';
import type { AppNavTab, MoneyState } from '../../types/finance';
import type { VehicleState } from '../../types/vehicle';
import type { AppNotificationSettings } from '../../types/notifications';

export * from '../../types/plugin';
import type {
  PluginBackupSection,
  PluginErrorRecord,
  PluginHealth,
  PluginManifest,
  PluginMigration,
  PluginNodeType,
  PluginPermission,
  PluginSetting,
  PluginStatus,
} from '../../types/plugin';

// ---------------------------------------------------------------------------
// Controlled Plugin Context
// ---------------------------------------------------------------------------

/** Namespaced key/value storage owned by a single plugin. */
export interface PluginStorageApi {
  read<T>(key: string, fallback: T): T;
  write<T>(key: string, value: T): void;
  remove(key: string): void;
  keys(): string[];
}

export interface PluginNotificationApi {
  /** Raise an in-app notification for the plugin. Never touches Core alerts. */
  notify(title: string, message: string, details?: Record<string, unknown>): void;
  /**
   * Register this plugin's desired-notification provider with the shared
   * MindMesh notification engine. The engine reconciles the provider's pure
   * `getDesired(now)` answer against the platform scheduler exactly like
   * ordinary reminders, so plugin notifications survive the app being closed
   * and never duplicate. Registering again replaces the previous provider.
   */
  register(provider: Omit<PluginNotificationProvider, 'pluginId'>): void;
  /** Remove this plugin's provider so no further notifications are scheduled. */
  clear(): void;
}

/** A notification a plugin wants the shared engine to schedule. */
export interface PluginNotificationJob {
  /** Job id, unique within the plugin. Stable across recomputes. */
  id: string;
  title: string;
  body: string;
  /** Epoch milliseconds the notification targets. */
  fireAt: number;
  /** Stable key for one cycle of the notification. */
  cycleKey: string;
  /** Opaque reference handed back to the plugin on an action. */
  ref?: string;
}

export type PluginNotificationAction = 'complete' | 'snooze' | 'skip' | 'open';

/**
 * Generic contract between a plugin and the shared notification engine. Core
 * never knows what a plugin's notifications mean; it only schedules them and
 * routes user actions back through `onAction`.
 */
export interface PluginNotificationProvider {
  pluginId: string;
  /** Pure: the same `now` state always produces the same list. */
  getDesired(now: Date): PluginNotificationJob[];
  /** Called when the user acts on one of this plugin's notifications. */
  onAction?(action: PluginNotificationAction, job: PluginNotificationJob): void;
}

export interface PluginSchedulerJob {
  id: string;
  runAt: string;
  payload?: Record<string, unknown>;
}

export interface PluginSchedulerApi {
  schedule(job: PluginSchedulerJob): void;
  cancel(jobId: string): void;
  list(): PluginSchedulerJob[];
  clear(): void;
}

export interface PluginReminderApi {
  list(): Reminder[];
}

export interface PluginGraphApi {
  registerNodeType(nodeType: PluginNodeType): void;
  nodeTypes(): PluginNodeType[];
}

export interface PluginSettingsApi {
  get<T>(key: string, fallback: T): T;
  set<T>(key: string, value: T): void;
}

export interface PluginDiagnosticsApi {
  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, details?: Record<string, unknown>): void;
  report(message: string, details?: Record<string, unknown>): void;
}

export interface PluginNativeBridgeApi {
  /** True when a native bridge capability is present in this runtime. */
  available(capability: string): boolean;
}

export interface PluginContext {
  pluginId: string;
  coreVersion: string;
  apiVersion: string;
  storage: PluginStorageApi;
  notifications: PluginNotificationApi;
  scheduler: PluginSchedulerApi;
  reminders: PluginReminderApi;
  graph: PluginGraphApi;
  settings: PluginSettingsApi;
  diagnostics: PluginDiagnosticsApi;
  nativeBridge: PluginNativeBridgeApi;
}

// ---------------------------------------------------------------------------
// Host bridge (Core → plugin). Deliberately explicit and small.
// ---------------------------------------------------------------------------

/**
 * The application-owned state and actions a plugin route may use. Core passes
 * this into the plugin's route component; plugins cannot reach into arbitrary
 * application internals.
 */
export interface MindMeshHostAPI {
  moneyState: MoneyState;
  onUpdateMoneyState: Dispatch<SetStateAction<MoneyState>>;
  vehicleState: VehicleState;
  onUpdateVehicleState: Dispatch<SetStateAction<VehicleState>>;
  reminders: Reminder[];
  categories: Category[];
  onUpdateReminders: Dispatch<SetStateAction<Reminder[]>>;
  onUpdateCategories: Dispatch<SetStateAction<Category[]>>;
  notificationSettings: AppNotificationSettings;
  onOpenReminder: (reminderId: string) => void;
  navigateToTab: (tab: AppNavTab) => void;
}

export interface PluginRouteProps {
  context: PluginContext;
  host: MindMeshHostAPI;
}

/** A UI route a plugin contributes to primary navigation. */
export interface PluginRoute {
  id: string;
  tab: AppNavTab;
  label: string;
  component: ComponentType<PluginRouteProps>;
}

/**
 * The payload a plugin provides when it is serialized. The manager wraps it in
 * a full {@link PluginBackupSection} with identity metadata, settings and the
 * enablement flag so plugin code cannot accidentally drop data by omitting it.
 */
export interface PluginBackupPayload {
  /** The plugin's owned user data. */
  data: unknown;
  /** Optional plugin-specific history that is not part of `data`. */
  history?: unknown;
}

export interface PluginBackupHandler {
  /** Serialize the plugin's owned data for the backup file. */
  serialize(): PluginBackupPayload;
  /**
   * Apply a backup section. Must be idempotent and must never delete data on
   * failure — the restore pipeline isolates and logs plugin errors.
   */
  restore(section: PluginBackupSection): void;
}

/** A migration whose `run` receives the controlled context. */
export interface RuntimePluginMigration extends PluginMigration {
  run(context: PluginContext): void | Promise<void>;
}

// ---------------------------------------------------------------------------
// The plugin contract
// ---------------------------------------------------------------------------

export interface MindMeshPlugin {
  manifest: PluginManifest;
  /**
   * Whether the plugin is enabled the first time it is seen. Enables the
   * "architecturally invisible" migration: a feature that used to be built in
   * keeps working until the user explicitly disables it.
   */
  defaultEnabled?: boolean;
  /** Optional legacy-data probe used to preserve a previously-active feature. */
  detectExistingData?: (host: MindMeshHostAPI) => boolean;
  activate(context: PluginContext): void | Promise<void>;
  deactivate(context: PluginContext): void | Promise<void>;
  /** Explicit, user-confirmed data removal. Never called by disable. */
  deleteData?(context: PluginContext): void;
  routes?: PluginRoute[];
  settings?: PluginSetting[];
  graphNodeTypes?: PluginNodeType[];
  backup?: PluginBackupHandler;
  migrations?: RuntimePluginMigration[];
  health?(context: PluginContext): PluginHealth;
}

/** Read-only view of a plugin for the Plugin Manager UI and diagnostics. */
export interface PluginView {
  id: string;
  name: string;
  description: string;
  version: string;
  installedVersion: string;
  minimumCoreVersion: string;
  apiVersion: string;
  author?: string;
  status: PluginStatus;
  enabled: boolean;
  installed: boolean;
  coreCompatible: boolean;
  permissions: PluginPermission[];
  dependencies: string[];
  pendingMigrationIds: string[];
  routes: { id: string; tab: AppNavTab; label: string }[];
  lastError?: PluginErrorRecord;
}
