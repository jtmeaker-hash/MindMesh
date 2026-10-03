/**
 * Medication & Supplement Tracker migrations.
 *
 * Schema v1 adopts any already-stored plugin payload by running it through the
 * non-destructive normalizer. Older or malformed records are skipped, never
 * deleted, and the migration only writes when normalization actually changes
 * something. Failures are isolated by the PluginManager and leave data intact.
 */
import type { RuntimePluginMigration } from '../core/types';
import { normalizeState } from './model';
import { peek, setState } from './store';
import { MEDICATION_TRACKER_MANIFEST } from './manifest';

export const MEDICATION_TRACKER_HYDRATION_ID = 'medication-tracker.schema-hydration';

export function createMedicationTrackerMigrations(): RuntimePluginMigration[] {
  return [
    {
      id: MEDICATION_TRACKER_HYDRATION_ID,
      description: 'Adopt the stored medication payload into plugin schema v1 (non-destructive).',
      fromSchemaVersion: 0,
      toSchemaVersion: MEDICATION_TRACKER_MANIFEST.schemaVersion,
      run: () => {
        const current = peek();
        const normalized = normalizeState(current);
        if (JSON.stringify(normalized) !== JSON.stringify(current)) {
          setState(normalized);
        }
      },
    },
  ];
}
