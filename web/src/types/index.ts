export type Priority = 'low' | 'medium' | 'high';

export * from './routine';

export interface Subtask {
  id: string;
  reminderId: string;
  title: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
}

/**
 * A Step is a strict, ordered process item. Unlike an independent Subtask, Steps
 * must be completed sequentially: only the first incomplete Step is actionable.
 * Steps live in their own persisted array and share no business logic with
 * Subtasks beyond both hanging off a Reminder.
 */
export interface Step {
  id: string;
  reminderId: string;
  title: string;
  description?: string;
  /** Position in the ordered sequence. Stable identity is `id`, not this index. */
  order: number;
  completed: boolean;
  completedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export type RecurrenceFrequency = 'none' | 'daily' | 'weekly' | 'monthly' | 'custom';

export type CustomRecurrenceUnit = 'day' | 'week' | 'month';

export interface RecurrenceRule {
  frequency: RecurrenceFrequency;
  interval?: number; // e.g. 1 (every 1 day/week/month) or 2, 3...
  unit?: CustomRecurrenceUnit; // for custom frequency
  daysOfWeek?: number[]; // 0 = Sun, 1 = Mon, ..., 6 = Sat
  endAfterOccurrences?: number;
  endDate?: string; // YYYY-MM-DD
}

export interface Reminder {
  id: string;
  categoryId: string;
  title: string;
  /** Longer context shown in reminder details and used by local Smart Assistance enhancement. */
  description?: string;
  /** Compact text intended for graph nodes and other dense surfaces. */
  summary?: string;
  notes?: string;
  dueDate?: string;
  dueTime?: string;
  priority: Priority;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
  recurrence?: RecurrenceRule;
  recurringSeriesId?: string;
  occurrenceCount?: number;
  subtasks: Subtask[];
  /**
   * Ordered sequential process items. Optional for backwards compatibility with
   * reminders stored before Steps existed; normalized to an array on load.
   */
  steps?: Step[];
  /**
   * Independent enable switch for the Subtask checklist system. Absent on legacy
   * reminders and derived from whether subtasks exist during normalization.
   */
  enableSubtasks?: boolean;
  /**
   * Independent enable switch for the sequential Steps system. Enabling Steps
   * never enables Subtasks and vice versa.
   */
  enableSteps?: boolean;
  linkedBillId?: string;
  linkedExtraIncomeId?: string;
  linkedContactId?: string;
  /** Optional per-reminder notification configuration (see types/notifications). */
  notifications?: import('./notifications').ReminderNotificationSettings;
  /** Set while a notification for this reminder is snoozed. */
  snoozeUntil?: string;
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string;
  /** Stable parent link; undefined/null means this is a root category. */
  parentCategoryId?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface NodePosition {
  nodeId: string;
  x: number;
  y: number;
  manuallyPositioned: boolean;
  updatedAt?: string;
}

export type NodePositionMap = Record<string, NodePosition>;

export interface MindMeshStorageData {
  version: number;
  categories: Category[];
  reminders: Reminder[];
  nodePositions: NodePositionMap;
  lastUpdated: string;
  money?: import('./finance').MoneyState;
  contacts?: import('./contact').Contact[];
  contactCategories?: string[];
  contactRelationships?: string[];
  preferences?: Record<string, unknown>;
  appearance?: import('./appearance').AppearanceSettings;
  notifications?: import('./notifications').AppNotificationSettings;
  notificationHistory?: import('./notifications').NotificationHistoryEntry[];
  /** Local Smart Engine preferences; absent in older payloads and restored to safe defaults. */
  smartEngineSettings?: import('./smartEngine').SmartEngineSettings;
  /** Optional so pre-Routine backups and local payloads remain readable. */
  routines?: import('./routine').Routine[];
  /** Optional so payloads stored before Vehicle Maintenance remain readable. */
  vehicles?: import('./vehicle').VehicleState;
}

export * from './finance';
export * from './contact';
export * from './backup';
export * from './appearance';
export * from './notifications';
export * from './diagnostics';
export * from './smartEngine';
export * from './vehicle';

export type ViewMode = 'active' | 'completed';

export interface MeshNodeData extends Record<string, unknown> {
  id: string;
  label: string;
  /** Compact reminder summary, never the full description. */
  summary?: string;
  description?: string;
  type: 'root' | 'category' | 'reminder' | 'subtask';
  color?: string;
  count?: number;
  completedCount?: number;
  totalCount?: number;
  priority?: Priority;
  completed?: boolean;
  dueDate?: string;
  dueTime?: string;
  recurrence?: RecurrenceRule;
  isRecurring?: boolean;
  subtaskCount?: number;
  completedSubtaskCount?: number;
  /** Sequential Step progress surfaced in reminder/node detail information. */
  hasSteps?: boolean;
  stepCount?: number;
  completedStepCount?: number;
  /** 1-based number of the current (first incomplete) Step, 0 when all complete. */
  currentStepNumber?: number;
  categoryId?: string;
  reminderId?: string;
  isFocused?: boolean;
  isCompletedView?: boolean;
  manuallyPositioned?: boolean;
  isFinancialLinked?: boolean;
  linkedBillTitle?: string;
  linkedContactId?: string;
  linkedContactName?: string;
  /** Compact notification indicator data for the node badge. */
  notificationState?: 'off' | 'on' | 'permission' | 'failed' | 'unsupported';
  notificationLabel?: string;
  notificationCount?: number;
  /** Routine graph state used by both the 2D and SpatialGraph adapters. */
  isRoutineNode?: boolean;
  routineState?: 'active' | 'current' | 'completed' | 'upcoming';
  isDependency?: boolean;
  dependencyLabel?: string;
  // Appearance-resolved theme values (set by the layout generator)
  accentColor?: string;
  surfaceColor?: string;
  surfaceAltColor?: string;
  textColor?: string;
  mutedTextColor?: string;
  borderColor?: string;
  glowColor?: string;
  hoverColor?: string;
  onNodeClick?: (nodeId: string, type: string) => void;
  onSubtaskToggle?: (subtaskId: string, reminderId: string) => void;
  onReminderCompleteToggle?: (reminderId: string) => void;
}

