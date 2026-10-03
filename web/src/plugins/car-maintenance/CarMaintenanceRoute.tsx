import React from 'react';
import type { PluginRouteProps } from '../core/types';
import { VehicleModule } from '../../components/vehicles/VehicleModule';

/**
 * Thin host adapter: renders the existing, unchanged VehicleModule. The plugin
 * owns the route registration; Core owns the shared state and passes it in.
 */
export const CarMaintenanceRoute: React.FC<PluginRouteProps> = ({ host }) => (
  <VehicleModule
    vehicleState={host.vehicleState}
    onUpdateVehicleState={host.onUpdateVehicleState}
    appNotificationsEnabled={host.notificationSettings.enabled}
  />
);
