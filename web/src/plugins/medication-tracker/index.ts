/**
 * Medication & Supplement Tracker plugin.
 *
 * A fully self-contained optional plugin: it owns its UI, data model, logic,
 * storage and reminders, and talks to MindMesh only through the plugin API
 * (storage, notifications, scheduler, settings, diagnostics, backup). Core
 * holds no medication state and has no medication-specific logic.
 *
 * Data lives in plugin-scoped storage and is always included in backups — even
 * while the plugin is disabled — through the plugin backup handler. Disabling
 * never deletes data; only the explicit, confirmed `deleteData` action does.
 */
import type { MindMeshPlugin, PluginContext } from '../core/types';
import { createDefaultState, normalizeState } from './model';
import { createNotificationProvider } from './logic';
import { bindStorage, clear, getState, hasStoredData, peek, setState, update } from './store';
import { MEDICATION_TRACKER_MANIFEST, MEDICATION_TRACKER_PLUGIN_ID } from './manifest';
import { MedicationTrackerRoute } from './MedicationTrackerRoute';
import { createMedicationTrackerMigrations } from './migrations';

export function createMedicationTrackerPlugin(): MindMeshPlugin {
  return {
    manifest: MEDICATION_TRACKER_MANIFEST,
    // Optional and OFF by default: the user must enable it in the Plugin Manager.
    defaultEnabled: false,
    // Auto-enable only when this plugin already has data (e.g. after an upgrade
    // or a restore), never for a fresh install.
    detectExistingData: () => hasStoredData(),
    routes: [
      {
        id: 'medication-tracker.overview',
        tab: 'medications',
        label: 'Meds',
        component: MedicationTrackerRoute,
      },
    ],
    settings: [
      {
        id: 'doseReminders',
        label: 'Dose reminders',
        description: 'Schedule native reminders for each medication dose and refill level.',
        type: 'boolean',
        defaultValue: true,
      },
      {
        id: 'defaultSnoozeMinutes',
        label: 'Default snooze (minutes)',
        description: 'How long a snoozed dose reminder is deferred by default.',
        type: 'number',
        defaultValue: 10,
      },
    ],
    migrations: createMedicationTrackerMigrations(),
    activate: (context: PluginContext) => {
      // Route plugin storage through the MindMesh storage API.
      bindStorage(context.storage);
      context.notifications.register(
        createNotificationProvider(
          () => getState(),
          (mutate) => update(mutate),
          // The shared engine only asks for desired notifications while the
          // app-wide notification switch is on, so always report them here.
          () => true
        )
      );
      context.diagnostics.report('Medication & Supplement Tracker activated', {
        items: getState().items.length,
      });
    },
    deactivate: (context: PluginContext) => {
      // Stop contributing reminders but never touch stored data.
      context.notifications.clear();
      context.scheduler.clear();
      context.diagnostics.report('Medication & Supplement Tracker deactivated; data retained');
    },
    deleteData: (context: PluginContext) => {
      context.diagnostics.report('Medication & Supplement Tracker data explicitly deleted by user');
      context.notifications.clear();
      clear();
    },
    backup: {
      // Always serialize the persisted copy, even while the plugin is disabled.
      serialize: () => ({ data: peek() }),
      restore: (section) => {
        setState(normalizeState(section.data));
      },
    },
    health: () => {
      const state = getState();
      const scheduled = state.schedules.filter((schedule) => schedule.active).length;
      return {
        status: 'enabled',
        message: hasStoredData()
          ? `${state.items.length} item(s), ${scheduled} active schedule(s) stored and readable.`
          : 'Installed and ready — no medication data stored yet.',
      };
    },
  };
}

export { MEDICATION_TRACKER_MANIFEST, MEDICATION_TRACKER_PLUGIN_ID, createDefaultState };
