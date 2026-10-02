import React, { useState } from 'react';
import {
  MAINTENANCE_CATEGORIES,
  KNOWN_ISSUE_STATUS_LABELS,
  type KnownIssueSeverity,
  type KnownIssueStatus,
  type KnownVehicleIssue,
  type MaintenanceCategory,
  type MaintenanceItem,
  type MaintenanceItemCondition,
  type NextServiceItem,
  type NextServiceItemSource,
  type NextServiceRequirement,
  type PartEstimate,
  type ServiceRecord,
  type ServiceRecordItem,
  type ServiceTypeDefinition,
  type Vehicle,
  type VehiclePriority,
} from '../../types/vehicle';
import { createVehicle, toIsoDate, vehicleId } from '../../services/vehicleMaintenance';
import { Button, Field, Modal, Row, Select, TextArea, TextInput, V } from './VehicleUi';

const num = (value: string): number | undefined => {
  if (value.trim() === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const splitLines = (value: string): string[] =>
  value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/* ------------------------------------------------------------------ *\n * Vehicle profile\n * ------------------------------------------------------------------ */

export const VehicleFormModal: React.FC<{
  initial?: Vehicle;
  onSave: (vehicle: Vehicle) => void;
  onClose: () => void;
}> = ({ initial, onSave, onClose }) => {
  const [draft, setDraft] = useState(() => ({
    nickname: initial?.nickname ?? '',
    make: initial?.make ?? '',
    model: initial?.model ?? '',
    year: initial?.year ? String(initial.year) : '',
    registrationPlate: initial?.registrationPlate ?? '',
    vin: initial?.vin ?? '',
    engine: initial?.engine ?? '',
    currentOdometerKm: initial ? String(initial.currentOdometerKm) : '',
    serviceIntervalKm: initial ? String(initial.serviceIntervalKm) : '10000',
    serviceIntervalMonths: initial?.serviceIntervalMonths ? String(initial.serviceIntervalMonths) : '',
    lastServiceKm: initial?.lastServiceKm ? String(initial.lastServiceKm) : '',
    lastServiceDate: initial?.lastServiceDate ?? '',
    notes: initial?.notes ?? '',
    photo: initial?.photo ?? '',
  }));

  const set = (key: keyof typeof draft) => (value: string) => setDraft((prev) => ({ ...prev, [key]: value }));

  const submit = () => {
    const vehicle = createVehicle({
      id: initial?.id,
      nickname: draft.nickname,
      make: draft.make,
      model: draft.model,
      year: num(draft.year),
      registrationPlate: draft.registrationPlate,
      vin: draft.vin,
      engine: draft.engine,
      currentOdometerKm: num(draft.currentOdometerKm) ?? initial?.currentOdometerKm ?? 0,
      serviceIntervalKm: num(draft.serviceIntervalKm) ?? 10000,
      serviceIntervalMonths: num(draft.serviceIntervalMonths),
      lastServiceKm: num(draft.lastServiceKm),
      lastServiceDate: draft.lastServiceDate || undefined,
      notes: draft.notes || undefined,
      photo: draft.photo || undefined,
      createdAt: initial?.createdAt,
      lastOdometerUpdateAt: initial?.lastOdometerUpdateAt,
    });
    onSave(vehicle);
  };

  return (
    <Modal title={initial ? 'Edit vehicle' : 'Add vehicle'} onClose={onClose} wide>
      <Row>
        <Field label="Nickname">
          <TextInput value={draft.nickname} onChange={(e) => set('nickname')(e.target.value)} placeholder="Daily driver" />
        </Field>
        <Field label="Make">
          <TextInput value={draft.make} onChange={(e) => set('make')(e.target.value)} placeholder="Toyota" />
        </Field>
        <Field label="Model">
          <TextInput value={draft.model} onChange={(e) => set('model')(e.target.value)} placeholder="Corolla" />
        </Field>
        <Field label="Year">
          <TextInput value={draft.year} onChange={(e) => set('year')(e.target.value)} inputMode="numeric" placeholder="2018" />
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Registration plate">
          <TextInput value={draft.registrationPlate} onChange={(e) => set('registrationPlate')(e.target.value)} placeholder="ABC123" />
        </Field>
        <Field label="VIN (optional)">
          <TextInput value={draft.vin} onChange={(e) => set('vin')(e.target.value)} />
        </Field>
        <Field label="Engine / variant (optional)">
          <TextInput value={draft.engine} onChange={(e) => set('engine')(e.target.value)} placeholder="1.8L petrol" />
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Current odometer (km)">
          <TextInput value={draft.currentOdometerKm} onChange={(e) => set('currentOdometerKm')(e.target.value)} inputMode="numeric" placeholder="126420" />
        </Field>
        <Field label="Service interval (km)">
          <TextInput value={draft.serviceIntervalKm} onChange={(e) => set('serviceIntervalKm')(e.target.value)} inputMode="numeric" placeholder="10000" />
        </Field>
        <Field label="Service interval (months, optional)">
          <TextInput value={draft.serviceIntervalMonths} onChange={(e) => set('serviceIntervalMonths')(e.target.value)} inputMode="numeric" placeholder="12" />
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Last service odometer (optional)" hint="Used until a full service record exists.">
          <TextInput value={draft.lastServiceKm} onChange={(e) => set('lastServiceKm')(e.target.value)} inputMode="numeric" placeholder="120300" />
        </Field>
        <Field label="Last service date (optional)">
          <TextInput type="date" value={draft.lastServiceDate} onChange={(e) => set('lastServiceDate')(e.target.value)} />
        </Field>
      </Row>
      <Field label="Photo URL (optional)" style={{ marginTop: 10 }}>
        <TextInput value={draft.photo} onChange={(e) => set('photo')(e.target.value)} placeholder="https://…" />
      </Field>
      <Field label="Notes" style={{ marginTop: 10 }}>
        <TextArea value={draft.notes} onChange={(e) => set('notes')(e.target.value)} />
      </Field>
      <Row style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit}>{initial ? 'Save vehicle' : 'Add vehicle'}</Button>
      </Row>
    </Modal>
  );
};

/* ------------------------------------------------------------------ *\n * Odometer update\n * ------------------------------------------------------------------ */

export const OdometerModal: React.FC<{
  vehicle: Vehicle;
  onSave: (km: number, note?: string) => void;
  onClose: () => void;
}> = ({ vehicle, onSave, onClose }) => {
  const [value, setValue] = useState(String(vehicle.currentOdometerKm || ''));
  const [note, setNote] = useState('');
  const km = num(value);
  return (
    <Modal title="Update odometer" onClose={onClose}>
      <p style={{ fontSize: 12.5, color: V.muted, marginBottom: 12 }}>
        Last recorded: <strong style={{ color: V.text }}>{vehicle.currentOdometerKm.toLocaleString('en-AU')} km</strong>. New readings are appended to
        history — previous readings are never overwritten.
      </p>
      <Field label="Current odometer (km)">
        <TextInput value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" autoFocus />
      </Field>
      <Field label="Note (optional)" style={{ marginTop: 10 }}>
        <TextInput value={note} onChange={(e) => setNote(e.target.value)} placeholder="Filled up at the servo" />
      </Field>
      <Row style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={km === undefined} onClick={() => km !== undefined && onSave(km, note || undefined)}>Save reading</Button>
      </Row>
    </Modal>
  );
};

/* ------------------------------------------------------------------ *\n * Service record\n * ------------------------------------------------------------------ */

interface ServiceDraftItem {
  maintenanceItemId?: string;
  name: string;
  selected: boolean;
  partsCost: string;
  labourCost: string;
}

export const ServiceFormModal: React.FC<{
  vehicle: Vehicle;
  maintenanceItems: MaintenanceItem[];
  serviceTypes: ServiceTypeDefinition[];
  initial?: ServiceRecord;
  onSave: (record: ServiceRecord) => void;
  onClose: () => void;
}> = ({ vehicle, maintenanceItems, serviceTypes, initial, onSave, onClose }) => {
  const vehicleItems = maintenanceItems.filter((item) => item.vehicleId === vehicle.id);
  const [date, setDate] = useState(initial?.date ?? toIsoDate());
  const [odometer, setOdometer] = useState(initial ? String(initial.odometerKm) : String(vehicle.currentOdometerKm));
  const [serviceTypeId, setServiceTypeId] = useState(initial?.serviceTypeId ?? serviceTypes[0]?.id ?? 'svc-standard');
  const [workshop, setWorkshop] = useState(initial?.workshop ?? '');
  const [labour, setLabour] = useState(initial?.labourCost !== undefined ? String(initial.labourCost) : '');
  const [parts, setParts] = useState(initial?.partsCost !== undefined ? String(initial.partsCost) : '');
  const [total, setTotal] = useState(initial?.totalCost !== undefined ? String(initial.totalCost) : '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [recommended, setRecommended] = useState(initial?.recommendedWork.join(', ') ?? '');
  const [inspected, setInspected] = useState(initial?.inspectedItems.join(', ') ?? '');
  const [repaired, setRepaired] = useState(initial?.repairedItems.join(', ') ?? '');
  const [draftItems, setDraftItems] = useState<ServiceDraftItem[]>(() => {
    const byId = new Map((initial?.items ?? []).map((item) => [item.maintenanceItemId ?? item.name, item]));
    return vehicleItems.map((item) => {
      const existing = byId.get(item.id);
      return {
        maintenanceItemId: item.id,
        name: item.name,
        selected: Boolean(existing),
        partsCost: existing?.partsCost !== undefined ? String(existing.partsCost) : '',
        labourCost: existing?.labourCost !== undefined ? String(existing.labourCost) : '',
      };
    });
  });

  const toggle = (index: number) =>
    setDraftItems((prev) => prev.map((item, i) => (i === index ? { ...item, selected: !item.selected } : item)));
  const updateItem = (index: number, key: 'partsCost' | 'labourCost', value: string) =>
    setDraftItems((prev) => prev.map((item, i) => (i === index ? { ...item, [key]: value } : item)));

  const submit = () => {
    if (num(odometer) === undefined) return;
    const now = new Date().toISOString();
    const recordId = initial?.id ?? vehicleId('svc');
    const items: ServiceRecordItem[] = draftItems
      .filter((item) => item.selected)
      .map((item) => {
        const partsCost = num(item.partsCost);
        const labourCost = num(item.labourCost);
        return {
          id: vehicleId('sitem'),
          serviceRecordId: recordId,
          maintenanceItemId: item.maintenanceItemId,
          name: item.name,
          action: 'replaced',
          partsCost,
          labourCost,
          cost: partsCost !== undefined || labourCost !== undefined ? (partsCost ?? 0) + (labourCost ?? 0) : undefined,
        };
      });

    const extraRecommended = splitLines(recommended);
    const record: ServiceRecord = {
      id: recordId,
      vehicleId: vehicle.id,
      date,
      odometerKm: num(odometer) as number,
      serviceTypeId,
      workshop: workshop || undefined,
      totalCost: num(total),
      labourCost: num(labour),
      partsCost: num(parts),
      notes: notes || undefined,
      items,
      replacedItems: items.map((i) => i.name),
      inspectedItems: splitLines(inspected),
      repairedItems: splitLines(repaired),
      recommendedWork: extraRecommended,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    };
    onSave(record);
  };

  return (
    <Modal title={initial ? 'Edit service record' : 'Record a service'} onClose={onClose} wide>
      <Row>
        <Field label="Service date">
          <TextInput type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Odometer (km)">
          <TextInput value={odometer} onChange={(e) => setOdometer(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Service type">
          <Select value={serviceTypeId} onChange={(e) => setServiceTypeId(e.target.value)}>
            {serviceTypes.map((type) => (
              <option key={type.id} value={type.id}>{type.name}</option>
            ))}
          </Select>
        </Field>
      </Row>
      <Field label="Workshop / mechanic" style={{ marginTop: 10 }}>
        <TextInput value={workshop} onChange={(e) => setWorkshop(e.target.value)} />
      </Field>
      <Row style={{ marginTop: 10 }}>
        <Field label="Labour cost">
          <TextInput value={labour} onChange={(e) => setLabour(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Parts cost">
          <TextInput value={parts} onChange={(e) => setParts(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Total cost">
          <TextInput value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal" />
        </Field>
      </Row>

      <div style={{ marginTop: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: V.muted, textTransform: 'uppercase', marginBottom: 8 }}>
          Items completed ({draftItems.filter((i) => i.selected).length})
        </div>
        <div style={{ maxHeight: 220, overflowY: 'auto', border: `1px solid ${V.border}`, borderRadius: 12, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {draftItems.map((item, index) => (
            <div key={item.maintenanceItemId} style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, flex: '1 1 150px', cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" checked={item.selected} onChange={() => toggle(index)} style={{ accentColor: V.accent, width: 16, height: 16 }} />
                {item.name}
              </label>
              {item.selected && (
                <div style={{ display: 'flex', gap: 6 }}>
                  <TextInput placeholder="Parts $" value={item.partsCost} onChange={(e) => updateItem(index, 'partsCost', e.target.value)} style={{ width: 90 }} inputMode="decimal" />
                  <TextInput placeholder="Labour $" value={item.labourCost} onChange={(e) => updateItem(index, 'labourCost', e.target.value)} style={{ width: 90 }} inputMode="decimal" />
                </div>
              )}
            </div>
          ))}
        </div>
        <p style={{ fontSize: 11, color: V.faint, marginTop: 6 }}>
          Saving updates each selected component's last-replaced date and odometer, and recalculates its next replacement automatically.
        </p>
      </div>

      <Row style={{ marginTop: 12 }}>
        <Field label="Items inspected (comma separated)">
          <TextInput value={inspected} onChange={(e) => setInspected(e.target.value)} />
        </Field>
        <Field label="Items repaired (comma separated)">
          <TextInput value={repaired} onChange={(e) => setRepaired(e.target.value)} />
        </Field>
      </Row>
      <Field label="Recommended future work (comma or line separated)" style={{ marginTop: 10 }}>
        <TextArea value={recommended} onChange={(e) => setRecommended(e.target.value)} placeholder="Front brake pads, Rotate tyres" />
      </Field>
      <Field label="Notes" style={{ marginTop: 10 }}>
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>

      <Row style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={submit}>{initial ? 'Save record' : 'Save service'}</Button>
      </Row>
    </Modal>
  );
};

/* ------------------------------------------------------------------ *\n * Next service plan item\n * ------------------------------------------------------------------ */

export const PlanItemModal: React.FC<{
  vehicle: Vehicle;
  maintenanceItems: MaintenanceItem[];
  initial?: NextServiceItem;
  onSave: (item: NextServiceItem) => void;
  onClose: () => void;
}> = ({ vehicle, maintenanceItems, initial, onSave, onClose }) => {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [maintenanceItemId, setMaintenanceItemId] = useState(initial?.maintenanceItemId ?? '');
  const [requirement, setRequirement] = useState<NextServiceRequirement>(initial?.requirement ?? 'required');
  const [source, setSource] = useState<NextServiceItemSource>(initial?.source ?? 'scheduled');
  const [priority, setPriority] = useState<VehiclePriority>(initial?.priority ?? 'medium');
  const [partCost, setPartCost] = useState(initial?.estimatedPartCost !== undefined ? String(initial.estimatedPartCost) : '');
  const [labourCost, setLabourCost] = useState(initial?.estimatedLabourCost !== undefined ? String(initial.estimatedLabourCost) : '');
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const vehicleItems = maintenanceItems.filter((item) => item.vehicleId === vehicle.id);

  const submit = () => {
    if (!title.trim()) return;
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? vehicleId('nsi'),
      vehicleId: vehicle.id,
      maintenanceItemId: maintenanceItemId || undefined,
      title: title.trim(),
      reason: reason || undefined,
      requirement,
      estimatedPartCost: num(partCost),
      estimatedLabourCost: num(labourCost),
      estimatedTotalCost: initial?.estimatedTotalCost,
      notes: notes || undefined,
      priority,
      source,
      knownIssueId: initial?.knownIssueId,
      completed: initial?.completed ?? false,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <Modal title={initial ? 'Edit next-service item' : 'Add next-service item'} onClose={onClose}>
      <Field label="Maintenance item">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Front brake pads" />
      </Field>
      <Field label="Link to tracked component (optional)" style={{ marginTop: 10 }} hint="Linking lets the plan item complete itself when the part is replaced.">
        <Select value={maintenanceItemId} onChange={(e) => setMaintenanceItemId(e.target.value)}>
          <option value="">— none —</option>
          {vehicleItems.map((item) => (
            <option key={item.id} value={item.id}>{item.name}</option>
          ))}
        </Select>
      </Field>
      <Row style={{ marginTop: 10 }}>
        <Field label="Requirement">
          <Select value={requirement} onChange={(e) => setRequirement(e.target.value as NextServiceRequirement)}>
            <option value="required">Required</option>
            <option value="recommended">Recommended</option>
          </Select>
        </Field>
        <Field label="Source">
          <Select value={source} onChange={(e) => setSource(e.target.value as NextServiceItemSource)}>
            <option value="scheduled">Scheduled maintenance</option>
            <option value="mechanic">Mechanic recommendation</option>
            <option value="known_issue">Known issue</option>
            <option value="user">User added</option>
            <option value="recommended">Recommended repair</option>
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as VehiclePriority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Estimated part cost">
          <TextInput value={partCost} onChange={(e) => setPartCost(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Estimated labour cost">
          <TextInput value={labourCost} onChange={(e) => setLabourCost(e.target.value)} inputMode="decimal" />
        </Field>
      </Row>
      <Field label="Reason (optional)" style={{ marginTop: 10 }}>
        <TextInput value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Field label="Notes" style={{ marginTop: 10 }}>
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Row style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!title.trim()} onClick={submit}>Save item</Button>
      </Row>
    </Modal>
  );
};

/* ------------------------------------------------------------------ *\n * Maintenance item\n * ------------------------------------------------------------------ */

export const MaintenanceItemModal: React.FC<{
  vehicle: Vehicle;
  initial?: MaintenanceItem;
  onSave: (item: MaintenanceItem) => void;
  onClose: () => void;
}> = ({ vehicle, initial, onSave, onClose }) => {
  const [name, setName] = useState(initial?.name ?? '');
  const [category, setCategory] = useState<MaintenanceCategory>(initial?.category ?? 'custom');
  const [lastDate, setLastDate] = useState(initial?.lastReplacedDate ?? '');
  const [lastKm, setLastKm] = useState(initial?.lastReplacedOdometerKm !== undefined ? String(initial.lastReplacedOdometerKm) : '');
  const [intervalKm, setIntervalKm] = useState(initial?.replacementIntervalKm !== undefined ? String(initial.replacementIntervalKm) : '');
  const [intervalMonths, setIntervalMonths] = useState(initial?.replacementIntervalMonths !== undefined ? String(initial.replacementIntervalMonths) : '');
  const [brand, setBrand] = useState(initial?.brand ?? '');
  const [partNumber, setPartNumber] = useState(initial?.partNumber ?? '');
  const [cost, setCost] = useState(initial?.cost !== undefined ? String(initial.cost) : '');
  const [installedBy, setInstalledBy] = useState(initial?.installedBy ?? '');
  const [condition, setCondition] = useState<MaintenanceItemCondition>(initial?.condition ?? 'unknown');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const conditions: MaintenanceItemCondition[] = ['new', 'good', 'worn', 'poor', 'unknown'];

  const submit = () => {
    if (!name.trim()) return;
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? vehicleId('maint'),
      vehicleId: vehicle.id,
      name: name.trim(),
      category,
      lastReplacedDate: lastDate || undefined,
      lastReplacedOdometerKm: num(lastKm),
      replacementIntervalKm: num(intervalKm),
      replacementIntervalMonths: num(intervalMonths),
      brand: brand || undefined,
      partNumber: partNumber || undefined,
      cost: num(cost),
      installedBy: installedBy || undefined,
      condition,
      notes: notes || undefined,
      custom: initial?.custom ?? true,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <Modal title={initial ? 'Edit maintenance item' : 'Add maintenance item'} onClose={onClose} wide>
      <Row>
        <Field label="Name">
          <TextInput value={name} onChange={(e) => setName(e.target.value)} placeholder="Cabin filter" />
        </Field>
        <Field label="Category">
          <Select value={category} onChange={(e) => setCategory(e.target.value as MaintenanceCategory)}>
            {MAINTENANCE_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </Select>
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Last replaced / checked date">
          <TextInput type="date" value={lastDate} onChange={(e) => setLastDate(e.target.value)} />
        </Field>
        <Field label="Last replaced odometer (km)">
          <TextInput value={lastKm} onChange={(e) => setLastKm(e.target.value)} inputMode="numeric" />
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Replacement interval (km)" hint="Optional — leave blank for inspection-only items.">
          <TextInput value={intervalKm} onChange={(e) => setIntervalKm(e.target.value)} inputMode="numeric" />
        </Field>
        <Field label="Replacement interval (months)">
          <TextInput value={intervalMonths} onChange={(e) => setIntervalMonths(e.target.value)} inputMode="numeric" />
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Brand">
          <TextInput value={brand} onChange={(e) => setBrand(e.target.value)} />
        </Field>
        <Field label="Part number">
          <TextInput value={partNumber} onChange={(e) => setPartNumber(e.target.value)} />
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Cost">
          <TextInput value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Installed by">
          <TextInput value={installedBy} onChange={(e) => setInstalledBy(e.target.value)} />
        </Field>
        <Field label="Condition">
          <Select value={condition} onChange={(e) => setCondition(e.target.value as MaintenanceItemCondition)}>
            {conditions.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </Field>
      </Row>
      <Field label="Notes" style={{ marginTop: 10 }}>
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Row style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!name.trim()} onClick={submit}>Save item</Button>
      </Row>
    </Modal>
  );
};

/* ------------------------------------------------------------------ *\n * Known issue\n * ------------------------------------------------------------------ */

export const KnownIssueModal: React.FC<{
  vehicle: Vehicle;
  initial?: KnownVehicleIssue;
  onSave: (issue: KnownVehicleIssue) => void;
  onClose: () => void;
}> = ({ vehicle, initial, onSave, onClose }) => {
  const [title, setTitle] = useState(initial?.title ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [firstNoticedDate, setFirstNoticedDate] = useState(initial?.firstNoticedDate ?? toIsoDate());
  const [odometerWhenNoticedKm, setOdometerWhenNoticedKm] = useState(
    initial?.odometerWhenNoticedKm !== undefined ? String(initial.odometerWhenNoticedKm) : String(vehicle.currentOdometerKm)
  );
  const [severity, setSeverity] = useState<KnownIssueSeverity>(initial?.severity ?? 'medium');
  const [priority, setPriority] = useState<VehiclePriority>(initial?.priority ?? 'medium');
  const [costLow, setCostLow] = useState(initial?.estimatedRepairCostLow !== undefined ? String(initial.estimatedRepairCostLow) : '');
  const [costHigh, setCostHigh] = useState(initial?.estimatedRepairCostHigh !== undefined ? String(initial.estimatedRepairCostHigh) : '');
  const [diagnosis, setDiagnosis] = useState(initial?.mechanicDiagnosis ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [status, setStatus] = useState<KnownIssueStatus>(initial?.status ?? 'monitoring');

  const statuses: KnownIssueStatus[] = ['monitoring', 'needs_inspection', 'repair_soon', 'urgent', 'booked', 'repaired', 'closed'];

  const submit = () => {
    if (!title.trim()) return;
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? vehicleId('issue'),
      vehicleId: vehicle.id,
      title: title.trim(),
      description: description || undefined,
      firstNoticedDate: firstNoticedDate || undefined,
      odometerWhenNoticedKm: num(odometerWhenNoticedKm),
      severity,
      priority,
      estimatedRepairCostLow: num(costLow),
      estimatedRepairCostHigh: num(costHigh),
      mechanicDiagnosis: diagnosis || undefined,
      notes: notes || undefined,
      photos: initial?.photos,
      status,
      nextServiceItemId: initial?.nextServiceItemId,
      resolvedAt: status === 'repaired' || status === 'closed' ? (initial?.resolvedAt ?? now) : undefined,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <Modal title={initial ? 'Edit known issue' : 'Add known issue'} onClose={onClose} wide>
      <Field label="Issue title">
        <TextInput value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Front suspension knocking" />
      </Field>
      <Row style={{ marginTop: 10 }}>
        <Field label="Date first noticed">
          <TextInput type="date" value={firstNoticedDate} onChange={(e) => setFirstNoticedDate(e.target.value)} />
        </Field>
        <Field label="Odometer when noticed (km)">
          <TextInput value={odometerWhenNoticedKm} onChange={(e) => setOdometerWhenNoticedKm(e.target.value)} inputMode="numeric" />
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Severity">
          <Select value={severity} onChange={(e) => setSeverity(e.target.value as KnownIssueSeverity)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as VehiclePriority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </Select>
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as KnownIssueStatus)}>
            {statuses.map((s) => (
              <option key={s} value={s}>{KNOWN_ISSUE_STATUS_LABELS[s]}</option>
            ))}
          </Select>
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Estimated repair cost (low)">
          <TextInput value={costLow} onChange={(e) => setCostLow(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Estimated repair cost (high)">
          <TextInput value={costHigh} onChange={(e) => setCostHigh(e.target.value)} inputMode="decimal" />
        </Field>
      </Row>
      <Field label="Description" style={{ marginTop: 10 }}>
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <Field label="Mechanic diagnosis" style={{ marginTop: 10 }}>
        <TextArea value={diagnosis} onChange={(e) => setDiagnosis(e.target.value)} />
      </Field>
      <Field label="Notes" style={{ marginTop: 10 }}>
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Row style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!title.trim()} onClick={submit}>Save issue</Button>
      </Row>
    </Modal>
  );
};

/* ------------------------------------------------------------------ *\n * Part estimate\n * ------------------------------------------------------------------ */

export const PartEstimateModal: React.FC<{
  vehicle: Vehicle;
  nextServiceItems: NextServiceItem[];
  initial?: PartEstimate;
  onSave: (estimate: PartEstimate) => void;
  onClose: () => void;
}> = ({ vehicle, nextServiceItems, initial, onSave, onClose }) => {
  const [partName, setPartName] = useState(initial?.partName ?? '');
  const [estimatedPartPrice, setEstimatedPartPrice] = useState(initial?.estimatedPartPrice !== undefined ? String(initial.estimatedPartPrice) : '');
  const [estimatedLabour, setEstimatedLabour] = useState(initial?.estimatedLabour !== undefined ? String(initial.estimatedLabour) : '');
  const [quantity, setQuantity] = useState(String(initial?.quantity ?? 1));
  const [supplier, setSupplier] = useState(initial?.supplier ?? '');
  const [actualFinalPrice, setActualFinalPrice] = useState(initial?.actualFinalPrice !== undefined ? String(initial.actualFinalPrice) : '');
  const [nextServiceItemId, setNextServiceItemId] = useState(initial?.nextServiceItemId ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');

  const submit = () => {
    if (!partName.trim()) return;
    const now = new Date().toISOString();
    onSave({
      id: initial?.id ?? vehicleId('part'),
      vehicleId: vehicle.id,
      partName: partName.trim(),
      estimatedPartPrice: num(estimatedPartPrice),
      estimatedLabour: num(estimatedLabour),
      quantity: num(quantity) ?? 1,
      supplier: supplier || undefined,
      notes: notes || undefined,
      actualFinalPrice: num(actualFinalPrice),
      nextServiceItemId: nextServiceItemId || undefined,
      createdAt: initial?.createdAt ?? now,
      updatedAt: now,
    });
  };

  return (
    <Modal title={initial ? 'Edit part estimate' : 'Add part estimate'} onClose={onClose}>
      <Field label="Part name">
        <TextInput value={partName} onChange={(e) => setPartName(e.target.value)} placeholder="Brake pads" />
      </Field>
      <Row style={{ marginTop: 10 }}>
        <Field label="Estimated part price">
          <TextInput value={estimatedPartPrice} onChange={(e) => setEstimatedPartPrice(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Estimated labour">
          <TextInput value={estimatedLabour} onChange={(e) => setEstimatedLabour(e.target.value)} inputMode="decimal" />
        </Field>
        <Field label="Quantity">
          <TextInput value={quantity} onChange={(e) => setQuantity(e.target.value)} inputMode="numeric" />
        </Field>
      </Row>
      <Row style={{ marginTop: 10 }}>
        <Field label="Supplier / source">
          <TextInput value={supplier} onChange={(e) => setSupplier(e.target.value)} />
        </Field>
        <Field label="Actual final price (once completed)">
          <TextInput value={actualFinalPrice} onChange={(e) => setActualFinalPrice(e.target.value)} inputMode="decimal" />
        </Field>
      </Row>
      <Field label="Link to next-service item (optional)" style={{ marginTop: 10 }}>
        <Select value={nextServiceItemId} onChange={(e) => setNextServiceItemId(e.target.value)}>
          <option value="">— none —</option>
          {nextServiceItems.filter((i) => i.vehicleId === vehicle.id).map((item) => (
            <option key={item.id} value={item.id}>{item.title}</option>
          ))}
        </Select>
      </Field>
      <Field label="Notes" style={{ marginTop: 10 }}>
        <TextArea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <Row style={{ marginTop: 16, justifyContent: 'flex-end' }}>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button disabled={!partName.trim()} onClick={submit}>Save estimate</Button>
      </Row>
    </Modal>
  );
};
