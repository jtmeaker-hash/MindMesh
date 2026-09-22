import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createEmptyRoutine, createRoutineStep } from '../types/routine';
import { applyRoutineImport, previewRoutineImport, serializeRoutineBulkExport, serializeRoutineExport, serializeRoutineHistoryCsv, serializeRoutineHistoryJson } from '../services/routineTransfer';
import { createBackup, restoreBackup, serializeBackup, validateBackup } from '../services/backup';
import { loadAllData, loadRoutines, saveAllData } from '../services/storage';

function routineFixture() {
  const routine = createEmptyRoutine({ id: 'routine-export', name: 'Export me', categoryId: 'cat-known', steps: [] });
  routine.steps = [createRoutineStep({ id: 'step-export', routineId: routine.id, title: 'Call someone', order: 0, links: { contactId: 'contact-missing', completionBehaviour: 'ask-first' } })];
  routine.history = [{ id: 'history-1', routineId: routine.id, stepId: 'step-export', event: 'completed', at: '2026-01-02T12:00:00.000Z', durationMinutes: 4 }];
  return routine;
}

const refs = { categories: new Set(['cat-known']), reminders: new Set<string>(), contacts: new Set<string>(), directDebits: new Set<string>(), routineIds: new Set<string>() };

describe('Routine Builder Stage 8 transfer hardening', () => {
  beforeEach(() => localStorage.clear());

  it('exports definition, history JSON/CSV, and bulk payloads without dropping source data', () => {
    const routine = routineFixture();
    expect(JSON.parse(serializeRoutineExport(routine)).routine.steps).toHaveLength(1);
    expect(JSON.parse(serializeRoutineHistoryJson(routine)).history).toHaveLength(1);
    expect(serializeRoutineHistoryCsv(routine)).toContain('completed');
    expect(JSON.parse(serializeRoutineBulkExport([routine])).routines[0].id).toBe(routine.id);
  });

  it('previews missing links before import and only unlinks after an explicit decision', () => {
    const routine = routineFixture();
    const preview = previewRoutineImport(serializeRoutineExport(routine), refs);
    expect(preview.valid).toBe(true);
    expect(preview.conflicts).toHaveLength(1);
    expect(preview.conflicts[0].kind).toBe('contact');
    const kept = applyRoutineImport(preview, { conflicts: { [preview.conflicts[0].id]: 'keep' } });
    expect(kept?.steps[0].links?.contactId).toBe('contact-missing');
    expect(kept?.steps[0].links?.broken).toBe(true);
    const unlinked = applyRoutineImport(preview, { conflicts: { [preview.conflicts[0].id]: 'unlink' } });
    expect(unlinked?.steps[0].links?.contactId).toBeUndefined();
  });

  it('duplicates an ID conflict rather than overwriting an existing routine', () => {
    const routine = routineFixture();
    const preview = previewRoutineImport(serializeRoutineExport(routine), { ...refs, routineIds: new Set([routine.id]) });
    const imported = applyRoutineImport(preview, { conflicts: { [`routine-id:routine:${routine.id}`]: 'duplicate' }, duplicateId: 'routine-copy' });
    expect(imported?.id).toBe('routine-copy');
    expect(imported?.steps[0].routineId).toBe('routine-copy');
    expect(imported?.history).toHaveLength(1);
  });

  it('keeps active sessions and version history in a routine-heavy full backup', () => {
    const routine = routineFixture();
    routine.activeSession = { id: 'session-1', routineId: routine.id, occurrenceId: 'occurrence-1', status: 'running', currentStepId: 'step-export', startedAt: new Date().toISOString(), completedStepIds: [], temporaryStepIds: [], updatedAt: new Date().toISOString() };
    routine.versionHistory = [{ id: 'version-1', routineId: routine.id, version: 1, createdAt: new Date().toISOString(), name: routine.name, steps: routine.steps }];
    saveAllData({ ...loadAllData(), routines: [routine] });
    const validation = validateBackup(serializeBackup(createBackup()));
    expect(validation.valid).toBe(true);
    localStorage.clear();
    expect(restoreBackup(validation.backupFile!).success).toBe(true);
    expect(loadRoutines()[0].activeSession?.currentStepId).toBe('step-export');
    expect(loadRoutines()[0].versionHistory).toHaveLength(1);
  });

  it('warns about malformed routine records without rejecting the rest of a backup', () => {
    const valid = routineFixture();
    const backup = createBackup();
    backup.data.routines = [valid, { id: 'bad', name: 'No category' } as never];
    const validation = validateBackup(serializeBackup(backup));
    expect(validation.valid).toBe(true);
    expect(validation.summary?.warnings.some((warning) => warning.includes('malformed routine'))).toBe(true);
    localStorage.clear();
    expect(restoreBackup(backup).success).toBe(true);
    expect(loadRoutines().map((routine) => routine.id)).toEqual(['routine-export']);
  });

  it('rolls back to the pre-restore snapshot when persistence fails verification', () => {
    const original = createEmptyRoutine({ id: 'routine-original', name: 'Keep this routine', categoryId: 'cat-known' });
    saveAllData({ ...loadAllData(), routines: [original] });

    const replacement = routineFixture();
    const backup = createBackup();
    backup.data.routines = [replacement];

    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    setItem.mockImplementationOnce(() => { throw new Error('simulated migration write failure'); });

    const restored = restoreBackup(backup);
    expect(restored.success).toBe(false);
    expect(restored.error).toMatch(/Original state preserved/);
    expect(loadRoutines().map((routine) => routine.id)).toEqual(['routine-original']);
  });
});
