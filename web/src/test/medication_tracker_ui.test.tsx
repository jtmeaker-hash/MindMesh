import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MedicationTrackerModule } from '../plugins/medication-tracker/MedicationTrackerModule';
import { bindStorage, clear as clearStore, setState } from '../plugins/medication-tracker/store';
import { createDefaultState } from '../plugins/medication-tracker/model';

beforeEach(() => {
  localStorage.clear();
  bindStorage(null);
  clearStore();
});

describe('Medication & Supplement Tracker plugin UI', () => {
  it('shows the empty state and opens the add form', () => {
    render(<MedicationTrackerModule appNotificationsEnabled />);
    expect(screen.getByRole('heading', { name: 'Medication & Supplement Tracker' })).toBeDefined();
    expect(screen.getByText(/Nothing tracked yet/)).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /Add your first entry/ }));
    expect(screen.getByRole('heading', { name: 'Add medication or supplement' })).toBeDefined();
    expect(screen.getByText('Form')).toBeDefined();
  });

  it('renders an existing item in the list and its history tab', () => {
    setState({
      ...createDefaultState(),
      items: [
        {
          id: 'm1',
          name: 'Vitamin D',
          kind: 'vitamin',
          active: true,
          asNeeded: true,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
    });
    render(<MedicationTrackerModule appNotificationsEnabled />);
    fireEvent.click(screen.getByRole('button', { name: /Medications/ }));
    expect(screen.getByText('Vitamin D')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /History/ }));
    expect(screen.getByText(/Nothing logged yet/)).toBeDefined();
  });
});
