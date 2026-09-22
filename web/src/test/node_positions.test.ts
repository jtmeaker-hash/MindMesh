import { describe, expect, it, beforeEach } from 'vitest';
import {
  commitNodePosition,
  findAvailablePosition,
  normalizeNodePositions,
  resetNodePosition,
} from '../services/nodePositions';
import { createBackup, migrateBackup, validateBackup } from '../services/backup';
import { loadAllData, saveAllData } from '../services/storage';

beforeEach(() => {
  localStorage.clear();
});

describe('manual graph positions', () => {
  it('commits a stable manual position without changing unrelated nodes', () => {
    const initial = normalizeNodePositions({ other: { x: 4, y: 8 } });
    const next = commitNodePosition(initial, 'node-1', 123.7, -55.2);

    expect(next['node-1']).toMatchObject({ nodeId: 'node-1', x: 124, y: -55, manuallyPositioned: true });
    expect(next.other).toMatchObject({ x: 4, y: 8 });
  });

  it('resets only the requested node so auto-layout can take it over', () => {
    const next = resetNodePosition({
      a: { nodeId: 'a', x: 10, y: 20, manuallyPositioned: true },
      b: { nodeId: 'b', x: 30, y: 40, manuallyPositioned: true },
    }, 'a');

    expect(next.a).toBeUndefined();
    expect(next.b).toBeDefined();
  });

  it('searches outward without moving an occupied node', () => {
    const position = findAvailablePosition(
      { x: 0, y: 0 },
      [{ position: { x: 0, y: 0 }, size: { width: 80, height: 80 } }],
      { width: 80, height: 80 },
    );
    expect(position).not.toEqual({ x: 0, y: 0 });
  });
});

describe('position backup compatibility', () => {
  it('round trips manual positions through the complete backup', () => {
    const state = loadAllData();
    saveAllData({
      ...state,
      nodePositions: {
        'cat-1': { nodeId: 'cat-1', x: 345, y: -210, manuallyPositioned: true },
      },
    });

    const backup = createBackup();
    expect(backup.data.nodePositions['cat-1']).toMatchObject({ x: 345, y: -210, manuallyPositioned: true });
    expect(validateBackup(JSON.stringify(backup)).valid).toBe(true);
    expect(migrateBackup(backup).nodePositions['cat-1'].x).toBe(345);
  });

  it('uses an empty position map for older backups without position data', () => {
    const backup = createBackup();
    const oldBackup = { ...backup, data: { ...backup.data } };
    delete (oldBackup.data as Partial<typeof oldBackup.data>).nodePositions;

    expect(migrateBackup(oldBackup).nodePositions).toEqual({});
  });
});
