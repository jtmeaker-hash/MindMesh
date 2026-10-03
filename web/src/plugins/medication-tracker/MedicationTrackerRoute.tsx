import React from 'react';
import type { PluginRouteProps } from '../core/types';
import { MedicationTrackerModule } from './MedicationTrackerModule';

/**
 * Plugin route adapter. The plugin owns its own state through plugin-scoped
 * storage; Core only tells it whether app-wide notifications are enabled.
 */
export const MedicationTrackerRoute: React.FC<PluginRouteProps> = ({ host }) => (
  <MedicationTrackerModule appNotificationsEnabled={host.notificationSettings.enabled} />
);
