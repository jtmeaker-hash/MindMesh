import React, { useState, useEffect } from 'react';
import {
  X,
  Trash2,
  CheckCircle2,
  RotateCcw,
  Plus,
  Repeat,
} from 'lucide-react';
import { Reminder, Category, Priority, Subtask, RecurrenceRule, RecurrenceFrequency, CustomRecurrenceUnit } from '../../types';
import { formatRecurrenceLabel } from '../../services/recurrence';

const WEEKDAYS = [
  { label: 'S', day: 0, title: 'Sunday' },
  { label: 'M', day: 1, title: 'Monday' },
  { label: 'T', day: 2, title: 'Tuesday' },
  { label: 'W', day: 3, title: 'Wednesday' },
  { label: 'T', day: 4, title: 'Thursday' },
  { label: 'F', day: 5, title: 'Friday' },
  { label: 'S', day: 6, title: 'Saturday' },
];

interface ReminderModalProps {
  isOpen: boolean;
  onClose: () => void;
  reminder?: Reminder | null;
  categories: Category[];
  defaultCategoryId?: string;
  onSave: (reminder: Reminder) => void;
  onDelete?: (reminderId: string) => void;
  onToggleComplete?: (reminderId: string) => void;
}

export const ReminderModal: React.FC<ReminderModalProps> = ({
  isOpen,
  onClose,
  reminder,
  categories,
  defaultCategoryId,
  onSave,
  onDelete,
  onToggleComplete,
}) => {
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [dueTime, setDueTime] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [subtasks, setSubtasks] = useState<Subtask[]>([]);
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('');

  // Recurrence state
  const [recurrenceFreq, setRecurrenceFreq] = useState<RecurrenceFrequency>('none');
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(1);
  const [recurrenceUnit, setRecurrenceUnit] = useState<CustomRecurrenceUnit>('week');
  const [recurrenceDays, setRecurrenceDays] = useState<number[]>([]);
  const [endCondition, setEndCondition] = useState<'never' | 'after' | 'until'>('never');
  const [endAfter, setEndAfter] = useState<number>(10);
  const [endUntilDate, setEndUntilDate] = useState<string>('');

  useEffect(() => {
    if (reminder) {
      setTitle(reminder.title);
      setNotes(reminder.notes || '');
      setCategoryId(reminder.categoryId);
      setDueDate(reminder.dueDate || '');
      setDueTime(reminder.dueTime || '');
      setPriority(reminder.priority);
      setSubtasks(reminder.subtasks ? [...reminder.subtasks] : []);

      // Load recurrence
      if (reminder.recurrence) {
        setRecurrenceFreq(reminder.recurrence.frequency || 'none');
        setRecurrenceInterval(reminder.recurrence.interval || 1);
        setRecurrenceUnit(reminder.recurrence.unit || 'week');
        setRecurrenceDays(reminder.recurrence.daysOfWeek || []);
        if (reminder.recurrence.endAfterOccurrences) {
          setEndCondition('after');
          setEndAfter(reminder.recurrence.endAfterOccurrences);
        } else if (reminder.recurrence.endDate) {
          setEndCondition('until');
          setEndUntilDate(reminder.recurrence.endDate);
        } else {
          setEndCondition('never');
        }
      } else {
        setRecurrenceFreq('none');
        setRecurrenceInterval(1);
        setRecurrenceUnit('week');
        setRecurrenceDays([]);
        setEndCondition('never');
      }
    } else {
      setTitle('');
      setNotes('');
      setCategoryId(defaultCategoryId || (categories[0]?.id ?? ''));
      setDueDate('');
      setDueTime('');
      setPriority('medium');
      setSubtasks([]);
      setRecurrenceFreq('none');
      setRecurrenceInterval(1);
      setRecurrenceUnit('week');
      setRecurrenceDays([]);
      setEndCondition('never');
    }
    setNewSubtaskTitle('');
  }, [reminder, defaultCategoryId, categories, isOpen]);

  if (!isOpen) return null;

  const toggleDayOfWeek = (day: number) => {
    setRecurrenceDays((prev) =>
      prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
    );
  };

  const handleAddSubtask = () => {
    const trimmed = newSubtaskTitle.trim();
    if (!trimmed) return;
    const newStep: Subtask = {
      id: `sub-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      reminderId: reminder?.id || '',
      title: trimmed,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    setSubtasks((prev) => [...prev, newStep]);
    setNewSubtaskTitle('');
  };

  const handleToggleSubtask = (id: string) => {
    setSubtasks((prev) =>
      prev.map((s) =>
        s.id === id
          ? {
              ...s,
              completed: !s.completed,
              completedAt: !s.completed ? new Date().toISOString() : undefined,
            }
          : s
      )
    );
  };

  const handleRemoveSubtask = (id: string) => {
    setSubtasks((prev) => prev.filter((s) => s.id !== id));
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !categoryId) return;

    let recurrenceRule: RecurrenceRule | undefined = undefined;
    if (recurrenceFreq !== 'none') {
      recurrenceRule = {
        frequency: recurrenceFreq,
        interval: Math.max(1, recurrenceInterval || 1),
        unit: recurrenceFreq === 'custom' ? recurrenceUnit : undefined,
        daysOfWeek:
          recurrenceFreq === 'weekly' || (recurrenceFreq === 'custom' && recurrenceUnit === 'week')
            ? recurrenceDays
            : undefined,
        endAfterOccurrences: endCondition === 'after' ? endAfter : undefined,
        endDate: endCondition === 'until' ? endUntilDate || undefined : undefined,
      };
    }

    const savedReminder: Reminder = {
      id: reminder?.id || `rem-${Date.now()}-${Math.random().toString(36).substr(2, 4)}`,
      categoryId,
      title: title.trim(),
      notes: notes.trim() || undefined,
      dueDate: dueDate || undefined,
      dueTime: dueTime || undefined,
      priority,
      completed: reminder ? reminder.completed : false,
      createdAt: reminder ? reminder.createdAt : new Date().toISOString(),
      completedAt: reminder?.completedAt,
      recurrence: recurrenceRule,
      recurringSeriesId: reminder?.recurringSeriesId,
      occurrenceCount: reminder?.occurrenceCount,
      subtasks: subtasks.map((s) => ({
        ...s,
        reminderId: reminder?.id || s.reminderId,
      })),
    };

    onSave(savedReminder);
    onClose();
  };

  const selectedCategory = categories.find((c) => c.id === categoryId);

  const previewRecurrence: RecurrenceRule = {
    frequency: recurrenceFreq,
    interval: recurrenceInterval,
    unit: recurrenceUnit,
    daysOfWeek: recurrenceDays,
  };


  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.75)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'flex-end',
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={onClose}
    >
      <div
        style={{
          backgroundColor: '#0F172A',
          borderTop: '1px solid rgba(255, 255, 255, 0.12)',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          padding: '20px 20px 32px 20px',
          maxHeight: '88vh',
          overflowY: 'auto',
          boxShadow: '0 -10px 40px rgba(0,0,0,0.8)',
          width: '100%',
          maxWidth: 580,
          margin: '0 auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab bar */}
        <div
          style={{
            width: 40,
            height: 4,
            borderRadius: 2,
            backgroundColor: '#334155',
            margin: '0 auto 16px auto',
          }}
        />

        {/* Modal Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 18,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                backgroundColor: selectedCategory?.color || '#3b82f6',
                boxShadow: `0 0 10px ${selectedCategory?.color || '#3b82f6'}`,
              }}
            />
            <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F8FAFC' }}>
              {reminder ? (reminder.completed ? 'Completed Reminder' : 'Edit Reminder') : 'New Reminder'}
            </h2>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {reminder && onToggleComplete && (
              <button
                type="button"
                onClick={() => {
                  onToggleComplete(reminder.id);
                  onClose();
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 10,
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: 'none',
                  backgroundColor: reminder.completed ? '#1e293b' : '#10b981',
                  color: '#ffffff',
                }}
              >
                {reminder.completed ? (
                  <>
                    <RotateCcw size={14} /> Reactivate
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} /> Complete
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'rgba(255,255,255,0.06)',
                border: 'none',
                borderRadius: '50%',
                width: 32,
                height: 32,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#94a3b8',
                cursor: 'pointer',
              }}
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Informational History & Series Badges */}
        {reminder && (reminder.completed || reminder.recurrence?.frequency !== 'none' || reminder.occurrenceCount) && (
          <div
            style={{
              padding: '10px 14px',
              borderRadius: 12,
              backgroundColor: reminder.completed ? 'rgba(16, 185, 129, 0.1)' : 'rgba(99, 102, 241, 0.1)',
              border: `1px solid ${reminder.completed ? 'rgba(16, 185, 129, 0.25)' : 'rgba(99, 102, 241, 0.25)'}`,
              marginBottom: 16,
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              fontSize: 12,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span
                style={{
                  fontWeight: 700,
                  color: reminder.completed ? '#34d399' : '#818cf8',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {reminder.completed ? <CheckCircle2 size={14} /> : <Repeat size={14} />}
                {reminder.completed
                  ? 'Completed Task Record'
                  : `Recurring Task${reminder.occurrenceCount ? ` • Occurrence #${reminder.occurrenceCount}` : ''}`}
              </span>
              {reminder.recurrence && reminder.recurrence.frequency !== 'none' && (
                <span style={{ color: '#cbd5e1', fontSize: 11, fontWeight: 600 }}>
                  {formatRecurrenceLabel(reminder.recurrence)}
                </span>
              )}
            </div>

            {reminder.completedAt && (
              <div style={{ color: '#94a3b8', fontSize: 11 }}>
                Completed on {new Date(reminder.completedAt).toLocaleString()}
                {reminder.dueDate ? ` (Target due date: ${reminder.dueDate})` : ''}
              </div>
            )}
          </div>
        )}

        <form onSubmit={handleSave} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Title */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              TASK TITLE *
            </label>
            <input
              type="text"
              required
              placeholder="e.g., Book mechanic service"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              style={{
                width: '100%',
                padding: '12px 14px',
                borderRadius: 12,
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                color: '#F8FAFC',
                fontSize: 15,
                fontWeight: 600,
                outline: 'none',
              }}
            />
          </div>

          {/* Category Chips */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              CATEGORY *
            </label>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {categories.map((cat) => {
                const isSelected = cat.id === categoryId;
                return (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(cat.id)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '7px 14px',
                      borderRadius: 12,
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                      border: isSelected ? `2px solid ${cat.color}` : '1px solid #334155',
                      backgroundColor: isSelected ? `${cat.color}22` : '#1E293B',
                      color: isSelected ? '#FFFFFF' : '#94A3B8',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        backgroundColor: cat.color,
                      }}
                    />
                    {cat.name}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Priority */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              PRIORITY
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              {(['low', 'medium', 'high'] as Priority[]).map((p) => {
                const isSelected = priority === p;
                const pColor = p === 'high' ? '#ef4444' : p === 'medium' ? '#f59e0b' : '#10b981';
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPriority(p)}
                    style={{
                      flex: 1,
                      padding: '8px 10px',
                      borderRadius: 10,
                      fontSize: 13,
                      fontWeight: 600,
                      textTransform: 'capitalize',
                      cursor: 'pointer',
                      border: isSelected ? `2px solid ${pColor}` : '1px solid #334155',
                      backgroundColor: isSelected ? `${pColor}22` : '#1E293B',
                      color: isSelected ? '#FFFFFF' : '#94A3B8',
                    }}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Date & Time */}
          <div style={{ display: 'flex', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                DUE DATE
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#F8FAFC',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
                TIME
              </label>
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#F8FAFC',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
            </div>
          </div>

          {/* Recurrence Settings */}
          <div
            style={{
              padding: '12px',
              borderRadius: 14,
              backgroundColor: 'rgba(30, 41, 59, 0.6)',
              border: '1px solid #334155',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: 8,
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#94a3b8',
                }}
              >
                <Repeat size={13} color="#818cf8" />
                REPEAT SCHEDULE
              </label>

              <span style={{ fontSize: 11, color: recurrenceFreq === 'none' ? '#64748b' : '#818cf8', fontWeight: 600 }}>
                {formatRecurrenceLabel(previewRecurrence)}
              </span>
            </div>

            {/* Recurrence Frequency Buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 6, marginBottom: 10 }}>
              {(['none', 'daily', 'weekly', 'monthly', 'custom'] as RecurrenceFrequency[]).map((f) => {
                const isSelected = recurrenceFreq === f;
                return (
                  <button
                    key={f}
                    type="button"
                    onClick={() => setRecurrenceFreq(f)}
                    style={{
                      padding: '7px 4px',
                      borderRadius: 8,
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: 'capitalize',
                      cursor: 'pointer',
                      border: isSelected ? '1.5px solid #6366F1' : '1px solid #334155',
                      backgroundColor: isSelected ? 'rgba(99, 102, 241, 0.25)' : '#0F172A',
                      color: isSelected ? '#FFFFFF' : '#94A3B8',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {f === 'none' ? 'None' : f}
                  </button>
                );
              })}
            </div>

            {/* Weekly Days of Week Picker */}
            {(recurrenceFreq === 'weekly' || (recurrenceFreq === 'custom' && recurrenceUnit === 'week')) && (
              <div style={{ marginTop: 8, marginBottom: 8 }}>
                <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 6 }}>Repeat on days:</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  {WEEKDAYS.map((w) => {
                    const isSelected = recurrenceDays.includes(w.day);
                    return (
                      <button
                        key={w.day}
                        type="button"
                        title={w.title}
                        onClick={() => toggleDayOfWeek(w.day)}
                        style={{
                          flex: 1,
                          height: 32,
                          borderRadius: 8,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                          border: isSelected ? '1.5px solid #6366F1' : '1px solid #334155',
                          backgroundColor: isSelected ? '#6366F1' : '#0F172A',
                          color: isSelected ? '#FFFFFF' : '#94A3B8',
                          transition: 'all 0.15s ease',
                        }}
                      >
                        {w.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Custom Interval & Unit */}
            {recurrenceFreq === 'custom' && (
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, marginBottom: 8 }}>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>Every</span>
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={recurrenceInterval}
                  onChange={(e) => setRecurrenceInterval(Math.max(1, parseInt(e.target.value) || 1))}
                  style={{
                    width: 60,
                    padding: '6px 8px',
                    borderRadius: 8,
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    fontSize: 13,
                    textAlign: 'center',
                    outline: 'none',
                  }}
                />
                <select
                  value={recurrenceUnit}
                  onChange={(e) => setRecurrenceUnit(e.target.value as CustomRecurrenceUnit)}
                  style={{
                    flex: 1,
                    padding: '6px 10px',
                    borderRadius: 8,
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    color: '#F8FAFC',
                    fontSize: 13,
                    outline: 'none',
                  }}
                >
                  <option value="day">Day(s)</option>
                  <option value="week">Week(s)</option>
                  <option value="month">Month(s)</option>
                </select>
              </div>
            )}

            {/* End Condition (when repeating) */}
            {recurrenceFreq !== 'none' && (
              <div style={{ marginTop: 10, paddingTop: 8, borderTop: '1px dashed #334155' }}>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 40 }}>Ends:</span>
                  <div style={{ display: 'flex', gap: 6, flex: 1 }}>
                    {(['never', 'after', 'until'] as const).map((cond) => {
                      const isSelected = endCondition === cond;
                      return (
                        <button
                          key={cond}
                          type="button"
                          onClick={() => setEndCondition(cond)}
                          style={{
                            flex: 1,
                            padding: '4px 6px',
                            borderRadius: 6,
                            fontSize: 11,
                            cursor: 'pointer',
                            border: isSelected ? '1px solid #818cf8' : '1px solid #334155',
                            backgroundColor: isSelected ? 'rgba(129, 140, 248, 0.2)' : '#0F172A',
                            color: isSelected ? '#ffffff' : '#94a3b8',
                          }}
                        >
                          {cond === 'never' ? 'Never' : cond === 'after' ? 'After...' : 'On date...'}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {endCondition === 'after' && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>End after</span>
                    <input
                      type="number"
                      min={1}
                      max={999}
                      value={endAfter}
                      onChange={(e) => setEndAfter(Math.max(1, parseInt(e.target.value) || 1))}
                      style={{
                        width: 70,
                        padding: '4px 8px',
                        borderRadius: 6,
                        backgroundColor: '#0F172A',
                        border: '1px solid #334155',
                        color: '#F8FAFC',
                        fontSize: 12,
                        textAlign: 'center',
                      }}
                    />
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>occurrences</span>
                  </div>
                )}

                {endCondition === 'until' && (
                  <div style={{ marginTop: 8 }}>
                    <input
                      type="date"
                      value={endUntilDate}
                      onChange={(e) => setEndUntilDate(e.target.value)}
                      style={{
                        width: '100%',
                        padding: '6px 10px',
                        borderRadius: 6,
                        backgroundColor: '#0F172A',
                        border: '1px solid #334155',
                        color: '#F8FAFC',
                        fontSize: 12,
                        outline: 'none',
                      }}
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Notes */}
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#94a3b8', marginBottom: 6 }}>
              NOTES & DETAILS
            </label>
            <textarea
              rows={2}
              placeholder="Additional details or instructions..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 10,
                backgroundColor: '#1E293B',
                border: '1px solid #334155',
                color: '#F8FAFC',
                fontSize: 13,
                outline: 'none',
                resize: 'none',
              }}
            />
          </div>

          {/* Subtasks (Mesh branches) */}
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <label style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
                SUBTASKS / STEPS ({subtasks.filter((s) => s.completed).length}/{subtasks.length})
              </label>
              <span style={{ fontSize: 11, color: '#64748b' }}>Branch outward in the mesh</span>
            </div>

            {/* Existing Subtasks */}
            {subtasks.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                {subtasks.map((st) => (
                  <div
                    key={st.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      borderRadius: 10,
                      backgroundColor: '#1E293B',
                      border: '1px solid #334155',
                    }}
                  >
                    <div
                      onClick={() => handleToggleSubtask(st.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 10,
                        cursor: 'pointer',
                        flex: 1,
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={st.completed}
                        onChange={() => handleToggleSubtask(st.id)}
                        style={{ cursor: 'pointer', accentColor: '#10b981' }}
                      />
                      <span
                        style={{
                          fontSize: 13,
                          color: st.completed ? '#64748b' : '#f1f5f9',
                          textDecoration: st.completed ? 'line-through' : 'none',
                        }}
                      >
                        {st.title}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleRemoveSubtask(st.id)}
                      style={{
                        background: 'none',
                        border: 'none',
                        color: '#64748b',
                        cursor: 'pointer',
                        padding: 4,
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add Subtask Row */}
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder="Add next subtask step..."
                value={newSubtaskTitle}
                onChange={(e) => setNewSubtaskTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddSubtask();
                  }
                }}
                style={{
                  flex: 1,
                  padding: '9px 12px',
                  borderRadius: 10,
                  backgroundColor: '#1E293B',
                  border: '1px solid #334155',
                  color: '#F8FAFC',
                  fontSize: 13,
                  outline: 'none',
                }}
              />
              <button
                type="button"
                onClick={handleAddSubtask}
                style={{
                  padding: '9px 14px',
                  borderRadius: 10,
                  backgroundColor: 'rgba(255,255,255,0.08)',
                  border: '1px solid #334155',
                  color: '#f8fafc',
                  fontSize: 13,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                }}
              >
                <Plus size={16} /> Add Step
              </button>
            </div>
          </div>

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: 10, marginTop: 10 }}>
            {reminder && onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (confirm('Delete this reminder?')) {
                    onDelete(reminder.id);
                    onClose();
                  }
                }}
                style={{
                  padding: '12px 14px',
                  borderRadius: 12,
                  backgroundColor: 'rgba(239, 68, 68, 0.12)',
                  border: '1px solid rgba(239, 68, 68, 0.3)',
                  color: '#ef4444',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
                title="Delete Reminder"
              >
                <Trash2 size={18} />
              </button>
            )}

            <button
              type="submit"
              style={{
                flex: 1,
                padding: '12px',
                borderRadius: 12,
                backgroundColor: '#6366F1',
                border: 'none',
                color: '#ffffff',
                fontSize: 15,
                fontWeight: 700,
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(99, 102, 241, 0.4)',
              }}
            >
              {reminder ? 'Save Changes' : 'Create Reminder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
