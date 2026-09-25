import { Node, Edge } from '@xyflow/react';
import { Category, Reminder, MeshNodeData, NodePositionMap } from '../types';
import { Contact } from '../types/contact';
import { AppearanceSettings } from '../types/appearance';
import {
  accentForNodeType,
  connectionStrokeStyle as connectionEdgeStyle,
  getDefaultAppearance,
  resolveNodeTheme,
  withAlpha,
} from '../services/appearance';
import { PlacementGrid } from '../services/nodePositions';

export interface GraphElements {
  nodes: Node<MeshNodeData>[];
  edges: Edge[];
}

/** Node box sizes in world units, matching the rendered node components. */
const NODE_BOX = {
  root: { width: 104, height: 104 },
  category: { width: 78, height: 78 },
  reminder: { width: 165, height: 100 },
  subtask: { width: 130, height: 42 },
} as const;

/** Minimum gap kept between neighbouring node boxes, wide enough for labels. */
const NODE_GAP = 72;

type BoxSize = { width: number; height: number };

/** Reserves every manually positioned node so auto placement routes around it. */
function reserveManualPositions(
  grid: PlacementGrid,
  manualPositions: NodePositionMap | undefined,
  sizeFor: (id: string) => BoxSize,
): void {
  if (!manualPositions) return;
  for (const [id, position] of Object.entries(manualPositions)) {
    if (position?.manuallyPositioned) grid.reserve({ x: position.x, y: position.y }, sizeFor(id));
  }
}

/**
 * Resolves the accent colour + readable surface palette for a single node.
 */
function nodeTheme(
  appearance: AppearanceSettings,
  accent: string,
  options: { completed?: boolean; isFocused?: boolean } = {},
) {
  const resolvedAccent = options.isFocused
    ? appearance.nodeColors.selected
    : options.completed && appearance.nodeColorMode === 'custom'
    ? appearance.nodeColors.completed
    : accent;

  const theme = resolveNodeTheme(appearance, resolvedAccent);
  return {
    ...theme,
    glow: withAlpha(resolvedAccent, 0.35),
    hover: appearance.nodeColors.hover,
  };
}

export interface NodeNotificationStatus {
  status: 'off' | 'on' | 'permission' | 'failed' | 'unsupported';
  label: string;
  count: number;
}

/** Optional per-reminder notification status map, keyed by reminder id. */
export type NotificationStatusMap = Record<string, NodeNotificationStatus>;

function notificationFields(
  reminderId: string,
  notificationStatus?: NotificationStatusMap
): Pick<MeshNodeData, 'notificationState' | 'notificationLabel' | 'notificationCount'> {
  const entry = notificationStatus?.[reminderId];
  if (!entry) return {};
  return {
    notificationState: entry.status,
    notificationLabel: entry.label,
    notificationCount: entry.count,
  };
}

export function generateActiveMesh(
  categories: Category[],
  reminders: Reminder[],
  focusedCategoryId?: string | null,
  callbacks?: {
    onNodeClick?: (nodeId: string, type: string) => void;
    onSubtaskToggle?: (subtaskId: string, reminderId: string) => void;
    onReminderCompleteToggle?: (reminderId: string) => void;
  },
  manualPositions?: NodePositionMap,
  contacts?: Contact[],
  appearance?: AppearanceSettings,
  notificationStatus?: NotificationStatusMap
): GraphElements {
  const nodes: Node<MeshNodeData>[] = [];
  const edges: Edge[] = [];

  const theme = appearance || getDefaultAppearance();
  const customNodeColors = theme.nodeColorMode === 'custom';
  const customLines = theme.connectionColorMode === 'custom';

  const activeReminders = reminders.filter((r) => !r.completed);

  // Collision-aware placement: every node claims its box before the next one is
  // positioned, so automatic layout can never stack nodes or their labels.
  const grid = new PlacementGrid();
  const sizeFor = (id: string): BoxSize => {
    if (id === 'root' || id === 'completed-root') return NODE_BOX.root;
    if (categories.some((category) => category.id === id)) return NODE_BOX.category;
    if (activeReminders.some((reminder) => reminder.id === id)) return NODE_BOX.reminder;
    return NODE_BOX.subtask;
  };
  reserveManualPositions(grid, manualPositions, sizeFor);

  // 1. Root Center Node
  const manualRoot = manualPositions?.['root'];
  const rootX = manualRoot?.manuallyPositioned ? manualRoot.x : 0;
  const rootY = manualRoot?.manuallyPositioned ? manualRoot.y : 0;
  grid.reserve({ x: rootX, y: rootY }, NODE_BOX.root);

  const rootAccent = accentForNodeType(theme, 'root');
  const rootTheme = nodeTheme(theme, rootAccent);

  const rootNode: Node<MeshNodeData> = {
    id: 'root',
    type: 'rootNode',
    position: { x: rootX, y: rootY },
    zIndex: 8,
    data: {
      id: 'root',
      label: 'MindMesh',
      type: 'root',
      color: rootTheme.accent,
      accentColor: rootTheme.accent,
      surfaceColor: rootTheme.surface,
      surfaceAltColor: rootTheme.surfaceAlt,
      textColor: rootTheme.text,
      mutedTextColor: rootTheme.mutedText,
      borderColor: rootTheme.border,
      glowColor: rootTheme.glow,
      hoverColor: rootTheme.hover,
      count: activeReminders.length,
      manuallyPositioned: Boolean(manualRoot?.manuallyPositioned),
      onNodeClick: callbacks?.onNodeClick,
    },
  };
  nodes.push(rootNode);

  const numCategories = categories.length;
  if (numCategories === 0) {
    return { nodes, edges };
  }

  // Radial radius for categories. The graph world is unbounded, so busy graphs
  // push categories further out instead of squeezing them into one small ring.
  const catRadius = 340 + Math.min(700, numCategories * 18);

  categories.forEach((category, i) => {
    // Angle evenly spaced starting from top (-PI/2)
    const autoCatAngle = (2 * Math.PI * i) / numCategories - Math.PI / 2;
    const autoCatX = Math.round(rootX + catRadius * Math.cos(autoCatAngle));
    const autoCatY = Math.round(rootY + catRadius * Math.sin(autoCatAngle));

    const manualCat = manualPositions?.[category.id];
    const catPosition = manualCat?.manuallyPositioned
      ? { x: manualCat.x, y: manualCat.y }
      : grid.place({ x: autoCatX, y: autoCatY }, NODE_BOX.category, NODE_GAP);
    const catX = catPosition.x;
    const catY = catPosition.y;
    const effectiveCatAngle = Math.atan2(catY - rootY, catX - rootX);

    const isFocused = focusedCategoryId === category.id;
    const catReminders = activeReminders.filter((r) => r.categoryId === category.id);
    const categoryAccent = customNodeColors ? accentForNodeType(theme, 'category') : category.color;
    const catTheme = nodeTheme(theme, categoryAccent, { isFocused });

    const branchStroke = customLines ? theme.connectionColors.branch : category.color;

    // Category Node
    const categoryNode: Node<MeshNodeData> = {
      id: category.id,
      type: 'categoryNode',
      position: { x: catX, y: catY },
      zIndex: 5,
      data: {
        id: category.id,
        label: category.name,
        type: 'category',
        color: catTheme.accent,
        accentColor: catTheme.accent,
        surfaceColor: catTheme.surface,
        surfaceAltColor: catTheme.surfaceAlt,
        textColor: catTheme.text,
        mutedTextColor: catTheme.mutedText,
        borderColor: catTheme.border,
        glowColor: catTheme.glow,
        hoverColor: catTheme.hover,
        count: catReminders.length,
        isFocused,
        manuallyPositioned: Boolean(manualCat?.manuallyPositioned),
        onNodeClick: callbacks?.onNodeClick,
      },
    };
    nodes.push(categoryNode);

    // Edge from Root to Category
    edges.push({
      id: `edge-root-${category.id}`,
      source: 'root',
      target: category.id,
      animated: isFocused,
      style: {
        stroke: branchStroke,
        ...connectionEdgeStyle(theme, isFocused ? 3.5 : 2.2, isFocused ? 0.95 : 0.6),
        filter: isFocused ? `drop-shadow(0 0 6px ${branchStroke})` : undefined,
      },
    });

    // Reminders fanning out from this category
    const numReminders = catReminders.length;
    if (numReminders > 0) {
      // Fan span based on number of reminders
      const fanSpan = Math.min(Math.PI * 0.9, Math.max(0.4, (numReminders - 1) * 0.38));
      const startAngle = effectiveCatAngle - fanSpan / 2;
      const angleStep = numReminders === 1 ? 0 : fanSpan / (numReminders - 1);

      catReminders.forEach((reminder, j) => {
        const remAngle = numReminders === 1 ? effectiveCatAngle : startAngle + j * angleStep;
        // Stagger distance slightly for an organic, breathing spiderweb feel
        const stagger = (j % 2 === 1 ? 34 : 0) + (j % 3 === 2 ? -22 : 0);
        const remDistance = (isFocused ? 400 : 340) + stagger;

        const autoRemX = Math.round(catX + remDistance * Math.cos(remAngle));
        const autoRemY = Math.round(catY + remDistance * Math.sin(remAngle));

        const manualRem = manualPositions?.[reminder.id];
        const remPosition = manualRem?.manuallyPositioned
          ? { x: manualRem.x, y: manualRem.y }
          : grid.place({ x: autoRemX, y: autoRemY }, NODE_BOX.reminder, NODE_GAP);
        const remX = remPosition.x;
        const remY = remPosition.y;
        const effectiveRemAngle = Math.atan2(remY - catY, remX - catX);

        const completedSubtasks = reminder.subtasks.filter((s) => s.completed).length;
        const linkedContact = contacts?.find((c) => c.id === reminder.linkedContactId);
        const reminderAccent = customNodeColors ? accentForNodeType(theme, 'reminder') : category.color;
        const remTheme = nodeTheme(theme, reminderAccent, { completed: reminder.completed });

        // Reminder Node
        const reminderNode: Node<MeshNodeData> = {
          id: reminder.id,
          type: 'reminderNode',
          position: { x: remX, y: remY },
          zIndex: 3,
          data: {
            id: reminder.id,
            label: reminder.title,
            summary: reminder.summary?.trim() || undefined,
            description: reminder.description?.trim() || undefined,
            type: 'reminder',
            color: remTheme.accent,
            accentColor: remTheme.accent,
            surfaceColor: remTheme.surface,
            surfaceAltColor: remTheme.surfaceAlt,
            textColor: remTheme.text,
            mutedTextColor: remTheme.mutedText,
            borderColor: remTheme.border,
            glowColor: remTheme.glow,
            hoverColor: remTheme.hover,
            priority: reminder.priority,
            completed: reminder.completed,
            dueDate: reminder.dueDate,
            dueTime: reminder.dueTime,
            recurrence: reminder.recurrence,
            isRecurring: reminder.recurrence && reminder.recurrence.frequency !== 'none',
            categoryId: category.id,
            subtaskCount: reminder.subtasks.length,
            completedSubtaskCount: completedSubtasks,
            isFinancialLinked: Boolean(reminder.linkedBillId || reminder.linkedExtraIncomeId),
            linkedContactId: reminder.linkedContactId,
            linkedContactName: linkedContact ? (linkedContact.displayName || linkedContact.fullName) : undefined,
            ...notificationFields(reminder.id, notificationStatus),
            manuallyPositioned: Boolean(manualRem?.manuallyPositioned),
            onNodeClick: callbacks?.onNodeClick,
            onReminderCompleteToggle: callbacks?.onReminderCompleteToggle,
          },
        };
        nodes.push(reminderNode);

        // Edge from Category to Reminder
        edges.push({
          id: `edge-${category.id}-${reminder.id}`,
          source: category.id,
          target: reminder.id,
          style: {
            stroke: customLines ? theme.connectionColors.reminder : category.color,
            ...connectionEdgeStyle(theme, isFocused ? 2.5 : 1.8, isFocused ? 0.85 : 0.5),
          },
        });

        // Subtasks branching from Reminder
        const numSubtasks = reminder.subtasks.length;
        if (numSubtasks > 0) {
          const subSpan = Math.min(Math.PI * 0.7, Math.max(0.35, (numSubtasks - 1) * 0.32));
          const subStartAngle = effectiveRemAngle - subSpan / 2;
          const subAngleStep = numSubtasks === 1 ? 0 : subSpan / (numSubtasks - 1);

          reminder.subtasks.forEach((subtask, k) => {
            const subAngle = numSubtasks === 1 ? effectiveRemAngle : subStartAngle + k * subAngleStep;
            const subDist = 180 + (k % 2 === 1 ? 30 : 0);

            const autoSubX = Math.round(remX + subDist * Math.cos(subAngle));
            const autoSubY = Math.round(remY + subDist * Math.sin(subAngle));

            const manualSub = manualPositions?.[subtask.id];
            const subPosition = manualSub?.manuallyPositioned
              ? { x: manualSub.x, y: manualSub.y }
              : grid.place({ x: autoSubX, y: autoSubY }, NODE_BOX.subtask, NODE_GAP / 2);
            const subX = subPosition.x;
            const subY = subPosition.y;

            const subtaskAccent = customNodeColors ? accentForNodeType(theme, 'subtask') : category.color;
            const subTheme = nodeTheme(theme, subtaskAccent, { completed: subtask.completed });

            const subNode: Node<MeshNodeData> = {
              id: subtask.id,
              type: 'subtaskNode',
              position: { x: subX, y: subY },
              zIndex: 1,
              data: {
                id: subtask.id,
                label: subtask.title,
                type: 'subtask',
                color: subTheme.accent,
                accentColor: subTheme.accent,
                surfaceColor: subTheme.surface,
                surfaceAltColor: subTheme.surfaceAlt,
                textColor: subTheme.text,
                mutedTextColor: subTheme.mutedText,
                borderColor: subTheme.border,
                glowColor: subTheme.glow,
                hoverColor: subTheme.hover,
                completed: subtask.completed,
                reminderId: reminder.id,
                manuallyPositioned: Boolean(manualSub?.manuallyPositioned),
                onNodeClick: callbacks?.onNodeClick,
                onSubtaskToggle: callbacks?.onSubtaskToggle,
              },
            };
            nodes.push(subNode);

            // Edge from Reminder to Subtask
            edges.push({
              id: `edge-${reminder.id}-${subtask.id}`,
              source: reminder.id,
              target: subtask.id,
              style: {
                stroke: subtask.completed
                  ? customLines
                    ? theme.connectionColors.completed
                    : '#475569'
                  : customLines
                  ? theme.connectionColors.subtask
                  : category.color,
                ...connectionEdgeStyle(theme, 1.4, subtask.completed ? 0.35 : 0.55),
                strokeDasharray: subtask.completed ? '4 4' : undefined,
              },
            });
          });
        }
      });
    }
  });

  return { nodes, edges };
}


// 2. Completed Overview Mesh (Central Completed Node -> Category Nodes Only)
export function generateCompletedOverviewMesh(
  categories: Category[],
  reminders: Reminder[],
  callbacks?: {
    onNodeClick?: (nodeId: string, type: string) => void;
  },
  manualPositions?: NodePositionMap,
  appearance?: AppearanceSettings
): GraphElements {
  const nodes: Node<MeshNodeData>[] = [];
  const edges: Edge[] = [];

  const theme = appearance || getDefaultAppearance();
  const customNodeColors = theme.nodeColorMode === 'custom';
  const customLines = theme.connectionColorMode === 'custom';

  const completedReminders = reminders.filter((r) => r.completed);

  // Central Completed Node
  const manualRoot = manualPositions?.['completed-root'];
  const rootX = manualRoot?.manuallyPositioned ? manualRoot.x : 0;
  const rootY = manualRoot?.manuallyPositioned ? manualRoot.y : 0;

  const rootAccent = accentForNodeType(theme, 'root', { completed: true });
  const rootTheme = nodeTheme(theme, rootAccent, { completed: true });

  const rootNode: Node<MeshNodeData> = {
    id: 'completed-root',
    type: 'rootNode',
    position: { x: rootX, y: rootY },
    zIndex: 8,
    data: {
      id: 'completed-root',
      label: 'Completed',
      type: 'root',
      color: rootTheme.accent,
      accentColor: rootTheme.accent,
      surfaceColor: rootTheme.surface,
      surfaceAltColor: rootTheme.surfaceAlt,
      textColor: rootTheme.text,
      mutedTextColor: rootTheme.mutedText,
      borderColor: rootTheme.border,
      glowColor: rootTheme.glow,
      hoverColor: rootTheme.hover,
      count: completedReminders.length,
      isCompletedView: true,
      manuallyPositioned: Boolean(manualRoot?.manuallyPositioned),
      onNodeClick: callbacks?.onNodeClick,
    },
  };
  nodes.push(rootNode);

  const numCategories = categories.length;
  if (numCategories === 0) {
    return { nodes, edges };
  }

  const catRadius = 360 + Math.min(700, numCategories * 18);

  categories.forEach((category, i) => {
    const autoCatAngle = (2 * Math.PI * i) / numCategories - Math.PI / 2;
    const autoCatX = Math.round(rootX + catRadius * Math.cos(autoCatAngle));
    const autoCatY = Math.round(rootY + catRadius * Math.sin(autoCatAngle));

    const manualCat = manualPositions?.[category.id];
    const catX = manualCat?.manuallyPositioned ? manualCat.x : autoCatX;
    const catY = manualCat?.manuallyPositioned ? manualCat.y : autoCatY;

    const catCompletedCount = completedReminders.filter((r) => r.categoryId === category.id).length;
    const categoryAccent = customNodeColors ? accentForNodeType(theme, 'category', { completed: true }) : category.color;
    const catTheme = nodeTheme(theme, categoryAccent, { completed: true });

    const catNode: Node<MeshNodeData> = {
      id: category.id,
      type: 'categoryNode',
      position: { x: catX, y: catY },
      zIndex: 5,
      data: {
        id: category.id,
        label: category.name,
        type: 'category',
        color: catTheme.accent,
        accentColor: catTheme.accent,
        surfaceColor: catTheme.surface,
        surfaceAltColor: catTheme.surfaceAlt,
        textColor: catTheme.text,
        mutedTextColor: catTheme.mutedText,
        borderColor: catTheme.border,
        glowColor: catTheme.glow,
        hoverColor: catTheme.hover,
        completedCount: catCompletedCount,
        isCompletedView: true,
        manuallyPositioned: Boolean(manualCat?.manuallyPositioned),
        onNodeClick: callbacks?.onNodeClick,
      },
    };
    nodes.push(catNode);

    edges.push({
      id: `edge-comp-${category.id}`,
      source: 'completed-root',
      target: category.id,
      style: {
        stroke: customLines ? theme.connectionColors.branch : category.color,
        ...connectionEdgeStyle(theme, 2, catCompletedCount > 0 ? 0.7 : 0.3),
      },
    });
  });

  return { nodes, edges };
}

// 3. Completed Category Detail Mesh:
// The CATEGORY becomes the centre node. Completed reminders branch outward from it.
// If a completed reminder has subtasks, those subtasks branch outward from it.
export function generateCompletedCategoryMesh(
  category: Category,
  reminders: Reminder[],
  callbacks?: {
    onNodeClick?: (nodeId: string, type: string) => void;
  },
  manualPositions?: NodePositionMap,
  contacts?: Contact[],
  appearance?: AppearanceSettings,
  notificationStatus?: NotificationStatusMap
): GraphElements {
  const nodes: Node<MeshNodeData>[] = [];
  const edges: Edge[] = [];

  const theme = appearance || getDefaultAppearance();
  const customNodeColors = theme.nodeColorMode === 'custom';
  const customLines = theme.connectionColorMode === 'custom';

  const completedCatReminders = reminders.filter(
    (r) => r.completed && r.categoryId === category.id
  );

  // Only nodes that actually exist in this view can block automatic placement,
  // and every manual position among them is respected and never moved.
  const visibleIds = new Set<string>([category.id]);
  completedCatReminders.forEach((reminder) => {
    visibleIds.add(reminder.id);
    reminder.subtasks.forEach((subtask) => visibleIds.add(subtask.id));
  });
  const grid = new PlacementGrid();
  const sizeFor = (id: string): BoxSize => {
    if (id === category.id) return NODE_BOX.category;
    if (completedCatReminders.some((reminder) => reminder.id === id)) return NODE_BOX.reminder;
    return NODE_BOX.subtask;
  };
  if (manualPositions) {
    for (const [id, position] of Object.entries(manualPositions)) {
      if (!position?.manuallyPositioned || !visibleIds.has(id)) continue;
      grid.reserve({ x: position.x, y: position.y }, sizeFor(id));
    }
  }

  // Category as the central hero node
  const manualCat = manualPositions?.[category.id];
  const catX = manualCat?.manuallyPositioned ? manualCat.x : 0;
  const catY = manualCat?.manuallyPositioned ? manualCat.y : 0;
  grid.reserve({ x: catX, y: catY }, NODE_BOX.category);

  const centerAccent = customNodeColors
    ? accentForNodeType(theme, 'category', { completed: true })
    : category.color;
  const centerTheme = nodeTheme(theme, centerAccent, { completed: true, isFocused: true });

  const centerCategoryNode: Node<MeshNodeData> = {
    id: category.id,
    type: 'categoryNode',
    position: { x: catX, y: catY },
    zIndex: 5,
    data: {
      id: category.id,
      label: category.name,
      type: 'category',
      color: centerTheme.accent,
      accentColor: centerTheme.accent,
      surfaceColor: centerTheme.surface,
      surfaceAltColor: centerTheme.surfaceAlt,
      textColor: centerTheme.text,
      mutedTextColor: centerTheme.mutedText,
      borderColor: centerTheme.border,
      glowColor: centerTheme.glow,
      hoverColor: centerTheme.hover,
      completedCount: completedCatReminders.length,
      isFocused: true,
      isCompletedView: true,
      manuallyPositioned: Boolean(manualCat?.manuallyPositioned),
      onNodeClick: callbacks?.onNodeClick,
    },
  };
  nodes.push(centerCategoryNode);

  const numReminders = completedCatReminders.length;
  if (numReminders === 0) {
    return { nodes, edges };
  }

  const remRadius = 360 + Math.min(720, numReminders * 26);

  completedCatReminders.forEach((reminder, j) => {
    const autoAngle = (2 * Math.PI * j) / numReminders - Math.PI / 2;
    const autoRemX = Math.round(catX + remRadius * Math.cos(autoAngle));
    const autoRemY = Math.round(catY + remRadius * Math.sin(autoAngle));

    const manualRem = manualPositions?.[reminder.id];
    const remPosition = manualRem?.manuallyPositioned
      ? { x: manualRem.x, y: manualRem.y }
      : grid.place({ x: autoRemX, y: autoRemY }, NODE_BOX.reminder, NODE_GAP);
    const remX = remPosition.x;
    const remY = remPosition.y;
    const effectiveRemAngle = Math.atan2(remY - catY, remX - catX);
    const linkedContact = contacts?.find((c) => c.id === reminder.linkedContactId);
    const reminderAccent = customNodeColors
      ? accentForNodeType(theme, 'reminder', { completed: true })
      : category.color;
    const remTheme = nodeTheme(theme, reminderAccent, { completed: true });

    const reminderNode: Node<MeshNodeData> = {
      id: reminder.id,
      type: 'reminderNode',
      position: { x: remX, y: remY },
      zIndex: 3,
      data: {
        id: reminder.id,
        label: reminder.title,
        type: 'reminder',
        color: remTheme.accent,
        accentColor: remTheme.accent,
        surfaceColor: remTheme.surface,
        surfaceAltColor: remTheme.surfaceAlt,
        textColor: remTheme.text,
        mutedTextColor: remTheme.mutedText,
        borderColor: remTheme.border,
        glowColor: remTheme.glow,
        hoverColor: remTheme.hover,
        priority: reminder.priority,
        completed: true,
        dueDate: reminder.dueDate,
        dueTime: reminder.dueTime,
        recurrence: reminder.recurrence,
        isRecurring: reminder.recurrence && reminder.recurrence.frequency !== 'none',
        categoryId: category.id,
        subtaskCount: reminder.subtasks.length,
        completedSubtaskCount: reminder.subtasks.filter((s) => s.completed).length,
        isFinancialLinked: Boolean(reminder.linkedBillId || reminder.linkedExtraIncomeId),
        linkedContactId: reminder.linkedContactId,
        linkedContactName: linkedContact ? (linkedContact.displayName || linkedContact.fullName) : undefined,
        ...notificationFields(reminder.id, notificationStatus),
        isCompletedView: true,
        manuallyPositioned: Boolean(manualRem?.manuallyPositioned),
        onNodeClick: callbacks?.onNodeClick,
      },
    };
    nodes.push(reminderNode);

    edges.push({
      id: `edge-comp-cat-${reminder.id}`,
      source: category.id,
      target: reminder.id,
      style: {
        stroke: customLines ? theme.connectionColors.reminder : category.color,
        ...connectionEdgeStyle(theme, 2, 0.65),
      },
    });

    // Subtasks branching from completed reminder
    const numSubtasks = reminder.subtasks.length;
    if (numSubtasks > 0) {
      const subSpan = Math.min(Math.PI * 0.65, Math.max(0.35, (numSubtasks - 1) * 0.3));
      const subStartAngle = effectiveRemAngle - subSpan / 2;
      const subStep = numSubtasks === 1 ? 0 : subSpan / (numSubtasks - 1);

      reminder.subtasks.forEach((subtask, k) => {
        const subAngle = numSubtasks === 1 ? effectiveRemAngle : subStartAngle + k * subStep;
        const subDist = 180;
        const autoSubX = Math.round(remX + subDist * Math.cos(subAngle));
        const autoSubY = Math.round(remY + subDist * Math.sin(subAngle));

        const manualSub = manualPositions?.[subtask.id];
        const subPosition = manualSub?.manuallyPositioned
          ? { x: manualSub.x, y: manualSub.y }
          : grid.place({ x: autoSubX, y: autoSubY }, NODE_BOX.subtask, NODE_GAP / 2);
        const subX = subPosition.x;
        const subY = subPosition.y;

        const subtaskAccent = customNodeColors
          ? accentForNodeType(theme, 'subtask', { completed: subtask.completed })
          : category.color;
        const subTheme = nodeTheme(theme, subtaskAccent, { completed: subtask.completed });

        const subNode: Node<MeshNodeData> = {
          id: subtask.id,
          type: 'subtaskNode',
          position: { x: subX, y: subY },
          zIndex: 1,
          data: {
            id: subtask.id,
            label: subtask.title,
            type: 'subtask',
            color: subTheme.accent,
            accentColor: subTheme.accent,
            surfaceColor: subTheme.surfaceAlt,
            surfaceAltColor: subTheme.surface,
            textColor: subTheme.text,
            mutedTextColor: subTheme.mutedText,
            borderColor: subTheme.border,
            glowColor: subTheme.glow,
            hoverColor: subTheme.hover,
            completed: subtask.completed,
            reminderId: reminder.id,
            isCompletedView: true,
            manuallyPositioned: Boolean(manualSub?.manuallyPositioned),
            onNodeClick: callbacks?.onNodeClick,
          },
        };
        nodes.push(subNode);

        edges.push({
          id: `edge-comp-rem-${subtask.id}`,
          source: reminder.id,
          target: subtask.id,
          style: {
            stroke: customLines ? theme.connectionColors.completed : '#64748B',
            ...connectionEdgeStyle(theme, 1.2, 0.45),
          },
        });
      });
    }
  });

  return { nodes, edges };
}

