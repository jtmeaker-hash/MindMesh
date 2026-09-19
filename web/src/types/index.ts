export type Priority = 'low' | 'medium' | 'high';

export interface Subtask {
  id: string;
  reminderId: string;
  title: string;
  completed: boolean;
  createdAt: string;
  completedAt?: string;
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
}

export interface Category {
  id: string;
  name: string;
  color: string;
  icon?: string;
  createdAt: string;
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
}

export type ViewMode = 'active' | 'completed';

export interface MeshNodeData extends Record<string, unknown> {
  id: string;
  label: string;
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
  categoryId?: string;
  reminderId?: string;
  isFocused?: boolean;
  isCompletedView?: boolean;
  manuallyPositioned?: boolean;
  onNodeClick?: (nodeId: string, type: string) => void;
  onSubtaskToggle?: (subtaskId: string, reminderId: string) => void;
  onReminderCompleteToggle?: (reminderId: string) => void;
}

