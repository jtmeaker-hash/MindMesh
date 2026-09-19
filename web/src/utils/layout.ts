import { Node, Edge, MarkerType } from '@xyflow/react';
import { Category, Reminder, MeshNodeData, NodePositionMap } from '../types';

export interface GraphElements {
  nodes: Node<MeshNodeData>[];
  edges: Edge[];
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
  manualPositions?: NodePositionMap
): GraphElements {
  const nodes: Node<MeshNodeData>[] = [];
  const edges: Edge[] = [];

  const activeReminders = reminders.filter((r) => !r.completed);

  // 1. Root Center Node
  const manualRoot = manualPositions?.['root'];
  const rootX = manualRoot?.manuallyPositioned ? manualRoot.x : 0;
  const rootY = manualRoot?.manuallyPositioned ? manualRoot.y : 0;

  const rootNode: Node<MeshNodeData> = {
    id: 'root',
    type: 'rootNode',
    position: { x: rootX, y: rootY },
    data: {
      id: 'root',
      label: 'MindMesh',
      type: 'root',
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

  // Radial radius for categories
  const catRadius = numCategories > 4 ? 260 : 220;

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

    // Category Node
    const categoryNode: Node<MeshNodeData> = {
      id: category.id,
      type: 'categoryNode',
      position: { x: catX, y: catY },
      data: {
        id: category.id,
        label: category.name,
        type: 'category',
        color: category.color,
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
        stroke: category.color,
        strokeWidth: isFocused ? 3.5 : 2.2,
        strokeOpacity: isFocused ? 0.95 : 0.6,
        filter: isFocused ? `drop-shadow(0 0 6px ${category.color})` : undefined,
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
        const stagger = (j % 2 === 1 ? 30 : 0) + (j % 3 === 2 ? -20 : 0);
        const remDistance = (isFocused ? 240 : 210) + stagger;

        const autoRemX = Math.round(catX + remDistance * Math.cos(remAngle));
        const autoRemY = Math.round(catY + remDistance * Math.sin(remAngle));

        const manualRem = manualPositions?.[reminder.id];
        const remX = manualRem?.manuallyPositioned ? manualRem.x : autoRemX;
        const remY = manualRem?.manuallyPositioned ? manualRem.y : autoRemY;
        const effectiveRemAngle = Math.atan2(remY - catY, remX - catX);

        const completedSubtasks = reminder.subtasks.filter((s) => s.completed).length;

        // Reminder Node
        const reminderNode: Node<MeshNodeData> = {
          id: reminder.id,
          type: 'reminderNode',
          position: { x: remX, y: remY },
          data: {
            id: reminder.id,
            label: reminder.title,
            type: 'reminder',
            color: category.color,
            priority: reminder.priority,
            completed: reminder.completed,
            dueDate: reminder.dueDate,
            dueTime: reminder.dueTime,
            recurrence: reminder.recurrence,
            isRecurring: reminder.recurrence && reminder.recurrence.frequency !== 'none',
            categoryId: category.id,
            subtaskCount: reminder.subtasks.length,
            completedSubtaskCount: completedSubtasks,
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
            stroke: category.color,
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
            const subDist = 135 + (k % 2 === 1 ? 25 : 0);

            const autoSubX = Math.round(remX + subDist * Math.cos(subAngle));
            const autoSubY = Math.round(remY + subDist * Math.sin(subAngle));

            const manualSub = manualPositions?.[subtask.id];
            const subX = manualSub?.manuallyPositioned ? manualSub.x : autoSubX;
            const subY = manualSub?.manuallyPositioned ? manualSub.y : autoSubY;

            const subNode: Node<MeshNodeData> = {
              id: subtask.id,
              type: 'subtaskNode',
              position: { x: subX, y: subY },
              data: {
                id: subtask.id,
                label: subtask.title,
                type: 'subtask',
                color: category.color,
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
                stroke: subtask.completed ? '#475569' : category.color,
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
  manualPositions?: NodePositionMap
): GraphElements {
  const nodes: Node<MeshNodeData>[] = [];
  const edges: Edge[] = [];

  const completedReminders = reminders.filter((r) => r.completed);

  // Central Completed Node
  const manualRoot = manualPositions?.['completed-root'];
  const rootX = manualRoot?.manuallyPositioned ? manualRoot.x : 0;
  const rootY = manualRoot?.manuallyPositioned ? manualRoot.y : 0;

  const rootNode: Node<MeshNodeData> = {
    id: 'completed-root',
    type: 'rootNode',
    position: { x: rootX, y: rootY },
    data: {
      id: 'completed-root',
      label: 'Completed',
      type: 'root',
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

  const catRadius = 240;

  categories.forEach((category, i) => {
    const autoCatAngle = (2 * Math.PI * i) / numCategories - Math.PI / 2;
    const autoCatX = Math.round(rootX + catRadius * Math.cos(autoCatAngle));
    const autoCatY = Math.round(rootY + catRadius * Math.sin(autoCatAngle));

    const manualCat = manualPositions?.[category.id];
    const catX = manualCat?.manuallyPositioned ? manualCat.x : autoCatX;
    const catY = manualCat?.manuallyPositioned ? manualCat.y : autoCatY;

    const catCompletedCount = completedReminders.filter((r) => r.categoryId === category.id).length;

    const catNode: Node<MeshNodeData> = {
      id: category.id,
      type: 'categoryNode',
      position: { x: catX, y: catY },
      data: {
        id: category.id,
        label: category.name,
        type: 'category',
        color: category.color,
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
        stroke: category.color,
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
  manualPositions?: NodePositionMap
): GraphElements {
  const nodes: Node<MeshNodeData>[] = [];
  const edges: Edge[] = [];

  const completedCatReminders = reminders.filter(
    (r) => r.completed && r.categoryId === category.id
  );

  // Category as the central hero node
  const manualCat = manualPositions?.[category.id];
  const catX = manualCat?.manuallyPositioned ? manualCat.x : 0;
  const catY = manualCat?.manuallyPositioned ? manualCat.y : 0;

  const centerCategoryNode: Node<MeshNodeData> = {
    id: category.id,
    type: 'categoryNode',
    position: { x: catX, y: catY },
    data: {
      id: category.id,
      label: category.name,
      type: 'category',
      color: category.color,
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

  const remRadius = numReminders > 4 ? 260 : 220;

  completedCatReminders.forEach((reminder, j) => {
    const autoAngle = (2 * Math.PI * j) / numReminders - Math.PI / 2;
    const autoRemX = Math.round(catX + remRadius * Math.cos(autoAngle));
    const autoRemY = Math.round(catY + remRadius * Math.sin(autoAngle));

    const manualRem = manualPositions?.[reminder.id];
    const remX = manualRem?.manuallyPositioned ? manualRem.x : autoRemX;
    const remY = manualRem?.manuallyPositioned ? manualRem.y : autoRemY;
    const effectiveRemAngle = Math.atan2(remY - catY, remX - catX);

    const reminderNode: Node<MeshNodeData> = {
      id: reminder.id,
      type: 'reminderNode',
      position: { x: remX, y: remY },
      data: {
        id: reminder.id,
        label: reminder.title,
        type: 'reminder',
        color: category.color,
        priority: reminder.priority,
        completed: true,
        dueDate: reminder.dueDate,
        dueTime: reminder.dueTime,
        recurrence: reminder.recurrence,
        isRecurring: reminder.recurrence && reminder.recurrence.frequency !== 'none',
        categoryId: category.id,
        subtaskCount: reminder.subtasks.length,
        completedSubtaskCount: reminder.subtasks.filter((s) => s.completed).length,
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
        stroke: category.color,
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
        const subDist = 130;
        const autoSubX = Math.round(remX + subDist * Math.cos(subAngle));
        const autoSubY = Math.round(remY + subDist * Math.sin(subAngle));

        const manualSub = manualPositions?.[subtask.id];
        const subX = manualSub?.manuallyPositioned ? manualSub.x : autoSubX;
        const subY = manualSub?.manuallyPositioned ? manualSub.y : autoSubY;

        const subNode: Node<MeshNodeData> = {
          id: subtask.id,
          type: 'subtaskNode',
          position: { x: subX, y: subY },
          data: {
            id: subtask.id,
            label: subtask.title,
            type: 'subtask',
            color: category.color,
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
            stroke: '#64748B',
            strokeWidth: 1.2,
            strokeOpacity: 0.45,
          },
        });
      });
    }
  });

  return { nodes, edges };
}

