import { describe, it, expect, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import App from '../App';

describe('Vehicle Maintenance UI', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('opens from the primary navigation and shows the empty state', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Vehicles/ }));
    expect(screen.getByText(/No vehicles yet/)).toBeDefined();
    expect(screen.getByRole('button', { name: /Add your first vehicle/ })).toBeDefined();
  });

  it('opens the add-vehicle form from the empty state', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: /Vehicles/ }));
    fireEvent.click(screen.getByRole('button', { name: /Add your first vehicle/ }));
    expect(screen.getByRole('heading', { name: 'Add vehicle' })).toBeDefined();
    expect(screen.getByText('Nickname')).toBeDefined();
  });
});
