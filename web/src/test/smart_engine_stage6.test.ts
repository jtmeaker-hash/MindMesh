import { beforeEach, describe, expect, it } from 'vitest';
import { Category, Reminder } from '../types';
import { DiagnosticReport, LogEntry } from '../types/diagnostics';
import { Contact } from '../types/contact';
import {
  DEFAULT_SMART_ENGINE_SETTINGS,
  SMART_ASSISTANCE_FEATURES,
  SMART_ASSISTANCE_PRIVACY_NOTE,
  getEffectiveSmartAssistanceFeatures,
  isWriteConfirmationRequired,
  normalizeSmartEngineSettings,
  setSmartAssistanceFeature,
} from '../types/smartEngine';
import { createBackup, migrateBackup, restoreBackup, serializeBackup } from '../services/backup';
import { loadAllData, loadSmartEngineSettings, saveAllData, saveSmartEngineSettings } from '../services/storage';
import { createSmartEngine, DefaultSmartEngineActionValidator, DefaultSmartEngineContextProvider } from '../services/smartEngine';
import {
  analyzeDiagnostics,
  buildDiagnosticsSuggestions,
  summarizeDiagnosticsSuggestions,
} from '../services/smartEngineDiagnostics';
import { getFixDefinition } from '../services/fixer';
import { CreateReminderProposal } from '../types/smartEngine';

const categories: Category[] = [
  { id: 'car', name: 'Car', color: '#f97316', createdAt: '2026-01-01T00:00:00.000Z' },
];

const contacts: Contact[] = [
  {
    id: 'c1',
    fullName: 'Josh Smith',
    firstName: 'Josh',
    lastName: 'Smith',
    phoneNumber: '0400000000',
    relationship: 'Friend',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  },
];

const categoryContext = new DefaultSmartEngineContextProvider(categories);

function reminder(overrides: Partial<Reminder> & Pick<Reminder, 'id' | 'title' | 'completed'>): Reminder {
  return {
    categoryId: 'car',
    priority: 'medium',
    createdAt: '2026-08-01T00:00:00.000Z',
    subtasks: [],
    ...overrides,
  };
}

function reportOf(results: DiagnosticReport['results']): DiagnosticReport {
  return {
    summary: {
      overall: 'warning',
      passed: 0,
      warnings: 0,
      failed: 0,
      unknown: 0,
      total: results.length,
      runAt: '2026-09-23T00:00:00.000Z',
      mode: 'quick',
    },
    results,
  };
}

const failingPermissionCheck: DiagnosticReport['results'][number] = {
  id: 'notifications.permission',
  name: 'Notification permission',
  category: 'notifications',
  status: 'warning',
  explanation: 'Notifications are currently blocked on Android.',
  timestamp: '2026-09-23T00:00:00.000Z',
  details: { permission: 'denied', platform: 'android-native' },
  suggestedFix: 'Allow notifications for MindMesh, then retry.',
  fixId: 'fix.openNotificationSettings',
};

describe('Smart Engine Stage 06 — settings, backup and diagnostics', () => {
  beforeEach(() => localStorage.clear());

  it('ships all documented Smart Assistance controls with safe defaults', () => {
    const effective = getEffectiveSmartAssistanceFeatures(DEFAULT_SMART_ENGINE_SETTINGS);
    for (const definition of SMART_ASSISTANCE_FEATURES) {
      expect(effective[definition.feature]).toBe(definition.defaultEnabled);
      expect(definition.description.length).toBeGreaterThan(0);
    }
    expect(effective.autoDetectDates).toBe(true);
    expect(effective.detectRecurrence).toBe(true);
    expect(effective.suggestCategories).toBe(true);
    expect(effective.suggestSubcategories).toBe(true);
    expect(effective.suggestSubtasks).toBe(true);
    expect(effective.suggestDescriptions).toBe(true);
    expect(effective.moneySmartFeatures).toBe(true);
    expect(effective.dashboardSummaries).toBe(true);
    expect(effective.useCompletedHistory).toBe(true);
    expect(effective.useContactContext).toBe(true);
    expect(effective.diagnosticsSuggestions).toBe(true);
    expect(DEFAULT_SMART_ENGINE_SETTINGS.enabled).toBe(true);
    // Privacy copy is present and accurate about the local-only design.
    expect(SMART_ASSISTANCE_PRIVACY_NOTE).toContain('no API key');
    expect(SMART_ASSISTANCE_PRIVACY_NOTE).toContain('network request');
  });

  it('persists toggles and reports honest, non-fake capabilities', () => {
    saveSmartEngineSettings(setSmartAssistanceFeature(DEFAULT_SMART_ENGINE_SETTINGS, 'suggestSubtasks', false));
    const loaded = loadSmartEngineSettings();
    expect(loaded.featureToggles).toEqual({ suggestSubtasks: false });
    expect(loaded.requireConfirmationForWrites).toBe(true);
    // Only real, deterministic features are registered — no model/provider keys.
    expect(SMART_ASSISTANCE_FEATURES.some((definition) => /api|model|provider|key/i.test(definition.feature))).toBe(false);
  });

  it('never allows confirmation for writes to be bypassed, even from stored data', () => {
    expect(normalizeSmartEngineSettings({ requireConfirmationForWrites: false }).requireConfirmationForWrites).toBe(true);
    expect(isWriteConfirmationRequired({ ...DEFAULT_SMART_ENGINE_SETTINGS, requireConfirmationForWrites: false })).toBe(true);

    const clean: CreateReminderProposal = {
      type: 'create-reminder',
      id: 'p1',
      preview: 'Create reminder “Pay rego”',
      fields: { title: { value: 'Pay rego', confidence: { score: 0.99, reason: 'explicit-pattern' } } },
      confidence: { score: 0.99, reason: 'explicit-pattern' },
      missingFields: [],
      ambiguities: [],
      validation: { valid: false, canWrite: false, reasons: [] },
    };
    const validation = new DefaultSmartEngineActionValidator().validate(clean, {
      ...DEFAULT_SMART_ENGINE_SETTINGS,
      requireConfirmationForWrites: false,
    });
    expect(validation.valid).toBe(true);
    expect(validation.canWrite).toBe(false);
  });

  it('honours per-feature gates by removing suggestions instead of inventing them', () => {
    const engine = createSmartEngine({
      contextProvider: categoryContext,
      settings: {
        featureToggles: {
          autoDetectDates: false,
          detectRecurrence: false,
          suggestCategories: false,
          suggestSubtasks: false,
        },
      },
      referenceDate: new Date(2026, 8, 23),
    });
    const result = engine.interpret('create-reminder', 'remind me to service the car tomorrow every month');
    const fields = (result.proposal as CreateReminderProposal).fields;
    expect(String(fields.title?.value)).toContain('service the car');
    expect(fields.dueDate).toBeUndefined();
    expect(fields.dueTime).toBeUndefined();
    expect(fields.recurrence).toBeUndefined();
    expect(fields.categoryId).toBeUndefined();
    expect(fields.suggestedSubtasks).toBeUndefined();
    expect(result.status).toBe('needs-confirmation');
    expect(result.ambiguities.some((ambiguity) => /turned off/.test(ambiguity.message))).toBe(true);

    // With the gates on, the same input does produce those suggestions.
    const on = createSmartEngine({ contextProvider: categoryContext, referenceDate: new Date(2026, 8, 23) });
    const onFields = (on.interpret('create-reminder', 'remind me to service the car tomorrow every month').proposal as CreateReminderProposal).fields;
    expect(onFields.dueDate?.value).toBe('2026-09-24');
    expect(onFields.recurrence?.value).toBeDefined();
    expect(onFields.categoryId?.value).toBe('car');
    expect(onFields.suggestedSubtasks?.value).toBeDefined();
  });

  it('turns gated operations off honestly', () => {
    const engine = createSmartEngine({
      settings: {
        featureToggles: { moneySmartFeatures: false, dashboardSummaries: false, suggestDescriptions: false },
      },
    });
    expect(engine.interpret('create-direct-debit', 'Netflix is $25.99 every month on the 16th').status).toBe('unknown');
    expect(engine.interpret('create-direct-debit', 'Netflix is $25.99 every month on the 16th').message).toContain('turned off');
    expect(engine.interpret('classify-money', 'I got paid $900').status).toBe('unknown');
    expect(engine.interpret('dashboard-summary', 'summarise my dashboard').message).toContain('turned off');
    expect(engine.enhanceDescription('pay rego').status).toBe('unknown');
    expect(engine.interpret('assistant-command', 'Netflix bill $25 monthly').message).toContain('turned off');
  });

  it('disables contact and completed-history context when their permissions are off', () => {
    const off = createSmartEngine({
      contextProvider: categoryContext,
      contacts,
      reminders: [reminder({ id: 'r1', title: 'Service the car', completed: true, completedAt: '2026-08-10T00:00:00.000Z' })],
      referenceDate: new Date(2026, 8, 23),
      settings: { featureToggles: { useContactContext: false, useCompletedHistory: false } },
    });
    const match = off.interpret('match-contact', 'Josh');
    expect(match.status).toBe('unknown');
    expect(match.message).toContain('turned off');

    const proposal = off.interpret('create-reminder', 'remind me to service the car tomorrow').proposal as CreateReminderProposal;
    expect(proposal.fields.suggestedContactName?.value).toBeUndefined();
    expect(proposal.fields.historyContext?.value).toBeUndefined();

    const on = createSmartEngine({
      contextProvider: categoryContext,
      contacts,
      reminders: [reminder({ id: 'r1', title: 'Service the car', completed: true, completedAt: '2026-08-10T00:00:00.000Z' })],
      referenceDate: new Date(2026, 8, 23),
    });
    const onProposal = on.interpret('create-reminder', 'service the car tomorrow with Josh').proposal as CreateReminderProposal;
    expect(onProposal.fields.suggestedContactName?.value).toBe('Josh Smith');
    expect(onProposal.fields.historyContext?.value).toBeDefined();
  });

  it('round-trips Smart Assistance settings through a full backup', () => {
    const state = loadAllData();
    saveAllData({
      ...state,
      smartEngineSettings: normalizeSmartEngineSettings({
        ...DEFAULT_SMART_ENGINE_SETTINGS,
        enabled: false,
        featureToggles: { diagnosticsSuggestions: false, moneySmartFeatures: false },
      }),
    });

    const backup = createBackup();
    expect(backup.data.smartEngineSettings?.enabled).toBe(false);
    expect(backup.data.smartEngineSettings?.featureToggles).toEqual({
      diagnosticsSuggestions: false,
      moneySmartFeatures: false,
    });
    // Reminders, contacts and money data remain part of the backup as before.
    expect(Array.isArray(backup.data.reminders)).toBe(true);
    expect(Array.isArray(backup.data.contacts)).toBe(true);
    expect(backup.data.money).toBeDefined();

    localStorage.clear();
    expect(restoreBackup(backup).success).toBe(true);
    const restored = loadSmartEngineSettings();
    expect(restored.enabled).toBe(false);
    expect(restored.featureToggles).toEqual({ diagnosticsSuggestions: false, moneySmartFeatures: false });
    expect(restored.requireConfirmationForWrites).toBe(true);
  });

  it('restores older backups that lack Smart Engine data and any new toggles', () => {
    const base = loadAllData();

    const legacy = JSON.parse(serializeBackup(createBackup())) as ReturnType<typeof createBackup>;
    delete legacy.data.smartEngineSettings;
    const migrated = migrateBackup(legacy);
    expect(migrated.smartEngineSettings).toEqual(DEFAULT_SMART_ENGINE_SETTINGS);
    expect(migrated.reminders).toEqual(base.reminders);

    // A backup that stored only the original three context toggles must keep them
    // and fall back to documented defaults for every newer control.
    const partial = JSON.parse(serializeBackup(createBackup())) as ReturnType<typeof createBackup>;
    partial.data.smartEngineSettings = {
      enabled: true,
      featureToggles: { useContactContext: false },
      requireConfirmationForWrites: false,
      minimumConfidenceForSuggestions: 0.7,
      minimumConfidenceForWrites: 0.9,
    } as never;

    localStorage.clear();
    expect(restoreBackup(partial).success).toBe(true);
    const restored = loadSmartEngineSettings();
    expect(restored.featureToggles).toEqual({ useContactContext: false });
    const effective = getEffectiveSmartAssistanceFeatures(restored);
    expect(effective.useContactContext).toBe(false);
    expect(effective.suggestSubtasks).toBe(true);
    expect(effective.diagnosticsSuggestions).toBe(true);
    expect(restored.requireConfirmationForWrites).toBe(true);
  });

  it('only reports diagnostics the app can actually inspect', () => {
    const clean = reportOf([
      { id: 'app.version', name: 'App & build version', category: 'app', status: 'pass', explanation: 'ok', timestamp: 't' },
      { id: 'platform.info', name: 'Platform', category: 'platform', status: 'pass', explanation: 'ok', timestamp: 't' },
    ]);
    expect(buildDiagnosticsSuggestions(clean)).toEqual([]);
    expect(summarizeDiagnosticsSuggestions([])).toContain('No notification or configuration problems');

    // Non-actionable informational checks never become issues, even when unknown.
    const noisy = reportOf([
      { id: 'network.connectivity', name: 'Internet connectivity', category: 'network', status: 'warning', explanation: 'offline', timestamp: 't' },
      { id: 'pwa.serviceWorker', name: 'Service worker', category: 'platform', status: 'unknown', explanation: 'not supported', timestamp: 't' },
      { id: 'storage.hydration', name: 'State hydration', category: 'storage', status: 'unknown', explanation: 'cannot tell', timestamp: 't' },
    ]);
    expect(buildDiagnosticsSuggestions(noisy)).toEqual([]);
  });

  it('routes diagnostics suggestions to the existing fixer without claiming a fix ran', () => {
    const report = reportOf([
      failingPermissionCheck,
      {
        id: 'deep.duplicateIds',
        name: 'Duplicate record identifiers',
        category: 'storage',
        status: 'fail',
        explanation: '2 duplicate identifier(s) found.',
        timestamp: 't',
        details: { duplicates: ['reminder:a'] },
        suggestedFix: 'Create a backup first, then remove duplicated records.',
        fixId: 'fix.removeDuplicatedRecords',
        userDataAtRisk: true,
      },
      { id: 'app.startup', name: 'Application startup', category: 'app', status: 'pass', explanation: 'ok', timestamp: 't' },
    ]);

    const suggestions = buildDiagnosticsSuggestions(report, {
      reminders: [reminder({ id: 'r1', title: 'Unscheduled', completed: false })],
    });
    const byCheck = Object.fromEntries(suggestions.map((suggestion) => [suggestion.sourceCheckId, suggestion]));

    const permission = byCheck['notifications.permission'];
    expect(permission.severity).toBe('warning');
    expect(permission.canAutoFix).toBe(true);
    expect(permission.route).toBe('existing-fix');
    expect(permission.fixId).toBe('fix.openNotificationSettings');
    expect(permission.evidence).toMatchObject({ permission: 'denied' });
    expect(getFixDefinition('fix.openNotificationSettings')?.kind).toBe('safe');

    const duplicates = byCheck['deep.duplicateIds'];
    expect(duplicates.severity).toBe('fail');
    expect(duplicates.canAutoFix).toBe(false);
    expect(duplicates.requiresConfirmation).toBe(true);
    expect(duplicates.route).toBe('confirm-fix');

    // Reminder with no due date and no recurrence is a real, detectable state.
    const noTrigger = byCheck['reminders.trigger'];
    expect(noTrigger.severity).toBe('warning');
    expect(noTrigger.canAutoFix).toBe(false);
    expect(noTrigger.evidence).toMatchObject({ withoutTrigger: 1 });

    expect(byCheck['app.startup']).toBeUndefined();

    const analytics = analyzeDiagnostics(report, {
      reminders: [reminder({ id: 'r2', title: 'Scheduled', completed: false, dueDate: '2026-09-30' })],
    });
    expect(analytics.facts.total).toBe(analytics.suggestions.length);
    expect(analytics.facts.failures).toBe(1);
    expect(analytics.facts.warnings).toBe(1);
    expect(analytics.facts.autoFixable).toBe(1);
    expect(analytics.facts.requiresConfirmation).toBe(1);
    expect(analytics.facts.remindersWithoutTrigger).toBe(0);
    expect(analytics.text).toContain(`${analytics.facts.total} diagnostic suggestion`);
    // Suggestions never claim a repair happened.
    expect(analytics.text).not.toMatch(/\bfixed\b|\brepaired successfully\b/i);
  });

  it('only surfaces log-pattern suggestions when matching evidence exists', () => {
    const logs: LogEntry[] = [
      { id: 'l1', timestamp: 't', level: 'ERROR', subsystem: 'Notifications', message: 'Delivery failed for reminder r1' },
      { id: 'l2', timestamp: 't', level: 'INFO', subsystem: 'Notifications', message: 'Scheduled reminder r2' },
    ];
    const empty = reportOf([{ id: 'app.lastStartup', name: 'Startup', category: 'app', status: 'pass', explanation: 'ok', timestamp: 't' }]);

    const withEvidence = buildDiagnosticsSuggestions(empty, { logs });
    expect(withEvidence).toHaveLength(1);
    expect(withEvidence[0].id).toBe('diag-log-notification-delivery');
    expect(withEvidence[0].canAutoFix).toBe(true);
    expect(withEvidence[0].evidence).toMatchObject({ matches: 1 });

    const withoutEvidence = buildDiagnosticsSuggestions(empty, {
      logs: [{ id: 'l3', timestamp: 't', level: 'INFO', subsystem: 'Notifications', message: 'Scheduled reminder r3' }],
    });
    expect(withoutEvidence).toEqual([]);
  });

  it('routes a diagnostics assistant command through the engine and stays offline', () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (() => {
      calls += 1;
      throw new Error('network must not be used');
    }) as typeof fetch;
    try {
      // Warm up hydration/normalisation once so the comparison reflects only the
      // engine's own effects, not the one-time state migration.
      loadAllData();
      const before = JSON.stringify(loadAllData());
      const engine = createSmartEngine({
        diagnosticsReport: reportOf([failingPermissionCheck]),
        logs: [],
      });
      const result = engine.interpret('assistant-command', 'diagnostics help');
      expect(result.status).toBe('ok');
      expect(result.message).toContain('Notification permission');
      expect(engine.analyzeDiagnosticsSummary().suggestions).toHaveLength(1);
      expect(JSON.stringify(loadAllData())).toBe(before);
      expect(calls).toBe(0);

      const disabled = createSmartEngine({
        diagnosticsReport: reportOf([failingPermissionCheck]),
        settings: { featureToggles: { diagnosticsSuggestions: false } },
      });
      const blocked = disabled.interpret('diagnostics-suggestion', 'what is wrong');
      expect(blocked.status).toBe('unknown');
      expect(blocked.message).toContain('turned off');

      const noReport = createSmartEngine();
      expect(noReport.interpret('diagnostics-suggestion', 'what is wrong').message).toContain('Run diagnostics first');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
