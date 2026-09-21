import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ReminderModal } from '../components/modals/ReminderModal';
import { Category, Reminder } from '../types';
import { AppNotificationSettings, DEFAULT_NOTIFICATION_SETTINGS } from '../types/notifications';
import { flushLogs } from '../services/logging';
import { teardownNotificationEngine } from '../services/notifications';

const CATEGORIES: Category[] = [
  { id: 'cat-health', name: 'Health', color: '#22d3ee', createdAt: new Date().toISOString() },
];

const TITLE_PLACEHOLDER = /Book mechanic service/i;

interface RenderOptions {
  reminder?: Reminder | null;
  settings?: Partial<AppNotificationSettings>;
}

function renderModal(options: RenderOptions = {}) {
  const onSave = vi.fn();
  const onClose = vi.fn();

  render(
    <ReminderModal
      isOpen
      onClose={onClose}
      reminder={options.reminder ?? null}
      categories={CATEGORIES}
      notificationSettings={{ ...DEFAULT_NOTIFICATION_SETTINGS, ...options.settings }}
      notificationHistory={[]}
      onSave={onSave}
      onDelete={vi.fn()}
      onToggleComplete={vi.fn()}
    />
  );

  return { onSave, onClose };
}

function submittedReminder(onSave: ReturnType<typeof vi.fn>): Reminder {
  expect(onSave).toHaveBeenCalled();
  return onSave.mock.calls[0][0] as Reminder;
}

function setTitle(value = 'Dentist Appointment') {
  fireEvent.change(screen.getByPlaceholderText(TITLE_PLACEHOLDER), { target: { value } });
}

describe('Reminder notification configuration', () => {
  beforeEach(() => {
    localStorage.clear();
    flushLogs();
  });

  afterEach(() => {
    teardownNotificationEngine();
  });

  it('creates a new reminder using the app default notification settings', () => {
    const { onSave } = renderModal();

    setTitle();
    fireEvent.click(screen.getByRole('button', { name: /Create Reminder/ }));

    const saved = submittedReminder(onSave);
    expect(saved.title).toBe('Dentist Appointment');
    expect(saved.notifications?.enabled).toBe(DEFAULT_NOTIFICATION_SETTINGS.defaultReminderNotifications);
    expect(saved.notifications?.notifyAtDueTime).toBe(DEFAULT_NOTIFICATION_SETTINGS.defaultNotifyAtDueTime);
    expect(saved.notifications?.advanceMinutes).toEqual([DEFAULT_NOTIFICATION_SETTINGS.defaultAdvanceMinutes]);
  });

  it('honours a default of no advance notification', () => {
    const { onSave } = renderModal({ settings: { defaultAdvanceMinutes: 0 } });

    setTitle();
    fireEvent.click(screen.getByRole('button', { name: /Create Reminder/ }));

    expect(submittedReminder(onSave).notifications?.advanceMinutes).toEqual([]);
  });

  it('saves multiple advance notifications for one reminder', () => {
    const { onSave } = renderModal({ settings: { defaultAdvanceMinutes: 0 } });

    setTitle();
    fireEvent.click(screen.getByRole('button', { name: '1 day before' }));
    fireEvent.click(screen.getByRole('button', { name: '2 hours before' }));
    fireEvent.click(screen.getByRole('button', { name: '15 min before' }));
    fireEvent.click(screen.getByRole('button', { name: /Create Reminder/ }));

    const saved = submittedReminder(onSave);
    expect(saved.notifications?.enabled).toBe(true);
    expect(saved.notifications?.advanceMinutes).toEqual([15, 120, 1440]);
    expect(saved.notifications?.notifyAtDueTime).toBe(true);
  });

  it('lets the same preset be toggled back off', () => {
    const { onSave } = renderModal({ settings: { defaultAdvanceMinutes: 0 } });

    setTitle();
    fireEvent.click(screen.getByRole('button', { name: '30 min before' }));
    fireEvent.click(screen.getByRole('button', { name: '30 min before' }));
    fireEvent.click(screen.getByRole('button', { name: /Create Reminder/ }));

    expect(submittedReminder(onSave).notifications?.advanceMinutes).toEqual([]);
  });

  it('accepts a custom advance duration', () => {
    const { onSave } = renderModal({ settings: { defaultAdvanceMinutes: 0 } });

    setTitle();
    fireEvent.change(screen.getByPlaceholderText(/Custom minutes before/i), { target: { value: '45' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /Create Reminder/ }));

    expect(submittedReminder(onSave).notifications?.advanceMinutes).toEqual([45]);
  });

  it('ignores nonsense custom durations', () => {
    const { onSave } = renderModal({ settings: { defaultAdvanceMinutes: 0 } });

    setTitle('Nonsense');
    fireEvent.change(screen.getByPlaceholderText(/Custom minutes before/i), { target: { value: '-10' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    fireEvent.click(screen.getByRole('button', { name: /Create Reminder/ }));

    const saved = submittedReminder(onSave);
    expect(saved.notifications?.advanceMinutes).toEqual([]);
  });

  it('saves a custom snooze duration', () => {
    const { onSave } = renderModal();

    setTitle('Snooze me');
    fireEvent.change(screen.getByLabelText('Custom snooze duration'), { target: { value: '60' } });
    fireEvent.click(screen.getByRole('button', { name: /Create Reminder/ }));

    expect(submittedReminder(onSave).notifications?.snoozeMinutes).toBe(60);
  });

  it('can switch notifications off without losing the chosen schedule', () => {
    const { onSave } = renderModal();

    setTitle('Off again');
    fireEvent.click(screen.getByRole('button', { name: '1 hour before' }));
    fireEvent.click(screen.getByRole('button', { name: 'On' }));
    fireEvent.click(screen.getByRole('button', { name: /Create Reminder/ }));

    const saved = submittedReminder(onSave);
    expect(saved.notifications?.enabled).toBe(false);
    expect(saved.notifications?.advanceMinutes).toContain(60);
  });

  it('loads existing notification configuration when editing', () => {
    const existing: Reminder = {
      id: 'rem-existing',
      categoryId: 'cat-health',
      title: 'Existing reminder',
      dueDate: '2099-03-04',
      dueTime: '15:00',
      priority: 'medium',
      completed: false,
      createdAt: new Date().toISOString(),
      subtasks: [],
      notifications: { enabled: true, notifyAtDueTime: false, advanceMinutes: [30], snoozeMinutes: 5 },
    };

    const { onSave } = renderModal({ reminder: existing });

    expect(screen.getByRole('button', { name: 'On' })).toBeDefined();
    const dueTimeCheckbox = screen.getByRole('checkbox', {
      name: /Notify at the exact due time/,
    }) as HTMLInputElement;
    expect(dueTimeCheckbox.checked).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /Save Changes/ }));
    const saved = submittedReminder(onSave);

    expect(saved.id).toBe('rem-existing');
    expect(saved.notifications).toEqual({
      enabled: true,
      notifyAtDueTime: false,
      advanceMinutes: [30],
      snoozeMinutes: 5,
    });
  });

  it('starts a previously unconfigured reminder with notifications off', () => {
    const existing: Reminder = {
      id: 'rem-legacy',
      categoryId: 'cat-health',
      title: 'Legacy reminder',
      dueDate: '2099-03-04',
      priority: 'medium',
      completed: false,
      createdAt: new Date().toISOString(),
      subtasks: [],
    };

    renderModal({ reminder: existing });

    // Upgrading must not silently start notifying about old reminders.
    expect(screen.getByRole('button', { name: 'Off' })).toBeDefined();
  });

  it('warns that a due date is needed before a schedule can run', () => {
    renderModal();
    setTitle('No date yet');

    expect(screen.getByText(/Set a due date to schedule notifications/i)).toBeDefined();
  });

  it('does not wipe typed input when the notification section is edited', () => {
    // Regression guard for the reset-effect bug class fixed earlier in this project.
    const { onSave } = renderModal();

    const titleInput = screen.getByPlaceholderText(TITLE_PLACEHOLDER) as HTMLInputElement;
    fireEvent.change(titleInput, { target: { value: 'Half filled form' } });
    fireEvent.click(screen.getByRole('button', { name: '5 min before' }));

    expect(titleInput.value).toBe('Half filled form');

    fireEvent.click(screen.getByRole('button', { name: /Create Reminder/ }));
    expect(submittedReminder(onSave).title).toBe('Half filled form');
  });
});
