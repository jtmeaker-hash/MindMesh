/**
 * Car Maintenance plugin migrations.
 *
 * Adopts the existing `vehicles` Core slice into plugin-owned schema v1 by
 * normalising it in place. Non-destructive and idempotent: it only writes when
 * normalisation changes something and never removes records.
 */
import type { RuntimePluginMigration } from '../core/types';
import { loadVehicleState, saveVehicleState } from '../../services/storage';
import { normalizeVehicleState } from '../../services/vehicleMaintenance';
import { CAR_MAINTENANCE_MANIFEST } from './manifest';

export const CAR_LEGACY_HYDRATION_ID = 'car-maintenance.legacy-hydration';

export function createCarMaintenanceMigrations(): RuntimePluginMigration[] {
  return [
    {
      id: CAR_LEGACY_HYDRATION_ID,
      description: 'Adopt the existing vehicle slice into Car Maintenance plugin schema v1 (non-destructive).',
      fromSchemaVersion: 0,
      toSchemaVersion: CAR_MAINTENANCE_MANIFEST.schemaVersion,
      run: () => {
        const current = loadVehicleState();
        const normalized = normalizeVehicleState(current);
        if (JSON.stringify(normalized) !== JSON.stringify(current)) {
          saveVehicleState(normalized);
        }
      },
    },
  ];
}
