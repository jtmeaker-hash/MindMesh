import React, { useState } from 'react';
import {
  X,
  Trash2,
  Bell,
  Calendar,
  DollarSign,
  Repeat,
  FileText,
  Link as LinkIcon,
  Tag,
} from 'lucide-react';
import {
  DirectDebit,
  DirectDebitCategory,
  BillFrequency,
  NotificationSetting,
  NotificationOffsetType,
} from '../../types/finance';
import { Reminder } from '../../types';

interface DirectDebitModalProps {
  isOpen: boolean;
  onClose: () => void;
  debit?: DirectDebit | null;
  categories: DirectDebitCategory[];
  reminders: Reminder[];
  onSave: (debit: DirectDebit) => void;
  onDelete?: (debitId: string) => void;
}

const FREQUENCY_OPTIONS: { id: BillFrequency; label: string }[] = [
  { id: 'weekly', label: 'Weekly' },
  { id: 'fortnightly', label: 'Fortnightly' },
  { id: 'monthly', label: 'Monthly' },
  { id: 'quarterly', label: 'Quarterly' },
  { id: 'every_x_days', label: 'Every X Days' },
  { id: 'every_x_weeks', label: 'Every X Weeks' },
  { id: 'every_x_months', label: 'Every X Months' },
  { id: 'annually', label: 'Annually' },
  { id: 'custom', label: 'Custom' },
];

const NOTIF_OPTIONS: { id: NotificationOffsetType; label: string }[] = [
  { id: 'on_day', label: 'On the day' },
  { id: '1_day_before', label: '1 day before' },
  { id: '2_days_before', label: '2 days before' },
  { id: '3_days_before', label: '3 days before' },
  { id: '1_week_before', label: '1 week before' },
  { id: 'custom_days_before', label: 'Custom days before' },
  { id: 'custom_hours_before', label: 'Custom hours before' },
];

export const DirectDebitModal: React.FC<DirectDebitModalProps> = ({
  isOpen,
  onClose,
  debit,
  categories,
  reminders,
  onSave,
  onDelete,
}) => {
  const [title, setTitle] = useState(debit?.title || '');
  const [amount, setAmount] = useState(debit ? String(debit.amount) : '');
  const [categoryId, setCategoryId] = useState(debit?.categoryId || categories[0]?.id || '');
  const [frequency, setFrequency] = useState<BillFrequency>(debit?.frequency || 'monthly');
  const [customDays, setCustomDays] = useState(debit?.recurrenceConfig?.customDays || 14);
  const [interval, setInterval] = useState(debit?.recurrenceConfig?.interval || 1);
  const [nextPaymentDate, setNextPaymentDate] = useState(
    debit?.nextPaymentDate || new Date().toISOString().split('T')[0]
  );
  const [endDate, setEndDate] = useState(debit?.endDate || '');
  const [notes, setNotes] = useState(debit?.notes || '');
  const [active, setActive] = useState(debit ? debit.active : true);
  const [linkedReminderId, setLinkedReminderId] = useState(debit?.linkedReminderId || '');
  const [notifications, setNotifications] = useState<NotificationSetting[]>(
    debit?.notificationSettings || [{ id: 'notif-1', type: '1_day_before', enabled: true }]
  );
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleToggleNotifType = (type: NotificationOffsetType) => {
    setNotifications((prev) => {
      const exists = prev.find((n) => n.type === type);
      if (exists) {
        return prev.filter((n) => n.type !== type);
      }
      return [...prev, { id: `notif-${Date.now()}-${type}`, type, enabled: true }];
    });
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('Title is required');
      return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      setError('Please enter a valid bill amount greater than $0');
      return;
    }

    if (!nextPaymentDate) {
      setError('Next payment date is required');
      return;
    }

    const payload: DirectDebit = {
      id: debit?.id || `debit-${Date.now()}`,
      title: trimmedTitle,
      amount: Math.round(parsedAmount * 100) / 100,
      categoryId,
      frequency,
      recurrenceConfig: {
        interval: Number(interval) || 1,
        customDays: Number(customDays) || 14,
      },
      nextPaymentDate,
      endDate: endDate.trim() || undefined,
      notes: notes.trim() || undefined,
      active,
      notificationSettings: notifications,
      linkedReminderId: linkedReminderId.trim() || undefined,
      createdAt: debit?.createdAt || new Date().toISOString(),
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
          maxWidth: 520,
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
                background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
              }}
            >
              <DollarSign size={18} />
            </div>
            <h2 style={{ fontSize: 17, fontWeight: 700, color: '#f8fafc', margin: 0 }}>
              {debit ? 'Edit Direct Debit' : 'New Direct Debit / Bill'}
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

          {/* Title & Amount */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 12 }}>
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Bill Name *
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Netflix, Car Insurance, Rent"
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
                Amount ($ AUD) *
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: 14,
                  fontWeight: 600,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          </div>

          {/* Category & Status */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px', gap: 12 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <Tag size={13} />
                <span>Category</span>
              </label>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
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
                onClick={() => setActive(!active)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 10,
                  border: active ? '1px solid #10b981' : '1px solid #64748b',
                  background: active ? 'rgba(16, 185, 129, 0.15)' : 'rgba(100, 116, 139, 0.15)',
                  color: active ? '#34d399' : '#94a3b8',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                }}
              >
                {active ? 'Active' : 'Paused'}
              </button>
            </div>
          </div>

          {/* Frequency & Dates */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12 }}>
            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <Repeat size={13} />
                <span>Frequency</span>
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as BillFrequency)}
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
                {FREQUENCY_OPTIONS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                <Calendar size={13} />
                <span>Next Payment *</span>
              </label>
              <input
                type="date"
                value={nextPaymentDate}
                onChange={(e) => setNextPaymentDate(e.target.value)}
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

          {/* Custom Frequency Sub-fields */}
          {(frequency === 'every_x_days' || frequency === 'custom') && (
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
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {(frequency === 'every_x_weeks' || frequency === 'every_x_months') && (
            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                Interval Number
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
                  padding: '10px 12px',
                  color: '#fff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            </div>
          )}

          {/* Optional End Date */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              Optional End Date
            </label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
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

          {/* Linked MindMesh Reminder */}
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
                padding: '10px 12px',
                color: '#fff',
                fontSize: 13,
                outline: 'none',
                boxSizing: 'border-box',
              }}
            >
              <option value="">-- No Linked Reminder --</option>
              {reminders.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.title} {r.completed ? '(Completed)' : ''}
                </option>
              ))}
            </select>
          </div>

          {/* Notifications config */}
          <div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 8 }}>
              <Bell size={13} />
              <span>Upcoming Bill Notifications</span>
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {NOTIF_OPTIONS.map((opt) => {
                const isSelected = notifications.some((n) => n.type === opt.id);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => handleToggleNotifType(opt.id)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: 8,
                      fontSize: 12,
                      fontWeight: isSelected ? 600 : 500,
                      border: isSelected ? '1px solid #6366f1' : '1px solid rgba(255, 255, 255, 0.1)',
                      background: isSelected ? 'rgba(99, 102, 241, 0.2)' : 'rgba(255, 255, 255, 0.04)',
                      color: isSelected ? '#a5b4fc' : '#94a3b8',
                      cursor: 'pointer',
                    }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

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
              placeholder="e.g. Account number, contract reference, direct debit mandate"
              style={{
                width: '100%',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 10,
                padding: '10px 12px',
                color: '#fff',
                fontSize: 13,
                outline: 'none',
                resize: 'none',
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
            {debit && onDelete ? (
              <button
                type="button"
                onClick={() => {
                  if (confirm(`Delete direct debit "${debit.title}"?`)) {
                    onDelete(debit.id);
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
                  background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
                  color: '#ffffff',
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(99, 102, 241, 0.35)',
                }}
              >
                Save Bill
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
