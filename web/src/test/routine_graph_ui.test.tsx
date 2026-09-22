import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReactFlowProvider } from '@xyflow/react';
import { RoutineModule } from '../components/routines/RoutineModule';
import { createEmptyRoutine, createRoutineStep } from '../types/routine';
import { createRoutine } from '../services/routines';
import { getDefaultAppearance } from '../services/appearance';
import { runDiagnostics } from '../services/diagnostics';

const category = { id: 'cat-routine', name: 'Personal', color: '#0891b2', createdAt: new Date().toISOString() };

function seedRoutine() {
  const routineId = 'routine-graph-ui';
  createRoutine(createEmptyRoutine({
    id: routineId,
    name: 'Mobile-safe routine',
    categoryId: category.id,
    steps: [
      createRoutineStep({ id: 'step-one', routineId, title: 'First step', order: 0 }),
      createRoutineStep({ id: 'step-two', routineId, title: 'Second step', order: 1 }),
    ],
  }));
}

function renderBuilder() {
  const result = render(
    <ReactFlowProvider>
      <RoutineModule categories={[category]} appearance={getDefaultAppearance()} />
    </ReactFlowProvider>
  );
  fireEvent.click(screen.getByText('Mobile-safe routine'));
  return result;
}

describe('Routine Builder graph mode containment', () => {
  beforeEach(() => {
    localStorage.clear();
    seedRoutine();
  });

  it('loads in list mode and swaps to a bounded graph viewport on mobile-sized layouts', () => {
    const { container } = renderBuilder();

    expect(screen.getByTestId('routine-list-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('routine-graph')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Node graph/i }));

    const viewport = screen.getByTestId('routine-graph-viewport');
    expect(viewport).toBeInTheDocument();
    expect(viewport).toHaveStyle({ position: 'relative', width: '100%', minWidth: '0px', overflow: 'hidden' });
    expect(viewport.querySelector('[data-testid="spatial-graph"]')).toBeInTheDocument();
    expect(screen.queryByTestId('routine-list-editor')).not.toBeInTheDocument();
    expect(container.querySelector('.routine-module')).toHaveClass('routine-module');
  });

  it('always exits graph mode and unmounts the interaction surface when List editor is tapped', () => {
    const { unmount } = renderBuilder();
    const graphTab = screen.getByRole('tab', { name: /Node graph/i });
    const listTab = screen.getByRole('tab', { name: /List editor/i });

    fireEvent.click(graphTab);
    expect(screen.getByTestId('spatial-graph')).toBeInTheDocument();
    fireEvent.click(listTab);

    expect(screen.getByTestId('routine-list-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('routine-graph')).not.toBeInTheDocument();
    expect(screen.queryByTestId('spatial-graph')).not.toBeInTheDocument();
    expect(listTab).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(graphTab);
    fireEvent.click(listTab);
    fireEvent.click(graphTab);
    fireEvent.click(listTab);
    expect(screen.queryByTestId('spatial-graph')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Mobile-safe routine')).toBeInTheDocument();
    unmount();
  });

  it('keeps routine data unchanged while switching views', () => {
    renderBuilder();
    fireEvent.click(screen.getByRole('tab', { name: /Node graph/i }));
    fireEvent.click(screen.getByRole('tab', { name: /List editor/i }));

    expect(screen.getByDisplayValue('Mobile-safe routine')).toBeInTheDocument();
    expect(screen.getByDisplayValue('First step')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Second step')).toBeInTheDocument();
  });

  it('reports graph containment through the existing diagnostics runner', async () => {
    renderBuilder();
    fireEvent.click(screen.getByRole('tab', { name: /Node graph/i }));

    const report = await runDiagnostics('quick');
    const graphCheck = report.results.find((result) => result.id === 'routines.graphLayout');
    expect(graphCheck?.status).toBe('pass');
    expect(graphCheck?.details).toMatchObject({ active: true, editorMode: 'graph', contained: true });

    fireEvent.click(screen.getByRole('tab', { name: /List editor/i }));
    const closedReport = await runDiagnostics('quick');
    const closedGraphCheck = closedReport.results.find((result) => result.id === 'routines.graphLayout');
    expect(closedGraphCheck?.status).toBe('pass');
    expect(closedGraphCheck?.details).toMatchObject({ active: false });
  });
});
