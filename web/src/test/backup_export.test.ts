import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Reminder } from '../types';
import { Contact } from '../types/contact';
import { DirectDebit } from '../types/finance';
import {
  createBackup,
  serializeBackup,
  exportBackup,
  validateBackup,
  restoreBackup,
  generateBackupFilename,
} from '../services/backup';
import { hasLastImportedNodePositions, loadAllData, saveAllData } from '../services/storage';
import { getDefaultMoneyState } from '../utils/sampleFinanceData';
import { getDefaultAppearance } from '../services/appearance';
import { runDiagnostics } from '../services/diagnostics';

/** The page-side shape of the Android bridge the native layer injects. */
interface TestBridgeWindow {
  MindMeshBackup?: {
    isSupported?(): boolean;
    saveFile(requestId: string, filename: string, content: string): boolean;
  };
  MindMeshNativeBackupEvents?: {
    onResult(requestId: string, ok: boolean, message: string): void;
  };
  showSaveFilePicker?: unknown;
}

const win = window as unknown as TestBridgeWindow;

const seedReminder = (overrides: Partial<Reminder> = {}): Reminder => ({
  id: 'rem-export-1',
  categoryId: 'cat-export',
  title: 'Pay the electricity bill',
  description: 'Find the current bill and pay it before the due date.',
  summary: 'Find bill and pay before due date',
  priority: 'high',
  completed: false,
  subtasks: [
    {
      id: 'sub-1',
      reminderId: 'rem-export-1',
      title: 'Find the bill',
      completed: true,
      createdAt: '2026-03-01T08:05:00.000Z',
      completedAt: '2026-03-01T09:00:00.000Z',
    },
    {
      id: 'sub-2',
      reminderId: 'rem-export-1',
      title: 'Transfer funds',
      completed: false,
      createdAt: '2026-03-01T08:06:00.000Z',
    },
  ],
  dueDate: '2026-03-10',
  dueTime: '09:30',
  notifications: { enabled: true, notifyAtDueTime: true, advanceMinutes: [1440, 60] },
  createdAt: '2026-03-01T08:00:00.000Z',
  ...overrides,
});

const seedContact = (): Contact => ({
  id: 'contact-export-1',
  fullName: 'Ada Lovelace',
  displayName: 'Ada',
  phoneNumber: '+61 400 222 333',
  email: 'ada@example.com',
  address: '1 Analytical Way, Melbourne VIC',
  relationship: 'Friend',
  category: 'Personal',
  notes: 'Met at the maths meetup',
  birthday: '1990-12-10',
  photo: 'data:image/jpeg;base64,AAAA',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
});

const seedDirectDebit = (): DirectDebit => ({
  id: 'dd-export-1',
  title: 'Gym membership',
  amount: 24.99,
  categoryId: 'bill-cat-1',
  frequency: 'monthly',
  nextPaymentDate: '2026-03-15',
  active: true,
  notificationSettings: [{ id: 'n1', minutesBefore: 1440, enabled: true } as never],
  createdAt: '2026-02-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
});

/** Populates representative data across every persisted module. */
function seedFullState(): void {
  const base = loadAllData();
  const money = getDefaultMoneyState();
  saveAllData({
    ...base,
    reminders: [seedReminder(), seedReminder({ id: 'rem-export-2', title: 'Done thing', completed: true })],
    contacts: [seedContact()],
    contactCategories: ['Personal', 'Work', 'Clinic'],
    money: {
      ...money,
      directDebits: [seedDirectDebit()],
      extraIncomeList: [
        { id: 'ei-1', title: 'Weekend shift', amount: 180, date: '2026-03-02', categoryId: 'ei-cat-1', createdAt: '2026-03-02T00:00:00.000Z' } as never,
      ],
      tipEntries: [
        { id: 'tip-1', amount: 40, date: '2026-03-03', createdAt: '2026-03-03T00:00:00.000Z' } as never,
      ],
    },
    appearance: { ...getDefaultAppearance(), themeId: 'matrix' },
  });
}

describe('Backup export: JSON generation', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('builds a complete backup object covering every persisted module', () => {
    seedFullState();
    const backup = createBackup();

    expect(backup.appName).toBe('MindMesh');
    expect(backup.backupVersion).toBeGreaterThan(0);
    expect(backup.schemaVersion).toBeGreaterThan(0);
    expect(new Date(backup.createdAt).toString()).not.toBe('Invalid Date');

    const data = backup.data;
    expect(data.reminders).toHaveLength(2);
    expect(data.reminders[0].subtasks).toHaveLength(2);
    expect(data.reminders[0].description).toContain('current bill');
    expect(data.reminders[0].summary).toBe('Find bill and pay before due date');
    expect(data.categories.length).toBeGreaterThan(0);
    expect(data.contacts[0].photo).toBeDefined();
    expect(data.contactCategories).toContain('Clinic');
    expect(data.money.directDebits).toHaveLength(1);
    expect(data.money.tipEntries).toHaveLength(1);
    expect(data.money.extraIncomeList).toHaveLength(1);
    expect(data.appearance?.themeId).toBe('matrix');
    expect(data.notifications).toBeDefined();
    expect(data.preferences).toBeDefined();
    expect(data.diagnostics?.preferences).toBeDefined();
  });

  it('serializes to valid, parseable JSON', () => {
    seedFullState();
    const json = serializeBackup(createBackup());

    expect(typeof json).toBe('string');
    expect(json.length).toBeGreaterThan(100);

    const parsed = JSON.parse(json) as { backupVersion: number; data: { reminders: unknown[] } };
    expect(parsed.backupVersion).toBe(createBackup().backupVersion);
    expect(parsed.data.reminders).toHaveLength(2);
  });

  it('refuses to serialize a payload that is not a backup object', () => {
    expect(() => serializeBackup(undefined as never)).toThrow(/No backup payload/);
    expect(() => serializeBackup(null as never)).toThrow(/No backup payload/);
  });

  it('refuses to export sample defaults over an unreadable store', () => {
    // A corrupt payload makes loadAllData fall back to defaults; exporting those
    // would look like a successful backup of an empty installation.
    localStorage.setItem('mindmesh_state_v2', '{not valid json');

    expect(() => createBackup()).toThrow(/could not be read/);
    expect(() => serializeBackup(createBackup())).toThrow(/could not be read/);
  });

  it('names the file with a sortable timestamp and a .json extension', () => {
    const filename = generateBackupFilename(new Date('2026-09-21T14:35:42'));
    expect(filename).toMatch(/^mindmesh-backup-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);
    expect(filename).toContain('2026-09-21');
    expect(filename).toContain('143542');
  });
});

describe('Backup export: writing a real file', () => {
  let createObjectURL: ReturnType<typeof vi.fn>;
  let anchorClick: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    seedFullState();

    createObjectURL = vi.fn(() => 'blob:mindmesh-test');
    Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
    Object.defineProperty(URL, 'revokeObjectURL', { value: vi.fn(), writable: true });
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  });

  afterEach(() => {
    delete win.MindMeshBackup;
    delete win.showSaveFilePicker;
    vi.restoreAllMocks();
  });

  it('writes the JSON through the save dialog and only succeeds after close() resolves', async () => {
    const written: string[] = [];
    let closed = false;

    win.showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({
        write: async (data: string | Blob) => {
          expect(closed).toBe(false);
          written.push(typeof data === 'string' ? data : String(data));
        },
        close: async () => {
          closed = true;
        },
      }),
    }));

    const backup = createBackup();
    const result = await exportBackup(backup, generateBackupFilename(new Date(backup.createdAt)));

    expect(result.ok).toBe(true);
    expect(result.method).toBe('file-system-access');
    expect(result.unverified).toBeUndefined();
    expect(result.bytes).toBeGreaterThan(0);
    expect(written).toHaveLength(1);
    expect(closed).toBe(true);

    // What landed on "disk" is the same backup, and it re-validates.
    const validation = validateBackup(written[0]);
    expect(validation.valid).toBe(true);
    expect(validation.summary?.remindersCount).toBe(2);
    expect(validation.summary?.contactsCount).toBe(1);
    expect(validation.summary?.directDebitsCount).toBe(1);

    // The dialog was the only write path used.
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('reports failure when the write itself fails, without claiming success', async () => {
    win.showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({
        write: async () => {
          throw new Error('disk full');
        },
        close: async () => {},
      }),
    }));

    const result = await exportBackup(createBackup());

    expect(result.ok).toBe(false);
    expect(result.method).toBe('file-system-access');
    expect(result.error).toMatch(/disk full/);
  });

  it('reports a dismissed dialog and falls back to a browser download', async () => {
    const abort = new Error('user aborted');
    abort.name = 'AbortError';
    win.showSaveFilePicker = vi.fn(async () => {
      throw abort;
    });

    const result = await exportBackup(createBackup());

    expect(result.ok).toBe(true);
    expect(result.method).toBe('browser-download');
    // The page cannot observe a browser download, so it must not claim "saved".
    expect(result.unverified).toBe(true);
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe('application/json');
    expect(blob.size).toBeGreaterThan(0);
    expect(anchorClick).toHaveBeenCalledTimes(1);
  });

  it('fails loudly when the environment cannot save files at all', async () => {
    Object.defineProperty(URL, 'createObjectURL', { value: undefined, writable: true });

    const result = await exportBackup(createBackup());

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(anchorClick).not.toHaveBeenCalled();
  });

  it('writes through the Android bridge and waits for the native result', async () => {
    const captured: { filename?: string; content?: string } = {};

    win.MindMeshBackup = {
      isSupported: () => true,
      saveFile: (requestId, filename, content) => {
        captured.filename = filename;
        captured.content = content;
        // The native layer reports its outcome asynchronously.
        setTimeout(() => win.MindMeshNativeBackupEvents?.onResult(requestId, true, 'Saved'), 0);
        return true;
      },
    };

    const backup = createBackup();
    const result = await exportBackup(backup, 'mindmesh-backup-2026-09-21-143542.json');

    expect(result.ok).toBe(true);
    expect(result.method).toBe('android-document');
    expect(result.unverified).toBeUndefined();
    expect(captured.filename).toBe('mindmesh-backup-2026-09-21-143542.json');

    const validation = validateBackup(captured.content ?? '');
    expect(validation.valid).toBe(true);
  });

  it('surfaces a native write failure instead of a success', async () => {
    win.MindMeshBackup = {
      saveFile: (requestId) => {
        setTimeout(() => win.MindMeshNativeBackupEvents?.onResult(requestId, false, 'Android wrote 0 bytes'), 0);
        return true;
      },
    };

    const result = await exportBackup(createBackup());

    expect(result.ok).toBe(false);
    expect(result.method).toBe('android-document');
    expect(result.error).toBe('Android wrote 0 bytes');
  });
});

describe('Backup export channel diagnostics', () => {
  beforeEach(() => {
    localStorage.clear();
    // This block runs after the blob stubs above; reset to a bare jsdom window.
    Object.defineProperty(URL, 'createObjectURL', { value: undefined, writable: true });
    delete win.MindMeshBackup;
    delete win.showSaveFilePicker;
  });

  afterEach(() => {
    delete win.MindMeshBackup;
    delete win.showSaveFilePicker;
  });

  it('reports FAIL when the environment cannot save a file at all', async () => {
    const report = await runDiagnostics('quick');
    const check = report.results.find((r) => r.id === 'backup.exportChannel');

    expect(check).toBeDefined();
    expect(check?.status).toBe('fail');
    expect(check?.details?.channel).toBe('unavailable');
    expect(check?.suggestedFix).toBeDefined();
  });

  it('reports PASS and names the native channel when the Android bridge is present', async () => {
    win.MindMeshBackup = { saveFile: () => true };

    const report = await runDiagnostics('quick');
    const check = report.results.find((r) => r.id === 'backup.exportChannel');

    expect(check?.status).toBe('pass');
    expect(check?.details?.channel).toBe('android-document-writer');
    expect(check?.details?.fileSystemAccess).toBe(false);
  });

  it('warns when only an unverifiable browser download is possible', async () => {
    Object.defineProperty(URL, 'createObjectURL', { value: vi.fn(), writable: true });

    const report = await runDiagnostics('quick');
    const check = report.results.find((r) => r.id === 'backup.exportChannel');

    expect(check?.status).toBe('warning');
    expect(check?.details?.channel).toBe('browser-download');
  });
});

describe('Backup round trip: export then restore', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('restores every seeded module from a serialized backup', () => {
    seedFullState();

    const json = serializeBackup(createBackup());

    // Wipe the installation the way "Delete all local data" would.
    localStorage.clear();
    expect(loadAllData().reminders.some((r) => r.id === 'rem-export-1')).toBe(false);

    const validation = validateBackup(json);
    expect(validation.valid).toBe(true);
    expect(validation.backupFile).toBeDefined();

    const restored = restoreBackup(validation.backupFile!);
    expect(restored.success).toBe(true);

    const state = loadAllData();
    const contacts = state.contacts ?? [];
    const money = state.money ?? getDefaultMoneyState();

    expect(state.reminders.map((r) => r.id).sort()).toEqual(['rem-export-1', 'rem-export-2']);
    expect(state.reminders[0].subtasks).toHaveLength(2);
    expect(state.reminders[0].description).toContain('current bill');
    expect(state.reminders[0].summary).toBe('Find bill and pay before due date');
    expect(state.reminders[0].notifications?.advanceMinutes).toEqual([1440, 60]);
    expect(contacts.map((c) => c.id)).toEqual(['contact-export-1']);
    expect(contacts[0].photo).toBe('data:image/jpeg;base64,AAAA');
    expect(money.directDebits.map((d) => d.id)).toEqual(['dd-export-1']);
    expect(money.tipEntries).toHaveLength(1);
    expect(state.appearance?.themeId).toBe('matrix');
    expect(state.contactCategories).toContain('Clinic');
  });

  it('round trips every custom node position and keeps them recoverable after import', () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      nodePositions: {
        'cat-work': { nodeId: 'cat-work', x: 640, y: -480, manuallyPositioned: true, updatedAt: '2026-03-01T00:00:00.000Z' },
        'sub-1': { nodeId: 'sub-1', x: 90, y: 30, manuallyPositioned: true },
      },
    });

    const json = serializeBackup(createBackup());
    localStorage.clear();

    const validation = validateBackup(json);
    expect(validation.valid).toBe(true);
    expect(validation.summary?.nodePositionsCount).toBe(2);

    const restored = restoreBackup(validation.backupFile!);
    expect(restored.success).toBe(true);

    const state = loadAllData();
    expect(state.nodePositions['cat-work']).toMatchObject({ x: 640, y: -480, manuallyPositioned: true });
    expect(state.nodePositions['sub-1']).toMatchObject({ x: 90, y: 30, manuallyPositioned: true });
    // Imported positions are retained independently of the live layout.
    expect(hasLastImportedNodePositions()).toBe(true);
  });

  it('keeps relationships valid across a round trip and drops dangling links', () => {
    const base = loadAllData();
    saveAllData({
      ...base,
      reminders: [seedReminder({ linkedContactId: 'contact-export-1' }), seedReminder({ id: 'orphan', linkedContactId: 'gone' })],
      contacts: [seedContact()],
    });

    const json = serializeBackup(createBackup());
    localStorage.clear();

    const validation = validateBackup(json);
    const restored = restoreBackup(validation.backupFile!);
    expect(restored.success).toBe(true);

    const state = loadAllData();
    const linked = state.reminders.find((r) => r.id === 'rem-export-1');
    const orphan = state.reminders.find((r) => r.id === 'orphan');
    expect(linked?.linkedContactId).toBe('contact-export-1');
    // The missing contact reference is stripped, and the reminder still exists.
    expect(orphan).toBeDefined();
    expect(orphan?.linkedContactId).toBeUndefined();
    expect((state.contacts ?? []).some((c) => c.id === 'contact-export-1')).toBe(true);
  });
});
