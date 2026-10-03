/**
 * Money Management plugin migrations.
 *
 * The feature previously stored its data in the shared Core `money` slice.
 * Rather than moving that data into a separate physical store (which would risk
 * user data), the migration adopts the existing slice into plugin-owned schema
 * v1 by normalising it in place. This is non-destructive:
 *   - it never drops or deletes records,
 *   - it only writes when normalisation actually changes something,
 *   - running it twice is a no-op (and completed migration ids are recorded).
 */
import type { RuntimePluginMigration } from '../core/types';
import { loadMoneyState, saveMoneyState } from '../../services/storage';
import { normalizeMoneyState } from '../../utils/finance';
import { MONEY_MANAGEMENT_MANIFEST } from './manifest';

export const MONEY_LEGACY_HYDRATION_ID = 'money-management.legacy-hydration';

export function createMoneyManagementMigrations(): RuntimePluginMigration[] {
  return [
    {
      id: MONEY_LEGACY_HYDRATION_ID,
      description: 'Adopt the existing money slice into Money Management plugin schema v1 (non-destructive).',
      fromSchemaVersion: 0,
      toSchemaVersion: MONEY_MANAGEMENT_MANIFEST.schemaVersion,
      run: () => {
        const current = loadMoneyState();
        const normalized = normalizeMoneyState(current);
        if (JSON.stringify(normalized) !== JSON.stringify(current)) {
          saveMoneyState(normalized);
        }
      },
    },
  ];
}
