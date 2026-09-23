import React, { useMemo, useState } from 'react';
import { BrainCircuit, Check, Info, Lock, ShieldCheck } from 'lucide-react';
import {
  SMART_ASSISTANCE_FEATURE_GROUPS,
  SMART_ASSISTANCE_MASTER_LABEL,
  SMART_ASSISTANCE_PRIVACY_NOTE,
  getSmartAssistanceFeaturesForGroup,
  getEffectiveSmartAssistanceFeatures,
  normalizeSmartEngineSettings,
  setSmartAssistanceFeature,
  SmartAssistanceFeature,
  SmartEngineSettings,
} from '../../types/smartEngine';
import { loadDiagnosticPreferences, loadSmartEngineSettings, saveDiagnosticPreferences, saveSmartEngineSettings } from '../../services/storage';
import { logger } from '../../services/logger';

/**
 * Settings surface for the local Smart Assistance engine. Everything here is
 * persisted through the existing settings slice (`smartEngineSettings`) plus the
 * existing diagnostics preferences, so it rides along in the normal full backup
 * and older backups keep working through the documented defaults.
 */
export const SmartAssistancePanel: React.FC = () => {
  const [settings, setSettings] = useState<SmartEngineSettings>(() => loadSmartEngineSettings());
  const [advancedDiagnostics, setAdvancedDiagnostics] = useState<boolean>(() => loadDiagnosticPreferences().advancedMode);
  const effective = useMemo(() => getEffectiveSmartAssistanceFeatures(settings), [settings]);

  const persist = (next: SmartEngineSettings) => {
    const normalized = normalizeSmartEngineSettings(next);
    setSettings(normalized);
    try {
      saveSmartEngineSettings(normalized);
    } catch (err) {
      logger.error('SmartEngine', 'Saving Smart Assistance settings failed', err);
    }
  };

  const toggleFeature = (feature: SmartAssistanceFeature, enabled: boolean) => {
    persist(setSmartAssistanceFeature(settings, feature, enabled));
  };

  const toggleAdvancedDiagnostics = (enabled: boolean) => {
    setAdvancedDiagnostics(enabled);
    try {
      saveDiagnosticPreferences({ ...loadDiagnosticPreferences(), advancedMode: enabled });
    } catch (err) {
      logger.error('SmartEngine', 'Saving developer diagnostics visibility failed', err);
    }
  };

  const toggleRow = (
    key: string,
    label: string,
    description: string,
    enabled: boolean,
    onChange: (value: boolean) => void,
    disabled = false
  ) => (
    <div
      key={key}
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '12px 14px',
        borderRadius: 12,
        backgroundColor: '#1E293B',
        border: '1px solid #334155',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: '#F8FAFC' }}>{label}</span>
        <span style={{ fontSize: 11.5, color: '#94a3b8', lineHeight: 1.4 }}>{description}</span>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!enabled)}
        style={{
          flexShrink: 0,
          width: 44,
          height: 26,
          borderRadius: 999,
          border: 'none',
          padding: 3,
          cursor: disabled ? 'not-allowed' : 'pointer',
          backgroundColor: enabled ? '#10b981' : '#475569',
          opacity: disabled ? 0.6 : 1,
          transition: 'background-color 0.15s ease',
          display: 'flex',
          justifyContent: enabled ? 'flex-end' : 'flex-start',
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            backgroundColor: '#ffffff',
            boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          }}
        />
      </button>
    </div>
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Privacy / local-first explanation */}
      <div
        data-testid="smart-assistance-privacy"
        style={{
          padding: 14,
          borderRadius: 16,
          backgroundColor: 'rgba(16, 185, 129, 0.08)',
          border: '1px solid rgba(16, 185, 129, 0.25)',
          fontSize: 12.5,
          color: '#a7f3d0',
          lineHeight: 1.5,
          display: 'flex',
          gap: 10,
        }}
      >
        <ShieldCheck size={18} color="#34d399" style={{ flexShrink: 0, marginTop: 1 }} />
        <div>
          <div style={{ fontWeight: 700, color: '#34d399', marginBottom: 4 }}>Runs locally on this device</div>
          {SMART_ASSISTANCE_PRIVACY_NOTE}
        </div>
      </div>

      {/* Master switch */}
      <div
        style={{
          padding: 14,
          borderRadius: 16,
          backgroundColor: 'rgba(30, 41, 59, 0.5)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BrainCircuit size={16} color="#818cf8" />
          <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{SMART_ASSISTANCE_MASTER_LABEL}</span>
        </div>
        {toggleRow(
          'enabled',
          'Enable Smart Assistance',
          'Turns suggestion-based help on or off. Existing reminders, contacts, money data and notifications are unaffected either way.',
          settings.enabled,
          (value) => persist({ ...settings, enabled: value })
        )}
      </div>

      {/* Per-feature permissions, grouped like the rest of Settings */}
      {SMART_ASSISTANCE_FEATURE_GROUPS.map((group) => {
        const features = getSmartAssistanceFeaturesForGroup(group.group);
        if (features.length === 0) return null;
        return (
          <div
            key={group.group}
            style={{
              padding: 14,
              borderRadius: 16,
              backgroundColor: 'rgba(30, 41, 59, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{group.label}</div>
              <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{group.description}</div>
            </div>
            {features.map((definition) =>
              toggleRow(
                definition.feature,
                definition.label,
                definition.description,
                effective[definition.feature],
                (value) => toggleFeature(definition.feature, value),
                !settings.enabled
              )
            )}
          </div>
        );
      })}

      {/* Mandatory confirmation + optional developer visibility */}
      <div
        style={{
          padding: 14,
          borderRadius: 16,
          backgroundColor: 'rgba(30, 41, 59, 0.5)',
          border: '1px solid rgba(255, 255, 255, 0.06)',
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
        }}
      >
        <div
          data-testid="smart-assistance-confirmation"
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 10,
            padding: '12px 14px',
            borderRadius: 12,
            backgroundColor: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
          }}
        >
          <Lock size={16} color="#a5b4fc" style={{ flexShrink: 0, marginTop: 2 }} />
          <div style={{ fontSize: 12, color: '#c7d2fe', lineHeight: 1.5 }}>
            <div style={{ fontWeight: 700, color: '#a5b4fc', marginBottom: 2 }}>Confirmation always required</div>
            Smart Assistance only ever produces a preview. Nothing is written until you confirm it in the app, and this
            cannot be turned off.
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6, color: '#86efac' }}>
              <Check size={13} /> Enforced — no hidden bypass
            </div>
          </div>
        </div>

        {toggleRow(
          'advancedDiagnostics',
          'Developer diagnostics visibility',
          'Reveals the advanced diagnostics panel for troubleshooting. Does not change how suggestions behave.',
          advancedDiagnostics,
          toggleAdvancedDiagnostics
        )}

        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
          <Info size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          There are no model, provider or API-key settings here on purpose: this engine uses deterministic parsing and
          templates only, so those controls would not do anything.
        </div>
      </div>
    </div>
  );
};
