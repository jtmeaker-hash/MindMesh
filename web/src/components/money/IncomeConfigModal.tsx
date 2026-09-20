import React, { useState } from 'react';
import {
  X,
  Briefcase,
  Calendar,
} from 'lucide-react';
import {
  IncomeConfig,
  EmploymentType,
  PayFrequency,
  HourlyRateConfig,
} from '../../types/finance';

interface IncomeConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  config?: IncomeConfig | null;
  onSave: (config: IncomeConfig) => void;
}

export const IncomeConfigModal: React.FC<IncomeConfigModalProps> = ({
  isOpen,
  onClose,
  config,
  onSave,
}) => {
  const [title, setTitle] = useState(config?.title || 'Primary Job');
  const [employmentType, setEmploymentType] = useState<EmploymentType>(
    config?.employmentType || 'casual_hourly'
  );
  const [frequency, setFrequency] = useState<PayFrequency>(config?.frequency || 'fortnightly');
  const [customFrequencyDays, setCustomFrequencyDays] = useState(config?.customFrequencyDays || 14);
  const [averagePay, setAveragePay] = useState(config ? String(config.averagePay) : '1150');
  const [nextPayDate, setNextPayDate] = useState(
    config?.nextPayDate || new Date(Date.now() + 86400000 * 6).toISOString().split('T')[0]
  );
  const [employerName, setEmployerName] = useState(config?.employerName || '');
  const [notes, setNotes] = useState(config?.notes || '');

  // Hourly / casual pay mode
  const [hourlyPayModeEnabled, setHourlyPayModeEnabled] = useState(
    config?.hourlyPayModeEnabled ?? (config?.employmentType === 'casual_hourly')
  );
  const [baseRate, setBaseRate] = useState(config?.hourlyRates?.baseRate ? String(config.hourlyRates.baseRate) : '32');
  const [saturdayRate, setSaturdayRate] = useState(
    config?.hourlyRates?.saturdayRate ? String(config.hourlyRates.saturdayRate) : '38'
  );
  const [sundayRate, setSundayRate] = useState(
    config?.hourlyRates?.sundayRate ? String(config.hourlyRates.sundayRate) : '44'
  );
  const [publicHolidayRate, setPublicHolidayRate] = useState(
    config?.hourlyRates?.publicHolidayRate ? String(config.hourlyRates.publicHolidayRate) : '56'
  );
  const [eveningRate, setEveningRate] = useState(
    config?.hourlyRates?.eveningRate ? String(config.hourlyRates.eveningRate) : '35'
  );
  const [nightRate, setNightRate] = useState(
    config?.hourlyRates?.nightRate ? String(config.hourlyRates.nightRate) : '37'
  );
  const [overtimeRate, setOvertimeRate] = useState(
    config?.hourlyRates?.overtimeRate ? String(config.hourlyRates.overtimeRate) : '48'
  );

  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Income source title is required');
      return;
    }

    const parsedAvgPay = parseFloat(averagePay);
    if (isNaN(parsedAvgPay) || parsedAvgPay < 0) {
      setError('Please enter a valid average pay per cycle (e.g. 1150)');
      return;
    }

    if (!nextPayDate) {
      setError('Next pay date is required');
      return;
    }

    const hourlyRates: HourlyRateConfig = {
      baseRate: parseFloat(baseRate) || 0,
      saturdayRate: saturdayRate ? parseFloat(saturdayRate) : undefined,
      sundayRate: sundayRate ? parseFloat(sundayRate) : undefined,
      publicHolidayRate: publicHolidayRate ? parseFloat(publicHolidayRate) : undefined,
      eveningRate: eveningRate ? parseFloat(eveningRate) : undefined,
      nightRate: nightRate ? parseFloat(nightRate) : undefined,
      overtimeRate: overtimeRate ? parseFloat(overtimeRate) : undefined,
    };

    const payload: IncomeConfig = {
      id: config?.id || `income-${Date.now()}`,
      title: trimmedTitle,
      employmentType,
      frequency,
      customFrequencyDays: frequency === 'custom' ? Number(customFrequencyDays) || 14 : undefined,
      averagePay: Math.round(parsedAvgPay * 100) / 100,
      nextPayDate,
      employerName: employerName.trim() || undefined,
      notes: notes.trim() || undefined,
      hourlyPayModeEnabled,
      hourlyRates,
      createdAt: config?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    onSave(payload);
    onClose();
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px',
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(10px)',
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 540,
          maxHeight: '90vh',
          backgroundColor: '#0f172a',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: 20,
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 22px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <Briefcase size={18} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              {config ? 'Configure Income / Pay' : 'Set Up Primary Income'}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              cursor: 'pointer',
              padding: 6,
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSave}
          style={{
            padding: '20px 22px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          {error && (
            <div
              role="alert"
              style={{
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.3)',
                color: '#fca5a5',
                padding: '10px 14px',
                borderRadius: 10,
                fontSize: 13,
              }}
            >
              {error}
            </div>
          )}

          {/* Title & Employer */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Income Source Title *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Main Job, Barista, Contractor"
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Employer / Business (Optional)
              </label>
              <input
                type="text"
                value={employerName}
                onChange={(e) => setEmployerName(e.target.value)}
                placeholder="e.g. Crown, Local Cafe"
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Employment Type & Frequency */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Employment Type
              </label>
              <select
                value={employmentType}
                onChange={(e) => {
                  const val = e.target.value as EmploymentType;
                  setEmploymentType(val);
                  if (val === 'casual_hourly') {
                    setHourlyPayModeEnabled(true);
                  }
                }}
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="casual_hourly">Casual / Hourly</option>
                <option value="part_time">Part-Time</option>
                <option value="full_time">Full-Time (Salaried)</option>
                <option value="freelance">Freelance / Subcontractor</option>
                <option value="other">Other</option>
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Pay Frequency
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as PayFrequency)}
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                <option value="weekly">Weekly</option>
                <option value="fortnightly">Fortnightly (Every 2 weeks)</option>
                <option value="monthly">Monthly</option>
                <option value="custom">Custom interval</option>
              </select>
            </div>
          </div>

          {frequency === 'custom' && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Cycle Length in Days
              </label>
              <input
                type="number"
                min="1"
                value={customFrequencyDays}
                onChange={(e) => setCustomFrequencyDays(Number(e.target.value))}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {/* Average Pay & Next Pay Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Average Pay Per Cycle ($ AUD) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={averagePay}
                onChange={(e) => setAveragePay(e.target.value)}
                placeholder="1150.00"
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: '#10b981',
                  fontWeight: 700,
                  fontSize: 15,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <Calendar size={13} />
                <span>Next Pay Date *</span>
              </label>
              <input
                type="date"
                value={nextPayDate}
                onChange={(e) => setNextPayDate(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Casual / Hourly Pay Configuration Toggle */}
          <div
            style={{
              padding: 14,
              borderRadius: 12,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div>
                <span style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc', display: 'block' }}>
                  Casual & Hourly Pay Rates
                </span>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  Calculate shift earnings based on weekend, evening, or penalty rates
                </span>
              </div>
              <input
                type="checkbox"
                id="toggle-hourly"
                checked={hourlyPayModeEnabled}
                onChange={(e) => setHourlyPayModeEnabled(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: '#6366f1', cursor: 'pointer' }}
              />
            </div>

            {hourlyPayModeEnabled && (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10, marginTop: 4 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                    Base Rate ($/hr)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={baseRate}
                    onChange={(e) => setBaseRate(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      color: '#fff',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                    Saturday ($/hr)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={saturdayRate}
                    onChange={(e) => setSaturdayRate(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      color: '#fff',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                    Sunday ($/hr)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={sundayRate}
                    onChange={(e) => setSundayRate(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      color: '#fff',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                    Public Holiday ($/hr)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={publicHolidayRate}
                    onChange={(e) => setPublicHolidayRate(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      color: '#fff',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                    Evening Rate ($/hr)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={eveningRate}
                    onChange={(e) => setEveningRate(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      color: '#fff',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                    Night Rate ($/hr)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={nightRate}
                    onChange={(e) => setNightRate(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      color: '#fff',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 11, color: '#94a3b8', marginBottom: 4 }}>
                    Overtime ($/hr)
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    value={overtimeRate}
                    onChange={(e) => setOvertimeRate(e.target.value)}
                    style={{
                      width: '100%',
                      background: 'rgba(255,255,255,0.05)',
                      border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: 8,
                      padding: '8px 10px',
                      color: '#fff',
                      fontSize: 13,
                      boxSizing: 'border-box',
                    }}
                  />
                </div>
              </div>
            )}
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Fortnightly payroll, paid alternate Thursdays"
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 10,
                padding: '9px 12px',
                color: '#fff',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <p style={{ fontSize: 11, color: '#64748b', margin: 0, lineHeight: 1.4 }}>
            * Shift calculations provide gross earnings estimates and do not claim to include tax withholdings, superannuation guarantee, or complex award interpretations.
          </p>

          {/* Action Buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              gap: 10,
              marginTop: 10,
              paddingTop: 16,
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: '9px 16px',
                borderRadius: 10,
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'transparent',
                color: '#94a3b8',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              style={{
                padding: '9px 20px',
                borderRadius: 10,
                border: 'none',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                fontWeight: 600,
                fontSize: 13,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
              }}
            >
              Save Income Settings
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
