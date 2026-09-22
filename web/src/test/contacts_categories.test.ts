import { beforeEach, describe, expect, it } from 'vitest';
import { Contact } from '../types/contact';
import { Category } from '../types';
import { deviceRecordToContact, mergeImportedContact, resolveImportedContact, findLikelyDuplicate } from '../services/contactImport';
import { applyCategoryDelete, getCategoryDescendantIds, normalizeCategories, validateCategoryParent } from '../services/categories';
import { loadAllData, saveAllData } from '../services/storage';
import { createBackup, restoreBackup } from '../services/backup';

const contact = (overrides: Partial<Contact> = {}): Contact => ({
  id: 'contact-1', fullName: 'Ada Lovelace', phoneNumber: '+61 400 111 222', relationship: 'Friend',
  notes: 'Keep my MindMesh notes', createdAt: '2026-01-01', updatedAt: '2026-01-01', ...overrides,
});

const category = (id: string, parentCategoryId: string | null = null): Category => ({
  id, name: id, color: '#22d3ee', parentCategoryId, createdAt: '2026-01-01',
});

describe('device contact import review', () => {
  it('maps optional fields without requiring a phone, email, address, or photo', async () => {
    const imported = await deviceRecordToContact({ id: 'device-1', name: ['Grace'] });
    expect(imported.fullName).toBe('Grace');
    expect(imported.phoneNumber).toBe('');
    expect(imported.importedFromDevice).toBe(true);
  });

  it('detects duplicates by phone or email and preserves MindMesh fields when merging', async () => {
    const existing = contact({ email: 'ada@example.com' });
    const imported = await deviceRecordToContact({ id: 'device-2', name: ['Ada', 'Lovelace'], email: ['ada@example.com'], tel: ['+61 999'] });
    expect(findLikelyDuplicate([existing], { email: ['ada@example.com'] })?.id).toBe(existing.id);
    const merged = mergeImportedContact(existing, imported);
    expect(merged.id).toBe(existing.id);
    expect(merged.notes).toBe('Keep my MindMesh notes');
    expect(merged.email).toBe('ada@example.com');
  });

  it('supports skip, merge, and separate decisions without silent overwrites', () => {
    const existing = contact();
    const imported = contact({ id: 'imported', phoneNumber: '+61 400 111 222', importedFromDevice: true, sourceContactId: 'device-1' });
    expect(resolveImportedContact([existing], imported, 'skip').action).toBe('skip');
    expect(resolveImportedContact([existing], imported, 'merge').contacts[0].id).toBe(existing.id);
    expect(resolveImportedContact([existing], imported, 'separate').contacts[0].id).toBe(imported.id);
  });
});

describe('nested category hierarchy', () => {
  it('supports arbitrary depth and blocks self/circular parents', () => {
    const categories = [category('projects'), category('mindmesh', 'projects'), category('reminders', 'mindmesh')];
    expect(getCategoryDescendantIds(categories, 'projects')).toEqual(['mindmesh', 'reminders']);
    expect(validateCategoryParent(categories, 'projects', 'reminders')).toContain('descendant');
    expect(validateCategoryParent(categories, 'projects', 'projects')).toContain('own parent');
  });

  it('normalizes legacy flat categories to root categories and removes duplicate IDs', () => {
    const normalized = normalizeCategories([category('one'), category('one'), { ...category('two'), parentCategoryId: undefined }]);
    expect(normalized).toHaveLength(2);
    expect(normalized.every((item) => item.parentCategoryId === null)).toBe(true);
  });

  it('moves children to the deleted category parent without deleting reminders elsewhere', () => {
    const categories = [category('root'), category('child', 'root'), category('grandchild', 'child')];
    const moved = applyCategoryDelete(categories, 'child', 'move-contents');
    expect(moved.find((item) => item.id === 'grandchild')?.parentCategoryId).toBe('root');
    expect(moved.some((item) => item.id === 'child')).toBe(false);
  });
});

describe('persisted imported contact compatibility', () => {
  beforeEach(() => localStorage.clear());

  it('keeps imported contact metadata through local storage hydration', () => {
    const state = loadAllData();
    saveAllData({ ...state, contacts: [contact({ importedFromDevice: true, sourceContactId: 'device-42', photo: 'data:image/png;base64,abc' })] });
    const reloaded = loadAllData();
    expect(reloaded.contacts?.[0].importedFromDevice).toBe(true);
    expect(reloaded.contacts?.[0].sourceContactId).toBe('device-42');
    expect(reloaded.contacts?.[0].photo).toContain('data:image');
  });

  it('restores an older backup without hierarchy or import metadata using safe defaults', () => {
    const backup = createBackup();
    backup.schemaVersion = 1;
    backup.data.categories = backup.data.categories.map(({ parentCategoryId: _ignored, ...legacy }) => legacy);
    backup.data.contacts = [contact()];
    const restored = restoreBackup(backup);
    expect(restored.success).toBe(true);
    expect(loadAllData().categories.every((item) => item.parentCategoryId === null)).toBe(true);
    expect(loadAllData().contacts?.[0].importedFromDevice).toBe(false);
  });
});
