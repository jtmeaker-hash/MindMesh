import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';
import { QuickAddModal } from '../components/modals/QuickAddModal';
import { Category } from '../types';

describe('App Root Render', () => {
  it('renders App without crashing', () => {
    const { container } = render(<App />);
    expect(container).toBeDefined();
    expect(screen.getAllByText('MindMesh').length).toBeGreaterThanOrEqual(1);
  });

  it('keeps the graph in a flex viewport and exposes every primary tab', () => {
    const { container } = render(<App />);
    const shell = container.querySelector('.mm-app-shell') as HTMLElement;
    const graphViewport = screen.getByTestId('graph-viewport');
    const spatialGraph = screen.getByTestId('spatial-graph');
    const navigation = screen.getByRole('navigation', { name: 'Primary Navigation' });

    expect(shell.style.height).toBe('100dvh');
    expect(graphViewport.style.flex).toBe('1 1 0%');
    expect(graphViewport.style.minHeight).toBe('0px');
    expect(graphViewport.style.minWidth).toBe('0px');
    expect(spatialGraph.getAttribute('data-spatial-active')).toBe('true');
    expect(spatialGraph.querySelectorAll('[data-node-id]').length).toBeGreaterThan(0);
    expect(navigation.querySelectorAll('button')).toHaveLength(4);
    expect(screen.getByRole('button', { name: /MindMesh/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Contacts/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Money/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Dashboard/ })).toBeDefined();
  });
});

describe('Modal & UI Components', () => {
  const dummyCategory: Category = {
    id: 'cat-work',
    name: 'Work',
    color: '#3b82f6',
    createdAt: new Date().toISOString(),
  };

  it('renders nothing when QuickAddModal isOpen is false', () => {
    const { container } = render(
      <QuickAddModal
        isOpen={false}
        onClose={vi.fn()}
        focusedCategory={null}
        onSelectAddReminder={vi.fn()}
        onSelectAddCategory={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders quick action buttons when QuickAddModal is open', () => {
    const onSelectAddReminder = vi.fn();
    const onSelectAddCategory = vi.fn();
    const onClose = vi.fn();

    render(
      <QuickAddModal
        isOpen={true}
        onClose={onClose}
        focusedCategory={dummyCategory}
        onSelectAddReminder={onSelectAddReminder}
        onSelectAddCategory={onSelectAddCategory}
      />
    );

    expect(screen.getByText('Quick Create')).toBeDefined();
    expect(screen.getByText('New Reminder / Task')).toBeDefined();
    expect(screen.getByText(/Preselected in "Work"/)).toBeDefined();
    expect(screen.getByText('New Category Branch')).toBeDefined();

    const addReminderBtn = screen.getByText('New Reminder / Task');
    fireEvent.click(addReminderBtn);
    expect(onSelectAddReminder).toHaveBeenCalledWith('cat-work');
  });

  it('triggers onSelectAddCategory when category action is selected', () => {
    const onSelectAddCategory = vi.fn();

    render(
      <QuickAddModal
        isOpen={true}
        onClose={vi.fn()}
        focusedCategory={null}
        onSelectAddReminder={vi.fn()}
        onSelectAddCategory={onSelectAddCategory}
      />
    );

    const addCategoryBtn = screen.getByText('New Category Branch');
    fireEvent.click(addCategoryBtn);
    expect(onSelectAddCategory).toHaveBeenCalled();
  });
});
