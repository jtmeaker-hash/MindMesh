import { Node, Edge } from '@xyflow/react';
import { Category, Reminder, MeshNodeData, NodePositionMap } from '../types';
import { Contact } from '../types/contact';
import { AppearanceSettings } from '../types/appearance';
import { accentForNodeType, getDefaultAppearance, resolveNodeTheme, withAlpha } from '../services/appearance';
import { getChildCategories } from '../services/categories';

export interface NestedGraphElements { nodes: Node<MeshNodeData>[]; edges: Edge[] }

type Callbacks = {
  onNodeClick?: (nodeId: string, type: string) => void;
  onSubtaskToggle?: (subtaskId: string, reminderId: string) => void;
  onReminderCompleteToggle?: (reminderId: string) => void;
};

function themeFor(appearance: AppearanceSettings, accent: string, completed = false) {
  const theme = resolveNodeTheme(appearance, accent);
  return { ...theme, glow: withAlpha(accent, completed ? 0.22 : 0.35), hover: appearance.nodeColors.hover };
}

export function generateNestedActiveMesh(
  categories: Category[], reminders: Reminder[], focusedCategoryId: string | null | undefined,
  callbacks: Callbacks, manualPositions: NodePositionMap = {}, contacts: Contact[] = [],
  appearance: AppearanceSettings = getDefaultAppearance(),
  _notificationStatus?: Record<string, unknown>,
): NestedGraphElements {
  const nodes: Node<MeshNodeData>[] = [];
  const edges: Edge[] = [];
  const activeReminders = reminders.filter((reminder) => !reminder.completed);
  const customNodes = appearance.nodeColorMode === 'custom';
  const customLines = appearance.connectionColorMode === 'custom';
  const rootPosition = manualPositions.root?.manuallyPositioned ? manualPositions.root : { x: 0, y: 0 };
  const rootTheme = themeFor(appearance, accentForNodeType(appearance, 'root'));

  nodes.push({ id: 'root', type: 'rootNode', position: { x: rootPosition.x, y: rootPosition.y }, zIndex: 20, data: {
    id: 'root', label: 'MindMesh', type: 'root', color: rootTheme.accent, accentColor: rootTheme.accent,
    surfaceColor: rootTheme.surface, surfaceAltColor: rootTheme.surfaceAlt, textColor: rootTheme.text,
    mutedTextColor: rootTheme.mutedText, borderColor: rootTheme.border, glowColor: rootTheme.glow, hoverColor: rootTheme.hover,
    count: activeReminders.length, onNodeClick: callbacks.onNodeClick,
  }});

  const renderSubtasks = (reminder: Reminder, x: number, y: number, color: string, parentAngle: number) => {
    reminder.subtasks.forEach((subtask, index) => {
      const angle = parentAngle - 0.45 + (reminder.subtasks.length === 1 ? 0.45 : index * 0.9 / (reminder.subtasks.length - 1));
      const distance = 125 + (index % 2) * 24;
      const manual = manualPositions[subtask.id];
      const subX = manual?.manuallyPositioned ? manual.x : Math.round(x + distance * Math.cos(angle));
      const subY = manual?.manuallyPositioned ? manual.y : Math.round(y + distance * Math.sin(angle));
      const subTheme = themeFor(appearance, customNodes ? accentForNodeType(appearance, 'subtask') : color, subtask.completed);
      nodes.push({ id: subtask.id, type: 'subtaskNode', position: { x: subX, y: subY }, zIndex: 1, data: {
        id: subtask.id, label: subtask.title, type: 'subtask', color: subTheme.accent, accentColor: subTheme.accent,
        surfaceColor: subTheme.surface, surfaceAltColor: subTheme.surfaceAlt, textColor: subTheme.text,
        mutedTextColor: subTheme.mutedText, borderColor: subTheme.border, glowColor: subTheme.glow, hoverColor: subTheme.hover,
        completed: subtask.completed, reminderId: reminder.id, onNodeClick: callbacks.onNodeClick, onSubtaskToggle: callbacks.onSubtaskToggle,
      }});
      edges.push({ id: `edge-${reminder.id}-${subtask.id}`, source: reminder.id, target: subtask.id, style: {
        stroke: subtask.completed ? (customLines ? appearance.connectionColors.completed : '#475569') : (customLines ? appearance.connectionColors.subtask : color),
        strokeWidth: 1.4, strokeOpacity: subtask.completed ? 0.35 : 0.55, strokeDasharray: subtask.completed ? '4 4' : undefined,
      }});
    });
  };

  const renderCategory = (category: Category, parentX: number, parentY: number, branchIndex: number, depth: number, parentId: string) => {
    const children = getChildCategories(categories, category.id);
    const siblingCount = getChildCategories(categories, category.parentCategoryId ?? null).length;
    const angle = (2 * Math.PI * branchIndex) / Math.max(siblingCount, 1) - Math.PI / 2;
    const distance = depth === 0 ? 230 : 190;
    const manual = manualPositions[category.id];
    const x = manual?.manuallyPositioned ? manual.x : Math.round(parentX + distance * Math.cos(angle));
    const y = manual?.manuallyPositioned ? manual.y : Math.round(parentY + distance * Math.sin(angle));
    const focused = focusedCategoryId === category.id;
    const accent = customNodes ? accentForNodeType(appearance, 'category') : category.color;
    const catTheme = themeFor(appearance, focused ? appearance.nodeColors.selected : accent);
    const branchReminders = activeReminders.filter((reminder) => reminder.categoryId === category.id);
    const descendants = children.length + branchReminders.length;

    nodes.push({ id: category.id, type: 'categoryNode', position: { x, y }, zIndex: 10 - depth, data: {
      id: category.id, label: category.name, type: 'category', color: catTheme.accent, accentColor: catTheme.accent,
      surfaceColor: catTheme.surface, surfaceAltColor: catTheme.surfaceAlt, textColor: catTheme.text,
      mutedTextColor: catTheme.mutedText, borderColor: catTheme.border, glowColor: catTheme.glow, hoverColor: catTheme.hover,
      count: descendants, isFocused: focused, onNodeClick: callbacks.onNodeClick,
    }});
    edges.push({ id: `edge-${parentId}-${category.id}`, source: parentId, target: category.id, animated: focused, style: {
      stroke: customLines ? appearance.connectionColors.branch : category.color, strokeWidth: focused ? 3.5 : 2.2, strokeOpacity: focused ? 0.95 : 0.6,
    }});

    branchReminders.forEach((reminder, index) => {
      const reminderAngle = angle - 0.65 + (branchReminders.length === 1 ? 0.65 : index * 1.3 / (branchReminders.length - 1));
      const reminderDistance = focused ? 225 : 190;
      const reminderManual = manualPositions[reminder.id];
      const reminderX = reminderManual?.manuallyPositioned ? reminderManual.x : Math.round(x + reminderDistance * Math.cos(reminderAngle));
      const reminderY = reminderManual?.manuallyPositioned ? reminderManual.y : Math.round(y + reminderDistance * Math.sin(reminderAngle));
      const remTheme = themeFor(appearance, customNodes ? accentForNodeType(appearance, 'reminder') : category.color, reminder.completed);
      const linkedContact = contacts.find((contact) => contact.id === reminder.linkedContactId);
      nodes.push({ id: reminder.id, type: 'reminderNode', position: { x: reminderX, y: reminderY }, zIndex: 5, data: {
        id: reminder.id, label: reminder.title, summary: reminder.summary?.trim() || undefined, description: reminder.description?.trim() || undefined,
        type: 'reminder', color: remTheme.accent, accentColor: remTheme.accent, surfaceColor: remTheme.surface, surfaceAltColor: remTheme.surfaceAlt,
        textColor: remTheme.text, mutedTextColor: remTheme.mutedText, borderColor: remTheme.border, glowColor: remTheme.glow, hoverColor: remTheme.hover,
        priority: reminder.priority, completed: reminder.completed, dueDate: reminder.dueDate, dueTime: reminder.dueTime, recurrence: reminder.recurrence,
        isRecurring: reminder.recurrence?.frequency !== 'none', categoryId: category.id, subtaskCount: reminder.subtasks.length,
        completedSubtaskCount: reminder.subtasks.filter((subtask) => subtask.completed).length, linkedContactId: reminder.linkedContactId,
        linkedContactName: linkedContact ? (linkedContact.displayName || linkedContact.fullName) : undefined,
        isFinancialLinked: Boolean(reminder.linkedBillId || reminder.linkedExtraIncomeId), onNodeClick: callbacks.onNodeClick,
        onReminderCompleteToggle: callbacks.onReminderCompleteToggle,
      }});
      edges.push({ id: `edge-${category.id}-${reminder.id}`, source: category.id, target: reminder.id, style: {
        stroke: customLines ? appearance.connectionColors.reminder : category.color, strokeWidth: focused ? 2.5 : 1.8, strokeOpacity: focused ? 0.85 : 0.5,
      }});
      renderSubtasks(reminder, reminderX, reminderY, category.color, reminderAngle);
    });
    children.forEach((child, index) => renderCategory(child, x, y, index, depth + 1, category.id));
  };

  getChildCategories(categories, null).forEach((category, index) => renderCategory(category, rootPosition.x, rootPosition.y, index, 0, 'root'));
  return { nodes, edges };
}

/** Completed overview keeps the root-to-category tree, including arbitrary nested categories. */
export function generateNestedCompletedOverviewMesh(
  categories: Category[], reminders: Reminder[], callbacks: Pick<Callbacks, 'onNodeClick'> = {},
  manualPositions: NodePositionMap = {}, appearance: AppearanceSettings = getDefaultAppearance(),
): NestedGraphElements {
  const nodes: Node<MeshNodeData>[] = [];
  const edges: Edge[] = [];
  const completed = reminders.filter((reminder) => reminder.completed);
  const root = manualPositions['completed-root'];
  const rootPosition = root?.manuallyPositioned ? root : { x: 0, y: 0 };
  const rootTheme = themeFor(appearance, accentForNodeType(appearance, 'root'), true);
  nodes.push({ id: 'completed-root', type: 'rootNode', position: rootPosition, zIndex: 20, data: {
    id: 'completed-root', label: 'Completed', type: 'root', isCompletedView: true, count: completed.length,
    color: rootTheme.accent, accentColor: rootTheme.accent, surfaceColor: rootTheme.surface, surfaceAltColor: rootTheme.surfaceAlt,
    textColor: rootTheme.text, mutedTextColor: rootTheme.mutedText, borderColor: rootTheme.border, glowColor: rootTheme.glow,
    hoverColor: rootTheme.hover, onNodeClick: callbacks.onNodeClick,
  }});
  const countFor = (id: string): number => completed.filter((reminder) => reminder.categoryId === id).length + getChildCategories(categories, id).reduce((sum, child) => sum + countFor(child.id), 0);
  const visit = (category: Category, parentId: string, parentX: number, parentY: number, index: number, depth: number) => {
    const siblings = getChildCategories(categories, category.parentCategoryId ?? null).length;
    const angle = (2 * Math.PI * index) / Math.max(siblings, 1) - Math.PI / 2;
    const distance = depth === 0 ? 240 : 190;
    const manual = manualPositions[category.id];
    const position = manual?.manuallyPositioned ? manual : { x: Math.round(parentX + distance * Math.cos(angle)), y: Math.round(parentY + distance * Math.sin(angle)) };
    const theme = themeFor(appearance, category.color, true);
    nodes.push({ id: category.id, type: 'categoryNode', position, zIndex: 10 - depth, data: {
      id: category.id, label: category.name, type: 'category', isCompletedView: true, completedCount: countFor(category.id),
      color: theme.accent, accentColor: theme.accent, surfaceColor: theme.surface, surfaceAltColor: theme.surfaceAlt,
      textColor: theme.text, mutedTextColor: theme.mutedText, borderColor: theme.border, glowColor: theme.glow, hoverColor: theme.hover,
      onNodeClick: callbacks.onNodeClick,
    }});
    edges.push({ id: `edge-completed-${parentId}-${category.id}`, source: parentId, target: category.id, style: { stroke: category.color, strokeWidth: 2, strokeOpacity: countFor(category.id) > 0 ? 0.7 : 0.3 } });
    getChildCategories(categories, category.id).forEach((child, childIndex) => visit(child, category.id, position.x, position.y, childIndex, depth + 1));
  };
  getChildCategories(categories, null).forEach((category, index) => visit(category, 'completed-root', rootPosition.x, rootPosition.y, index, 0));
  return { nodes, edges };
}
