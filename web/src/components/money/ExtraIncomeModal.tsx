import React, { useState } from 'react';
import {
  X,
  Trash2,
  Calendar,
  Tag,
  FileText,
  Sparkles,
  Link as LinkIcon,
  Calculator,
} from 'lucide-react';
import {
  ExtraIncome,
  ExtraIncomeCategory,
  IncomeConfig,
} from '../../types/finance';
import { Reminder } from '../../types';
import { formatCurrency } from '../../utils/finance';

interface ExtraIncomeModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: ExtraIncomeCategory[];
  reminders?: Reminder[];
  incomeConfig?: IncomeConfig | null;
  extraIncome?: ExtraIncome | null;
  onSave: (entry: ExtraIncome) => void;
  onDelete?: (id: string) => void;
}

export const ExtraIncomeModal: React.FC<ExtraIncomeModalProps> = ({
  isOpen,
  onClose,
  categories,
  reminders = [],
  incomeConfig,
  extraIncome,
  onSave,
  onDelete,
}) => {
  const [title, setTitle] = useState(extraIncome?.title || '');
  const [amount, setAmount] = useState(extraIncome ? String(extraIncome.amount) : '');
  const [categoryId, setCategoryId] = useState(
    extraIncome?.categoryId || categories[0]?.id || ''
  );
  const [date, setDate] = useState(
    extraIncome?.date || new Date().toISOString().split('T')[0]
  );
  const [received, setReceived] = useState(extraIncome ? extraIncome.received : true);
  const [includeInCurrentPayCycle, setIncludeInCurrentPayCycle] = useState(
    extraIncome?.includeInCurrentPayCycle ?? true
  );
  const [linkedReminderId, setLinkedReminderId] = useState(
    extraIncome?.linkedReminderId || ''
  );
  const [notes, setNotes] = useState(extraIncome?.notes || '');
  const [showShiftCalcHelper, setShowShiftCalcHelper] = useState(false);
  const [shiftHours, setShiftHours] = useState('6');
  const [shiftRate, setShiftRate] = useState(
    incomeConfig?.hourlyRates?.baseRate ? String(incomeConfig.hourlyRates.baseRate) : '32'
  );
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleApplyShiftCalc = () => {
    const hours = parseFloat(shiftHours) || 0;
    const rate = parseFloat(shiftRate) || 0;
    if (hours > 0 && rate > 0) {
      const computed = Math.round(hours * rate * 100) / 100;
      setAmount(String(computed));
      setShowShiftCalcHelper(false);
      if (!title) {
        setTitle(`Extra shift (${hours}h @ $${rate}/hr)`);
      }
    }
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title / Description is required');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount greater than $0');
      return;
    }

    if (!date) {
      setError('Date is required');
      return;
    }

    const payload: ExtraIncome = {
      id: extraIncome?.id || `extra-${Date.now()}`,
      title: trimmedTitle,
      amount: Math.round(parsedAmount * 100) / 100,
      categoryId,
      date,
      received,
      includeInCurrentPayCycle,
      linkedReminderId: linkedReminderId.trim() || undefined,
      notes: notes.trim() || undefined,
      createdAt: extraIncome?.createdAt || new Date().toISOString(),
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
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <Sparkles size={18} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              {extraIncome ? 'Edit Extra Income' : 'Record Extra Income'}
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

          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              Title / Description *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Lawn mowing, Sold old iPhone, Freelance design"
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

          {/* Amount & Shift Calculator trigger */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
                Amount ($ AUD) *
              </label>
              <button
                type="button"
                onClick={() => setShowShiftCalcHelper(!showShiftCalcHelper)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#38bdf8',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Calculator size={13} />
                <span>{showShiftCalcHelper ? 'Hide Calculator' : 'Calculate from shift'}</span>
              </button>
            </div>
            <input
              type="number"
              step="0.01"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0.00"
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 10,
                padding: '10px 12px',
                color: '#34d399',
                fontSize: 16,
                fontWeight: 700,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            />

            {/* Inline Shift Calc helper */}
            {showShiftCalcHelper && (
              <div
                style={{
                  marginTop: 8,
                  padding: 12,
                  borderRadius: 12,
                  background: 'rgba(59, 130, 246, 0.1)',
                  border: '1px solid rgba(59, 130, 246, 0.25)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 11, fontWeight: 600, color: '#93c5fd' }}>
                  Shift Earnings Estimator
                </span>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 2 }}>Hours</label>
                    <input
                      type="number"
                      step="0.5"
                      value={shiftHours}
                      onChange={(e) => setShiftHours(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: '#1e293b',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#fff',
                        fontSize: 12,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 10, color: '#94a3b8', display: 'block', marginBottom: 2 }}>Rate ($/hr)</label>
                    <input
                      type="number"
                      step="0.5"
                      value={shiftRate}
                      onChange={(e) => setShiftRate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 8px',
                        borderRadius: 6,
                        background: '#1e293b',
                        border: '1px solid rgba(255,255,255,0.1)',
                        color: '#fff',
                        fontSize: 12,
                        boxSizing: 'border-box',
                      }}
                    />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleApplyShiftCalc}
                  style={{
                    padding: '6px 10px',
                    borderRadius: 8,
                    background: '#2563eb',
                    border: 'none',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Set Amount ({formatCurrency((parseFloat(shiftHours) || 0) * (parseFloat(shiftRate) || 0))})
                </button>
              </div>
            )}
          </div>

          {/* Category & Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <Tag size={13} />
                <span>Category *</span>
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
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Status
              </label>
              <button
                type="button"
                onClick={() => setReceived(!received)}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 10,
                  border: received ? '1px solid #10b981' : '1px solid #f59e0b',
                  background: received ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                  color: received ? '#34d399' : '#fbbf24',
                  fontWeight: 600,
                  fontSize: 12,
                  cursor: 'pointer',
                }}
              >
                {received ? 'Received' : 'Pending'}
              </button>
            </div>
          </div>

          {/* Date */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              <Calendar size={13} />
              <span>Date Received / Expected</span>
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

          {/* Include in Pay Cycle Checkbox */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid rgba(255, 255, 255, 0.06)',
            }}
          >
            <input
              type="checkbox"
              id="include-cycle"
              checked={includeInCurrentPayCycle}
              onChange={(e) => setIncludeInCurrentPayCycle(e.target.checked)}
              style={{ width: 16, height: 16, accentColor: '#10b981', cursor: 'pointer' }}
            />
            <label htmlFor="include-cycle" style={{ fontSize: 13, color: '#cbd5e1', cursor: 'pointer' }}>
              Include in current pay cycle safe spend calculations
            </label>
          </div>

          {/* Optional Linked Reminder */}
          {reminders.length > 0 && (
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <LinkIcon size={13} />
                <span>Link to MindMesh Reminder (Optional)</span>
              </label>
              <select
                value={linkedReminderId}
                onChange={(e) => setLinkedReminderId(e.target.value)}
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
                {reminders.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.title}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Notes */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              <FileText size={13} />
              <span>Notes (Optional)</span>
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cash in envelope, invoice #104"
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 10,
                padding: '9px 12px',
                color: '#fff',
                fontSize: 13,
                resize: 'none',
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
            {extraIncome && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Delete this entry?')) {
                    onDelete(extraIncome.id);
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
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.35)',
                }}
              >
                Save Income
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
