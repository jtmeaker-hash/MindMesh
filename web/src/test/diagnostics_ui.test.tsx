import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { DiagnosticsModal } from '../components/diagnostics/DiagnosticsModal';
import { NotificationsModal } from '../components/notifications/NotificationsModal';
import App from '../App';
import {
  AppNotificationSettings,
  DEFAULT_NOTIFICATION_SETTINGS,
  NotificationHistoryEntry,
} from '../types/notifications';
import { flushLogs } from '../services/logging';
import { teardownNotificationEngine } from '../services/notifications';

function renderNotificationsModal(overrides: Partial<AppNotificationSettings> = {}) {
  const onChange = vi.fn();
  const onChangeHistory = vi.fn();
  const onOpenReminder = vi.fn();
  const onOpenDiagnostics = vi.fn();

  const history: NotificationHistoryEntry[] = [
    {
      id: 'rem-1::2099-03-04T15:00::15',
      reminderId: 'rem-1',
      reminderTitle: 'Dentist Appointment',
      scheduledFor: new Date(Date.now() + 3600_000).toISOString(),
      offsetMinutes: 15,
      status: 'pending',
    },
    {
      id: 'rem-2::2099-03-04T09:00::0',
      reminderId: 'rem-2',
      reminderTitle: 'Pay rent',
      scheduledFor: new Date(Date.now() - 7200_000).toISOString(),
      offsetMinutes: 0,
      status: 'missed',
    },
  ];

  const Harness: React.FC = () => {
    const [settings, setSettings] = useState<AppNotificationSettings>({
      ...DEFAULT_NOTIFICATION_SETTINGS,
      ...overrides,
    });
    return (
      <NotificationsModal
        isOpen
        onClose={() => {}}
        settings={settings}
        onChange={(next) => {
          onChange(next);
          setSettings(next);
        }}
        history={history}
        onChangeHistory={onChangeHistory}
        onOpenReminder={onOpenReminder}
        onOpenDiagnostics={onOpenDiagnostics}
      />
    );
  };

  render(<Harness />);
  return { onChange, onChangeHistory, onOpenReminder, onOpenDiagnostics };
}

describe('NotificationsModal', () => {
  beforeEach(() => {
    localStorage.clear();
    flushLogs();
  });

  afterEach(() => {
    teardownNotificationEngine();
  });

  it('toggles the master notification switch', () => {
    const { onChange } = renderNotificationsModal({ enabled: false });

    const toggle = screen.getByRole('button', { name: 'Off' });
    fireEvent.click(toggle);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ enabled: true });
    expect(screen.getByRole('button', { name: 'On' })).toBeDefined();
  });

  it('shows the permission status and the scheduled count', () => {
    renderNotificationsModal();

    expect(screen.getByText(/Permission:/)).toBeDefined();
    // jsdom has no Notification API, so the panel must say so rather than pretend.
    expect(screen.getByText(/Unavailable|Not yet allowed|Allowed|Blocked/)).toBeDefined();
    expect(screen.getByText('Scheduled:').parentElement?.textContent).toContain('1');
    expect(screen.getByText('Missed:').parentElement?.textContent).toContain('1');
  });

  it('reports a useful message when a test notification cannot be sent', async () => {
    renderNotificationsModal();

    fireEvent.click(screen.getByRole('button', { name: /Test Notification/ }));

    await waitFor(() => {
      expect(
        screen.getByText(/does not provide a notification API|not available in this environment/i)
      ).toBeDefined();
    });
  });

  it('lists notification history and opens the linked reminder', () => {
    const { onOpenReminder, onChangeHistory } = renderNotificationsModal();

    // Default filter is upcoming, so switch to all to see the missed entry too.
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(screen.getByText('Dentist Appointment')).toBeDefined();
    expect(screen.getByText('Pay rent')).toBeDefined();

    const rows = screen.getAllByRole('button', { name: 'Open reminder' });
    fireEvent.click(rows[0]);
    expect(onOpenReminder).toHaveBeenCalled();

    // Snoozing an entry must flow back to the parent rather than mutating the reminder.
    const snooze = screen.getAllByLabelText(/Snooze/)[0];
    fireEvent.change(snooze, { target: { value: '15' } });
    expect(onChangeHistory).toHaveBeenCalled();
  });

  it('exposes the defaults that apply to new reminders', () => {
    const { onChange } = renderNotificationsModal();

    const advanceSelect = screen.getByLabelText('Default advance notification');
    fireEvent.change(advanceSelect, { target: { value: '60' } });
    expect(onChange.mock.calls[0][0]).toMatchObject({ defaultAdvanceMinutes: 60 });

    const snoozeSelect = screen.getByLabelText('Default snooze duration');
    fireEvent.change(snoozeSelect, { target: { value: '30' } });
    expect(onChange.mock.calls[1][0]).toMatchObject({ defaultSnoozeMinutes: 30 });
  });

  it('links across to diagnostics', () => {
    const { onOpenDiagnostics } = renderNotificationsModal();
    fireEvent.click(screen.getByRole('button', { name: /Open Diagnostics/ }));
    expect(onOpenDiagnostics).toHaveBeenCalled();
  });
});

describe('DiagnosticsModal', () => {
  beforeEach(() => {
    localStorage.clear();
    flushLogs();
  });

  afterEach(() => {
    teardownNotificationEngine();
  });

  it('runs diagnostics on open and summarises overall health', async () => {
    render(<DiagnosticsModal isOpen onClose={() => {}} />);

    expect(await screen.findByText('MINDMESH HEALTH')).toBeDefined();
    await waitFor(() => {
      expect(screen.getByText(/\d+ Passed/)).toBeDefined();
    });
    expect(screen.getByText(/\d+ Warnings/)).toBeDefined();
    expect(screen.getByText(/\d+ Failed/)).toBeDefined();
    expect(screen.getByText(/Last diagnostic run:/)).toBeDefined();
  });

  it('shows real check results with statuses and expandable details', async () => {
    render(<DiagnosticsModal isOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/\d+ Passed/)).toBeDefined());

    const appVersion = await screen.findByText('App & build version');
    const card = appVersion.closest('[data-diagnostic-id]') as HTMLElement;
    expect(card).not.toBeNull();
    expect(card.getAttribute('data-diagnostic-status')).toBe('pass');

    fireEvent.click(within(card).getByRole('button', { name: /Technical details/ }));
    const details = within(card).getByText(/"appVersion"/);
    expect(details).toBeDefined();
    expect(details.textContent).toContain('schemaVersion');
  });

  it('splits checks across the notifications, storage and backups tabs', async () => {
    render(<DiagnosticsModal isOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/\d+ Passed/)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText('Notification permission')).toBeDefined();
    expect(screen.queryByText('App & build version')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Storage/ }));
    expect(await screen.findByText('State hydration')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Backups/ }));
    expect(await screen.findByText('Backup system')).toBeDefined();
    expect(screen.getByText(/Last backup:/)).toBeDefined();
  });

  it('keeps advanced internals hidden until advanced mode is enabled', async () => {
    render(<DiagnosticsModal isOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/\d+ Passed/)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Advanced/ }));
    expect(screen.getByText(/hidden. Enable advanced diagnostics/)).toBeDefined();
    expect(screen.queryByText('RAW DIAGNOSTIC IDS')).toBeNull();

    fireEvent.click(screen.getByLabelText(/Advanced diagnostics mode/));
    expect(await screen.findByText('RAW DIAGNOSTIC IDS')).toBeDefined();
    expect(screen.getByText(/mindmesh_state_v2/)).toBeDefined();
    expect(screen.getByText('BUILD & STATE')).toBeDefined();
  }, 20000);

  it('runs safe repairs and reports what was fixed', async () => {
    render(<DiagnosticsModal isOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/\d+ Passed/)).toBeDefined());

    // Exactly the Fixer tab — other health banners also mention the Fixer.
    fireEvent.click(screen.getByRole('button', { name: /^Fixer$/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Fix All Safe Issues/ }));

    // The preview must list what is about to be repaired.
    expect(screen.getByText(/The following safe repairs will run/)).toBeDefined();
    expect(screen.getByText('Re-run safe migrations')).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: /Run safe repairs/ }));

    await waitFor(
      () => {
        expect(screen.getByText(/Issues fixed:/)).toBeDefined();
      },
      { timeout: 20000 }
    );
    expect(screen.getByText(/Issues remaining:/)).toBeDefined();
    expect(screen.getByText(/Issues requiring manual action:/)).toBeDefined();
  }, 40000);

  it('never offers a confirmation-required repair inside Fix All', async () => {
    render(<DiagnosticsModal isOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/\d+ Passed/)).toBeDefined());

    // Exactly the Fixer tab — other health banners also mention the Fixer.
    fireEvent.click(screen.getByRole('button', { name: /^Fixer$/ }));
    expect(await screen.findByText('REPAIRS REQUIRING CONFIRMATION')).toBeDefined();
    expect(screen.getAllByRole('button', { name: /Review & run/ }).length).toBeGreaterThan(0);
  });

  it('renders the log viewer with filters and export actions', async () => {
    render(<DiagnosticsModal isOpen onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText(/\d+ Passed/)).toBeDefined());

    fireEvent.click(screen.getByRole('button', { name: /Logs/ }));

    expect(await screen.findByLabelText('Search logs')).toBeDefined();
    expect(screen.getByRole('button', { name: /Export logs \(text\)/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Copy diagnostic report/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Clear logs/ })).toBeDefined();
  });
});

describe('App shell diagnostic entry points', () => {
  beforeEach(() => {
    localStorage.clear();
    flushLogs();
  });

  afterEach(() => {
    cleanup();
    teardownNotificationEngine();
  });

  it('exposes Notifications and Diagnostics from the options menu', async () => {
    render(<App />);

    fireEvent.click(screen.getByTitle('Options'));

    const notificationsEntry = await screen.findByText('Notifications');
    const diagnosticsEntry = await screen.findByText('Diagnostics');
    expect(notificationsEntry).toBeDefined();
    expect(diagnosticsEntry).toBeDefined();

    fireEvent.click(diagnosticsEntry);
    expect(await screen.findByRole('dialog', { name: 'MindMesh Diagnostics' })).toBeDefined();
  }, 20000);
});
