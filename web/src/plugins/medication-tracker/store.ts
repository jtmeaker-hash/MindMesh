/**
 * Plugin-scoped state store.
 *
 * The single source of truth for the medication tracker. It persists through the
 * MindMesh plugin storage API (namespaced `mindmesh_plugin_<id>_<key>`) when a
 * context is bound, and falls back to the same namespaced key directly for the
 * context-free backup handler. React components subscribe with
 * `useSyncExternalStore`.
 *
 * Data lives entirely in plugin storage — Core never holds or migrates it.
 */
import type { PluginStorageApi } from '../core/types';
import { normalizeState, createDefaultState, type MedicationState } from './model';

export const PLUGIN_ID = 'medication-tracker';
const STATE_KEY = 'state';

let adapter: PluginStorageApi | null = null;
let cache: MedicationState | null = null;
const listeners = new Set<() => void>();

/** Binds (or clears) the plugin storage API for this process. */
export function bindStorage(storage: PluginStorageApi | null): void {
  adapter = storage;
  cache = null;
}

function readRaw(): MedicationState {
  try {
    if (adapter) return normalizeState(adapter.read<unknown>(STATE_KEY, createDefaultState()));
    const raw = localStorage.getItem(`mindmesh_plugin_${PLUGIN_ID}_${STATE_KEY}`);
    return raw ? normalizeState(JSON.parse(raw)) : createDefaultState();
  } catch {
    return createDefaultState();
  }
}

function writeRaw(state: MedicationState): void {
  try {
    if (adapter) {
      adapter.write(STATE_KEY, state);
      return;
    }
    localStorage.setItem(`mindmesh_plugin_${PLUGIN_ID}_${STATE_KEY}`, JSON.stringify(state));
  } catch {
    /* storage unavailable; keep the in-memory copy so the session still works */
  }
}

export function getState(): MedicationState {
  if (!cache) cache = readRaw();
  return cache;
}

/** Always reads the persisted copy, bypassing the in-memory cache (backup use). */
export function peek(): MedicationState {
  return readRaw();
}

export function setState(next: MedicationState): void {
  cache = next;
  writeRaw(next);
  for (const listener of listeners) listener();
}

/** Applies a pure mutation and persists the result. */
export function update(mutate: (state: MedicationState) => MedicationState): void {
  setState(mutate(getState()));
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Re-reads persisted state (used after a restore/import). */
export function reload(): void {
  cache = readRaw();
  for (const listener of listeners) listener();
}

/** Explicit user-confirmed data removal. */
export function clear(): void {
  try {
    if (adapter) adapter.remove(STATE_KEY);
    else localStorage.removeItem(`mindmesh_plugin_${PLUGIN_ID}_${STATE_KEY}`);
  } catch {
    /* ignore */
  }
  cache = createDefaultState();
  for (const listener of listeners) listener();
}

/** True when the plugin has real user data (used to auto-enable on upgrade). */
export function hasStoredData(): boolean {
  const state = readRaw();
  return state.items.length > 0 || state.schedules.length > 0 || state.doseEvents.length > 0;
}
