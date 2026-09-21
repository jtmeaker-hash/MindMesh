import { describe, it, expect, beforeEach } from 'vitest';
import {
  createBackup,
  validateBackup,
  restoreBackup,
  generateBackupFilename,
  BACKUP_FORMAT_VERSION,
} from '../services/backup';
import {
  loadAllData,
  loadContacts,
  saveContacts,
  loadContactCategories,
  loadContactRelationships,
  resetMindMeshEntirely,
  CURRENT_STORAGE_VERSION,
} from '../services/storage';
import { Contact } from '../types/contact';
import { Reminder } from '../types';

describe('Contact Book & Storage Persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('loads sample contacts when initially uninitialized', () => {
    const contacts = loadContacts();
    expect(contacts.length).toBeGreaterThan(0);
    expect(contacts[0]).toHaveProperty('id');
    expect(contacts[0]).toHaveProperty('fullName');
    expect(contacts[0]).toHaveProperty('phoneNumber');
    expect(contacts[0]).toHaveProperty('relationship');
  });

  it('persists and retrieves updated contacts correctly', () => {
    const newContact: Contact = {
      id: 'contact-test-1',
      fullName: 'Jane Doe',
      displayName: 'Jane',
      phoneNumber: '+61 400 111 222',
      email: 'jane@example.com',
      address: '100 King St, Sydney NSW',
      relationship: 'Friend',
      category: 'Personal',
      notes: 'Best friend from university',
      birthday: '1992-04-12',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    saveContacts([newContact]);
    const reloaded = loadContacts();
    expect(reloaded).toHaveLength(1);
    expect(reloaded[0].fullName).toBe('Jane Doe');
    expect(reloaded[0].phoneNumber).toBe('+61 400 111 222');
    expect(reloaded[0].email).toBe('jane@example.com');
  });

  it('loads default contact categories and relationships', () => {
    const categories = loadContactCategories();
    expect(categories).toContain('Personal');
    expect(categories).toContain('Work');

    const relationships = loadContactRelationships();
    expect(relationships).toContain('Family');
    expect(relationships).toContain('Medical');
    expect(relationships).toContain('Emergency Contact');
  });
});

describe('Complete Backup & Restore System', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('generates a valid backup filename with formatted date and time', () => {
    const testDate = new Date('2026-09-20T14:35:00Z');
    const filename = generateBackupFilename(testDate);
    expect(filename).toMatch(/^mindmesh-backup-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
  });

  it('creates a complete full backup including all data sections', () => {
    const backup = createBackup();
    expect(backup.backupVersion).toBe(BACKUP_FORMAT_VERSION);
    expect(backup.appName).toBe('MindMesh');
    expect(backup.createdAt).toBeDefined();

    const data = backup.data;
    expect(Array.isArray(data.categories)).toBe(true);
    expect(Array.isArray(data.reminders)).toBe(true);
    expect(Array.isArray(data.contacts)).toBe(true);
    expect(data.contacts.length).toBeGreaterThan(0);
    expect(data.money).toBeDefined();
    expect(Array.isArray(data.money.directDebits)).toBe(true);
    expect(data.money.billCategories.length).toBeGreaterThan(0);
    expect(data.preferences).toBeDefined();
    expect(data.statistics).toBeDefined();
  });

  it('validates a correct backup JSON successfully', () => {
    const backup = createBackup();
    const jsonStr = JSON.stringify(backup);
    const result = validateBackup(jsonStr);

    expect(result.valid).toBe(true);
    expect(result.summary).toBeDefined();
    expect(result.summary?.categoriesCount).toBe(backup.data.categories.length);
    expect(result.summary?.remindersCount).toBe(backup.data.reminders.length);
    expect(result.summary?.contactsCount).toBe(backup.data.contacts.length);
    expect(result.summary?.directDebitsCount).toBe(backup.data.money.directDebits.length);
  });

  it('rejects invalid JSON or incompatible schema files safely', () => {
    const invalidJson = '{ this is not valid JSON }';
    const res1 = validateBackup(invalidJson);
    expect(res1.valid).toBe(false);
    expect(res1.error).toContain('Invalid JSON syntax');

    const missingData = JSON.stringify({ backupVersion: 1 });
    const res2 = validateBackup(missingData);
    expect(res2.valid).toBe(false);
    expect(res2.error).toContain('missing data payload');

    const futureVersion = JSON.stringify({ backupVersion: 999, data: {} });
    const res3 = validateBackup(futureVersion);
    expect(res3.valid).toBe(false);
    expect(res3.error).toContain('Unsupported future backup format version');
  });

  it('performs transactional restore and migrates state smoothly', () => {
    // Initial state with a custom reminder and contact
    const customContact: Contact = {
      id: 'contact-restore-1',
      fullName: 'Alice Smith',
      phoneNumber: '+61 400 333 444',
      relationship: 'Coworker',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const customReminder: Reminder = {
      id: 'rem-restore-1',
      categoryId: 'cat-1',
      title: 'Project handover with Alice',
      priority: 'high',
      completed: false,
      subtasks: [],
      linkedContactId: 'contact-restore-1',
      createdAt: new Date().toISOString(),
    };

    const backupObj = createBackup();
    backupObj.data.contacts = [customContact];
    backupObj.data.reminders = [customReminder];

    const restoreResult = restoreBackup(backupObj);
    expect(restoreResult.success).toBe(true);
    expect(restoreResult.state).toBeDefined();

    // Verify restored state in localStorage
    const stored = loadAllData();
    expect(stored.contacts?.find((c) => c.id === 'contact-restore-1')).toBeDefined();
    const storedRem = stored.reminders?.find((r) => r.id === 'rem-restore-1');
    expect(storedRem).toBeDefined();
    expect(storedRem?.linkedContactId).toBe('contact-restore-1');
  });

  it('cleans up dangling linkedContactId references if contact is missing in restored backup', () => {
    const orphanReminder: Reminder = {
      id: 'rem-orphan',
      categoryId: 'cat-1',
      title: 'Call missing contact',
      priority: 'medium',
      completed: false,
      subtasks: [],
      linkedContactId: 'non-existent-contact-id',
      createdAt: new Date().toISOString(),
    };

    const backupObj = createBackup();
    backupObj.data.reminders = [orphanReminder];
    backupObj.data.contacts = []; // No contacts

    const restoreResult = restoreBackup(backupObj);
    expect(restoreResult.success).toBe(true);

    const stored = loadAllData();
    const loadedRem = stored.reminders?.find((r) => r.id === 'rem-orphan');
    expect(loadedRem).toBeDefined();
    expect(loadedRem?.linkedContactId).toBeUndefined(); // Dangling link sanitized
  });

  it('resets MindMesh entirely to fresh state', () => {
    const resetResult = resetMindMeshEntirely();
    expect(resetResult.version).toBe(CURRENT_STORAGE_VERSION);
    expect(resetResult.categories.length).toBeGreaterThan(0);
    expect(resetResult.contacts?.length).toBeGreaterThan(0);
  });
});
