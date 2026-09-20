import React, { useState, useEffect } from 'react';
import {
  X,
  Trash2,
  Calendar,
  Clock,
  Calculator,
} from 'lucide-react';
import {
  Shift,
  ShiftRateType,
  IncomeConfig,
} from '../../types/finance';
import {
  calculateShiftEstimate,
  resolveHourlyRate,
  formatCurrency,
} from '../../utils/finance';

interface ShiftCalculatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  incomeConfig: IncomeConfig | null;
  shift?: Shift | null;
  onSave: (shift: Shift) => void;
  onDelete?: (shiftId: string) => void;
}

const RATE_OPTIONS: { id: ShiftRateType; label: string }[] = [
  { id: 'base', label: 'Base Weekday' },
  { id: 'saturday', label: 'Saturday' },
  { id: 'sunday', label: 'Sunday' },
  { id: 'public_holiday', label: 'Public Holiday' },
  { id: 'evening', label: 'Evening' },
  { id: 'night', label: 'Night' },
  { id: 'overtime', label: 'Overtime' },
  { id: 'custom', label: 'Custom Flat Rate' },
];

export const ShiftCalculatorModal: React.FC<ShiftCalculatorModalProps> = ({
  isOpen,
  onClose,
  incomeConfig,
  shift,
  onSave,
  onDelete,
}) => {
  const [date, setDate] = useState(shift?.date || new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState(shift?.startTime || '16:00');
  const [endTime, setEndTime] = useState(shift?.endTime || '23:30');
  const [breakMinutes, setBreakMinutes] = useState(shift ? shift.breakMinutes : 30);
  const [rateType, setRateType] = useState<ShiftRateType>(shift?.rateType || 'saturday');
  const [customRate, setCustomRate] = useState(shift?.customRate ? String(shift.customRate) : '');
  const [notes, setNotes] = useState(shift?.notes || '');
  const [error, setError] = useState('');

  // Auto-select rateType if date is weekend when creating new shift
  useEffect(() => {
    if (!shift && date) {
      const [y, m, d] = date.split('-').map(Number);
      const dayOfWeek = new Date(y, (m || 1) - 1, d || 1).getDay();
      if (dayOfWeek === 6) setRateType('saturday');
      else if (dayOfWeek === 0) setRateType('sunday');
    }
  }, [date, shift]);

  if (!isOpen) return null;

  const effectiveHourlyRate = resolveHourlyRate(
    incomeConfig,
    rateType,
    customRate ? parseFloat(customRate) : undefined
  );

  const { paidHours, estimatedPay } = calculateShiftEstimate({
    startTime,
    endTime,
    breakMinutes,
    rateType,
    customRate: customRate ? parseFloat(customRate) : undefined,
    hourlyRate: effectiveHourlyRate,
  });

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!date) {
      setError('Shift date is required');
      return;
    }

    if (paidHours <= 0) {
      setError('Shift duration must be greater than zero after unpaid breaks');
      return;
    }

    const payload: Shift = {
      id: shift?.id || `shift-${Date.now()}`,
      date,
      startTime,
      endTime,
      breakMinutes: Number(breakMinutes) || 0,
      rateType,
      customRate: customRate ? parseFloat(customRate) : undefined,
      hourlyRate: effectiveHourlyRate,
      paidHours,
      estimatedPay,
      notes: notes.trim() || undefined,
      createdAt: shift?.createdAt || new Date().toISOString(),
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
        zIndex: 110,
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
          maxWidth: 480,
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
                background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <Calculator size={18} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              {shift ? 'Edit Shift' : 'Casual Shift Calculator'}
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

        {/* Live Calculation Preview Banner */}
        <div
          style={{
            padding: '16px 22px',
            background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div>
            <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', color: '#93c5fd', letterSpacing: '0.05em' }}>
              Estimated Shift Earnings
            </span>
            <div style={{ fontSize: 24, fontWeight: 800, color: '#60a5fa' }}>
              {formatCurrency(estimatedPay)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#cbd5e1', display: 'block' }}>
              {paidHours} paid hours
            </span>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              @{formatCurrency(effectiveHourlyRate)}/hr
            </span>
          </div>
        </div>

        {/* Form Body */}
        <form
          onSubmit={handleSave}
          style={{
            padding: '20px 22px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
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

          {/* Date & Rate Type */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <Calendar size={13} />
                <span>Shift Date</span>
              </label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
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

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Rate Type
              </label>
              <select
                value={rateType}
                onChange={(e) => setRateType(e.target.value as ShiftRateType)}
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  color: '#fff',
                  fontSize: 13,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              >
                {RATE_OPTIONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Times & Break */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                <Clock size={12} />
                <span>Start</span>
              </label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  color: '#fff',
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                <Clock size={12} />
                <span>Finish</span>
              </label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  color: '#fff',
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: '#94a3b8', marginBottom: 5 }}>
                Unpaid Break
              </label>
              <select
                value={breakMinutes}
                onChange={(e) => setBreakMinutes(Number(e.target.value))}
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 8,
                  padding: '8px 6px',
                  color: '#fff',
                  fontSize: 12,
                  boxSizing: 'border-box',
                }}
              >
                <option value={0}>0 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
                <option value={45}>45 min</option>
                <option value={60}>1 hour</option>
              </select>
            </div>
          </div>

          {/* Custom Hourly Rate override */}
          {rateType === 'custom' && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Custom Hourly Rate ($/hr) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={customRate}
                onChange={(e) => setCustomRate(e.target.value)}
                placeholder="e.g. 42.50"
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  color: '#fff',
                  fontSize: 14,
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Closing shift, busy evening service"
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 10,
                padding: '9px 12px',
                color: '#fff',
                fontSize: 13,
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Action Buttons */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 10,
              paddingTop: 16,
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            {shift && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Delete shift?')) {
                    onDelete(shift.id);
                    onClose();
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '9px 14px',
                  borderRadius: 10,
                  border: 'none',
                  background: 'rgba(239, 68, 68, 0.15)',
                  color: '#f87171',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                <Trash2 size={15} />
                <span>Delete</span>
              </button>
            ) : (
              <div />
            )}

            <div style={{ display: 'flex', gap: 10 }}>
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
                  background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(59, 130, 246, 0.35)',
                }}
              >
                Save Shift
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
