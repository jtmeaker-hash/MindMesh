import React, { useMemo, useState } from 'react';
import {
  Car,
  Gauge,
  Wrench,
  AlertTriangle,
  History,
  Settings as SettingsIcon,
  Plus,
  Check,
  ChevronRight,
  Trash2,
  Calendar,
  RotateCcw,
  ClipboardList,
  Info,
} from 'lucide-react';
import {
  KNOWN_ISSUE_STATUS_LABELS,
  type KnownVehicleIssue,
  type MaintenanceItem,
  type NextServiceItem,
  type PartEstimate,
  type ServiceRecord,
  type Vehicle,
  type VehicleServiceStatus,
  type VehicleState,
} from '../../types/vehicle';
import {
  addVehicle,
  applyServiceCompletion,
  averageKmPerWeek,
  computeMaintenanceItemStatus,
  computeNextService,
  deleteVehicle,
  estimateDateForKm,
  estimateWeeksForKm,
  formatKm,
  getVehicleServiceRecords,
  getVehicleServiceStatus,
  isIssueOpen,
  promoteKnownIssueToNextService,
  recordOdometer,
  reopenKnownIssue,
  resolveItemEstimatedTotal,
  saveVehicle,
} from '../../services/vehicleMaintenance';
import {
  Button,
  Field,
  Panel,
  Row,
  Select,
  StatusPill,
  TextInput,
  V,
  formatDateAU,
  money,
  vehicleLabel,
} from './VehicleUi';
import {
  KnownIssueModal,
  MaintenanceItemModal,
  OdometerModal,
  PartEstimateModal,
  PlanItemModal,
  ServiceFormModal,
  VehicleFormModal,
} from './VehicleForms';

type Tab = 'overview' | 'next' | 'items' | 'issues' | 'history' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'next', label: 'Next Service' },
  { id: 'items', label: 'Items' },
  { id: 'issues', label: 'Issues' },
  { id: 'history', label: 'History' },
  { id: 'settings', label: 'Settings' },
];

export interface VehicleModuleProps {
  vehicleState: VehicleState;
  onUpdateVehicleState: (updater: (prev: VehicleState) => VehicleState) => void;
  appNotificationsEnabled: boolean;
}

export const VehicleModule: React.FC<VehicleModuleProps> = ({ vehicleState, onUpdateVehicleState, appNotificationsEnabled }) => {
  const [selectedId, setSelectedId] = useState<string | null>(vehicleState.vehicles[0]?.id ?? null);
  const [tab, setTab] = useState<Tab>('overview');
  const [toast, setToast] = useState<string | null>(null);

  const [vehicleFormOpen, setVehicleFormOpen] = useState(false);
  const [vehicleFormInitial, setVehicleFormInitial] = useState<Vehicle | undefined>();
  const [odometerOpen, setOdometerOpen] = useState(false);
  const [serviceOpen, setServiceOpen] = useState(false);
  const [serviceEdit, setServiceEdit] = useState<ServiceRecord | undefined>();
  const [planOpen, setPlanOpen] = useState(false);
  const [planEdit, setPlanEdit] = useState<NextServiceItem | undefined>();
  const [itemOpen, setItemOpen] = useState(false);
  const [itemEdit, setItemEdit] = useState<MaintenanceItem | undefined>();
  const [issueOpen, setIssueOpen] = useState(false);
  const [issueEdit, setIssueEdit] = useState<KnownVehicleIssue | undefined>();
  const [partOpen, setPartOpen] = useState(false);
  const [partEdit, setPartEdit] = useState<PartEstimate | undefined>();

  const update = (fn: (prev: VehicleState) => VehicleState) => onUpdateVehicleState(fn);

  const selectedVehicle = useMemo(
    () => vehicleState.vehicles.find((v) => v.id === selectedId) ?? vehicleState.vehicles[0] ?? null,
    [vehicleState.vehicles, selectedId]
  );

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  const odometerRecords = useMemo(
    () => (selectedVehicle ? vehicleState.odometerRecords.filter((r) => r.vehicleId === selectedVehicle.id) : []),
    [vehicleState.odometerRecords, selectedVehicle]
  );
  const serviceRecords = useMemo(
    () => (selectedVehicle ? getVehicleServiceRecords(vehicleState.serviceRecords, selectedVehicle.id) : []),
    [vehicleState.serviceRecords, selectedVehicle]
  );
  const maintenanceItems = useMemo(
    () => (selectedVehicle ? vehicleState.maintenanceItems.filter((i) => i.vehicleId === selectedVehicle.id) : []),
    [vehicleState.maintenanceItems, selectedVehicle]
  );
  const knownIssues = useMemo(
    () => (selectedVehicle ? vehicleState.knownIssues.filter((i) => i.vehicleId === selectedVehicle.id) : []),
    [vehicleState.knownIssues, selectedVehicle]
  );
  const planItems = useMemo(
    () => (selectedVehicle ? vehicleState.nextServiceItems.filter((i) => i.vehicleId === selectedVehicle.id && !i.completed) : []),
    [vehicleState.nextServiceItems, selectedVehicle]
  );
  const partEstimates = useMemo(
    () => (selectedVehicle ? vehicleState.partEstimates.filter((p) => p.vehicleId === selectedVehicle.id) : []),
    [vehicleState.partEstimates, selectedVehicle]
  );

  const nextInfo = useMemo(
    () => (selectedVehicle ? computeNextService(selectedVehicle, vehicleState.serviceRecords) : undefined),
    [selectedVehicle, vehicleState.serviceRecords]
  );
  const status = useMemo(
    () => (nextInfo ? getVehicleServiceStatus(nextInfo, vehicleState.thresholds) : undefined),
    [nextInfo, vehicleState.thresholds]
  );
  const kmPerWeek = useMemo(() => averageKmPerWeek(odometerRecords), [odometerRecords]);
  const estimatedWeeks = useMemo(
    () => estimateWeeksForKm(nextInfo?.kmRemaining, kmPerWeek),
    [nextInfo?.kmRemaining, kmPerWeek]
  );
  const estimatedDate = useMemo(
    () => estimateDateForKm(nextInfo?.kmRemaining, kmPerWeek),
    [nextInfo?.kmRemaining, kmPerWeek]
  );

  const maintenanceStatuses = useMemo(
    () =>
      selectedVehicle
        ? maintenanceItems.map((item) => ({
            item,
            status: computeMaintenanceItemStatus(item, selectedVehicle.currentOdometerKm, vehicleState.thresholds),
          }))
        : [],
    [maintenanceItems, selectedVehicle, vehicleState.thresholds]
  );
  const dueSoonCount = maintenanceStatuses.filter(
    (entry) => entry.status.status !== 'ok' && entry.status.message !== 'No replacement record'
  ).length;
  const openIssueCount = knownIssues.filter(isIssueOpen).length;

  const costSummary = useMemo(() => {
    let scheduled = 0;
    let knownIssue = 0;
    let recommended = 0;
    let unknown = 0;
    for (const item of planItems) {
      const resolved = resolveItemEstimatedTotal(item);
      if (!resolved.hasEstimate) {
        unknown += 1;
        continue;
      }
      const value = resolved.estimated ?? 0;
      if (item.source === 'known_issue') knownIssue += value;
      else if (item.source === 'recommended' || item.source === 'mechanic') recommended += value;
      else scheduled += value;
    }
    const total = scheduled + knownIssue + recommended;
    return { scheduled, knownIssue, recommended, total, unknown };
  }, [planItems]);

  /* ----------------------------- actions ----------------------------- */

  const handleSaveVehicle = (vehicle: Vehicle) => {
    update((prev) => (prev.vehicles.some((v) => v.id === vehicle.id) ? saveVehicle(prev, vehicle) : addVehicle(prev, vehicle)));
    setSelectedId(vehicle.id);
    setVehicleFormOpen(false);
    setVehicleFormInitial(undefined);
    showToast('Vehicle saved. Serviceable components have been seeded.');
  };

  const handleSaveOdometer = (km: number, note?: string) => {
    if (!selectedVehicle) return;
    update((prev) => recordOdometer(prev, selectedVehicle.id, km, new Date().toISOString(), note));
    setOdometerOpen(false);
    showToast('Odometer updated — service status recalculated.');
  };

  const handleSaveService = (record: ServiceRecord) => {
    const result = applyServiceCompletion(vehicleState, record);
    update(() => result.state);
    setServiceOpen(false);
    setServiceEdit(undefined);
    const bits: string[] = [];
    if (result.itemUpdates.length) bits.push(`${result.itemUpdates.length} component(s) updated`);
    if (result.completedNextServiceItemIds.length) bits.push(`${result.completedNextServiceItemIds.length} plan item(s) completed`);
    if (result.resolvedIssueIds.length) bits.push(`${result.resolvedIssueIds.length} known issue(s) resolved`);
    showToast(bits.length ? `Service saved: ${bits.join(', ')}.` : 'Service saved to history.');
  };

  const handleSavePlanItem = (item: NextServiceItem) => {
    update((prev) => {
      const exists = prev.nextServiceItems.some((i) => i.id === item.id);
      return {
        ...prev,
        nextServiceItems: exists ? prev.nextServiceItems.map((i) => (i.id === item.id ? item : i)) : [...prev.nextServiceItems, item],
      };
    });
    setPlanOpen(false);
    setPlanEdit(undefined);
    showToast('Next-service plan updated.');
  };

  const handleSaveItem = (item: MaintenanceItem) => {
    update((prev) => {
      const exists = prev.maintenanceItems.some((i) => i.id === item.id);
      return {
        ...prev,
        maintenanceItems: exists ? prev.maintenanceItems.map((i) => (i.id === item.id ? item : i)) : [...prev.maintenanceItems, item],
      };
    });
    setItemOpen(false);
    setItemEdit(undefined);
    showToast('Maintenance item saved — next replacement recalculated.');
  };

  const handleSaveIssue = (issue: KnownVehicleIssue) => {
    update((prev) => {
      const exists = prev.knownIssues.some((i) => i.id === issue.id);
      return {
        ...prev,
        knownIssues: exists ? prev.knownIssues.map((i) => (i.id === issue.id ? issue : i)) : [...prev.knownIssues, issue],
      };
    });
    setIssueOpen(false);
    setIssueEdit(undefined);
    showToast('Known issue saved.');
  };

  const handleSavePart = (estimate: PartEstimate) => {
    update((prev) => {
      const exists = prev.partEstimates.some((p) => p.id === estimate.id);
      return {
        ...prev,
        partEstimates: exists ? prev.partEstimates.map((p) => (p.id === estimate.id ? estimate : p)) : [...prev.partEstimates, estimate],
      };
    });
    setPartOpen(false);
    setPartEdit(undefined);
    showToast('Part estimate saved.');
  };

  const handleDeleteVehicle = () => {
    if (!selectedVehicle) return;
    if (!window.confirm(`Delete ${vehicleLabel(selectedVehicle)} and all of its history? This cannot be undone.`)) return;
    update((prev) => deleteVehicle(prev, selectedVehicle.id));
    setSelectedId(null);
    showToast('Vehicle deleted.');
  };

  const handlePromote = (issueId: string) => {
    update((prev) => promoteKnownIssueToNextService(prev, issueId));
    setTab('next');
    showToast('Known issue added to the next service plan.');
  };

  const handleReopen = (issueId: string) => {
    update((prev) => reopenKnownIssue(prev, issueId));
    showToast('Known issue reopened.');
  };

  /* ----------------------------- render ----------------------------- */

  return (
    <div
      className="mm-module"
      style={{ flex: '1 1 0%', minHeight: 0, minWidth: 0, width: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* Vehicle selector */}
      <div style={{ padding: '14px 16px 10px', display: 'flex', gap: 8, overflowX: 'auto', alignItems: 'center' }}>
        {vehicleState.vehicles.map((vehicle) => {
          const active = selectedVehicle?.id === vehicle.id;
          return (
            <button
              key={vehicle.id}
              type="button"
              onClick={() => setSelectedId(vehicle.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 7,
                padding: '8px 13px',
                borderRadius: 999,
                border: `1px solid ${active ? V.accent : V.border}`,
                background: active ? V.accentSoft : 'rgba(15,23,42,0.6)',
                color: active ? '#bae6fd' : V.muted,
                fontSize: 13,
                fontWeight: active ? 700 : 500,
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                flexShrink: 0,
              }}
            >
              <Car size={15} />
              {vehicleLabel(vehicle)}
            </button>
          );
        })}
        <Button
          variant="subtle"
          style={{ flexShrink: 0 }}
          onClick={() => {
            setVehicleFormInitial(undefined);
            setVehicleFormOpen(true);
          }}
        >
          <Plus size={15} /> Vehicle
        </Button>
      </div>

      {toast && (
        <div
          role="status"
          style={{
            margin: '0 16px 8px',
            padding: '9px 12px',
            borderRadius: 10,
            background: 'rgba(56, 189, 248, 0.12)',
            border: `1px solid ${V.borderStrong}`,
            color: '#bae6fd',
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Check size={15} /> {toast}
        </div>
      )}

      <div style={{ flex: '1 1 0%', minHeight: 0, overflowY: 'auto', padding: '0 16px 32px' }}>
        {!selectedVehicle ? (
          <div style={{ textAlign: 'center', padding: '48px 20px', color: V.muted }}>
            <Car size={40} color={V.accent} style={{ marginBottom: 12 }} />
            <h2 style={{ fontSize: 18, fontWeight: 800, color: '#f8fafc', marginBottom: 6 }}>No vehicles yet</h2>
            <p style={{ fontSize: 13, maxWidth: 420, margin: '0 auto 18px', lineHeight: 1.6 }}>
              Add a vehicle to track servicing by odometer and service history. MindMesh calculates the next service, remaining kilometres,
              upcoming costs and known faults automatically.
            </p>
            <Button
              onClick={() => {
                setVehicleFormInitial(undefined);
                setVehicleFormOpen(true);
              }}
            >
              <Plus size={16} /> Add your first vehicle
            </Button>
          </div>
        ) : (
          <>
            <DashboardCard
              vehicle={selectedVehicle}
              status={status}
              nextInfo={nextInfo}
              estimatedCost={costSummary.total}
              unknownCostCount={costSummary.unknown}
              openIssueCount={openIssueCount}
              dueSoonCount={dueSoonCount}
              lastService={serviceRecords[0]}
              onUpdateKm={() => setOdometerOpen(true)}
              onNextService={() => setTab('next')}
              onItems={() => setTab('items')}
              onIssues={() => setTab('issues')}
              onHistory={() => setTab('history')}
            />

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 6, overflowX: 'auto', margin: '14px 0' }}>
              {TABS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => setTab(entry.id)}
                  style={{
                    padding: '8px 13px',
                    borderRadius: 10,
                    border: `1px solid ${tab === entry.id ? V.borderStrong : V.border}`,
                    background: tab === entry.id ? V.accentSoft : 'transparent',
                    color: tab === entry.id ? '#bae6fd' : V.muted,
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {tab === 'overview' && (
              <OverviewTab
                vehicle={selectedVehicle}
                status={status}
                nextInfo={nextInfo}
                odometerRecords={odometerRecords}
                serviceRecords={serviceRecords}
                kmPerWeek={kmPerWeek}
                estimatedWeeks={estimatedWeeks}
                estimatedDate={estimatedDate}
                onUpdateKm={() => setOdometerOpen(true)}
              />
            )}

            {tab === 'next' && (
              <NextServiceTab
                planItems={planItems}
                costSummary={costSummary}
                partEstimates={partEstimates}
                onAdd={() => {
                  setPlanEdit(undefined);
                  setPlanOpen(true);
                }}
                onEdit={(item) => {
                  setPlanEdit(item);
                  setPlanOpen(true);
                }}
                onRemove={(id) => update((prev) => ({ ...prev, nextServiceItems: prev.nextServiceItems.filter((i) => i.id !== id) }))}
                onAddPart={() => {
                  setPartEdit(undefined);
                  setPartOpen(true);
                }}
                onEditPart={(p) => {
                  setPartEdit(p);
                  setPartOpen(true);
                }}
                onRemovePart={(id) => update((prev) => ({ ...prev, partEstimates: prev.partEstimates.filter((p) => p.id !== id) }))}
                onRecordService={() => {
                  setServiceEdit(undefined);
                  setServiceOpen(true);
                }}
              />
            )}

            {tab === 'items' && (
              <ItemsTab
                entries={maintenanceStatuses}
                onAdd={() => {
                  setItemEdit(undefined);
                  setItemOpen(true);
                }}
                onEdit={(item) => {
                  setItemEdit(item);
                  setItemOpen(true);
                }}
                onRecordService={() => {
                  setServiceEdit(undefined);
                  setServiceOpen(true);
                }}
              />
            )}

            {tab === 'issues' && (
              <IssuesTab
                issues={knownIssues}
                onAdd={() => {
                  setIssueEdit(undefined);
                  setIssueOpen(true);
                }}
                onEdit={(issue) => {
                  setIssueEdit(issue);
                  setIssueOpen(true);
                }}
                onPromote={handlePromote}
                onReopen={handleReopen}
                onResolve={(id) =>
                  update((prev) => ({
                    ...prev,
                    knownIssues: prev.knownIssues.map((i) => (i.id === id ? { ...i, status: 'repaired', resolvedAt: new Date().toISOString() } : i)),
                  }))
                }
                onDelete={(id) => update((prev) => ({ ...prev, knownIssues: prev.knownIssues.filter((i) => i.id !== id) }))}
              />
            )}

            {tab === 'history' && (
              <HistoryTab
                records={serviceRecords}
                serviceTypes={vehicleState.serviceTypes}
                onAdd={() => {
                  setServiceEdit(undefined);
                  setServiceOpen(true);
                }}
                onEdit={(record) => {
                  setServiceEdit(record);
                  setServiceOpen(true);
                }}
              />
            )}

            {tab === 'settings' && (
              <SettingsTab
                vehicle={selectedVehicle}
                vehicleState={vehicleState}
                appNotificationsEnabled={appNotificationsEnabled}
                onEditVehicle={() => {
                  setVehicleFormInitial(selectedVehicle);
                  setVehicleFormOpen(true);
                }}
                onUpdate={update}
                onDelete={handleDeleteVehicle}
                onAddVehicle={() => {
                  setVehicleFormInitial(undefined);
                  setVehicleFormOpen(true);
                }}
              />
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {vehicleFormOpen && (
        <VehicleFormModal initial={vehicleFormInitial} onSave={handleSaveVehicle} onClose={() => setVehicleFormOpen(false)} />
      )}
      {odometerOpen && selectedVehicle && (
        <OdometerModal vehicle={selectedVehicle} onSave={handleSaveOdometer} onClose={() => setOdometerOpen(false)} />
      )}
      {serviceOpen && selectedVehicle && (
        <ServiceFormModal
          vehicle={selectedVehicle}
          maintenanceItems={vehicleState.maintenanceItems}
          serviceTypes={vehicleState.serviceTypes}
          initial={serviceEdit}
          onSave={handleSaveService}
          onClose={() => {
            setServiceOpen(false);
            setServiceEdit(undefined);
          }}
        />
      )}
      {planOpen && selectedVehicle && (
        <PlanItemModal
          vehicle={selectedVehicle}
          maintenanceItems={vehicleState.maintenanceItems}
          initial={planEdit}
          onSave={handleSavePlanItem}
          onClose={() => {
            setPlanOpen(false);
            setPlanEdit(undefined);
          }}
        />
      )}
      {itemOpen && selectedVehicle && (
        <MaintenanceItemModal
          vehicle={selectedVehicle}
          initial={itemEdit}
          onSave={handleSaveItem}
          onClose={() => {
            setItemOpen(false);
            setItemEdit(undefined);
          }}
        />
      )}
      {issueOpen && selectedVehicle && (
        <KnownIssueModal
          vehicle={selectedVehicle}
          initial={issueEdit}
          onSave={handleSaveIssue}
          onClose={() => {
            setIssueOpen(false);
            setIssueEdit(undefined);
          }}
        />
      )}
      {partOpen && selectedVehicle && (
        <PartEstimateModal
          vehicle={selectedVehicle}
          nextServiceItems={vehicleState.nextServiceItems}
          initial={partEdit}
          onSave={handleSavePart}
          onClose={() => {
            setPartOpen(false);
            setPartEdit(undefined);
          }}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ *\n * Dashboard card\n * ------------------------------------------------------------------ */

const DashboardCard: React.FC<{
  vehicle: Vehicle;
  status: ReturnType<typeof getVehicleServiceStatus> | undefined;
  nextInfo: ReturnType<typeof computeNextService> | undefined;
  estimatedCost: number;
  unknownCostCount: number;
  openIssueCount: number;
  dueSoonCount: number;
  lastService: ServiceRecord | undefined;
  onUpdateKm: () => void;
  onNextService: () => void;
  onItems: () => void;
  onIssues: () => void;
  onHistory: () => void;
}> = ({
  vehicle,
  status,
  nextInfo,
  estimatedCost,
  unknownCostCount,
  openIssueCount,
  dueSoonCount,
  lastService,
  onUpdateKm,
  onNextService,
  onItems,
  onIssues,
  onHistory,
}) => {
  const title = [vehicle.year, vehicle.make, vehicle.model].filter(Boolean).join(' ') || vehicleLabel(vehicle);
  return (
    <Panel>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
        <div
          style={{
            width: 54,
            height: 54,
            borderRadius: 14,
            background: V.accentSoft,
            border: `1px solid ${V.borderStrong}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            flexShrink: 0,
          }}
        >
          {vehicle.photo ? (
            <img src={vehicle.photo} alt={vehicleLabel(vehicle)} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <Car size={26} color={V.accent} />
          )}
        </div>
        <div style={{ flex: '1 1 200px', minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: '#f8fafc' }}>{title}</div>
          <div style={{ fontSize: 12, color: V.muted, marginTop: 2 }}>
            {vehicle.registrationPlate ? `${vehicle.registrationPlate} · ` : ''}
            {vehicleLabel(vehicle)}
          </div>
          <div style={{ fontSize: 24, fontWeight: 800, color: V.accent, marginTop: 6 }}>
            {vehicle.currentOdometerKm.toLocaleString('en-AU')} <span style={{ fontSize: 13, color: V.muted }}>KM</span>
          </div>
        </div>
        {status && <StatusPill status={status.status} label={status.label} />}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginTop: 14 }}>
        <Stat label="Next service" value={nextInfo?.nextServiceKm !== undefined ? `${nextInfo.nextServiceKm.toLocaleString('en-AU')} km` : '—'} />
        <Stat label="Remaining" value={status?.kmRemaining !== undefined ? formatKm(status.kmRemaining) : status?.message ?? '—'} accent={status?.status} />
        <Stat label="Estimated cost" value={`${money(estimatedCost)}${unknownCostCount ? ` +${unknownCostCount}` : ''}`} />
        <Stat label="Known issues" value={String(openIssueCount)} />
        <Stat label="Maintenance due soon" value={String(dueSoonCount)} />
        <Stat label="Last service" value={lastService ? formatDateAU(lastService.date) : '—'} />
      </div>

      <Row style={{ marginTop: 14 }}>
        <Button onClick={onUpdateKm}><Gauge size={15} /> Update KM</Button>
        <Button variant="subtle" onClick={onNextService}><ClipboardList size={15} /> Next Service</Button>
        <Button variant="ghost" onClick={onItems}><Wrench size={15} /> Maintenance Items</Button>
        <Button variant="ghost" onClick={onIssues}><AlertTriangle size={15} /> Known Issues</Button>
        <Button variant="ghost" onClick={onHistory}><History size={15} /> Service History</Button>
      </Row>
    </Panel>
  );
};

const Stat: React.FC<{ label: string; value: string; accent?: VehicleServiceStatus }> = ({ label, value, accent }) => (
  <div style={{ background: V.panelAlt, border: `1px solid ${V.border}`, borderRadius: 12, padding: '10px 12px' }}>
    <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase', color: V.faint }}>{label}</div>
    <div style={{ fontSize: 15, fontWeight: 700, color: accent ? '#f8fafc' : V.text, marginTop: 3 }}>{value}</div>
  </div>
);

/* ------------------------------------------------------------------ *\n * Tabs\n * ------------------------------------------------------------------ */

const OverviewTab: React.FC<{
  vehicle: Vehicle;
  status: ReturnType<typeof getVehicleServiceStatus> | undefined;
  nextInfo: ReturnType<typeof computeNextService> | undefined;
  odometerRecords: VehicleState['odometerRecords'];
  serviceRecords: ServiceRecord[];
  kmPerWeek: number | undefined;
  estimatedWeeks: number | undefined;
  estimatedDate: string | undefined;
  onUpdateKm: () => void;
}> = ({ vehicle, status, nextInfo, odometerRecords, serviceRecords, kmPerWeek, estimatedWeeks, estimatedDate, onUpdateKm }) => {
  const recent = odometerRecords.slice().sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt)).slice(0, 6);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Panel title="Service status">
        {status ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <StatusPill status={status.status} label={status.label} />
            <div style={{ fontSize: 14, color: V.text }}>{status.message}</div>
            <div style={{ fontSize: 12.5, color: V.muted }}>
              Formula: last service {nextInfo?.lastServiceKm !== undefined ? formatKm(nextInfo.lastServiceKm) : '—'} + interval{' '}
              {formatKm(vehicle.serviceIntervalKm)} = next service {nextInfo?.nextServiceKm !== undefined ? formatKm(nextInfo.nextServiceKm) : '—'}
            </div>
            {nextInfo?.nextServiceDate && (
              <div style={{ fontSize: 12.5, color: V.muted }}>
                Time interval: next due {formatDateAU(nextInfo.nextServiceDate)}
                {status.daysRemaining !== undefined ? ` (${status.daysRemaining} day${status.daysRemaining === 1 ? '' : 's'})` : ''}
              </div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: V.muted }}>Set a service interval to calculate the next service.</p>
        )}
      </Panel>

      <Panel title="Estimated service date" right={<Info size={14} color={V.faint} />}>
        <p style={{ fontSize: 12.5, color: V.muted, marginBottom: 8 }}>Estimate only — the kilometre and date thresholds always take precedence.</p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Stat label="Average driving" value={kmPerWeek !== undefined ? `${Math.round(kmPerWeek)} km/week` : 'Not enough data'} />
          <Stat
            label="Estimated time to service"
            value={estimatedWeeks !== undefined ? `~${Math.round(estimatedWeeks)} week${Math.round(estimatedWeeks) === 1 ? '' : 's'}` : '—'}
          />
          <Stat label="Approx. date" value={estimatedDate ? formatDateAU(estimatedDate) : '—'} />
        </div>
      </Panel>

      <Panel
        title="Odometer history"
        right={<Button variant="subtle" onClick={onUpdateKm}><Gauge size={14} /> Update</Button>}
      >
        {recent.length === 0 ? (
          <p style={{ fontSize: 13, color: V.muted }}>No readings yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {recent.map((record) => (
              <div key={record.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '6px 0', borderBottom: `1px solid ${V.border}` }}>
                <span style={{ color: V.muted }}>{formatDateAU(record.recordedAt.slice(0, 10))}</span>
                <span style={{ color: V.text, fontWeight: 600 }}>{record.odometerKm.toLocaleString('en-AU')} km</span>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Last service">
        {serviceRecords[0] ? (
          <div style={{ fontSize: 13, color: V.text, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontWeight: 700 }}>{serviceRecords[0].odometerKm.toLocaleString('en-AU')} km · {formatDateAU(serviceRecords[0].date)}</div>
            <div style={{ color: V.muted }}>{serviceRecords[0].workshop ?? '—'}{serviceRecords[0].totalCost !== undefined ? ` · ${money(serviceRecords[0].totalCost)}` : ''}</div>
            {serviceRecords[0].replacedItems.length > 0 && (
              <div style={{ color: V.muted }}>Completed: {serviceRecords[0].replacedItems.join(', ')}</div>
            )}
            {serviceRecords[0].recommendedWork.length > 0 && (
              <div style={{ color: '#bae6fd' }}>Recommended next: {serviceRecords[0].recommendedWork.join(', ')}</div>
            )}
          </div>
        ) : (
          <p style={{ fontSize: 13, color: V.muted }}>No services recorded yet. Add a previous service from the History tab.</p>
        )}
      </Panel>
    </div>
  );
};

const NextServiceTab: React.FC<{
  planItems: NextServiceItem[];
  costSummary: { scheduled: number; knownIssue: number; recommended: number; total: number; unknown: number };
  partEstimates: PartEstimate[];
  onAdd: () => void;
  onEdit: (item: NextServiceItem) => void;
  onRemove: (id: string) => void;
  onAddPart: () => void;
  onEditPart: (part: PartEstimate) => void;
  onRemovePart: (id: string) => void;
  onRecordService: () => void;
}> = ({ planItems, costSummary, partEstimates, onAdd, onEdit, onRemove, onAddPart, onEditPart, onRemovePart, onRecordService }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
    <Panel
      title="Next service plan"
      right={
        <Row>
          <Button variant="subtle" onClick={onAdd}><Plus size={14} /> Item</Button>
          <Button onClick={onRecordService}><Check size={14} /> Record service</Button>
        </Row>
      }
    >
      {planItems.length === 0 ? (
        <p style={{ fontSize: 13, color: V.muted }}>Nothing planned yet. Add items, or promote a known issue.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {planItems.map((item) => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${V.border}` }}>
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: V.text }}>{item.title}</div>
                <div style={{ fontSize: 11.5, color: V.muted }}>
                  {item.requirement === 'required' ? 'Required' : 'Recommended'} · {sourceLabel(item.source)}
                  {item.reason ? ` · ${item.reason}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 13, color: V.text, fontWeight: 600 }}>{money(resolveItemEstimatedTotal(item).estimated)}</div>
              <button type="button" onClick={() => onEdit(item)} style={iconBtn} aria-label="Edit"><SettingsIcon size={15} /></button>
              <button type="button" onClick={() => onRemove(item.id)} style={iconBtn} aria-label="Remove"><Trash2 size={15} color={V.danger} /></button>
            </div>
          ))}
        </div>
      )}

      <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 10 }}>
        <Stat label="Scheduled maintenance" value={money(costSummary.scheduled)} />
        <Stat label="Known issues" value={money(costSummary.knownIssue)} />
        <Stat label="Recommended repairs" value={money(costSummary.recommended)} />
        <Stat label="Estimated total" value={`${money(costSummary.total)}${costSummary.unknown ? ` +${costSummary.unknown} no estimate` : ''}`} />
      </div>
      {costSummary.unknown > 0 && (
        <p style={{ fontSize: 11.5, color: V.faint, marginTop: 8 }}>
          {costSummary.unknown} item{costSummary.unknown === 1 ? '' : 's'} have no cost estimate and are not treated as $0.
        </p>
      )}
    </Panel>

    <Panel title="Parts / repair estimates" right={<Button variant="subtle" onClick={onAddPart}><Plus size={14} /> Estimate</Button>}>
      {partEstimates.length === 0 ? (
        <p style={{ fontSize: 13, color: V.muted }}>No part estimates yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {partEstimates.map((part) => {
            const estimated = (part.estimatedPartPrice ?? 0) * (part.quantity || 1) + (part.estimatedLabour ?? 0);
            const diff = part.actualFinalPrice !== undefined ? part.actualFinalPrice - estimated : undefined;
            return (
              <div key={part.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: `1px solid ${V.border}` }}>
                <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: V.text }}>{part.partName}{part.quantity > 1 ? ` × ${part.quantity}` : ''}</div>
                  <div style={{ fontSize: 11.5, color: V.muted }}>
                    {part.supplier ? `${part.supplier} · ` : ''}Estimated {money(estimated)}
                    {part.actualFinalPrice !== undefined ? ` · Actual ${money(part.actualFinalPrice)}` : ''}
                  </div>
                </div>
                {diff !== undefined && (
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: diff <= 0 ? '#34d399' : '#f87171' }}>
                    {diff <= 0 ? '-' : '+'}{money(Math.abs(diff))}
                  </span>
                )}
                <button type="button" onClick={() => onEditPart(part)} style={iconBtn} aria-label="Edit"><SettingsIcon size={15} /></button>
                <button type="button" onClick={() => onRemovePart(part.id)} style={iconBtn} aria-label="Remove"><Trash2 size={15} color={V.danger} /></button>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  </div>
);

const ItemsTab: React.FC<{
  entries: { item: MaintenanceItem; status: ReturnType<typeof computeMaintenanceItemStatus> }[];
  onAdd: () => void;
  onEdit: (item: MaintenanceItem) => void;
  onRecordService: () => void;
}> = ({ entries, onAdd, onEdit, onRecordService }) => {
  const [filter, setFilter] = useState<string>('all');
  const filters = ['all', 'due', 'engine', 'brakes', 'tyres', 'transmission', 'electrical', 'custom'];
  const filtered = entries.filter((entry) => {
    if (filter === 'all') return true;
    if (filter === 'due') return entry.status.status !== 'ok' && entry.status.message !== 'No replacement record';
    return entry.item.category === filter;
  });
  return (
    <Panel
      title="Maintenance status"
      right={<Row><Button variant="subtle" onClick={onAdd}><Plus size={14} /> Custom item</Button><Button onClick={onRecordService}><Check size={14} /> Record service</Button></Row>}
    >
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto', marginBottom: 10 }}>
        {filters.map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFilter(f)}
            style={{
              padding: '5px 11px',
              borderRadius: 999,
              border: `1px solid ${filter === f ? V.borderStrong : V.border}`,
              background: filter === f ? V.accentSoft : 'transparent',
              color: filter === f ? '#bae6fd' : V.muted,
              fontSize: 11.5,
              fontWeight: 700,
              cursor: 'pointer',
              textTransform: 'capitalize',
              whiteSpace: 'nowrap',
            }}
          >
            {f}
          </button>
        ))}
      </div>
      {filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: V.muted }}>No items match this filter.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {filtered.map(({ item, status }) => (
            <button
              key={item.id}
              type="button"
              onClick={() => onEdit(item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '9px 10px',
                borderRadius: 10,
                background: V.panelAlt,
                border: `1px solid ${V.border}`,
                cursor: 'pointer',
                textAlign: 'left',
                width: '100%',
              }}
            >
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: V.text }}>{item.name}</div>
                <div style={{ fontSize: 11.5, color: V.muted }}>
                  {item.lastReplacedOdometerKm !== undefined ? `Last: ${item.lastReplacedOdometerKm.toLocaleString('en-AU')} km` : 'No replacement record'}
                  {status.nextReplacementKm !== undefined ? ` · Next: ${status.nextReplacementKm.toLocaleString('en-AU')} km` : ''}
                  {status.nextReplacementDate ? ` · Next: ${formatDateAU(status.nextReplacementDate)}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: status.status === 'ok' ? V.muted : '#f8fafc' }}>{status.message}</div>
                {status.status !== 'ok' && status.message !== 'No replacement record' && <StatusPill status={status.status} label={status.label.replace('SERVICE ', '')} />}
              </div>
              <ChevronRight size={16} color={V.faint} />
            </button>
          ))}
        </div>
      )}
    </Panel>
  );
};

const IssuesTab: React.FC<{
  issues: KnownVehicleIssue[];
  onAdd: () => void;
  onEdit: (issue: KnownVehicleIssue) => void;
  onPromote: (id: string) => void;
  onReopen: (id: string) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
}> = ({ issues, onAdd, onEdit, onPromote, onReopen, onResolve, onDelete }) => (
  <Panel title="Known issues" right={<Button variant="subtle" onClick={onAdd}><Plus size={14} /> Issue</Button>}>
    {issues.length === 0 ? (
      <p style={{ fontSize: 13, color: V.muted }}>No known issues. Add one when something needs attention outside routine servicing.</p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {issues.map((issue) => {
          const open = isIssueOpen(issue);
          const promoted = Boolean(issue.nextServiceItemId);
          return (
            <div key={issue.id} style={{ border: `1px solid ${V.border}`, borderRadius: 12, padding: 12, background: V.panelAlt }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: V.text }}>{issue.title}</div>
                  <div style={{ fontSize: 11.5, color: V.muted }}>
                    {KNOWN_ISSUE_STATUS_LABELS[issue.status]} · {issue.priority} priority
                    {issue.odometerWhenNoticedKm !== undefined ? ` · noticed at ${issue.odometerWhenNoticedKm.toLocaleString('en-AU')} km` : ''}
                  </div>
                </div>
                {(issue.estimatedRepairCostLow !== undefined || issue.estimatedRepairCostHigh !== undefined) && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                    {money(issue.estimatedRepairCostLow)}
                    {issue.estimatedRepairCostHigh !== undefined ? `–${money(issue.estimatedRepairCostHigh)}` : ''}
                  </div>
                )}
              </div>
              {issue.description && <p style={{ fontSize: 12.5, color: V.muted, margin: '8px 0 0' }}>{issue.description}</p>}
              <Row style={{ marginTop: 10 }}>
                {open && !promoted && (
                  <Button variant="subtle" onClick={() => onPromote(issue.id)}><ClipboardList size={14} /> Add to next service</Button>
                )}
                {open ? (
                  <Button variant="ghost" onClick={() => onResolve(issue.id)}><Check size={14} /> Mark repaired</Button>
                ) : (
                  <Button variant="ghost" onClick={() => onReopen(issue.id)}><RotateCcw size={14} /> Reopen</Button>
                )}
                <Button variant="ghost" onClick={() => onEdit(issue)}><SettingsIcon size={14} /> Edit</Button>
                <Button variant="danger" onClick={() => onDelete(issue.id)}><Trash2 size={14} /></Button>
              </Row>
              {promoted && <p style={{ fontSize: 11, color: '#bae6fd', marginTop: 8 }}>Included in the next service plan.</p>}
            </div>
          );
        })}
      </div>
    )}
  </Panel>
);

const HistoryTab: React.FC<{
  records: ServiceRecord[];
  serviceTypes: VehicleState['serviceTypes'];
  onAdd: () => void;
  onEdit: (record: ServiceRecord) => void;
}> = ({ records, serviceTypes, onAdd, onEdit }) => (
  <Panel title="Service history" right={<Button variant="subtle" onClick={onAdd}><Plus size={14} /> Service</Button>}>
    {records.length === 0 ? (
      <p style={{ fontSize: 13, color: V.muted }}>No services recorded. Add a missed service to build your history.</p>
    ) : (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {records.map((record) => {
          const type = serviceTypes.find((t) => t.id === record.serviceTypeId);
          return (
            <button
              key={record.id}
              type="button"
              onClick={() => onEdit(record)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 12, background: V.panelAlt, border: `1px solid ${V.border}`, cursor: 'pointer', textAlign: 'left', width: '100%' }}
            >
              <Calendar size={16} color={V.accent} />
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: V.text }}>{record.odometerKm.toLocaleString('en-AU')} km</div>
                <div style={{ fontSize: 11.5, color: V.muted }}>
                  {formatDateAU(record.date)} · {type?.name ?? 'Service'}
                  {record.workshop ? ` · ${record.workshop}` : ''}
                </div>
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 700, color: V.text }}>{money(record.totalCost)}</div>
              <ChevronRight size={16} color={V.faint} />
            </button>
          );
        })}
      </div>
    )}
    <p style={{ fontSize: 11, color: V.faint, marginTop: 10 }}>Service records are permanent — adding a new service never overwrites an older one.</p>
  </Panel>
);

const SettingsTab: React.FC<{
  vehicle: Vehicle;
  vehicleState: VehicleState;
  appNotificationsEnabled: boolean;
  onEditVehicle: () => void;
  onUpdate: (fn: (prev: VehicleState) => VehicleState) => void;
  onDelete: () => void;
  onAddVehicle: () => void;
}> = ({ vehicle, vehicleState, appNotificationsEnabled, onEditVehicle, onUpdate, onDelete, onAddVehicle }) => {
  const settings = vehicleState.notificationSettings;
  const toggles: { key: keyof typeof settings; label: string }[] = [
    { key: 'serviceApproaching', label: 'Service approaching' },
    { key: 'serviceDue', label: 'Service due' },
    { key: 'serviceOverdue', label: 'Service overdue' },
    { key: 'maintenanceApproaching', label: 'Maintenance item approaching' },
    { key: 'maintenanceDue', label: 'Maintenance item due' },
    { key: 'timeBasedMaintenance', label: 'Time-based maintenance due' },
    { key: 'knownIssueFollowUp', label: 'Known issue follow-up' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Panel title="Vehicle details" right={<Button variant="subtle" onClick={onEditVehicle}><SettingsIcon size={14} /> Edit</Button>}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8, fontSize: 13 }}>
          <DetailRow label="Nickname" value={vehicle.nickname} />
          <DetailRow label="Make / model" value={[vehicle.make, vehicle.model].filter(Boolean).join(' ') || '—'} />
          <DetailRow label="Year" value={vehicle.year ? String(vehicle.year) : '—'} />
          <DetailRow label="Registration" value={vehicle.registrationPlate ?? '—'} />
          <DetailRow label="VIN" value={vehicle.vin ?? '—'} />
          <DetailRow label="Engine" value={vehicle.engine ?? '—'} />
          <DetailRow label="Service interval" value={`${formatKm(vehicle.serviceIntervalKm)}${vehicle.serviceIntervalMonths ? ` / ${vehicle.serviceIntervalMonths} months` : ''}`} />
        </div>
      </Panel>

      <Panel title="Service thresholds">
        <p style={{ fontSize: 12, color: V.muted, marginBottom: 10 }}>Used to label each vehicle's service status.</p>
        <Row>
          <Field label="Approaching at (km remaining)">
            <TextInput
              value={String(vehicleState.thresholds.approachingKm)}
              inputMode="numeric"
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value)) return;
                onUpdate((prev) => ({ ...prev, thresholds: { ...prev.thresholds, approachingKm: Math.max(0, value) } }));
              }}
            />
          </Field>
          <Field label="Urgent at (km remaining)">
            <TextInput
              value={String(vehicleState.thresholds.urgentKm)}
              inputMode="numeric"
              onChange={(e) => {
                const value = Number(e.target.value);
                if (!Number.isFinite(value)) return;
                onUpdate((prev) => ({ ...prev, thresholds: { ...prev.thresholds, urgentKm: Math.max(0, value) } }));
              }}
            />
          </Field>
        </Row>
      </Panel>

      <Panel title="Reminders">
        {!appNotificationsEnabled && (
          <p style={{ fontSize: 12, color: '#fcd34d', marginBottom: 10 }}>
            MindMesh notifications are turned off app-wide, so vehicle reminders are paused.
          </p>
        )}
        <Row>
          <Field label="Odometer reminder">
            <Select
              value={settings.odometerReminderMode}
              onChange={(e) =>
                onUpdate((prev) => ({
                  ...prev,
                  notificationSettings: { ...prev.notificationSettings, odometerReminderMode: e.target.value as typeof settings.odometerReminderMode },
                }))
              }
            >
              <option value="disabled">Disabled</option>
              <option value="weekly">Weekly</option>
              <option value="custom">Custom interval</option>
            </Select>
          </Field>
          {settings.odometerReminderMode === 'custom' && (
            <Field label="Interval (days)">
              <TextInput
                value={String(settings.odometerReminderIntervalDays)}
                inputMode="numeric"
                onChange={(e) => {
                  const value = Number(e.target.value);
                  if (!Number.isFinite(value)) return;
                  onUpdate((prev) => ({
                    ...prev,
                    notificationSettings: { ...prev.notificationSettings, odometerReminderIntervalDays: Math.max(1, value) },
                  }));
                }}
              />
            </Field>
          )}
        </Row>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 8, marginTop: 12 }}>
          {toggles.map(({ key, label }) => (
            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: V.text, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={Boolean(settings[key])}
                onChange={(e) =>
                  onUpdate((prev) => ({
                    ...prev,
                    notificationSettings: { ...prev.notificationSettings, [key]: e.target.checked },
                  }))
                }
                style={{ accentColor: V.accent, width: 16, height: 16 }}
              />
              {label}
            </label>
          ))}
        </div>
        <p style={{ fontSize: 11, color: V.faint, marginTop: 10 }}>
          Recurring reminders recalculate and reschedule themselves — they never need a manual reset.
        </p>
      </Panel>

      <Panel title="Vehicles">
        <Row>
          <Button variant="subtle" onClick={onAddVehicle}><Plus size={14} /> Add vehicle</Button>
          <Button variant="danger" onClick={onDelete}><Trash2 size={14} /> Delete this vehicle</Button>
        </Row>
      </Panel>
    </div>
  );
};

const DetailRow: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div>
    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', color: V.faint }}>{label}</div>
    <div style={{ color: V.text }}>{value}</div>
  </div>
);

const iconBtn: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: V.muted,
  cursor: 'pointer',
  padding: 4,
  display: 'flex',
  flexShrink: 0,
};

function sourceLabel(source: NextServiceItem['source']): string {
  switch (source) {
    case 'scheduled':
      return 'Scheduled maintenance';
    case 'mechanic':
      return 'Mechanic recommendation';
    case 'known_issue':
      return 'Known issue';
    case 'recommended':
      return 'Recommended repair';
    default:
      return 'User added';
  }
}

export default VehicleModule;
