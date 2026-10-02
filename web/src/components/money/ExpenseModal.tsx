import React, { useState } from 'react';
import {
  X,
  Trash2,
  Calendar,
  Receipt,
  Store,
} from 'lucide-react';
import {
  Expense,
  ExpensePaymentMethod,
  ExpenseRepeat,
  DirectDebitCategory,
} from '../../types/finance';
import { parseLocalDate } from '../../utils/finance';

interface ExpenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  expense?: Expense | null;
  categories: DirectDebitCategory[];
  onSave: (expense: Expense) => void;
  onDelete?: (id: string) => void;
}

const PAYMENT_METHODS: { id: ExpensePaymentMethod; label: string }[] = [
  { id: 'card', label: 'Card' },
  { id: 'cash', label: 'Cash' },
  { id: 'transfer', label: 'Bank Transfer' },
  { id: 'other', label: 'Other' },
];

const REPEAT_OPTIONS: { id: ExpenseRepeat; label: string }[] = [
  { id: 'none', label: 'None' },
  { id: 'per_pay_cycle', label: 'Per pay cycle' },
  { id: 'weekly', label: 'Weekly' },
  { id: 'fortnightly', label: 'Fortnightly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'custom', label: 'Custom' },
];

/**
 * Create / edit / delete for a general expense. The date is optional so an
 * expected amount can be allocated to a pay cycle ("Fuel $70 per pay cycle")
 * without pretending it happens on an exact day. General expenses are never
 * overdue and never require manual completion, unlike a bill.
 */
export const ExpenseModal: React.FC<ExpenseModalProps> = ({
  isOpen,
  onClose,
  expense,
  categories,
  onSave,
  onDelete,
}) => {
  const [title, setTitle] = useState(expense?.title || '');
  const [amount, setAmount] = useState(expense ? String(expense.amount) : '');
  const [date, setDate] = useState(expense?.date || '');
  const [repeat, setRepeat] = useState<ExpenseRepeat>(expense?.repeat || 'none');
  const [interval, setInterval] = useState(expense?.recurrenceConfig?.interval || 1);
  const [customDays, setCustomDays] = useState(expense?.recurrenceConfig?.customDays || 7);
  const [categoryId, setCategoryId] = useState(
    expense?.categoryId || categories[0]?.id || ''
  );
  const [merchant, setMerchant] = useState(expense?.merchant || '');
  const [paymentMethod, setPaymentMethod] = useState<ExpensePaymentMethod | ''>(
    expense?.paymentMethod || ''
  );
  const [reference, setReference] = useState(expense?.reference || '');
  const [notes, setNotes] = useState(expense?.notes || '');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!title.trim()) {
      setError('Please enter a title for this expense');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid amount greater than $0');
      return;
    }

    // The date is intentionally optional. A per-pay-cycle or undated one-off
    // expense is a valid expectation and must never block saving.
    const recurrenceConfig =
      repeat === 'custom'
        ? {
            interval: Math.max(1, Number(interval) || 1),
            customDays: Math.max(1, Number(customDays) || 7),
          }
        : repeat === 'weekly' || repeat === 'monthly'
        ? { interval: Math.max(1, Number(interval) || 1) }
        : undefined;

    const dayOfMonth = date && repeat === 'monthly' ? parseLocalDate(date).getDate() : undefined;

    const now = new Date().toISOString();
    const payload: Expense = {
      id: expense?.id || `exp-${Date.now()}`,
      title: title.trim(),
      amount: Math.round(parsedAmount * 100) / 100,
      date: date || undefined,
      repeat,
      recurrenceConfig: recurrenceConfig
        ? { ...recurrenceConfig, ...(dayOfMonth ? { dayOfMonth } : {}) }
        : dayOfMonth
        ? { dayOfMonth }
        : undefined,
      estimated: repeat !== 'none' || !date,
      categoryId: categoryId || categories[0]?.id || 'bcat-other',
      merchant: merchant.trim() || undefined,
      paymentMethod: paymentMethod || undefined,
      reference: reference.trim() || undefined,
      notes: notes.trim() || undefined,
      createdAt: expense?.createdAt || now,
      updatedAt: now,
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
          maxWidth: 460,
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
                background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <Receipt size={18} />
            </div>
            <div>
              <h2 style={{ fontSize: 17, fontWeight: 700, color: '#f8fafc', margin: 0 }}>
                {expense ? 'Edit Expense' : 'Add Expense'}
              </h2>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                Expected / discretionary spending — no date required
              </span>
            </div>
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
              Title *
            </label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Fuel, Groceries, Parking"
              autoFocus
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

          {/* Amount & Date */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Amount ($ AUD) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '9px 12px',
                  color: '#fb923c',
                  fontWeight: 700,
                  fontSize: 16,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <Calendar size={13} />
                <span>Date (Optional)</span>
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
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Repeat */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              Repeat
            </label>
            <select
              aria-label="Repeat"
              value={repeat}
              onChange={(e) => setRepeat(e.target.value as ExpenseRepeat)}
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
              {REPEAT_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.label}
                </option>
              ))}
            </select>
            <p style={{ fontSize: 11, color: '#64748b', margin: '6px 0 0', lineHeight: 1.45 }}>
              {repeat === 'per_pay_cycle'
                ? 'Allocates this amount to every pay cycle. No calendar date is needed and it can never be overdue.'
                : repeat === 'none'
                ? 'A one-off expense. Leave the date blank to treat it as an expected cost for the current cycle.'
                : 'Expected to repeat on this schedule and counted in each matching pay cycle.'}
            </p>
          </div>

          {repeat === 'custom' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                  Repeat Every (Days)
                </label>
                <input
                  type="number"
                  min="1"
                  value={customDays}
                  onChange={(e) => setCustomDays(Number(e.target.value))}
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
          )}

          {(repeat === 'weekly' || repeat === 'monthly') && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Every N {repeat === 'weekly' ? 'Weeks' : 'Months'}
              </label>
              <input
                type="number"
                min="1"
                value={interval}
                onChange={(e) => setInterval(Number(e.target.value))}
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
          )}

          {/* Category */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              Category
            </label>
            <select
              aria-label="Category"
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
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Merchant & Payment Method */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <Store size={13} />
                <span>Merchant (Optional)</span>
              </label>
              <input
                type="text"
                value={merchant}
                onChange={(e) => setMerchant(e.target.value)}
                placeholder="e.g. Ampol, Coles"
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

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Payment Method (Optional)
              </label>
              <select
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as ExpensePaymentMethod | '')}
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
                <option value="">Not specified</option>
                {PAYMENT_METHODS.map((pm) => (
                  <option key={pm.id} value={pm.id}>
                    {pm.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Reference */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              Reference / Receipt (Optional)
            </label>
            <input
              type="text"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="e.g. Receipt #1234"
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

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              Notes (Optional)
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering about this spend"
              rows={2}
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 10,
                padding: '9px 12px',
                color: '#fff',
                fontSize: 13,
                resize: 'vertical',
                boxSizing: 'border-box',
                fontFamily: 'inherit',
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
            {expense && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Delete this expense?')) {
                    onDelete(expense.id);
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
                  background: 'linear-gradient(135deg, #f97316 0%, #ea580c 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(249, 115, 22, 0.35)',
                }}
              >
                Save Expense
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
