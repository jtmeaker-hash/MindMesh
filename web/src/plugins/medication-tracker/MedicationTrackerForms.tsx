import React, { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import {
  DOSE_UNITS,
  FORM_LABELS,
  FREQUENCY_LABELS,
  ITEM_COLORS,
  KIND_LABELS,
  type MedicationDoseUnit,
  type MedicationForm,
  type MedicationItem,
  type MedicationKind,
  type MedicationSchedule,
  type ScheduleFrequency,
  type SupplyRecord,
} from './model';
import { uid } from './logic';
import { Button, Field, M, Modal, Row, Select, TextArea, TextInput } from './MedicationTrackerUi';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function todayKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function numberOrUndefined(value: string): number | undefined {
  const parsed = Number(value);
  return value.trim() !== '' && Number.isFinite(parsed) ? parsed : undefined;
}

export const ItemFormModal: React.FC<{
  initial?: MedicationItem;
  onClose: () => void;
  onSave: (item: MedicationItem) => void;
  onDelete?: (itemId: string) => void;
}> = ({ initial, onClose, onSave, onDelete }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [brandName, setBrandName] = useState(initial?.brandName ?? '');
  const [kind, setKind] = useState<MedicationKind>(initial?.kind ?? 'medication');
  const [form, setForm] = useState<MedicationForm>(initial?.form ?? 'tablet');
  const [strengthAmount, setStrengthAmount] = useState(initial?.strengthAmount?.toString() ?? '');
  const [strengthUnit, setStrengthUnit] = useState<MedicationDoseUnit>(initial?.strengthUnit ?? 'mg');
  const [doseAmount, setDoseAmount] = useState(initial?.doseAmount?.toString() ?? '');
  const [doseUnit, setDoseUnit] = useState<MedicationDoseUnit>(initial?.doseUnit ?? 'tablets');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [prescriber, setPrescriber] = useState(initial?.prescriber ?? '');
  const [pharmacy, setPharmacy] = useState(initial?.pharmacy ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [startDate, setStartDate] = useState(initial?.startDate ?? '');
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [asNeeded, setAsNeeded] = useState(initial?.asNeeded ?? false);
  const [maxDaily, setMaxDaily] = useState(initial?.maxDaily?.toString() ?? '');
  const [color, setColor] = useState(initial?.color ?? ITEM_COLORS[0]);
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!name.trim()) {
      setError('Give this entry a name.');
      return;
    }
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? uid('item'),
      name: name.trim(),
      brandName: brandName.trim() || undefined,
      kind,
      form,
      strengthAmount: numberOrUndefined(strengthAmount),
      strengthUnit: numberOrUndefined(strengthAmount) === undefined ? undefined : strengthUnit,
      doseAmount: numberOrUndefined(doseAmount),
      doseUnit: numberOrUndefined(doseAmount) === undefined ? undefined : doseUnit,
      instructions: instructions.trim() || undefined,
      reason: reason.trim() || undefined,
      prescriber: prescriber.trim() || undefined,
      pharmacy: pharmacy.trim() || undefined,
      notes: notes.trim() || undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      active,
      asNeeded,
      maxDaily: numberOrUndefined(maxDaily),
      color,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
    onClose();
  };

  return (
    <Modal title={initial ? 'Edit entry' : 'Add medication or supplement'} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Row>
          <Field label="Name" style={{ flex: '2 1 220px' }}>
            <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Metformin" autoFocus />
          </Field>
          <Field label="Type">
            <Select value={kind} onChange={(e) => setKind(e.target.value as MedicationKind)}>
              {(Object.keys(KIND_LABELS) as MedicationKind[]).map((key) => (
                <option key={key} value={key}>
                  {KIND_LABELS[key]}
                </option>
              ))}
            </Select>
          </Field>
        </Row>
        <Row>
          <Field label="Brand name" style={{ flex: '2 1 200px' }}>
            <TextInput value={brandName} onChange={(e) => setBrandName(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Form">
            <Select value={form} onChange={(e) => setForm(e.target.value as MedicationForm)}>
              {(Object.keys(FORM_LABELS) as MedicationForm[]).map((key) => (
                <option key={key} value={key}>
                  {FORM_LABELS[key]}
                </option>
              ))}
            </Select>
          </Field>
        </Row>
        <Row>
          <Field label="Strength">
            <TextInput type="number" inputMode="decimal" value={strengthAmount} onChange={(e) => setStrengthAmount(e.target.value)} placeholder="500" />
          </Field>
          <Field label="Strength unit">
            <Select value={strengthUnit} onChange={(e) => setStrengthUnit(e.target.value as MedicationDoseUnit)}>
              {DOSE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Dose amount">
            <TextInput type="number" inputMode="decimal" value={doseAmount} onChange={(e) => setDoseAmount(e.target.value)} placeholder="1" />
          </Field>
          <Field label="Dose unit">
            <Select value={doseUnit} onChange={(e) => setDoseUnit(e.target.value as MedicationDoseUnit)}>
              {DOSE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </Field>
        </Row>
        <Field label="Instructions" hint="Your own instruction — the app never generates dosage advice">
          <TextInput value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. Take with food" />
        </Field>
        <Row>
          <Field label="Reason / purpose" style={{ flex: '2 1 200px' }}>
            <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <Field label="Prescriber / provider">
            <TextInput value={prescriber} onChange={(e) => setPrescriber(e.target.value)} />
          </Field>
        </Row>
        <Field label="Pharmacy">
          <TextInput value={pharmacy} onChange={(e) => setPharmacy(e.target.value)} />
        </Field>
        <Row>
          <Field label="Start date">
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label="End date" hint="Optional">
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </Row>
        <Field label="Colour">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {ITEM_COLORS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setColor(option)}
                aria-label={`Colour ${option}`}
                style={{
                  width: 28, height: 28, borderRadius: '50%', background: option, cursor: 'pointer',
                  border: color === option ? '3px solid #f8fafc' : `1px solid ${M.border}`,
                }}
              />
            ))}
          </div>
        </Field>
        <Field label="Notes">
          <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: M.text, fontSize: 13 }}>
          <input type="checkbox" checked={asNeeded} onChange={(e) => setAsNeeded(e.target.checked)} />
          PRN / as needed (log doses manually)
        </label>
        {asNeeded && (
          <Field label="Your maximum doses per day" hint="Only your own limit — the app never suggests one">
            <TextInput type="number" min={0} value={maxDaily} onChange={(e) => setMaxDaily(e.target.value)} placeholder="Optional" />
          </Field>
        )}
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: M.text, fontSize: 13 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Currently taking this
        </label>
        {error && <p style={{ color: '#fca5a5', fontSize: 12.5 }}>{error}</p>}
        <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
          {onDelete && initial ? (
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm(`Delete ${initial.name}? Its schedules, history and supply data will also be removed.`)) {
                  onDelete(initial.id);
                  onClose();
                }
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          ) : (
            <span />
          )}
          <Row>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit}>{initial ? 'Save' : 'Add'}</Button>
          </Row>
        </Row>
      </div>
    </Modal>
  );
};

export const ScheduleFormModal: React.FC<{
  itemId: string;
  itemName: string;
  initial?: MedicationSchedule;
  onClose: () => void;
  onSave: (schedule: MedicationSchedule) => void;
  onDelete?: (scheduleId: string) => void;
}> = ({ itemId, itemName, initial, onClose, onSave, onDelete }) => {
  const [frequency, setFrequency] = useState<ScheduleFrequency>(initial?.frequency ?? 'specific_times');
  const [times, setTimes] = useState<string[]>(initial?.times?.length ? initial.times : ['08:00']);
  const [daysOfWeek, setDaysOfWeek] = useState<number[]>(initial?.daysOfWeek ?? [1]);
  const [dayOfMonth, setDayOfMonth] = useState(initial?.dayOfMonth?.toString() ?? '1');
  const [intervalHours, setIntervalHours] = useState(initial?.intervalHours?.toString() ?? '6');
  const [intervalDays, setIntervalDays] = useState(initial?.intervalDays?.toString() ?? '2');
  const [startDate, setStartDate] = useState(initial?.startDate ?? todayKey());
  const [endDate, setEndDate] = useState(initial?.endDate ?? '');
  const [doseAmount, setDoseAmount] = useState(initial?.doseAmount?.toString() ?? '');
  const [doseUnit, setDoseUnit] = useState<MedicationDoseUnit>(initial?.doseUnit ?? 'tablets');
  const [instructions, setInstructions] = useState(initial?.instructions ?? '');
  const [active, setActive] = useState(initial?.active ?? true);
  const [error, setError] = useState<string | null>(null);

  const needsTimes = frequency !== 'as_needed' && frequency !== 'every_hours';
  const needsDays = frequency === 'specific_days' || frequency === 'weekly';

  const submit = () => {
    if (needsTimes && times.filter(Boolean).length === 0) {
      setError('Add at least one time.');
      return;
    }
    if (needsDays && daysOfWeek.length === 0) {
      setError('Pick at least one day.');
      return;
    }
    const now = new Date().toISOString();
    const amount = numberOrUndefined(doseAmount);
    onSave({
      id: initial?.id ?? uid('sched'),
      itemId,
      frequency,
      times: needsTimes ? Array.from(new Set(times.filter(Boolean))).sort() : initial?.times ?? [],
      daysOfWeek: needsDays ? [...daysOfWeek].sort((a, b) => a - b) : initial?.daysOfWeek,
      dayOfMonth: frequency === 'monthly' ? Math.min(31, Math.max(1, Number(dayOfMonth) || 1)) : initial?.dayOfMonth,
      intervalHours: frequency === 'every_hours' ? Math.max(1, Number(intervalHours) || 6) : initial?.intervalHours,
      intervalDays: frequency === 'every_n_days' ? Math.max(1, Number(intervalDays) || 2) : initial?.intervalDays,
      startDate: startDate || todayKey(),
      endDate: endDate || undefined,
      doseAmount: amount,
      doseUnit: amount === undefined ? undefined : doseUnit,
      instructions: instructions.trim() || undefined,
      active,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
    onClose();
  };

  return (
    <Modal title={`${initial ? 'Edit' : 'Add'} schedule · ${itemName}`} onClose={onClose} wide>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Schedule type">
          <Select value={frequency} onChange={(e) => setFrequency(e.target.value as ScheduleFrequency)}>
            {(Object.keys(FREQUENCY_LABELS) as ScheduleFrequency[]).map((key) => (
              <option key={key} value={key}>
                {FREQUENCY_LABELS[key]}
              </option>
            ))}
          </Select>
        </Field>

        {frequency === 'every_hours' && (
          <Field label="Every how many hours">
            <TextInput type="number" min={1} value={intervalHours} onChange={(e) => setIntervalHours(e.target.value)} />
          </Field>
        )}
        {frequency === 'every_n_days' && (
          <Field label="Every how many days">
            <TextInput type="number" min={1} value={intervalDays} onChange={(e) => setIntervalDays(e.target.value)} />
          </Field>
        )}
        {frequency === 'monthly' && (
          <Field label="Day of month">
            <TextInput type="number" min={1} max={31} value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)} />
          </Field>
        )}
        {needsDays && (
          <Field label="Days">
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {DAY_NAMES.map((day, index) => {
                const selected = daysOfWeek.includes(index);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setDaysOfWeek((prev) => (prev.includes(index) ? prev.filter((d) => d !== index) : [...prev, index]))}
                    style={{
                      padding: '7px 12px', borderRadius: 999, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${selected ? M.accent : M.border}`,
                      background: selected ? M.accentSoft : 'transparent',
                      color: selected ? '#a7f3d0' : M.muted,
                    }}
                  >
                    {day}
                  </button>
                );
              })}
            </div>
          </Field>
        )}

        {needsTimes && (
          <Field label="Times" hint="Local time each dose is due">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {times.map((time, index) => (
                <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <TextInput type="time" value={time} onChange={(e) => setTimes((prev) => prev.map((t, i) => (i === index ? e.target.value : t)))} />
                  {times.length > 1 && (
                    <Button variant="ghost" onClick={() => setTimes((prev) => prev.filter((_, i) => i !== index))} aria-label="Remove time">
                      <Trash2 size={14} />
                    </Button>
                  )}
                </div>
              ))}
              <Button variant="subtle" onClick={() => setTimes((prev) => [...prev, '20:00'])} style={{ alignSelf: 'flex-start' }}>
                <Plus size={14} /> Add time
              </Button>
            </div>
          </Field>
        )}

        {frequency === 'every_hours' && (
          <Field label="First dose time">
            <TextInput type="time" value={times[0] ?? '08:00'} onChange={(e) => setTimes([e.target.value])} />
          </Field>
        )}

        <Row>
          <Field label="Dose amount">
            <TextInput type="number" inputMode="decimal" value={doseAmount} onChange={(e) => setDoseAmount(e.target.value)} />
          </Field>
          <Field label="Dose unit">
            <Select value={doseUnit} onChange={(e) => setDoseUnit(e.target.value as MedicationDoseUnit)}>
              {DOSE_UNITS.map((unit) => (
                <option key={unit} value={unit}>
                  {unit}
                </option>
              ))}
            </Select>
          </Field>
        </Row>
        <Row>
          <Field label={frequency === 'course' ? 'Course start' : 'Start date'}>
            <TextInput type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </Field>
          <Field label={frequency === 'course' ? 'Course end' : 'End date'} hint={frequency === 'course' ? 'Temporary course end' : 'Optional'}>
            <TextInput type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </Row>
        <Field label="Notes">
          <TextInput value={instructions} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, color: M.text, fontSize: 13 }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Schedule active
        </label>
        {error && <p style={{ color: '#fca5a5', fontSize: 12.5 }}>{error}</p>}
        <Row style={{ justifyContent: 'space-between', marginTop: 4 }}>
          {onDelete && initial ? (
            <Button
              variant="danger"
              onClick={() => {
                if (window.confirm('Delete this schedule and its recorded doses?')) {
                  onDelete(initial.id);
                  onClose();
                }
              }}
            >
              <Trash2 size={14} /> Delete
            </Button>
          ) : (
            <span />
          )}
          <Row>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={submit}>{initial ? 'Save' : 'Add'}</Button>
          </Row>
        </Row>
      </div>
    </Modal>
  );
};

export const SupplyFormModal: React.FC<{
  itemName: string;
  initial?: SupplyRecord;
  onClose: () => void;
  onSave: (supply: SupplyRecord) => void;
}> = ({ itemName, initial, onClose, onSave }) => {
  const [quantity, setQuantity] = useState(initial?.quantity?.toString() ?? '');
  const [unit, setUnit] = useState<MedicationDoseUnit>(initial?.unit ?? 'tablets');
  const [usedPerDose, setUsedPerDose] = useState(initial?.usedPerDose?.toString() ?? '1');
  const [refillQuantity, setRefillQuantity] = useState(initial?.refillQuantity?.toString() ?? '');
  const [refillThreshold, setRefillThreshold] = useState(initial?.refillThreshold?.toString() ?? '');
  const [refillByDate, setRefillByDate] = useState(initial?.refillByDate ?? '');

  const submit = () => {
    onSave({
      quantity: numberOrUndefined(quantity),
      unit: numberOrUndefined(quantity) === undefined ? undefined : unit,
      // A newly-entered quantity is measured from now so the estimate is honest.
      asOf: quantity === initial?.quantity?.toString() ? initial?.asOf ?? new Date().toISOString() : new Date().toISOString(),
      usedPerDose: Math.max(0, Number(usedPerDose) || 1),
      refillQuantity: numberOrUndefined(refillQuantity),
      refillThreshold: numberOrUndefined(refillThreshold),
      refillByDate: refillByDate || undefined,
    });
    onClose();
  };

  return (
    <Modal title={`Supply · ${itemName}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Row>
          <Field label="Current quantity">
            <TextInput type="number" inputMode="decimal" value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="30" />
          </Field>
          <Field label="Unit">
            <Select value={unit} onChange={(e) => setUnit(e.target.value as MedicationDoseUnit)}>
              {DOSE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </Select>
          </Field>
        </Row>
        <Row>
          <Field label="Used per dose" hint="How many units one dose consumes">
            <TextInput type="number" inputMode="decimal" value={usedPerDose} onChange={(e) => setUsedPerDose(e.target.value)} />
          </Field>
          <Field label="Refill quantity">
            <TextInput type="number" inputMode="decimal" value={refillQuantity} onChange={(e) => setRefillQuantity(e.target.value)} />
          </Field>
        </Row>
        <Row>
          <Field label="Low-supply alert at">
            <TextInput type="number" inputMode="decimal" value={refillThreshold} onChange={(e) => setRefillThreshold(e.target.value)} placeholder="5" />
          </Field>
          <Field label="Refill by date" hint="Optional">
            <TextInput type="date" value={refillByDate} onChange={(e) => setRefillByDate(e.target.value)} />
          </Field>
        </Row>
        <p style={{ fontSize: 11.5, color: M.faint }}>
          Remaining supply is estimated from your own entries and can be corrected at any time.
        </p>
        <Row style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit}>Save supply</Button>
        </Row>
      </div>
    </Modal>
  );
};

export const PrnLogModal: React.FC<{
  item: MedicationItem;
  onClose: () => void;
  onLog: (note: string) => void;
}> = ({ item, onClose, onLog }) => {
  const [note, setNote] = useState('');
  return (
    <Modal title={`Log PRN dose · ${item.name}`} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <p style={{ fontSize: 12.5, color: M.muted }}>
          Records the time you took this now. {item.maxDaily ? `Your own limit is ${item.maxDaily} per day.` : ''}
        </p>
        <Field label="Reason / note" hint="Optional">
          <TextArea value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>
        <Row style={{ justifyContent: 'flex-end' }}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onLog(note)}>Log dose</Button>
        </Row>
      </div>
    </Modal>
  );
};
