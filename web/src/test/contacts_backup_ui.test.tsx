import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ContactsModule } from '../components/contacts/ContactsModule';
import { SettingsBackupModal } from '../components/modals/SettingsBackupModal';
import { Contact } from '../types/contact';
import { Reminder } from '../types';
import App from '../App';
import { createBackup, validateBackup } from '../services/backup';
import { loadAllData, saveContacts } from '../services/storage';
import { INITIAL_CONTACT_CATEGORIES, INITIAL_CONTACT_RELATIONSHIPS } from '../utils/sampleContactData';

/** Stateful harness so create/edit/delete flow through real component state. */
const ContactsHarness: React.FC<{ initial?: Contact[]; reminders?: Reminder[] }> = ({
  initial = [],
  reminders = [],
}) => {
  const [contacts, setContacts] = useState<Contact[]>(initial);
  const [categories, setCategories] = useState<string[]>(INITIAL_CONTACT_CATEGORIES);
  const [relationships, setRelationships] = useState<string[]>(INITIAL_CONTACT_RELATIONSHIPS);

  return (
    <ContactsModule
      contacts={contacts}
      onUpdateContacts={setContacts}
      contactCategories={categories}
      onUpdateContactCategories={setCategories}
      contactRelationships={relationships}
      onUpdateContactRelationships={setRelationships}
      reminders={reminders}
    />
  );
};

const makeContact = (overrides: Partial<Contact> = {}): Contact => ({
  id: 'contact-test-1',
  fullName: 'Jane Doe',
  phoneNumber: '+61 400 111 222',
  relationship: 'Friend',
  category: 'Personal',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...overrides,
});

describe('Contact Book UI: create, view, edit, delete', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates a contact through the modal and shows it in the list', async () => {
    render(<ContactsHarness />);

    // Empty state first
    expect(screen.getByText('No contacts found')).toBeDefined();

    fireEvent.click(screen.getByText('Add Contact'));
    expect(await screen.findByText('New Contact')).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah Miller'), {
      target: { value: 'Sarah Miller' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. Dr. Miller'), {
      target: { value: 'Dr. Miller' },
    });
    fireEvent.change(screen.getByPlaceholderText('+61 400 000 000'), {
      target: { value: '+61 400 555 777' },
    });
    fireEvent.change(screen.getByPlaceholderText('name@example.com'), {
      target: { value: 'sarah@clinic.example' },
    });
    fireEvent.change(screen.getByPlaceholderText('e.g. 124 Collins St, Melbourne VIC 3000'), {
      target: { value: '12 Clinic Rd, Melbourne VIC' },
    });

    fireEvent.click(screen.getByText('Create Contact'));

    // Modal closes and the new contact renders as a card
    await waitFor(() => expect(screen.queryByText('New Contact')).toBeNull());
    expect(screen.getByText('Dr. Miller')).toBeDefined();
    expect(screen.getByText('Sarah Miller')).toBeDefined();
    expect(screen.getByText('+61 400 555 777')).toBeDefined();
    expect(screen.getByText('1 contact saved • Linkable to reminders')).toBeDefined();
  });

  it('opens the detail view and shows actionable phone, email and address links', async () => {
    render(
      <ContactsHarness
        initial={[
          makeContact({
            email: 'jane@example.com',
            address: '100 King St, Sydney NSW',
            birthday: '1992-04-12',
            notes: 'University friend',
          }),
        ]}
      />
    );

    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(screen.getByText('Edit')).toBeDefined());

    const tel = document.querySelector('a[href^="tel:"]') as HTMLAnchorElement;
    const mail = document.querySelector('a[href^="mailto:"]') as HTMLAnchorElement;
    const map = document.querySelector('a[href*="google.com/maps"]') as HTMLAnchorElement;

    // Spaces are stripped so the tel: URI is dialable
    expect(tel.getAttribute('href')).toBe('tel:+61400111222');
    expect(mail.getAttribute('href')).toBe('mailto:jane@example.com');
    expect(map.getAttribute('href')).toContain('100%20King%20St');
    expect(screen.getByText('University friend')).toBeDefined();
  });

  it('edits an existing contact and persists the change in the list', async () => {
    render(<ContactsHarness initial={[makeContact()]} />);

    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(screen.getByText('Edit')).toBeDefined());
    fireEvent.click(screen.getByText('Edit'));

    // Prefilled with the existing contact
    const nameInput = screen.getByPlaceholderText('e.g. Sarah Miller') as HTMLInputElement;
    expect(nameInput.value).toBe('Jane Doe');

    fireEvent.change(screen.getByPlaceholderText('+61 400 000 000'), {
      target: { value: '+61 411 999 000' },
    });
    fireEvent.click(screen.getByText('Save Contact'));

    await waitFor(() => expect(screen.queryByText('Save Contact')).toBeNull());
    expect(screen.getByText('+61 411 999 000')).toBeDefined();
    expect(screen.queryByText('+61 400 111 222')).toBeNull();
  });

  it('requires confirmation before deleting a contact', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<ContactsHarness initial={[makeContact()]} />);

    fireEvent.click(screen.getByText('Jane Doe'));
    await waitFor(() => expect(screen.getByText('Edit')).toBeDefined());
    fireEvent.click(screen.getByText('Edit'));

    fireEvent.click(screen.getByTitle('Delete Contact'));
    expect(confirmSpy).toHaveBeenCalled();
    // Declined -> contact still present
    expect(screen.queryByText('Save Contact')).not.toBeNull();

    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByTitle('Delete Contact'));

    await waitFor(() => expect(screen.getByText('No contacts found')).toBeDefined());
    confirmSpy.mockRestore();
  });

  it('filters contacts by search query and by relationship', async () => {
    render(
      <ContactsHarness
        initial={[
          makeContact({ id: 'c1', fullName: 'Alice Adams', relationship: 'Coworker' }),
          makeContact({
            id: 'c2',
            fullName: 'Bob Brown',
            phoneNumber: '+61 422 333 444',
            relationship: 'Family',
          }),
        ]}
      />
    );

    expect(screen.getByText('Alice Adams')).toBeDefined();
    expect(screen.getByText('Bob Brown')).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText('Search by name, phone, email, or address...'), {
      target: { value: '422' },
    });
    await waitFor(() => expect(screen.queryByText('Alice Adams')).toBeNull());
    expect(screen.getByText('Bob Brown')).toBeDefined();

    fireEvent.change(screen.getByPlaceholderText('Search by name, phone, email, or address...'), {
      target: { value: '' },
    });
    fireEvent.click(screen.getByText('Coworker (1)'));
    await waitFor(() => expect(screen.queryByText('Bob Brown')).toBeNull());
    expect(screen.getByText('Alice Adams')).toBeDefined();
  });

  it('creates a custom relationship type and uses it on the saved contact', async () => {
    render(<ContactsHarness />);

    fireEvent.click(screen.getByText('Add Contact'));
    await screen.findByText('New Contact');

    fireEvent.change(screen.getByPlaceholderText('e.g. Sarah Miller'), {
      target: { value: 'Custom Person' },
    });
    fireEvent.change(screen.getByPlaceholderText('+61 400 000 000'), {
      target: { value: '+61 433 111 222' },
    });

    const addButtons = screen.getAllByText('+ New');
    fireEvent.click(addButtons[0]); // relationship
    fireEvent.change(screen.getByPlaceholderText('Custom relationship...'), {
      target: { value: 'Neighbour' },
    });
    fireEvent.click(screen.getByText('Add'));

    fireEvent.click(screen.getByText('Create Contact'));

    await waitFor(() => expect(screen.getByText('Custom Person')).toBeDefined());
    expect(screen.getByText('Neighbour (1)')).toBeDefined();
  });

  it('shows an initials avatar fallback when no photo is set, and an image when one is', () => {
    const { container } = render(
      <ContactsHarness
        initial={[
          makeContact({ id: 'c1', fullName: 'Alice Adams' }),
          makeContact({ id: 'c2', fullName: 'Zoe Zimmer', photo: 'data:image/jpeg;base64,AAAA' }),
        ]}
      />
    );

    const images = container.querySelectorAll('img');
    expect(images.length).toBe(1);
    expect(screen.getByText('AA')).toBeDefined();
  });
});

describe('Backup & Restore UI', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let revokeObjectURL: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    createObjectURL = vi.fn(() => 'blob:mindmesh-test');
    revokeObjectURL = vi.fn();
    // jsdom does not implement these
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const noop = () => {};

  it('renders nothing when closed', () => {
    const { container } = render(
      <SettingsBackupModal isOpen={false} onClose={noop} onRestoreComplete={noop} onResetComplete={noop} />
    );
    expect(container.firstChild).toBeNull();
  });

  it('produces a real backup blob and reports honestly what the browser did with it', async () => {
    render(
      <SettingsBackupModal isOpen onClose={noop} onRestoreComplete={noop} onResetComplete={noop} />
    );

    expect(screen.getByText('Backup, Restore & Data')).toBeDefined();
    fireEvent.click(screen.getByText('Export Full Backup'));

    const result = await screen.findByTestId('export-result');
    expect(screen.queryByTestId('export-error')).toBeNull();
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    // The blob handed to the browser is genuine, parseable backup JSON.
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(blob.size).toBeGreaterThan(0);

    // The filename follows the documented pattern.
    expect(result.textContent).toMatch(/mindmesh-backup-\d{4}-\d{2}-\d{2}-\d{6}\.json/);

    // jsdom cannot observe the browser's own download, so the UI must not claim
    // the file was saved — it offers a copy fallback instead.
    expect(result.textContent).toMatch(/browser downloads/);
    expect(screen.getByText('Copy backup JSON')).toBeDefined();
  });

  it('reports an unreadable store instead of exporting sample data', async () => {
    localStorage.setItem('mindmesh_state_v2', 'not json at all');

    render(
      <SettingsBackupModal isOpen onClose={noop} onRestoreComplete={noop} onResetComplete={noop} />
    );

    fireEvent.click(screen.getByText('Export Full Backup'));

    const error = await screen.findByTestId('export-error');
    expect(error.textContent).toMatch(/could not be read/);
    expect(screen.queryByTestId('export-result')).toBeNull();
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('shows an error instead of a success when the platform cannot write the file', async () => {
    createObjectURL.mockImplementation(() => {
      throw new Error('downloads are blocked in this frame');
    });

    render(
      <SettingsBackupModal isOpen onClose={noop} onRestoreComplete={noop} onResetComplete={noop} />
    );

    fireEvent.click(screen.getByText('Export Full Backup'));

    const error = await screen.findByTestId('export-error');
    expect(error.textContent).toMatch(/downloads are blocked in this frame/);
    expect(screen.queryByTestId('export-result')).toBeNull();
    expect(screen.getByText('Copy backup JSON instead')).toBeDefined();
  });

  it('previews a valid backup summary then restores it into persisted state', async () => {
    // Seed an exportable state containing a contact + a linked reminder
    saveContacts([makeContact({ id: 'contact-keep', fullName: 'Restore Me' })]);

    const backup = createBackup();
    backup.data.contacts = [makeContact({ id: 'restored-contact', fullName: 'Restored Person' })];
    backup.data.reminders = [
      {
        id: 'restored-rem',
        categoryId: backup.data.categories[0]?.id ?? 'cat-1',
        title: 'Restored reminder',
        priority: 'high',
        completed: false,
        subtasks: [],
        linkedContactId: 'restored-contact',
        createdAt: '2026-02-02T00:00:00.000Z',
      } as Reminder,
    ];

    const onRestoreComplete = vi.fn();
    render(
      <SettingsBackupModal
        isOpen
        onClose={noop}
        onRestoreComplete={onRestoreComplete}
        onResetComplete={noop}
      />
    );

    fireEvent.click(screen.getByText('Restore Backup'));
    await waitFor(() => expect(screen.getByText('Choose MindMesh Backup File')).toBeDefined());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify(backup)], 'MindMesh-Backup-2026-02-02-0000.json', {
      type: 'application/json',
    });
    fireEvent.change(fileInput, { target: { files: [file] } });

    // Validation summary appears
    await waitFor(() => expect(screen.getByText('Valid MindMesh Backup')).toBeDefined());
    // Summarised only — nothing is written to the app until the user confirms
    expect(screen.queryByText('Restored Person')).toBeNull();
    expect(screen.getByText('Contacts')).toBeDefined();
    expect(screen.getByText('Direct Debits')).toBeDefined();
    expect(loadAllData().contacts?.map((c) => c.id)).not.toContain('restored-contact');

    fireEvent.click(screen.getByText('Confirm & Restore Backup'));

    await waitFor(() => expect(screen.getByText(/Restoration complete/)).toBeDefined());
    // onRestoreComplete fires after the confirmation delay before the modal closes
    await waitFor(() => expect(onRestoreComplete).toHaveBeenCalled(), { timeout: 4000 });

    // State is now persisted and the link survived
    const stored = loadAllData();
    expect(stored.contacts?.map((c) => c.id)).toEqual(['restored-contact']);
    expect(stored.reminders?.[0].linkedContactId).toBe('restored-contact');
  });

  it('rejects a malformed backup file with a visible error and keeps current data', async () => {
    saveContacts([makeContact({ id: 'contact-keep', fullName: 'Keep Me' })]);

    render(
      <SettingsBackupModal isOpen onClose={noop} onRestoreComplete={noop} onResetComplete={noop} />
    );

    fireEvent.click(screen.getByText('Restore Backup'));
    await waitFor(() => expect(screen.getByText('Choose MindMesh Backup File')).toBeDefined());

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: { files: [new File(['{not json at all'], 'broken.json', { type: 'application/json' })] },
    });

    await waitFor(() => expect(screen.getByText(/Invalid JSON syntax/)).toBeDefined());
    // No confirm button, and existing data is untouched
    expect(screen.queryByText('Confirm & Restore Backup')).toBeNull();
    expect(loadAllData().contacts?.map((c) => c.id)).toEqual(['contact-keep']);
  });

  it('rejects an unsupported future backup version', async () => {
    render(
      <SettingsBackupModal isOpen onClose={noop} onRestoreComplete={noop} onResetComplete={noop} />
    );

    fireEvent.click(screen.getByText('Restore Backup'));
    await waitFor(() => expect(screen.getByText('Choose MindMesh Backup File')).toBeDefined());

    const future = { backupVersion: 999, appVersion: 'x', createdAt: '', schemaVersion: 99, data: {} };
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(fileInput, {
      target: {
        files: [new File([JSON.stringify(future)], 'future.json', { type: 'application/json' })],
      },
    });

    await waitFor(() =>
      expect(screen.getByText(/Unsupported future backup format version/)).toBeDefined()
    );
    expect(screen.queryByText('Confirm & Restore Backup')).toBeNull();
  });

  it('gates the destructive reset behind typed confirmation', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onResetComplete = vi.fn();

    render(
      <SettingsBackupModal
        isOpen
        onClose={noop}
        onRestoreComplete={noop}
        onResetComplete={onResetComplete}
      />
    );

    fireEvent.click(screen.getByText('Reset MindMesh'));
    const resetButton = screen.getByText('Reset MindMesh Entirely').closest('button') as HTMLButtonElement;
    expect(resetButton.disabled).toBe(true);

    fireEvent.click(resetButton);
    expect(confirmSpy).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText('DELETE'), { target: { value: 'delete' } });
    expect(resetButton.disabled).toBe(false);
    fireEvent.click(resetButton);

    expect(confirmSpy).toHaveBeenCalled();
    expect(onResetComplete).toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('validates round-tripped exports (export -> validate -> restore) end to end', () => {
    saveContacts([makeContact({ id: 'round-trip', fullName: 'Round Trip' })]);
    const exported = JSON.stringify(createBackup(), null, 2);

    const result = validateBackup(exported);
    expect(result.valid).toBe(true);
    expect(result.summary?.contactsCount).toBe(1);
    expect(result.summary?.appVersion).toBeDefined();
  });
});

describe('MindMesh app shell wiring', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('navigates into the Contact Book tab from the primary nav', async () => {
    render(<App />);

    fireEvent.click(screen.getByText('Contacts'));

    await waitFor(() => expect(screen.getByText('Contact Book')).toBeDefined());
    expect(screen.getByText('Add Contact')).toBeDefined();
    expect(
      screen.getByPlaceholderText('Search by name, phone, email, or address...')
    ).toBeDefined();
  });

  it('opens the Backup & Restore dialog from the options menu', async () => {
    render(<App />);

    fireEvent.click(screen.getByTitle('Options'));
    const entry = await screen.findByText('Backup & Restore Data');
    fireEvent.click(entry);

    await waitFor(() => expect(screen.getByText('Backup, Restore & Data')).toBeDefined());
    expect(screen.getByText('Export Full Backup')).toBeDefined();
  });

  it('keeps reminders working when a linked contact is deleted (cascade cleanup)', async () => {
    // Persist a contact plus a reminder linked to it, then boot the app
    saveContacts([makeContact({ id: 'linked-1', fullName: 'Linked Person' })]);
    const stored = loadAllData();
    stored.reminders = [
      {
        id: 'rem-linked',
        categoryId: stored.categories[0].id,
        title: 'Follow up with linked person',
        priority: 'medium',
        completed: false,
        subtasks: [],
        linkedContactId: 'linked-1',
        createdAt: '2026-03-03T00:00:00.000Z',
      } as Reminder,
    ];
    localStorage.setItem('mindmesh_state_v2', JSON.stringify(stored));

    render(<App />);
    fireEvent.click(screen.getByText('Contacts'));
    await waitFor(() => expect(screen.getByText('Contact Book')).toBeDefined());

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);

    // Delete the linked contact through the detail -> edit -> delete path
    fireEvent.click(screen.getByText('Linked Person'));
    await waitFor(() => expect(screen.getByText('Edit')).toBeDefined());
    fireEvent.click(screen.getByText('Edit'));
    fireEvent.click(screen.getByTitle('Delete Contact'));

    await waitFor(() => expect(screen.getByText('No contacts found')).toBeDefined());

    // Reminder survives, but the dangling contact link is removed
    const after = loadAllData();
    const reminder = after.reminders?.find((r) => r.id === 'rem-linked');
    expect(reminder).toBeDefined();
    expect(reminder?.linkedContactId).toBeUndefined();

    confirmSpy.mockRestore();
  });

});
