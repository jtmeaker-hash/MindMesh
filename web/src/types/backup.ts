import { Category, Reminder, NodePositionMap } from './index';
import { MoneyState } from './finance';
import { Contact } from './contact';

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
  nodePositions: NodePositionMap;
  money: MoneyState;
  contacts: Contact[];
  contactCategories?: string[];
  contactRelationships?: string[];
  preferences?: AppPreferences;
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
  contactsCount: number;
  directDebitsCount: number;
  extraIncomeCount: number;
  tipsCount: number;
  shiftsCount: number;
  hasMoneyConfig: boolean;
  warnings: string[];
}

export interface BackupValidationResult {
  valid: boolean;
  summary?: RestoreSummary;
  error?: string;
  backupFile?: MindMeshBackupFile;
}
