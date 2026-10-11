/**
 * Self Care plugin.
 *
 * Optional, opt-in gentle check-ins delivered as REAL Android notifications
 * through the existing native bridge (AlarmManager + NotificationStore, so
 * alarms fire with the UI closed and survive reboot/update). The plugin owns
 * its scheduling entirely: desired occurrences are derived purely from its
 * stored check-ins, reconciled against the native scheduler, and scoped so
 * disabling the plugin cancels exactly its own alarms.
 *
 * HONEST INSTALL MODEL (shared with Money/Car built-ins): the downloadable
 * `.mindmesh-plugin.zip` carries manifest + integrity metadata and is
 * reconciled by the runtime installer; the executable implementation ships
 * compiled in the app through this plugin branch. No downloaded code is ever
 * evaluated. A package for Self Care on a build without this implementation
 * stays `staged`, never `applied`.
 */
import type { MindMeshPlugin, PluginContext } from '../core/types';
import {
  attachSelfCareActionListener,
  cancelAllSelfCareAlarms,
  fireTimeOfOccurrenceKey,
  loadSelfCareState,
  parseSelfCareNotificationId,
  reconcileSelfCare,
  resetSelfCareState,
  saveSelfCareState,
  selfCareDiagnostics,
} from '../../services/selfCare';
import { normalizeSelfCareState } from '../../types/selfCare';
import { SELF_CARE_MANIFEST, SELF_CARE_PLUGIN_ID } from './manifest';
import { SelfCareRoute } from './SelfCareRoute';
import { createSelfCareMigrations } from './migrations';

/** Release the device-action listener between activations. */
let detachActions: (() => void) | null = null;

/**
 * Mirrors registered native alarms into the PluginContext scheduler store so
 * diagnostics can show what is scheduled. Payloads carry ids only — never
 * message text.
 */
function mirrorSchedulerJobs(context: PluginContext): void {
  try {
    context.scheduler.clear();
    const state = loadSelfCareState();
    for (const id of state.scheduledIds) {
      const parsed = parseSelfCareNotificationId(id);
      if (!parsed) continue;
      const fireAt = fireTimeOfOccurrenceKey(parsed.occurrenceKey);
      context.scheduler.schedule({
        id,
        runAt: fireAt !== null ? new Date(fireAt).toISOString() : new Date().toISOString(),
        payload: { checkInId: parsed.checkInId, occurrenceKey: parsed.occurrenceKey },
      });
    }
  } catch {
    /* diagnostics mirroring must never break activation */
  }
}

export function createSelfCarePlugin(): MindMeshPlugin {
  return {
    manifest: SELF_CARE_MANIFEST,
    // Explicitly opt-in: enabling the plugin schedules NOTHING until the user
    // creates a check-in. There are no surprise messages, ever.
    defaultEnabled: false,
    routes: [
      {
        id: 'self-care.overview',
        tab: 'self-care',
        label: 'Self Care',
        component: SelfCareRoute,
      },
    ],
    graphNodeTypes: [{ id: 'self-care.checkin', label: 'Check-in', color: '#f472b6' }],
    migrations: createSelfCareMigrations(),
    activate: (context: PluginContext) => {
      if (!detachActions) {
        detachActions = attachSelfCareActionListener();
      }
      // Repair any drift (reboot, update, permission change, edited schedule).
      reconcileSelfCare();
      mirrorSchedulerJobs(context);
      const diagnostics = selfCareDiagnostics(loadSelfCareState());
      context.diagnostics.report('Self Care activated', {
        checkIns: diagnostics.checkIns,
        scheduled: diagnostics.scheduled,
      });
    },
    deactivate: (context: PluginContext) => {
      // Disabling stops alarms and hides the feature but NEVER removes data.
      cancelAllSelfCareAlarms();
      context.scheduler.clear();
      if (detachActions) {
        detachActions();
        detachActions = null;
      }
      context.diagnostics.report('Self Care deactivated; alarms cancelled, stored data retained');
    },
    deleteData: (context: PluginContext) => {
      context.diagnostics.report('Self Care data explicitly deleted by user');
      cancelAllSelfCareAlarms();
      resetSelfCareState();
    },
    backup: {
      serialize: () => ({ data: loadSelfCareState(), history: loadSelfCareState().history }),
      restore: (section) => {
        if (!section.data || typeof section.data !== 'object') {
          throw new Error('Self Care backup section is malformed');
        }
        // Idempotent and non-destructive: normalise, never drop on failure.
        const normalized = normalizeSelfCareState(section.data);
        saveSelfCareState(normalized);
        // New alarms for restored check-ins are reconciled on next activation.
      },
    },
    health: () => {
      const diagnostics = selfCareDiagnostics(loadSelfCareState());
      return {
        status: 'enabled',
        message:
          diagnostics.checkIns === 0
            ? 'No check-ins yet. Create one to start gentle reminders.'
            : `${diagnostics.enabledCheckIns} of ${diagnostics.checkIns} check-ins active, ${diagnostics.scheduled} notifications scheduled.`,
      };
    },
  };
}

export { SELF_CARE_MANIFEST, SELF_CARE_PLUGIN_ID };
