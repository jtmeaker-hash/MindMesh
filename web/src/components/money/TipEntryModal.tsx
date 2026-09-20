import React, { useState } from 'react';
import {
  X,
  Trash2,
  Calendar,
  Coins,
  Clock,
} from 'lucide-react';
import {
  TipEntry,
  TipShiftType,
  Shift,
} from '../../types/finance';
import { formatDateAU } from '../../utils/finance';

interface TipEntryModalProps {
  isOpen: boolean;
  onClose: () => void;
  tip?: TipEntry | null;
  shifts?: Shift[];
  onSave: (tip: TipEntry) => void;
  onDelete?: (id: string) => void;
}

const SHIFT_TYPES: { id: TipShiftType; label: string }[] = [
  { id: 'day', label: 'Day Shift' },
  { id: 'evening', label: 'Evening Shift' },
  { id: 'night', label: 'Night Shift' },
  { id: 'weekend', label: 'Weekend Shift' },
  { id: 'other', label: 'Other' },
];

export const TipEntryModal: React.FC<TipEntryModalProps> = ({
  isOpen,
  onClose,
  tip,
  shifts = [],
  onSave,
  onDelete,
}) => {
  const [date, setDate] = useState(tip?.date || new Date().toISOString().split('T')[0]);
  const [amount, setAmount] = useState(tip ? String(tip.amount) : '');
  const [shiftType, setShiftType] = useState<TipShiftType>(tip?.shiftType || 'evening');
  const [shiftId, setShiftId] = useState(tip?.shiftId || '');
  const [venue, setVenue] = useState(tip?.venue || tip?.locationOrRole || '');
  const [categoryId, setCategoryId] = useState(tip?.categoryId || 'cash');
  const [notes, setNotes] = useState(tip?.notes || '');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleQuickAddAmount = (add: number) => {
    const current = parseFloat(amount) || 0;
    setAmount(String(current + add));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid tip amount greater than $0');
      return;
    }

    if (!date) {
      setError('Date is required');
      return;
    }

    const payload: TipEntry = {
      id: tip?.id || `tip-${Date.now()}`,
      date,
      amount: Math.round(parsedAmount * 100) / 100,
      shiftType,
      shiftId: shiftId.trim() || undefined,
      venue: venue.trim() || undefined,
      locationOrRole: venue.trim() || undefined,
      categoryId: categoryId.trim() || undefined,
      notes: notes.trim() || undefined,
      createdAt: tip?.createdAt || new Date().toISOString(),
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
          maxWidth: 440,
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
                background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <Coins size={18} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              {tip ? 'Edit Tip Entry' : 'Log Tip'}
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

        {/* Quick Amount Selector Bar */}
        <div
          style={{
            padding: '14px 22px',
            background: 'rgba(245, 158, 11, 0.08)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: '#fbbf24' }}>
            Fast Add:
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {[5, 10, 20, 50].map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => handleQuickAddAmount(val)}
                style={{
                  padding: '5px 10px',
                  borderRadius: 8,
                  border: '1px solid rgba(245, 158, 11, 0.3)',
                  background: 'rgba(245, 158, 11, 0.15)',
                  color: '#fef08a',
                  fontWeight: 700,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                +${val}
              </button>
            ))}
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

          {/* Amount & Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Tip Amount ($ AUD) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  color: '#fbbf24',
                  fontWeight: 700,
                  fontSize: 16,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <Calendar size={13} />
                <span>Date *</span>
              </label>
              <input
                type="date"
                required
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
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Link to Shift if shifts exist */}
          {shifts.length > 0 && (
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <Clock size={13} />
                <span>Link to Shift (Optional)</span>
              </label>
              <select
                value={shiftId}
                onChange={(e) => setShiftId(e.target.value)}
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  color: '#fff',
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              >
                <option value="">None (Unlinked)</option>
                {shifts.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDateAU(s.date)}: {s.startTime}–{s.endTime} ({s.rateType})
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Shift Type & Venue */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Shift Type
              </label>
              <select
                value={shiftType}
                onChange={(e) => setShiftType(e.target.value as TipShiftType)}
                style={{
                  width: '100%',
                  background: '#1e293b',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  color: '#fff',
                  fontSize: 13,
                  boxSizing: 'border-box',
                }}
              >
                {SHIFT_TYPES.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Venue / Role (Optional)
              </label>
              <input
                type="text"
                value={venue}
                onChange={(e) => setVenue(e.target.value)}
                placeholder="e.g. Bar, Bistro, Crown"
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
          </div>

          {/* Category */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              Tip Category (Optional)
            </label>
            <select
              value={categoryId}
              onChange={(e) => setCategoryId(e.target.value)}
              style={{
                width: '100%',
                background: '#1e293b',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 10,
                padding: '9px 12px',
                color: '#fff',
                fontSize: 13,
                boxSizing: 'border-box',
              }}
            >
              <option value="cash">Cash Tip</option>
              <option value="card">Card / EFTPOS Tip</option>
              <option value="pooled">Pooled / Shared Tip</option>
              <option value="direct">Direct Customer Tip</option>
              <option value="other">Other</option>
            </select>
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              Notes (Optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Big table on patio, pool split"
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

          {/* Actions */}
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
            {tip && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Delete this tip entry?')) {
                    onDelete(tip.id);
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
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(245, 158, 11, 0.35)',
                }}
              >
                Save Tip
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
