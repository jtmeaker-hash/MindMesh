import { Node, Edge } from '@xyflow/react';
import { Category, Reminder, MeshNodeData, NodePositionMap } from '../types';
import { Contact } from '../types/contact';
import { AppearanceSettings } from '../types/appearance';
import {
  accentForNodeType,
  connectionStrokeStyle,
  getDefaultAppearance,
  resolveNodeTheme,
  withAlpha,
} from '../services/appearance';
import { getChildCategories } from '../services/categories';
import { createPlacementGrid } from '../services/nodePositions';

export interface NestedGraphElements { nodes: Node<MeshNodeData>[]; edges: Edge[] }

type Callbacks = {
  onNodeClick?: (nodeId: string, type: string) => void;
  onSubtaskToggle?: (subtaskId: string, reminderId: string) => void;
  onReminderCompleteToggle?: (reminderId: string) => void;
};

/**
 * MindMesh graphs are laid out in an unbounded world coordinate space, not in
 * screen space. The camera travels around the world, so the layout engine never
 * reads the viewport size and never clamps nodes to a fixed box.
 *
 * Spacing is hierarchical and proportional to the size of each branch: a
 * category holding fifteen reminders receives far more angular room and a
 * larger radius than one holding three.
 */
const NODE_SIZES = {
  root: { width: 104, height: 104 },
  category: { width: 78, height: 78 },
  reminder: { width: 165, height: 100 },
  subtask: { width: 130, height: 42 },
} as const;

/**
 * Minimum empty gap kept between the edges of two neighbouring nodes. This is
 * deliberately roomy: the gap has to hold node labels, badges and the finger / 
 * cursor hit area, so neighbouring nodes must never just barely touch.
 */
const SPACING = {
  root: 72,
  category: 120,
  reminder: 96,
  subtask: 56,
} as const;

const CATEGORY_BASE_RADIUS = 380;
const CATEGORY_WEIGHT_RADIUS = 44;
const CATEGORY_MAX_WEIGHT_RADIUS = 1500;
const NESTED_CATEGORY_MIN_DISTANCE = 300;
const REMINDER_BASE_DISTANCE = 330;
const REMINDER_WEIGHT_DISTANCE = 34;
const REMINDER_MAX_WEIGHT_DISTANCE = 1100;
const SUBTASK_DISTANCE = 200;
const SUBTASK_WEIGHT_DISTANCE = 14;

type Size = { width: number; height: number };
type Point = { x: number; y: number };

function themeFor(appearance: AppearanceSettings, accent: string, completed = false) {
  const theme = resolveNodeTheme(appearance, accent);
  return { ...theme, glow: withAlpha(accent, completed ? 0.22 : 0.35), hover: appearance.nodeColors.hover };
}

/**
 * Fold the user's connection brightness/contrast into an edge style. Only width
 * and alpha are touched, so the chosen connection colours and dash patterns are
 * preserved exactly.
 */
function lineStyle(
  appearance: AppearanceSettings,
  stroke: string,
  width: number,
  opacity: number,
  extra: Record<string, unknown> = {},
) {
  return { stroke, ...connectionStrokeStyle(appearance, width, opacity), ...extra };
}

/** Total rendered descendants (reminders, their subtasks and nested categories). */
function subtreeNodeCount(categories: Category[], reminders: Reminder[], categoryId: string): number {
  const own = reminders.filter((reminder) => reminder.categoryId === categoryId);
  let count = own.length + own.reduce((sum, reminder) => sum + reminder.subtasks.length, 0);
  for (const child of getChildCategories(categories, categoryId)) {
    count += subtreeNodeCount(categories, reminders, child.id);
  }
  return count;
}

/**
 * Distributes angular space in proportion to branch weight so large branches
 * never share almost identical angles with their neighbours.
 */
function allocateAngles(weights: number[], startAngle: number, span = Math.PI * 2) {
  const total = weights.reduce((sum, weight) => sum + weight, 0) || 1;
  let cursor = startAngle;
  return weights.map((weight) => {
    const share = (span * Math.max(weight, 1)) / total;
    const angle = cursor + share / 2;
    cursor += share;
    return { angle, share };
  });
}

function categoryRadius(weight: number): number {
  return CATEGORY_BASE_RADIUS + Math.min(CATEGORY_MAX_WEIGHT_RADIUS, CATEGORY_WEIGHT_RADIUS * Math.sqrt(Math.max(weight, 1)));
}

function reminderDistance(count: number): number {
  return Math.min(REMINDER_MAX_WEIGHT_DISTANCE, REMINDER_BASE_DISTANCE + count * REMINDER_WEIGHT_DISTANCE);
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
  const grid = createPlacementGrid();

  // Reserve every manually positioned node up-front so automatic placement can
  // route around it regardless of the order branches are generated in.
  const visibleIds = new Set<string>(['root']);
  const sizeFor = (id: string): Size => {
    const reminder = activeReminders.find((entry) => entry.id === id);
    if (reminder) return NODE_SIZES.reminder;
    if (activeReminders.some((entry) => entry.subtasks.some((subtask) => subtask.id === id))) {
      return NODE_SIZES.subtask;
    }
    return NODE_SIZES.category;
  };
  categories.forEach((category) => visibleIds.add(category.id));
  activeReminders.forEach((reminder) => {
    visibleIds.add(reminder.id);
    reminder.subtasks.forEach((subtask) => visibleIds.add(subtask.id));
  });
  for (const [id, position] of Object.entries(manualPositions)) {
    if (position?.manuallyPositioned && visibleIds.has(id)) {
      grid.reserve({ x: position.x, y: position.y }, sizeFor(id));
    }
  }

  const place = (
    ideal: Point,
    manual: { x: number; y: number; manuallyPositioned?: boolean } | undefined,
    size: Size,
    spacing: number,
  ): Point => {
    // Manual positions were reserved up-front and are never moved.
    if (manual?.manuallyPositioned) return { x: manual.x, y: manual.y };
    return grid.place(ideal, size, spacing);
  };

  const rootPosition = place(
    { x: 0, y: 0 },
    manualPositions.root,
    NODE_SIZES.root,
    SPACING.root,
  );
  const rootTheme = themeFor(appearance, accentForNodeType(appearance, 'root'));

  nodes.push({ id: 'root', type: 'rootNode', position: { x: rootPosition.x, y: rootPosition.y }, zIndex: 20, data: {
    id: 'root', label: 'MindMesh', type: 'root', color: rootTheme.accent, accentColor: rootTheme.accent,
    surfaceColor: rootTheme.surface, surfaceAltColor: rootTheme.surfaceAlt, textColor: rootTheme.text,
    mutedTextColor: rootTheme.mutedText, borderColor: rootTheme.border, glowColor: rootTheme.glow, hoverColor: rootTheme.hover,
    count: activeReminders.length, onNodeClick: callbacks.onNodeClick,
  }});

  const renderSubtasks = (reminder: Reminder, x: number, y: number, color: string, parentAngle: number) => {
    const count = reminder.subtasks.length;
    const span = Math.min(Math.PI * 0.95, Math.max(0.4, count * 0.4));
    const startAngle = parentAngle - span / 2;
    const step = count <= 1 ? 0 : span / (count - 1);

    reminder.subtasks.forEach((subtask, index) => {
      const angle = count === 1 ? parentAngle : startAngle + index * step;
      // Steps of a long checklist push outward instead of crowding one arc.
      const distance = SUBTASK_DISTANCE + count * SUBTASK_WEIGHT_DISTANCE + (index % 2) * 26;
      const manual = manualPositions[subtask.id];
      const subPosition = place(
        { x: Math.round(x + distance * Math.cos(angle)), y: Math.round(y + distance * Math.sin(angle)) },
        manual,
        NODE_SIZES.subtask,
        SPACING.subtask,
      );
      const subTheme = themeFor(appearance, customNodes ? accentForNodeType(appearance, 'subtask') : color, subtask.completed);
      nodes.push({ id: subtask.id, type: 'subtaskNode', position: { x: subPosition.x, y: subPosition.y }, zIndex: 1, data: {
        id: subtask.id, label: subtask.title, type: 'subtask', color: subTheme.accent, accentColor: subTheme.accent,
        surfaceColor: subTheme.surface, surfaceAltColor: subTheme.surfaceAlt, textColor: subTheme.text,
        mutedTextColor: subTheme.mutedText, borderColor: subTheme.border, glowColor: subTheme.glow, hoverColor: subTheme.hover,
        completed: subtask.completed, reminderId: reminder.id, onNodeClick: callbacks.onNodeClick, onSubtaskToggle: callbacks.onSubtaskToggle,
      }});
      edges.push({ id: `edge-${reminder.id}-${subtask.id}`, source: reminder.id, target: subtask.id, style: lineStyle(
        appearance,
        subtask.completed ? (customLines ? appearance.connectionColors.completed : '#475569') : (customLines ? appearance.connectionColors.subtask : color),
        1.4,
        subtask.completed ? 0.35 : 0.55,
        subtask.completed ? { strokeDasharray: '4 4' } : {},
      )});
    });
  };

  const renderCategory = (
    category: Category,
    parentX: number,
    parentY: number,
    angle: number,
    share: number,
    distance: number,
    depth: number,
    parentId: string,
  ) => {
    const children = getChildCategories(categories, category.id);
    const manual = manualPositions[category.id];
    const categoryPosition = place(
      { x: Math.round(parentX + distance * Math.cos(angle)), y: Math.round(parentY + distance * Math.sin(angle)) },
      manual,
      NODE_SIZES.category,
      SPACING.category,
    );
    const x = categoryPosition.x;
    const y = categoryPosition.y;
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
    edges.push({ id: `edge-${parentId}-${category.id}`, source: parentId, target: category.id, animated: focused, style: lineStyle(
      appearance,
      customLines ? appearance.connectionColors.branch : category.color,
      focused ? 3.5 : 2.2,
      focused ? 0.95 : 0.6,
    )});

    // Reminders fan outward through the category's angular wedge.
    const reminderCount = branchReminders.length;
    const fanSpan = reminderCount <= 1 ? 0 : Math.min(Math.PI * 1.2, Math.max(0.55, reminderCount * 0.42));
    const startAngle = angle - fanSpan / 2;
    const step = reminderCount <= 1 ? 0 : fanSpan / (reminderCount - 1);
    const baseDistance = reminderDistance(reminderCount) + (focused ? 40 : 0);

    branchReminders.forEach((reminder, index) => {
      const reminderAngle = reminderCount === 1 ? angle : startAngle + index * step;
      const manualReminder = manualPositions[reminder.id];
      const reminderPosition = place(
        { x: Math.round(x + baseDistance * Math.cos(reminderAngle)), y: Math.round(y + baseDistance * Math.sin(reminderAngle)) },
        manualReminder,
        NODE_SIZES.reminder,
        SPACING.reminder,
      );
      const reminderX = reminderPosition.x;
      const reminderY = reminderPosition.y;
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
      edges.push({ id: `edge-${category.id}-${reminder.id}`, source: category.id, target: reminder.id, style: lineStyle(
        appearance,
        customLines ? appearance.connectionColors.reminder : category.color,
        focused ? 2.5 : 1.8,
        focused ? 0.85 : 0.5,
      )});
      renderSubtasks(reminder, reminderX, reminderY, category.color, reminderAngle);
    });

    // Nested categories split the parent's wedge by their own weight.
    const childWeights = children.map((child) => Math.max(1, subtreeNodeCount(categories, activeReminders, child.id)));
    const childPlan = allocateAngles(childWeights, angle - share / 2, share);
    children.forEach((child, index) => {
      const childShare = childPlan[index]?.share ?? share / Math.max(children.length, 1);
      const childAngle = childPlan[index]?.angle ?? angle;
      const childDistance = Math.max(NESTED_CATEGORY_MIN_DISTANCE, distance * 0.78);
      renderCategory(child, x, y, childAngle, childShare, childDistance, depth + 1, category.id);
    });
  };

  const rootCategories = getChildCategories(categories, null);
  const rootWeights = rootCategories.map((category) => Math.max(1, subtreeNodeCount(categories, activeReminders, category.id)));
  const rootPlan = allocateAngles(rootWeights, -Math.PI / 2);
  rootCategories.forEach((category, index) => {
    const share = rootPlan[index]?.share ?? (Math.PI * 2) / Math.max(rootCategories.length, 1);
    const angle = rootPlan[index]?.angle ?? -Math.PI / 2;
    renderCategory(category, rootPosition.x, rootPosition.y, angle, share, categoryRadius(rootWeights[index]), 0, 'root');
  });

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
  const grid = createPlacementGrid();

  for (const position of Object.values(manualPositions)) {
    if (position?.manuallyPositioned) {
      grid.reserve({ x: position.x, y: position.y }, NODE_SIZES.category);
    }
  }

  const place = (
    ideal: Point,
    manual: { x: number; y: number; manuallyPositioned?: boolean } | undefined,
    size: Size,
    spacing: number,
  ): Point => {
    if (manual?.manuallyPositioned) return { x: manual.x, y: manual.y };
    return grid.place(ideal, size, spacing);
  };

  const root = manualPositions['completed-root'];
  const rootPosition = place({ x: 0, y: 0 }, root, NODE_SIZES.root, SPACING.root);
  const rootTheme = themeFor(appearance, accentForNodeType(appearance, 'root'), true);
  nodes.push({ id: 'completed-root', type: 'rootNode', position: rootPosition, zIndex: 20, data: {
    id: 'completed-root', label: 'Completed', type: 'root', isCompletedView: true, count: completed.length,
    color: rootTheme.accent, accentColor: rootTheme.accent, surfaceColor: rootTheme.surface, surfaceAltColor: rootTheme.surfaceAlt,
    textColor: rootTheme.text, mutedTextColor: rootTheme.mutedText, borderColor: rootTheme.border, glowColor: rootTheme.glow,
    hoverColor: rootTheme.hover, onNodeClick: callbacks.onNodeClick,
  }});

  const countFor = (id: string): number => completed.filter((reminder) => reminder.categoryId === id).length + getChildCategories(categories, id).reduce((sum, child) => sum + countFor(child.id), 0);

  const visit = (category: Category, parentId: string, parentX: number, parentY: number, angle: number, share: number, distance: number, depth: number) => {
    const manual = manualPositions[category.id];
    const position = place(
      { x: Math.round(parentX + distance * Math.cos(angle)), y: Math.round(parentY + distance * Math.sin(angle)) },
      manual,
      NODE_SIZES.category,
      SPACING.category,
    );
    const theme = themeFor(appearance, category.color, true);
    nodes.push({ id: category.id, type: 'categoryNode', position, zIndex: 10 - depth, data: {
      id: category.id, label: category.name, type: 'category', isCompletedView: true, completedCount: countFor(category.id),
      color: theme.accent, accentColor: theme.accent, surfaceColor: theme.surface, surfaceAltColor: theme.surfaceAlt,
      textColor: theme.text, mutedTextColor: theme.mutedText, borderColor: theme.border, glowColor: theme.glow, hoverColor: theme.hover,
      onNodeClick: callbacks.onNodeClick,
    }});
    edges.push({ id: `edge-completed-${parentId}-${category.id}`, source: parentId, target: category.id, style: lineStyle(
      appearance,
      appearance.connectionColorMode === 'custom' ? appearance.connectionColors.branch : category.color,
      2,
      countFor(category.id) > 0 ? 0.7 : 0.3,
    ) });

    const childCategories = getChildCategories(categories, category.id);
    const childWeights = childCategories.map((child) => Math.max(1, 1 + countFor(child.id)));
    const childPlan = allocateAngles(childWeights, angle - share / 2, share);
    childCategories.forEach((child, childIndex) => {
      const childShare = childPlan[childIndex]?.share ?? share / Math.max(childCategories.length, 1);
      const childAngle = childPlan[childIndex]?.angle ?? angle;
      visit(child, category.id, position.x, position.y, childAngle, childShare, Math.max(NESTED_CATEGORY_MIN_DISTANCE, distance * 0.8), depth + 1);
    });
  };

  const rootCategories = getChildCategories(categories, null);
  const weights = rootCategories.map((category) => Math.max(1, 1 + countFor(category.id)));
  const plan = allocateAngles(weights, -Math.PI / 2);
  rootCategories.forEach((category, index) => {
    const share = plan[index]?.share ?? (Math.PI * 2) / Math.max(rootCategories.length, 1);
    const angle = plan[index]?.angle ?? -Math.PI / 2;
    visit(category, 'completed-root', rootPosition.x, rootPosition.y, angle, share, categoryRadius(weights[index]), 0);
  });

  return { nodes, edges };
}
