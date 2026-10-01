import React from 'react';
import { ChevronDown, ChevronUp, Plus, Trash2 } from 'lucide-react';
import { CasualPayRateRule, RateRuleMode } from '../../types/finance';
import { describeRateRule } from '../../utils/payRates';

interface RateRuleEditorProps {
  rules: CasualPayRateRule[];
  baseRate: number;
  onChange: (rules: CasualPayRateRule[]) => void;
}

const DAY_LABELS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  padding: '8px 10px',
  color: '#fff',
  fontSize: 13,
  boxSizing: 'border-box',
};

const smallLabelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  color: '#94a3b8',
  marginBottom: 4,
};

/**
 * Ordered editor for user-defined casual pay rate rules. List order is the
 * priority order: the first matching rule wins, and the base rate is the
 * fallback when no rule matches.
 */
export const RateRuleEditor: React.FC<RateRuleEditorProps> = ({ rules, baseRate, onChange }) => {
  const updateRule = (id: string, patch: Partial<CasualPayRateRule>) => {
    onChange(rules.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  };

  const addRule = () => {
    onChange([
      ...rules,
      {
        id: `rate-rule-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        label: `Rule ${rules.length + 1}`,
        enabled: true,
        days: [],
        allDay: true,
        // A new rule starts all-day, so no example time is pre-filled. The user
        // picks the window themselves after turning off "All day".
        mode: 'fixed',
        rate: Number.isFinite(baseRate) ? baseRate : 0,
        priority: rules.length,
      },
    ]);
  };

  const moveRule = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= rules.length) return;
    const next = [...rules];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  };

  const toggleDay = (rule: CasualPayRateRule, day: number) => {
    const days = rule.days.includes(day)
      ? rule.days.filter((value) => value !== day)
      : [...rule.days, day].sort((a, b) => a - b);
    updateRule(rule.id, { days });
  };

  const enabledRules = rules.filter((rule) => rule.enabled);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc', display: 'block' }}>Pay Rate Rules</span>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            Time-of-day and day-of-week rates. The first matching rule wins; the base rate covers everything else.
          </span>
        </div>
        <button
          type="button"
          onClick={addRule}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 5,
            padding: '7px 12px',
            borderRadius: 10,
            border: '1px solid rgba(255, 255, 255, 0.12)',
            background: 'rgba(59, 130, 246, 0.15)',
            color: '#93c5fd',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          <Plus size={14} />
          <span>Add Rate Rule</span>
        </button>
      </div>

      {rules.length === 0 && (
        <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>
          No custom rules yet. Every hour is paid at the base rate. Add a rule for weekday evenings, Saturdays,
          Sundays or any other pattern.
        </p>
      )}

      {rules.map((rule, index) => {
        const effectiveRate = rule.mode === 'multiplier' ? baseRate * (Number(rule.rate) || 0) : Number(rule.rate) || 0;
        return (
          <div
            key={rule.id}
            style={{
              padding: 12,
              borderRadius: 12,
              background: 'rgba(2, 6, 23, 0.45)',
              border: `1px solid ${rule.enabled ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.05)'}`,
              opacity: rule.enabled ? 1 : 0.6,
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input
                type="text"
                value={rule.label}
                onChange={(e) => updateRule(rule.id, { label: e.target.value })}
                placeholder="Rule name e.g. Weekday evening"
                aria-label="Rate rule name"
                style={{ ...inputStyle, flex: 1 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={(e) => updateRule(rule.id, { enabled: e.target.checked })}
                  style={{ width: 15, height: 15, accentColor: '#10b981', cursor: 'pointer' }}
                />
                Enabled
              </label>
              <button
                type="button"
                aria-label="Move rule up"
                onClick={() => moveRule(index, -1)}
                disabled={index === 0}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: index === 0 ? '#334155' : '#94a3b8',
                  cursor: index === 0 ? 'default' : 'pointer',
                  padding: 4,
                }}
              >
                <ChevronUp size={16} />
              </button>
              <button
                type="button"
                aria-label="Move rule down"
                onClick={() => moveRule(index, 1)}
                disabled={index === rules.length - 1}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: index === rules.length - 1 ? '#334155' : '#94a3b8',
                  cursor: index === rules.length - 1 ? 'default' : 'pointer',
                  padding: 4,
                }}
              >
                <ChevronDown size={16} />
              </button>
              <button
                type="button"
                aria-label="Delete rule"
                onClick={() => onChange(rules.filter((item) => item.id !== rule.id))}
                style={{
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: 'none',
                  color: '#f87171',
                  cursor: 'pointer',
                  padding: 6,
                  borderRadius: 8,
                  display: 'flex',
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>

            <div>
              <span style={smallLabelStyle}>Days</span>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {DAY_LABELS.map((label, day) => {
                  const selected = rule.days.includes(day);
                  return (
                    <button
                      key={day}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleDay(rule, day)}
                      style={{
                        minWidth: 34,
                        padding: '6px 8px',
                        borderRadius: 8,
                        border: `1px solid ${selected ? 'rgba(99,102,241,0.6)' : 'rgba(255,255,255,0.1)'}`,
                        background: selected ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.03)',
                        color: selected ? '#c7d2fe' : '#94a3b8',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr 1fr', gap: 10, alignItems: 'end' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#94a3b8', paddingBottom: 8, whiteSpace: 'nowrap' }}>
                <input
                  type="checkbox"
                  checked={rule.allDay}
                  onChange={(e) => updateRule(rule.id, { allDay: e.target.checked })}
                  style={{ width: 15, height: 15, accentColor: '#6366f1', cursor: 'pointer' }}
                />
                All day
              </label>
              <div>
                <span style={smallLabelStyle}>Start</span>
                <input
                  type="time"
                  value={rule.allDay ? '' : rule.startTime || ''}
                  disabled={rule.allDay}
                  onChange={(e) => updateRule(rule.id, { startTime: e.target.value })}
                  aria-label="Rule start time"
                  style={{ ...inputStyle, opacity: rule.allDay ? 0.4 : 1 }}
                />
              </div>
              <div>
                <span style={smallLabelStyle}>End (exclusive)</span>
                <input
                  type="time"
                  value={rule.allDay ? '' : rule.endTime || ''}
                  disabled={rule.allDay}
                  onChange={(e) => updateRule(rule.id, { endTime: e.target.value })}
                  aria-label="Rule end time"
                  style={{ ...inputStyle, opacity: rule.allDay ? 0.4 : 1 }}
                />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <div>
                <span style={smallLabelStyle}>Rate type</span>
                <select
                  value={rule.mode}
                  onChange={(e) => updateRule(rule.id, { mode: e.target.value as RateRuleMode })}
                  aria-label="Rule rate type"
                  style={{ ...inputStyle, background: '#1e293b' }}
                >
                  <option value="fixed">Fixed hourly rate</option>
                  <option value="multiplier">Multiplier of base</option>
                </select>
              </div>
              <div>
                <span style={smallLabelStyle}>{rule.mode === 'multiplier' ? 'Multiplier (e.g. 1.5)' : 'Hourly rate ($/hr)'}</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={rule.rate}
                  onChange={(e) => updateRule(rule.id, { rate: Number(e.target.value) })}
                  aria-label="Rule rate value"
                  style={inputStyle}
                />
              </div>
            </div>

            <span style={{ fontSize: 11, color: '#64748b' }}>
              Effective: ${effectiveRate.toFixed(2)}/hr · {describeRateRule(rule, baseRate)}
            </span>
          </div>
        );
      })}

      {rules.length > 0 && (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            background: 'rgba(16, 185, 129, 0.08)',
            border: '1px solid rgba(16, 185, 129, 0.2)',
          }}
        >
          <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: '#6ee7b7', letterSpacing: '0.05em' }}>
            Rate summary
          </span>
          <div style={{ marginTop: 6, display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 12, color: '#cbd5e1' }}>Base: ${(Number(baseRate) || 0).toFixed(2)}/hr</span>
            {enabledRules.map((rule) => (
              <span key={rule.id} style={{ fontSize: 12, color: '#cbd5e1' }}>
                {rule.label}: {describeRateRule(rule, baseRate)}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
