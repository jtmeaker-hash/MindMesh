/**
 * Money Management plugin.
 *
 * This wraps the existing Money Management feature behind the MindMesh Plugin
 * API. It does NOT reimplement the feature: the storage, calculations, UI,
 * notifications and backup integration are the exact same modules the app used
 * before, now registered as a plugin.
 */
import type { MindMeshPlugin, PluginContext } from '../core/types';
import type { MoneyState } from '../../types/finance';
import { getDefaultMoneyState } from '../../utils/sampleFinanceData';
import { normalizeMoneyState } from '../../utils/finance';
import { loadMoneyState, saveMoneyState } from '../../services/storage';
import { MONEY_MANAGEMENT_MANIFEST, MONEY_MANAGEMENT_PLUGIN_ID } from './manifest';
import { MoneyManagementRoute } from './MoneyManagementRoute';
import { createMoneyManagementMigrations } from './migrations';

/** True when the money slice holds anything a user would not want to lose. */
export function hasMoneyActivity(state: MoneyState | undefined): boolean {
  if (!state) return false;
  return (
    Boolean(state.incomeConfig) ||
    state.directDebits.length > 0 ||
    state.extraIncomeList.length > 0 ||
    state.tipEntries.length > 0 ||
    state.shifts.length > 0 ||
    state.expenses.length > 0
  );
}

export function createMoneyManagementPlugin(): MindMeshPlugin {
  return {
    manifest: MONEY_MANAGEMENT_MANIFEST,
    defaultEnabled: true,
    detectExistingData: (host) => hasMoneyActivity(host.moneyState),
    routes: [
      {
        id: 'money-management.overview',
        tab: 'money',
        label: 'Money',
        component: MoneyManagementRoute,
      },
    ],
    graphNodeTypes: [{ id: 'money-management.bill', label: 'Bill', color: '#34d399' }],
    settings: [
      {
        id: 'notifyUpcomingPayments',
        label: 'Upcoming payment reminders',
        description: 'Keep scheduling reminders for bills and direct debits due soon.',
        type: 'boolean',
        defaultValue: true,
      },
    ],
    migrations: createMoneyManagementMigrations(),
    activate: (context: PluginContext) => {
      context.diagnostics.report('Money Management activated', {
        directDebits: loadMoneyState().directDebits.length,
      });
    },
    deactivate: (context: PluginContext) => {
      // Disabling stops plugin-specific runtime work but never removes data.
      context.scheduler.clear();
      context.diagnostics.report('Money Management deactivated; stored data retained');
    },
    deleteData: (context: PluginContext) => {
      context.diagnostics.report('Money Management data explicitly deleted by user');
      saveMoneyState(getDefaultMoneyState());
    },
    backup: {
      serialize: () => ({
        version: MONEY_MANAGEMENT_MANIFEST.version,
        schemaVersion: MONEY_MANAGEMENT_MANIFEST.schemaVersion,
        data: loadMoneyState(),
      }),
      restore: (section) => {
        if (!section.data || typeof section.data !== 'object') {
          throw new Error('Money Management backup section is malformed');
        }
        saveMoneyState(normalizeMoneyState(section.data as MoneyState));
      },
    },
    health: () => ({
      status: 'enabled',
      message: hasMoneyActivity(loadMoneyState())
        ? 'Money data present and readable.'
        : 'No Money data stored yet.',
    }),
  };
}

export { MONEY_MANAGEMENT_MANIFEST, MONEY_MANAGEMENT_PLUGIN_ID };
