import { Node, Edge } from '@xyflow/react';
import { Category, Reminder, MeshNodeData, NodePositionMap } from '../types';
import { Contact } from '../types/contact';
import { AppearanceSettings } from '../types/appearance';
import { accentForNodeType, getDefaultAppearance, resolveNodeTheme, withAlpha } from '../services/appearance';

export interface GraphElements {
  nodes: Node<MeshNodeData>[];
  edges: Edge[];
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

  // 1. Root Center Node
  const manualRoot = manualPositions?.['root'];
  const rootX = manualRoot?.manuallyPositioned ? manualRoot.x : 0;
  const rootY = manualRoot?.manuallyPositioned ? manualRoot.y : 0;

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
    const catX = manualCat?.manuallyPositioned ? manualCat.x : autoCatX;
    const catY = manualCat?.manuallyPositioned ? manualCat.y : autoCatY;
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
        strokeWidth: isFocused ? 3.5 : 2.2,
        strokeOpacity: isFocused ? 0.95 : 0.6,
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
        const remX = manualRem?.manuallyPositioned ? manualRem.x : autoRemX;
        const remY = manualRem?.manuallyPositioned ? manualRem.y : autoRemY;
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
            strokeWidth: isFocused ? 2.5 : 1.8,
            strokeOpacity: isFocused ? 0.85 : 0.5,
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
            const subX = manualSub?.manuallyPositioned ? manualSub.x : autoSubX;
            const subY = manualSub?.manuallyPositioned ? manualSub.y : autoSubY;

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
                strokeWidth: 1.4,
                strokeOpacity: subtask.completed ? 0.35 : 0.55,
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
        strokeWidth: 2,
        strokeOpacity: catCompletedCount > 0 ? 0.7 : 0.3,
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

  // Category as the central hero node
  const manualCat = manualPositions?.[category.id];
  const catX = manualCat?.manuallyPositioned ? manualCat.x : 0;
  const catY = manualCat?.manuallyPositioned ? manualCat.y : 0;

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
    const remX = manualRem?.manuallyPositioned ? manualRem.x : autoRemX;
    const remY = manualRem?.manuallyPositioned ? manualRem.y : autoRemY;
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
        strokeWidth: 2,
        strokeOpacity: 0.65,
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
        const subX = manualSub?.manuallyPositioned ? manualSub.x : autoSubX;
        const subY = manualSub?.manuallyPositioned ? manualSub.y : autoSubY;

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
            strokeWidth: 1.2,
            strokeOpacity: 0.45,
          },
        });
      });
    }
  });

  return { nodes, edges };
}

