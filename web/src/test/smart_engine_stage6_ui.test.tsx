import { beforeEach, describe, expect, it } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SmartAssistancePanel } from '../components/modals/SmartAssistancePanel';
import { SettingsBackupModal } from '../components/modals/SettingsBackupModal';
import { loadSmartEngineSettings } from '../services/storage';

describe('Smart Assistance settings panel', () => {
  beforeEach(() => localStorage.clear());

  it('shows the local-first explanation and persists per-feature toggles', () => {
    render(<SmartAssistancePanel />);

    // Privacy copy explains the local-only design.
    const privacy = screen.getByTestId('smart-assistance-privacy');
    expect(privacy.textContent).toMatch(/runs locally/i);
    expect(privacy.textContent).toMatch(/no network request/i);

    // Confirmation for writes is shown as enforced and not user-disableable.
    const confirmation = screen.getByTestId('smart-assistance-confirmation');
    expect(confirmation.textContent).toMatch(/Confirmation always required/);
    expect(confirmation.textContent).toMatch(/no hidden bypass/);
    expect(screen.queryByRole('switch', { name: /confirmation/i })).toBeNull();

    const subtaskSwitch = screen.getByRole('switch', { name: 'Suggest subtasks' });
    expect(subtaskSwitch.getAttribute('aria-checked')).toBe('true');
    fireEvent.click(subtaskSwitch);
    expect(screen.getByRole('switch', { name: 'Suggest subtasks' }).getAttribute('aria-checked')).toBe('false');
    expect(loadSmartEngineSettings().featureToggles).toEqual({ suggestSubtasks: false });

    // Disabling the master switch keeps feature preferences but blocks interaction.
    const master = screen.getByRole('switch', { name: 'Enable Smart Assistance' });
    fireEvent.click(master);
    expect(loadSmartEngineSettings().enabled).toBe(false);
    expect((screen.getByRole('switch', { name: 'Suggest subtasks' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('is reachable from the existing settings modal without changing other tabs', () => {
    render(
      <SettingsBackupModal
        isOpen
        onClose={() => undefined}
        onRestoreComplete={() => undefined}
        onResetComplete={() => undefined}
      />
    );

    // Existing tabs are untouched.
    expect(screen.getByText('Export Backup')).toBeTruthy();
    expect(screen.getByText('Restore Backup')).toBeTruthy();

    fireEvent.click(screen.getByText('Smart'));
    expect(screen.getByTestId('smart-assistance-privacy')).toBeTruthy();

    // Reset tab still works exactly as before.
    fireEvent.click(screen.getByText('Reset MindMesh'));
    expect(screen.getByText('Reset MindMesh Entirely')).toBeTruthy();
  });
});
