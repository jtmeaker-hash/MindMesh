import { beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { SmartAssistantModal } from '../components/modals/SmartAssistantModal';
import { SettingsBackupModal, requestSettingsTab } from '../components/modals/SettingsBackupModal';
import { Category, Reminder } from '../types';
import { DEFAULT_SMART_ENGINE_SETTINGS, SmartEngineSettings } from '../types/smartEngine';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { SmartAssistantHandlers } from '../services/smartAssistant';

/**
 * Stage 07 UI coverage: the assistant surface is preview-only. These tests make
 * sure a rendered command cannot mutate anything without the confirm button.
 */

const categories: Category[] = [
  { id: 'car', name: 'Car', color: '#06b6d4', createdAt: '2026-01-01T00:00:00.000Z' },
  { id: 'work', name: 'Work', color: '#38bdf8', createdAt: '2026-01-01T00:00:00.000Z' },
];

const reminders: Reminder[] = [];

const moneyState = getDefaultMoneyState();

function createHandlers(): { [K in keyof SmartAssistantHandlers]: ReturnType<typeof vi.fn> } {
  return { saveReminder: vi.fn(), saveCategory: vi.fn(), saveDirectDebit: vi.fn() };
}

function renderAssistant(
  handlers: SmartAssistantHandlers,
  settings: SmartEngineSettings = DEFAULT_SMART_ENGINE_SETTINGS,
  onOpenSettings = vi.fn(),
  assistantReminders: Reminder[] = reminders
) {
  render(
    <SmartAssistantModal
      isOpen
      onClose={() => undefined}
      settings={settings}
      categories={categories}
      reminders={assistantReminders}
      moneyState={moneyState}
      contacts={[]}
      handlers={handlers}
      onOpenSettings={onOpenSettings}
    />
  );
  return { onOpenSettings };
}

function typeCommand(command: string) {
  fireEvent.change(screen.getByTestId('smart-assistant-command'), { target: { value: command } });
  fireEvent.click(screen.getByTestId('smart-assistant-ready'));
}

describe('MindMesh Smart Assistant surface', () => {
  beforeEach(() => localStorage.clear());

  it('previews a command without writing, and writes only after Confirm', () => {
    const handlers = createHandlers();
    renderAssistant(handlers);

    expect(screen.getByText(/Local rules only/)).toBeTruthy();
    expect(screen.getByText(/Nothing is written until you confirm/i)).toBeTruthy();

    typeCommand('Remind me to service the car');

    // A proposal is shown with its preview rows, but nothing was written.
    expect(screen.getByTestId('smart-assistant-rows')).toBeTruthy();
    expect(screen.getByText('PROPOSED ACTION — PREVIEW')).toBeTruthy();
    expect(handlers.saveReminder).not.toHaveBeenCalled();
    expect(handlers.saveCategory).not.toHaveBeenCalled();
    expect(handlers.saveDirectDebit).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('smart-assistant-confirm'));

    expect(handlers.saveReminder).toHaveBeenCalledTimes(1);
    const reminder = handlers.saveReminder.mock.calls[0][0] as Reminder;
    expect(reminder.title).toBe('service the car');
    expect(reminder.categoryId).toBe('car');
    expect(screen.getByTestId('smart-assistant-outcome').textContent).toMatch(/Created reminder/);
  });

  it('renders structured reminder facts as a read-only summary', () => {
    const handlers = createHandlers();
    const summaryReminders: Reminder[] = [
      {
        id: 'r1',
        categoryId: 'car',
        title: 'Service car',
        dueDate: '2099-03-15',
        priority: 'medium',
        completed: false,
        createdAt: '2026-01-01T00:00:00.000Z',
        subtasks: [{ id: 's1', reminderId: 'r1', title: 'Book service', completed: true, createdAt: '2026-01-01T00:00:00.000Z' }],
      },
      {
        id: 'r2',
        categoryId: 'work',
        title: 'Send report',
        priority: 'medium',
        completed: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        subtasks: [],
      },
    ];
    renderAssistant(handlers, DEFAULT_SMART_ENGINE_SETTINGS, vi.fn(), summaryReminders);

    typeCommand('Summarize my reminders');

    expect(screen.getByTestId('smart-assistant-graph-summary')).toBeTruthy();
    expect(screen.getByText('Service car')).toBeTruthy();
    expect(screen.getByText('Send report')).toBeTruthy();
    expect(screen.getByTestId('smart-assistant-graph-summary').textContent).toContain('1/1 subtasks');
    expect(screen.getAllByTestId('smart-assistant-graph-summary-node')).toHaveLength(2);
    expect(screen.queryByTestId('smart-assistant-confirm')).toBeNull();
    expect(handlers.saveReminder).not.toHaveBeenCalled();
    expect(handlers.saveCategory).not.toHaveBeenCalled();
    expect(handlers.saveDirectDebit).not.toHaveBeenCalled();
  });

  it('keeps confirmation disabled until the missing answer is supplied', () => {
    const handlers = createHandlers();
    renderAssistant(handlers);

    typeCommand('Remind me to call the plumber tomorrow');

    const prompt = screen.getByTestId('smart-assistant-prompt-categoryId');
    expect(prompt.textContent).toMatch(/Choose which category/);
    expect((screen.getByTestId('smart-assistant-confirm') as HTMLButtonElement).disabled).toBe(true);

    // Clicking confirm while blocked must not write.
    fireEvent.click(screen.getByTestId('smart-assistant-confirm'));
    expect(handlers.saveReminder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Work' }));
    expect((screen.getByTestId('smart-assistant-confirm') as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(screen.getByTestId('smart-assistant-confirm'));
    expect(handlers.saveReminder).toHaveBeenCalledTimes(1);
    expect((handlers.saveReminder.mock.calls[0][0] as Reminder).categoryId).toBe('work');
  });

  it('does not write the same proposal twice', () => {
    const handlers = createHandlers();
    renderAssistant(handlers);

    typeCommand('Remind me to service the car');
    fireEvent.click(screen.getByTestId('smart-assistant-confirm'));
    expect(handlers.saveReminder).toHaveBeenCalledTimes(1);

    // Re-running the same command keeps the completed-proposal guard.
    typeCommand('Remind me to service the car');
    fireEvent.click(screen.getByTestId('smart-assistant-confirm'));

    expect(handlers.saveReminder).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('smart-assistant-outcome').textContent).toMatch(/already applied/i);
  });

  it('stays inert and points at settings when Smart Assistance is off', () => {
    const handlers = createHandlers();
    const off: SmartEngineSettings = { ...DEFAULT_SMART_ENGINE_SETTINGS, enabled: false };
    const { onOpenSettings } = renderAssistant(handlers, off);

    expect(screen.getByTestId('smart-assistant-off').textContent).toMatch(/Smart Assistance is off/);
    expect(screen.queryByTestId('smart-assistant-command')).toBeNull();

    fireEvent.click(screen.getByText(/Open Smart Assistance settings/));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(handlers.saveReminder).not.toHaveBeenCalled();
  });

  it('opens the settings modal on the Smart tab when asked, and only that once', () => {
    const props = {
      onClose: () => undefined,
      onRestoreComplete: () => undefined,
      onResetComplete: () => undefined,
    };
    const { rerender } = render(<SettingsBackupModal isOpen={false} {...props} />);

    requestSettingsTab('smart');
    rerender(<SettingsBackupModal isOpen {...props} />);
    expect(screen.getByTestId('smart-assistance-privacy')).toBeTruthy();

    // The request is consumed, so reopening later falls back to the default tab.
    rerender(<SettingsBackupModal isOpen={false} {...props} />);
    rerender(<SettingsBackupModal isOpen {...props} />);
    expect(screen.getByText('Export Backup')).toBeTruthy();
  });
});
