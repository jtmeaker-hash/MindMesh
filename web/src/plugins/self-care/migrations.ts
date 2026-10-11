/**
 * Self Care plugin migrations.
 *
 * Self Care is a brand-new feature with no legacy Core slice to adopt, so the
 * migration normalises the plugin-owned state in place. Non-destructive and
 * idempotent: it only writes when normalisation changes something and never
 * removes check-ins, messages or history.
 */
import type { RuntimePluginMigration } from '../core/types';
import { loadSelfCareState, saveSelfCareState } from '../../services/selfCare';
import { normalizeSelfCareState } from '../../types/selfCare';
import { SELF_CARE_MANIFEST } from './manifest';

export const SELF_CARE_HYDRATION_ID = 'self-care.hydration-v1';

export function createSelfCareMigrations(): RuntimePluginMigration[] {
  return [
    {
      id: SELF_CARE_HYDRATION_ID,
      description: 'Normalise Self Care state into schema v1 (non-destructive, idempotent).',
      fromSchemaVersion: 0,
      toSchemaVersion: SELF_CARE_MANIFEST.schemaVersion,
      run: () => {
        const current = loadSelfCareState();
        const normalized = normalizeSelfCareState(current);
        if (JSON.stringify(normalized) !== JSON.stringify(current)) {
          saveSelfCareState(normalized);
        }
      },
    },
  ];
}
