import { Category, Reminder, NodePositionMap } from './index';
import { MoneyState } from './finance';
import { Contact } from './contact';
import { AppearanceSettings } from './appearance';
import { AppNotificationSettings, NotificationHistoryEntry } from './notifications';
import { DiagnosticPreferences, DiagnosticsHistoryEntry, LogEntry } from './diagnostics';
import { Routine } from './routine';
import { SmartEngineSettings } from './smartEngine';
import { VehicleState } from './vehicle';
import { PluginBackupSection, PluginRegistryState } from './plugin';

export interface AppPreferences {
  theme?: 'dark' | 'light' | 'system';
  radialDensity?: number;
  enableSound?: boolean;
  enableHaptics?: boolean;
  defaultReminderPriority?: 'low' | 'medium' | 'high';
  defaultReminderTime?: string;
  autoSaveIntervalMs?: number;
  [key: string]: unknown;
}

export interface MindMeshBackupData {
  categories: Category[];
  reminders: Reminder[];
  /** Optional for compatibility with backups created before Routine Builder. */
  routines?: Routine[];
  nodePositions: NodePositionMap;
  /** Optional for compatibility with backups created before Vehicle Maintenance. */
  vehicles?: VehicleState;
  money: MoneyState;
  contacts: Contact[];
  contactCategories?: string[];
  contactRelationships?: string[];
  appearance?: AppearanceSettings;
  notifications?: AppNotificationSettings;
  notificationHistory?: NotificationHistoryEntry[];
  smartEngineSettings?: SmartEngineSettings;
  preferences?: AppPreferences;
  /**
   * Diagnostics preferences always travel with a backup. Logs themselves are
   * only included when the user opts in (see DiagnosticPreferences).
   */
  diagnostics?: {
    preferences: DiagnosticPreferences;
    logs?: LogEntry[];
    history?: DiagnosticsHistoryEntry[];
  };
  /**
   * Plugin-owned data, keyed by plugin id. Additive: backups created before
   * the plugin architecture simply omit it and restore unchanged.
   */
  plugins?: Record<string, PluginBackupSection>;
  /**
   * Persisted plugin registry (install/enable state). Optional so older
   * backups remain valid; absent means "default plugin state".
   */
  pluginRegistry?: PluginRegistryState;
  statistics?: {
    totalCompletedCount?: number;
    lastResetAt?: string;
    [key: string]: unknown;
  };
}

export interface MindMeshBackupFile {
  backupVersion: number;
  appVersion: string;
  appName: string;
  createdAt: string;
  schemaVersion: number;
  data: MindMeshBackupData;
}

export interface RestoreSummary {
  createdAt: string;
  appVersion: string;
  backupVersion: number;
  schemaVersion: number;
  categoriesCount: number;
  remindersCount: number;
  completedRemindersCount: number;
  /** Total sequential Steps across all reminders (optional for older payloads). */
  stepCount?: number;
  /** Custom node positions included in the backup (optional for older payloads). */
  nodePositionsCount?: number;
  contactsCount: number;
  directDebitsCount: number;
  extraIncomeCount: number;
  tipsCount: number;
  shiftsCount: number;
  /** General (variable) expenses included in the backup (optional for older payloads). */
  expensesCount?: number;
  hasMoneyConfig: boolean;
  hasAppearance: boolean;
  appearanceTheme?: string;
  hasNotifications: boolean;
  notificationHistoryCount: number;
  scheduledNotificationsCount: number;
  hasDiagnosticLogs: boolean;
  diagnosticLogCount: number;
  diagnosticsPreferences?: DiagnosticPreferences;
  routineCount?: number;
  activeRoutineCount?: number;
  routineHistoryCount?: number;
  vehicleCount?: number;
  serviceRecordCount?: number;
  maintenanceItemCount?: number;
  knownIssueCount?: number;
  odometerRecordCount?: number;
  /** Number of plugin data sections included in the backup. */
  pluginSectionCount?: number;
  pluginSectionIds?: string[];
  warnings: string[];
}

export interface BackupValidationResult {
  valid: boolean;
  summary?: RestoreSummary;
  error?: string;
  backupFile?: MindMeshBackupFile;
}
