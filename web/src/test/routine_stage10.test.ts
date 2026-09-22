import { describe, expect, it } from 'vitest';
import { createEmptyRoutine, createRoutineStep } from '../types/routine';
import { getDefaultAppearance } from '../services/appearance';
import { generateRoutineGraph, routineGraphLevelOfDetail } from '../services/routineGraph';

function largeRoutine(stepCount: number) {
  const routine = createEmptyRoutine({ id: 'routine-large', name: 'Large routine', categoryId: 'cat', steps: [] });
  routine.steps = Array.from({ length: stepCount }, (_, index) => createRoutineStep({
    id: `step-${index}`,
    routineId: routine.id,
    title: `Step ${index + 1}`,
    order: index,
    parentStepId: index > 0 ? `step-${index - 1}` : null,
    depth: index,
  }));
  routine.dependencies = routine.steps.slice(1).map((step, index) => ({
    id: `dependency-${index}`,
    stepId: step.id,
    dependsOnStepId: routine.steps[index].id,
    required: true,
  }));
  return routine;
}

describe('Routine Builder Stage 10 regression and performance pass', () => {
  it('selects progressively lighter detail for large graphs', () => {
    expect(routineGraphLevelOfDetail(20)).toBe('full');
    expect(routineGraphLevelOfDetail(100)).toBe('simplified');
    expect(routineGraphLevelOfDetail(240)).toBe('minimal');
    expect(routineGraphLevelOfDetail(20, true)).toBe('simplified');
  });

  it('keeps every step and sequential edge while simplifying decorative dependencies', () => {
    const routine = largeRoutine(250);
    const graph = generateRoutineGraph(routine, getDefaultAppearance());
    const performanceGraph = generateRoutineGraph(routine, getDefaultAppearance(), { performanceMode: true });

    expect(graph.nodes).toHaveLength(251);
    expect(graph.edges.filter((edge) => !edge.data?.isDependency)).toHaveLength(250);
    expect(performanceGraph.nodes).toHaveLength(251);
    expect(performanceGraph.edges.filter((edge) => !edge.data?.isDependency)).toHaveLength(250);
    expect(performanceGraph.edges.some((edge) => edge.data?.isDependency)).toBe(false);
  });

  it('does not lose current/completed state when rendering a simultaneous active routine', () => {
    const routine = largeRoutine(12);
    routine.activeSession = {
      id: 'session-large',
      routineId: routine.id,
      occurrenceId: 'occurrence-large',
      status: 'running',
      currentStepId: 'step-5',
      startedAt: '2026-09-22T08:00:00.000Z',
      completedStepIds: ['step-0', 'step-1'],
      temporaryStepIds: [],
      updatedAt: '2026-09-22T08:05:00.000Z',
    };
    const graph = generateRoutineGraph(routine, getDefaultAppearance(), { performanceMode: true });

    expect(graph.nodes.find((node) => node.id === 'step-5')?.data.routineState).toBe('current');
    expect(graph.nodes.find((node) => node.id === 'step-0')?.data.routineState).toBe('completed');
    expect(graph.nodes.find((node) => node.id === 'step-11')?.data.routineState).toBe('active');
  });
});
