import { describe, expect, it } from 'vitest';
import { createEmptyRoutine, createRoutineStep } from '../types/routine';
import { getDefaultAppearance } from '../services/appearance';
import { generateRoutineGraph, routineGraphAccent, routineGraphNodeCount, routineGraphUsesCategoryInheritance } from '../services/routineGraph';

function fixture() {
  const routine = createEmptyRoutine({ id: 'routine-visual', name: 'Morning', categoryId: 'health', steps: [] });
  const first = createRoutineStep({ id: 'step-1', routineId: routine.id, title: 'Water', order: 0, position: { x: 120, y: 180 } });
  const second = createRoutineStep({ id: 'step-2', routineId: routine.id, title: 'Stretch', order: 1, parentStepId: null });
  routine.steps = [first, second];
  routine.dependencies = [{ id: 'dependency-1', stepId: second.id, dependsOnStepId: first.id, required: true }];
  routine.activeSession = {
    id: 'session-1', routineId: routine.id, occurrenceId: 'occurrence-1', status: 'running',
    currentStepId: second.id, startedAt: new Date().toISOString(), completedStepIds: [first.id], temporaryStepIds: [], updatedAt: new Date().toISOString(),
  };
  return routine;
}

describe('routine graph adapter', () => {
  it('maps the full tree to the shared graph contract and preserves manual positions', () => {
    const routine = fixture();
    const graph = generateRoutineGraph(routine, getDefaultAppearance(), { categoryColor: '#f97316' });
    expect(routineGraphNodeCount(routine)).toBe(3);
    expect(graph.nodes).toHaveLength(3);
    expect(graph.nodes.find((node) => node.id === 'step-1')?.position).toEqual({ x: 120, y: 180 });
    expect(graph.nodes.find((node) => node.id === 'step-1')?.data.routineState).toBe('completed');
    expect(graph.nodes.find((node) => node.id === 'step-2')?.data.routineState).toBe('current');
    expect(graph.edges.some((edge) => edge.data?.isDependency)).toBe(true);
    expect(graph.edges.find((edge) => edge.data?.isDependency)?.style?.strokeDasharray).toBe('3 6');
  });

  it('supports category inheritance and removes decorative dependency edges in performance mode', () => {
    const routine = fixture();
    expect(routineGraphUsesCategoryInheritance(routine)).toBe(true);
    expect(routineGraphAccent(routine, '#f97316')).toBe('#f97316');
    routine.visual = { color: '#a855f7', inheritCategoryColor: false };
    expect(routineGraphUsesCategoryInheritance(routine)).toBe(false);
    expect(routineGraphAccent(routine, '#f97316')).toBe('#a855f7');
    const normal = generateRoutineGraph(routine, getDefaultAppearance());
    const performance = generateRoutineGraph(routine, getDefaultAppearance(), { performanceMode: true });
    expect(normal.edges.length).toBeGreaterThan(performance.edges.length);
    expect(performance.edges.some((edge) => edge.data?.isDependency)).toBe(false);
  });
});
