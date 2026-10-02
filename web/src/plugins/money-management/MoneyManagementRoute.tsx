import React from 'react';
import type { PluginRouteProps } from '../core/types';
import { MoneyModule } from '../../components/money/MoneyModule';

/**
 * Thin host adapter: renders the existing, unchanged MoneyModule. The plugin
 * owns the route registration; Core owns the shared state and passes it in.
 */
export const MoneyManagementRoute: React.FC<PluginRouteProps> = ({ host }) => (
  <div
    className="mm-module"
    style={{ flex: '1 1 0%', minHeight: 0, minWidth: 0, paddingTop: 0, width: '100%', display: 'flex' }}
  >
    <MoneyModule
      moneyState={host.moneyState}
      onUpdateMoneyState={host.onUpdateMoneyState}
      reminders={host.reminders}
      categories={host.categories}
      onUpdateReminders={host.onUpdateReminders}
      onUpdateCategories={host.onUpdateCategories}
      onOpenReminderModal={(reminderId) => {
        if (reminderId) host.onOpenReminder(reminderId);
      }}
    />
  </div>
);
