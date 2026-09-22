import { Edge, Node } from '@xyflow/react';
import { MeshNodeData } from '../types';
import { AppearanceSettings } from '../types/appearance';
import { Routine, RoutineStep } from '../types/routine';
import { accentForNodeType, getDefaultAppearance, resolveNodeTheme, withAlpha } from './appearance';

export interface RoutineGraphOptions {
  categoryColor?: string;
  performanceMode?: boolean;
}

export interface RoutineGraphElements {
  nodes: Node<MeshNodeData>[];
  edges: Edge[];
}

function positionFor(step: RoutineStep, index: number, total: number, parent?: RoutineStep) {
  if (step.position && Number.isFinite(step.position.x) && Number.isFinite(step.position.y)) return step.position;
  const angle = total <= 1 ? 0 : (index / Math.max(1, total - 1) - 0.5) * Math.PI * 1.35;
  const distance = parent ? 210 : 250;
  return {
    x: Math.round((parent?.position?.x || 0) + distance * Math.sin(angle)),
    y: Math.round((parent?.position?.y || 160) + distance * Math.cos(angle)),
  };
}

function stateFor(routine: Routine, step: RoutineStep): MeshNodeData['routineState'] {
  const session = routine.activeSession;
  if (session?.currentStepId === step.id) return 'current';
  if (session?.completedStepIds.includes(step.id) || step.completed) return 'completed';
  if (session?.status === 'running') return 'active';
  return 'upcoming';
}

function theme(appearance: AppearanceSettings, accent: string, state: MeshNodeData['routineState']) {
  const focused = state === 'current';
  const completed = state === 'completed';
  const resolved = resolveNodeTheme(appearance, focused ? appearance.nodeColors.selected : completed ? appearance.nodeColors.completed : accent);
  return { ...resolved, glow: withAlpha(resolved.accent, focused ? 0.72 : completed ? 0.16 : 0.35) };
}

/**
 * Adapts a persisted Routine tree to the same Node/Edge contract used by the
 * main MindMesh graph. This keeps 2D and SpatialGraph state identical.
 */
export function generateRoutineGraph(
  routine: Routine,
  appearance: AppearanceSettings = getDefaultAppearance(),
  options: RoutineGraphOptions = {},
): RoutineGraphElements {
  const nodes: Node<MeshNodeData>[] = [];
  const edges: Edge[] = [];
  const categoryAccent = options.categoryColor || appearance.nodeColors.category;
  const routineAccent = routine.visual?.inheritCategoryColor === false && routine.visual.color
    ? routine.visual.color
    : categoryAccent;
  const steps = routine.steps.slice().sort((a, b) => a.order - b.order);
  const byId = new Map(steps.map((step) => [step.id, step]));
  const activeCount = routine.activeSession?.completedStepIds.length || 0;
  const rootTheme = theme(appearance, routineAccent, routine.activeSession ? 'active' : 'upcoming');

  nodes.push({
    id: `routine-root-${routine.id}`,
    type: 'rootNode',
    position: { x: 0, y: 0 },
    zIndex: 30,
    data: {
      id: `routine-root-${routine.id}`, label: routine.name, type: 'root', count: activeCount,
      isRoutineNode: true, routineState: routine.activeSession ? 'active' : 'upcoming',
      color: rootTheme.accent, accentColor: rootTheme.accent, surfaceColor: rootTheme.surface,
      surfaceAltColor: rootTheme.surfaceAlt, textColor: rootTheme.text, mutedTextColor: rootTheme.mutedText,
      borderColor: rootTheme.border, glowColor: rootTheme.glow, hoverColor: appearance.nodeColors.hover,
    },
  });

  const rootSteps = steps.filter((step) => !step.parentStepId);
  const renderStep = (step: RoutineStep, index: number, siblings: RoutineStep[], parent?: RoutineStep) => {
    const state = stateFor(routine, step);
    const point = positionFor(step, index, siblings.length, parent);
    const stepTheme = theme(appearance, routineAccent, state);
    const nodeType = step.parentStepId ? 'subtaskNode' : 'reminderNode';
    nodes.push({
      id: step.id,
      type: nodeType,
      position: point,
      zIndex: state === 'current' ? 22 : 10,
      data: {
        id: step.id, label: step.title, type: step.parentStepId ? 'subtask' : 'reminder',
        reminderId: step.parentStepId ? `routine-${routine.id}` : undefined,
        completed: state === 'completed', isFocused: state === 'current', isRoutineNode: true,
        routineState: state, priority: routine.priority === 'critical' ? 'high' : routine.priority,
        color: stepTheme.accent, accentColor: stepTheme.accent, surfaceColor: stepTheme.surface,
        surfaceAltColor: stepTheme.surfaceAlt, textColor: stepTheme.text, mutedTextColor: stepTheme.mutedText,
        borderColor: state === 'current' ? appearance.nodeColors.selected : stepTheme.border,
        glowColor: stepTheme.glow, hoverColor: appearance.nodeColors.hover,
        summary: step.durationTargetMinutes ? `${step.durationTargetMinutes} min target` : undefined,
        subtaskCount: steps.filter((child) => child.parentStepId === step.id).length,
        completedSubtaskCount: steps.filter((child) => child.parentStepId === step.id && stateFor(routine, child) === 'completed').length,
      },
    });
    const parentId = parent?.id || `routine-root-${routine.id}`;
    edges.push({
      id: `routine-flow-${parentId}-${step.id}`,
      source: parentId,
      target: step.id,
      animated: state === 'current' || state === 'active',
      style: {
        stroke: state === 'completed' ? appearance.connectionColors.completed : state === 'current' ? appearance.nodeColors.selected : routineAccent,
        strokeWidth: state === 'current' ? 3.6 : 1.8,
        strokeOpacity: state === 'completed' ? 0.3 : 0.7,
        strokeDasharray: state === 'completed' ? '5 5' : undefined,
      },
    });
    steps.filter((child) => child.parentStepId === step.id).forEach((child, childIndex, childSiblings) => renderStep(child, childIndex, childSiblings, step));
  };

  rootSteps.forEach((step, index) => renderStep(step, index, rootSteps));

  routine.dependencies.forEach((dependency) => {
    const source = byId.get(dependency.dependsOnStepId);
    const target = byId.get(dependency.stepId);
    if (!source || !target) return;
    edges.push({
      id: `routine-dependency-${dependency.id}`,
      source: source.id,
      target: target.id,
      animated: false,
      label: dependency.condition || (dependency.required ? 'Required dependency' : 'Optional dependency'),
      style: { stroke: appearance.nodeColors.hover, strokeWidth: 1.5, strokeOpacity: 0.8, strokeDasharray: '3 6' },
      data: { isDependency: true, dependencyLabel: dependency.condition || 'Dependency' },
    });
  });

  // Performance mode intentionally reduces only decorative dependency edges;
  // all routine steps and flow edges remain available and persisted.
  if (options.performanceMode) {
    return { nodes, edges: edges.filter((edge) => !edge.data?.isDependency || edge.source === routine.activeSession?.currentStepId) };
  }
  return { nodes, edges };
}

export function routineGraphUsesCategoryInheritance(routine: Routine): boolean {
  return routine.visual?.inheritCategoryColor !== false;
}

export function routineGraphNodeCount(routine: Routine): number {
  return routine.steps.length + 1;
}

export function routineGraphAccent(routine: Routine, categoryColor: string, appearance = getDefaultAppearance()): string {
  return routine.visual?.inheritCategoryColor === false && routine.visual.color
    ? routine.visual.color
    : categoryColor || accentForNodeType(appearance, 'category');
}
