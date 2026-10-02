/**
 * Car Maintenance plugin.
 *
 * Wraps the existing Vehicle Maintenance feature behind the MindMesh Plugin
 * API without reimplementing it. Storage, service calculations, history,
 * issues, estimates, notifications and backup integration are the same modules
 * the app used before, now registered as a plugin.
 */
import type { MindMeshPlugin, PluginContext } from '../core/types';
import type { VehicleState } from '../../types/vehicle';
import { createDefaultVehicleState, normalizeVehicleState } from '../../services/vehicleMaintenance';
import { loadVehicleState, saveVehicleState } from '../../services/storage';
import { CAR_MAINTENANCE_MANIFEST, CAR_MAINTENANCE_PLUGIN_ID } from './manifest';
import { CarMaintenanceRoute } from './CarMaintenanceRoute';
import { createCarMaintenanceMigrations } from './migrations';

export function hasVehicleActivity(state: VehicleState | undefined): boolean {
  if (!state) return false;
  return (
    state.vehicles.length > 0 ||
    state.serviceRecords.length > 0 ||
    state.odometerRecords.length > 0 ||
    state.maintenanceItems.length > 0
  );
}

export function createCarMaintenancePlugin(): MindMeshPlugin {
  return {
    manifest: CAR_MAINTENANCE_MANIFEST,
    defaultEnabled: true,
    detectExistingData: (host) => hasVehicleActivity(host.vehicleState),
    routes: [
      {
        id: 'car-maintenance.overview',
        tab: 'vehicles',
        label: 'Vehicles',
        component: CarMaintenanceRoute,
      },
    ],
    graphNodeTypes: [{ id: 'car-maintenance.service', label: 'Service', color: '#38bdf8' }],
    settings: [
      {
        id: 'odometerReminders',
        label: 'Odometer reminders',
        description: 'Recurring reminders to update odometer readings and service intervals.',
        type: 'boolean',
        defaultValue: true,
      },
    ],
    migrations: createCarMaintenanceMigrations(),
    activate: (context: PluginContext) => {
      context.diagnostics.report('Car Maintenance activated', {
        vehicles: loadVehicleState().vehicles.length,
      });
    },
    deactivate: (context: PluginContext) => {
      // Disabling stops plugin-specific runtime work but never removes data.
      context.scheduler.clear();
      context.diagnostics.report('Car Maintenance deactivated; stored data retained');
    },
    deleteData: (context: PluginContext) => {
      context.diagnostics.report('Car Maintenance data explicitly deleted by user');
      saveVehicleState(createDefaultVehicleState());
    },
    backup: {
      serialize: () => ({ data: loadVehicleState() }),
      restore: (section) => {
        saveVehicleState(normalizeVehicleState(section.data));
      },
    },
    health: () => ({
      status: 'enabled',
      message: hasVehicleActivity(loadVehicleState())
        ? 'Vehicle data present and readable.'
        : 'No vehicle data stored yet.',
    }),
  };
}

export { CAR_MAINTENANCE_MANIFEST, CAR_MAINTENANCE_PLUGIN_ID };
