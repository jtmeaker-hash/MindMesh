import React, { useState } from 'react';
import {
  MoneyState,
  MoneySubTab,
  DirectDebit,
  IncomeConfig,
  Shift,
  ExtraIncome,
  TipEntry,
  DirectDebitCategory,
  ExtraIncomeCategory,
} from '../../types/finance';
import { Reminder, Category } from '../../types';
import {
  formatCurrency,
  formatDateAU,
  getCurrentPayCycleSummary,
  getDirectDebitsOverview,
  isBillOverdueOrDueSoon,
  computeShiftStats,
  calculateTipSummaries,
  getUpcomingMoneyTimeline,
} from '../../utils/finance';
import { EmptyState } from '../common/EmptyState';
import { DirectDebitModal } from './DirectDebitModal';
import { IncomeConfigModal } from './IncomeConfigModal';
import { ShiftCalculatorModal } from './ShiftCalculatorModal';
import { ExtraIncomeModal } from './ExtraIncomeModal';
import { TipEntryModal } from './TipEntryModal';
import {
  Wallet,
  Calendar,
  CreditCard,
  Plus,
  Coins,
  Sparkles,
  Clock,
  CheckCircle2,
  Settings,
  ChevronRight,
  Briefcase,
  Edit2,
  PauseCircle,
  PlayCircle,
  X,
  RotateCcw,
} from 'lucide-react';

interface MoneyModuleProps {
  moneyState: MoneyState;
  reminders: Reminder[];
  categories?: Category[];
  onUpdateMoneyState: (updater: (prev: MoneyState) => MoneyState) => void;
  onUpdateReminders?: (updater: (prev: Reminder[]) => Reminder[]) => void;
  onUpdateCategories?: (updater: (prev: Category[]) => Category[]) => void;
  onOpenReminderModal?: (reminderId?: string) => void;
}

export const MoneyModule: React.FC<MoneyModuleProps> = ({
  moneyState,
  reminders,
  onUpdateMoneyState,
  onOpenReminderModal,
}) => {
  const [activeSubTab, setActiveSubTab] = useState<MoneySubTab>('overview');

  // Modal states
  const [editingDebit, setEditingDebit] = useState<DirectDebit | null | 'new'>(null);
  const [isIncomeConfigOpen, setIsIncomeConfigOpen] = useState(false);
  const [editingShift, setEditingShift] = useState<Shift | null | 'new'>(null);
  const [editingExtra, setEditingExtra] = useState<ExtraIncome | null | 'new'>(null);
  const [editingTip, setEditingTip] = useState<TipEntry | null | 'new'>(null);

  // Pay cycle override modal state
  const [showOverrideModal, setShowOverrideModal] = useState(false);
  const [overrideInput, setOverrideInput] = useState('');

  // New Category input states in Settings
  const [newBillCatName, setNewBillCatName] = useState('');
  const [newBillCatColor, setNewBillCatColor] = useState('#6366f1');
  const [newExtraCatName, setNewExtraCatName] = useState('');
  const [newExtraCatColor, setNewExtraCatColor] = useState('#10b981');

  // Computed data
  const payCycleSummary = getCurrentPayCycleSummary(moneyState);
  const debitsOverview = getDirectDebitsOverview(moneyState.directDebits);
  const shiftStats = computeShiftStats(moneyState.shifts);
  const tipSummaries = calculateTipSummaries(moneyState.tipEntries);
  const timelineItems = getUpcomingMoneyTimeline(moneyState);

  const nextPayKey = moneyState.incomeConfig?.nextPayDate || '';
  const hasActiveOverride = Boolean(nextPayKey && moneyState.payCycleOverrides[nextPayKey] !== undefined);

  const subTabs: { id: MoneySubTab; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'bills', label: 'Direct Debits' },
    { id: 'income', label: 'Income & Pay' },
    { id: 'extra', label: 'Extra Income' },
    { id: 'tips', label: 'Tips' },
    { id: 'categories', label: 'Settings' },
  ];

  // Bill handlers
  const handleSaveDebit = (debit: DirectDebit) => {
    onUpdateMoneyState((prev) => {
      const exists = prev.directDebits.some((d) => d.id === debit.id);
      const directDebits = exists
        ? prev.directDebits.map((d) => (d.id === debit.id ? debit : d))
        : [debit, ...prev.directDebits];
      return { ...prev, directDebits };
    });
  };

  const handleDeleteDebit = (debitId: string) => {
    onUpdateMoneyState((prev) => ({
      ...prev,
      directDebits: prev.directDebits.filter((d) => d.id !== debitId),
    }));
  };

  const handleToggleDebitActive = (debitId: string) => {
    onUpdateMoneyState((prev) => ({
      ...prev,
      directDebits: prev.directDebits.map((d) =>
        d.id === debitId ? { ...d, active: !d.active } : d
      ),
    }));
  };

  // Income config handler
  const handleSaveIncomeConfig = (config: IncomeConfig) => {
    onUpdateMoneyState((prev) => ({
      ...prev,
      incomeConfig: config,
    }));
  };

  // Pay Cycle override handler
  const handleSaveOverride = (amount: number | null) => {
    if (!nextPayKey) return;
    onUpdateMoneyState((prev) => {
      const overrides = { ...prev.payCycleOverrides };
      if (amount === null || isNaN(amount)) {
        delete overrides[nextPayKey];
      } else {
        overrides[nextPayKey] = amount;
      }
      return { ...prev, payCycleOverrides: overrides };
    });
    setShowOverrideModal(false);
  };

  // Shift handlers
  const handleSaveShift = (shift: Shift) => {
    onUpdateMoneyState((prev) => {
      const exists = prev.shifts.some((s) => s.id === shift.id);
      const shifts = exists
        ? prev.shifts.map((s) => (s.id === shift.id ? shift : s))
        : [shift, ...prev.shifts];
      return { ...prev, shifts };
    });
  };

  const handleDeleteShift = (id: string) => {
    onUpdateMoneyState((prev) => ({
      ...prev,
      shifts: prev.shifts.filter((s) => s.id !== id),
    }));
  };

  // Extra income handlers
  const handleSaveExtra = (entry: ExtraIncome) => {
    onUpdateMoneyState((prev) => {
      const exists = prev.extraIncomeList.some((e) => e.id === entry.id);
      const extraIncomeList = exists
        ? prev.extraIncomeList.map((e) => (e.id === entry.id ? entry : e))
        : [entry, ...prev.extraIncomeList];
      return { ...prev, extraIncomeList };
    });
  };

  const handleDeleteExtra = (id: string) => {
    onUpdateMoneyState((prev) => ({
      ...prev,
      extraIncomeList: prev.extraIncomeList.filter((e) => e.id !== id),
    }));
  };

  // Tip handlers
  const handleSaveTip = (tip: TipEntry) => {
    onUpdateMoneyState((prev) => {
      const exists = prev.tipEntries.some((t) => t.id === tip.id);
      const tipEntries = exists
        ? prev.tipEntries.map((t) => (t.id === tip.id ? tip : t))
        : [tip, ...prev.tipEntries];
      return { ...prev, tipEntries };
    });
  };

  const handleDeleteTip = (id: string) => {
    onUpdateMoneyState((prev) => ({
      ...prev,
      tipEntries: prev.tipEntries.filter((t) => t.id !== id),
    }));
  };

  // Add bill category
  const handleAddBillCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBillCatName.trim()) return;
    const newCat: DirectDebitCategory = {
      id: `bcat-${Date.now()}`,
      name: newBillCatName.trim(),
      color: newBillCatColor,
    };
    onUpdateMoneyState((prev) => ({
      ...prev,
      billCategories: [...prev.billCategories, newCat],
    }));
    setNewBillCatName('');
  };

  // Add extra category
  const handleAddExtraCategory = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newExtraCatName.trim()) return;
    const newCat: ExtraIncomeCategory = {
      id: `xcat-${Date.now()}`,
      name: newExtraCatName.trim(),
      color: newExtraCatColor,
    };
    onUpdateMoneyState((prev) => ({
      ...prev,
      extraIncomeCategories: [...prev.extraIncomeCategories, newCat],
    }));
    setNewExtraCatName('');
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        backgroundColor: '#090d16',
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Sub-navigation Header */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
            }}
          >
            <Wallet size={18} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              Money Management
            </h1>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Bills, Income, Pay Cycles, Casual Shifts & Tips
            </span>
          </div>
        </div>

        {/* Sub-tabs pills */}
        <div
          role="tablist"
          aria-label="Money Subtabs"
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 999,
            padding: 3,
            border: '1px solid rgba(255, 255, 255, 0.08)',
            overflowX: 'auto',
            maxWidth: '100%',
          }}
        >
          {subTabs.map((tab) => {
            const isActive = activeSubTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveSubTab(tab.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 14px',
                  borderRadius: 999,
                  border: 'none',
                  background: isActive
                    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                    : 'transparent',
                  color: isActive ? '#ffffff' : '#94a3b8',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: 12,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                {tab.id === 'overview' && <Wallet size={14} />}
                {tab.id === 'bills' && <CreditCard size={14} />}
                {tab.id === 'income' && <Briefcase size={14} />}
                {tab.id === 'extra' && <Sparkles size={14} />}
                {tab.id === 'tips' && <Coins size={14} />}
                {tab.id === 'categories' && <Settings size={14} />}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Content Area */}
      <div style={{ padding: '24px', maxWidth: 1180, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        {/* ===================== OVERVIEW SUB-TAB ===================== */}
        {activeSubTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {!moneyState.incomeConfig ? (
              <EmptyState
                icon={Briefcase}
                title="No pay configured"
                description="Set up your income to calculate money remaining after bills."
                actionLabel="Configure Income"
                onAction={() => setIsIncomeConfigOpen(true)}
              />
            ) : (
              /* Pay Cycle Banner Header */
              <div
                style={{
                  borderRadius: 24,
                  background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  padding: '24px 28px',
                  boxShadow: '0 20px 40px -15px rgba(0, 0, 0, 0.5)',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, marginBottom: 20 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#10b981' }}>
                        Current Pay Cycle
                      </span>
                      {hasActiveOverride && (
                        <span style={{ fontSize: 10, fontWeight: 700, background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', padding: '2px 8px', borderRadius: 999 }}>
                          Cycle Override Active
                        </span>
                      )}
                    </div>
                    <h2 style={{ fontSize: 22, fontWeight: 800, margin: '4px 0 0 0', color: '#f8fafc' }}>
                      {formatDateAU(payCycleSummary.cycleStartDate)} — {formatDateAU(payCycleSummary.cycleEndDate)}
                    </h2>
                    <span style={{ fontSize: 12, color: '#94a3b8' }}>
                      {payCycleSummary.daysRemainingInCycle} days remaining until next pay date ({formatDateAU(payCycleSummary.nextPayDate)})
                    </span>
                  </div>

                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setOverrideInput(String(payCycleSummary.expectedPayThisCycle));
                        setShowOverrideModal(true);
                      }}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 14px',
                        borderRadius: 12,
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: hasActiveOverride ? '#fbbf24' : '#f8fafc',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <RotateCcw size={14} />
                      <span>{hasActiveOverride ? 'Adjust Override' : 'Override Cycle Pay'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setIsIncomeConfigOpen(true)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 14px',
                        borderRadius: 12,
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        background: 'rgba(255, 255, 255, 0.05)',
                        color: '#f8fafc',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Settings size={14} />
                      <span>Configure Pay</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingDebit('new')}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '8px 16px',
                        borderRadius: 12,
                        border: 'none',
                        background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                        color: '#ffffff',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                      }}
                    >
                      <Plus size={16} />
                      <span>Add Bill</span>
                    </button>
                  </div>
                </div>

                {/* The 6 Required Cards on Overview */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                    gap: 14,
                    paddingTop: 16,
                    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                  }}
                >
                  {/* 1. Next Pay */}
                  <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Next Pay</span>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#10b981' }}>
                      {formatCurrency(payCycleSummary.expectedPayThisCycle)}
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      Due {formatDateAU(payCycleSummary.nextPayDate)}
                    </span>
                  </div>

                  {/* 2. Days Until Pay */}
                  <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Days Until Pay</span>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#38bdf8' }}>
                      {payCycleSummary.daysRemainingInCycle}
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      days to next pay
                    </span>
                  </div>

                  {/* 3. Bills Before Next Pay */}
                  <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Bills Before Pay</span>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#f87171' }}>
                      {formatCurrency(payCycleSummary.billsTotalThisCycle)}
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {payCycleSummary.billsDueInCycle.length} recurring bills due
                    </span>
                  </div>

                  {/* 4. Money Remaining After Bills */}
                  <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Remaining After Bills</span>
                    <div
                      style={{
                        fontSize: 22,
                        fontWeight: 800,
                        color: payCycleSummary.estimatedRemainingSafe >= 0 ? '#38bdf8' : '#ef4444',
                      }}
                    >
                      {payCycleSummary.estimatedRemainingSafe >= 0 ? '+' : ''}
                      {formatCurrency(payCycleSummary.estimatedRemainingSafe)}
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      {payCycleSummary.estimatedRemainingSafe >= 0 ? 'Safe remainder' : 'Projected deficit'}
                    </span>
                  </div>

                  {/* 5. Extra Income This Pay Cycle */}
                  <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Extra Income (Cycle)</span>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#34d399' }}>
                      +{formatCurrency(payCycleSummary.extraIncomeTotalThisCycle)}
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      Included in cycle
                    </span>
                  </div>

                  {/* 6. Tips This Week */}
                  <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                    <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Tips This Week</span>
                    <div style={{ fontSize: 22, fontWeight: 800, color: '#fbbf24' }}>
                      +{formatCurrency(tipSummaries.weekTotal)}
                    </div>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      Mon – Sun tips
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Upcoming Money Timeline (with explicit +/- and [Income]/[Expense] badges) */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                borderRadius: 20,
                padding: '22px 24px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Calendar size={18} color="#38bdf8" />
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Upcoming Money Timeline</h3>
                </div>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>Cash flow in the next 14 days</span>
              </div>

              {timelineItems.length === 0 ? (
                <p style={{ color: '#94a3b8', fontSize: 13, margin: 0 }}>
                  No upcoming bills or scheduled income found in the next 14 days.
                </p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {timelineItems.map((item) => {
                    const isIncome = item.type === 'income';
                    return (
                      <div
                        key={item.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '12px 16px',
                          borderRadius: 14,
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: isIncome ? '1px solid rgba(16, 185, 129, 0.2)' : '1px solid rgba(239, 68, 68, 0.2)',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                          <span
                            style={{
                              fontSize: 12,
                              fontWeight: 700,
                              color: '#cbd5e1',
                              minWidth: 85,
                            }}
                          >
                            {item.dayLabel}
                          </span>
                          <div>
                            <span style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc', display: 'block' }}>
                              {item.title}
                            </span>
                            <span style={{ fontSize: 11, color: '#94a3b8' }}>
                              {formatDateAU(item.date)} • {item.categoryName}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 8px',
                              borderRadius: 999,
                              background: isIncome ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                              color: isIncome ? '#34d399' : '#f87171',
                              border: isIncome ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(239, 68, 68, 0.3)',
                            }}
                          >
                            [{item.badge}]
                          </span>
                          <span
                            style={{
                              fontSize: 16,
                              fontWeight: 800,
                              color: isIncome ? '#34d399' : '#fca5a5',
                            }}
                          >
                            {item.formattedAmount}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Two-Column Grid: Upcoming Bills & Quick Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 24 }}>
              {/* Bills Due in Current Cycle */}
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.6)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 20,
                  padding: '20px 22px',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CreditCard size={18} color="#f87171" />
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Bills Due in Current Cycle</h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSubTab('bills')}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#6366f1',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>View All</span>
                    <ChevronRight size={14} />
                  </button>
                </div>

                {payCycleSummary.billsDueInCycle.length === 0 ? (
                  <EmptyState
                    icon={CheckCircle2}
                    title="No Bills Due This Cycle"
                    description="You have no active direct debits falling inside this pay window."
                    actionLabel="Add Direct Debit"
                    onAction={() => setEditingDebit('new')}
                  />
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {payCycleSummary.billsDueInCycle.map((bill: DirectDebit) => {
                      const category = moneyState.billCategories.find((c) => c.id === bill.categoryId);
                      const dueStatus = isBillOverdueOrDueSoon(bill.nextPaymentDate);
                      return (
                        <div
                          key={bill.id}
                          onClick={() => setEditingDebit(bill)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '12px 14px',
                            borderRadius: 14,
                            background: 'rgba(255, 255, 255, 0.03)',
                            border: '1px solid rgba(255, 255, 255, 0.06)',
                            cursor: 'pointer',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                            <div
                              style={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                backgroundColor: category?.color || '#94a3b8',
                              }}
                            />
                            <div>
                              <span style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc', display: 'block' }}>
                                {bill.title}
                              </span>
                              <span style={{ fontSize: 11, color: '#94a3b8' }}>
                                Due {formatDateAU(bill.nextPaymentDate)} • {bill.frequency}
                              </span>
                            </div>
                          </div>

                          <div style={{ textAlign: 'right' }}>
                            <span style={{ fontSize: 15, fontWeight: 700, color: '#fca5a5', display: 'block' }}>
                              -{formatCurrency(bill.amount)}
                            </span>
                            {dueStatus.isDueSoon && (
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#f59e0b', textTransform: 'uppercase' }}>
                                Due in {dueStatus.daysUntilDue}d
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Fast Action Buttons & Burn Rate */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(3, 1fr)',
                    gap: 10,
                  }}
                >
                  <button
                    type="button"
                    onClick={() => setEditingTip('new')}
                    style={{
                      padding: '16px 12px',
                      borderRadius: 16,
                      background: 'rgba(245, 158, 11, 0.1)',
                      border: '1px solid rgba(245, 158, 11, 0.25)',
                      color: '#fbbf24',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <Coins size={22} />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>Log Tips</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingShift('new')}
                    style={{
                      padding: '16px 12px',
                      borderRadius: 16,
                      background: 'rgba(59, 130, 246, 0.1)',
                      border: '1px solid rgba(59, 130, 246, 0.25)',
                      color: '#60a5fa',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <Clock size={22} />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>Add Shift</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setEditingExtra('new')}
                    style={{
                      padding: '16px 12px',
                      borderRadius: 16,
                      background: 'rgba(16, 185, 129, 0.1)',
                      border: '1px solid rgba(16, 185, 129, 0.25)',
                      color: '#34d399',
                      display: 'flex',
                      flexDirection: 'column',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <Sparkles size={22} />
                    <span style={{ fontSize: 12, fontWeight: 700 }}>Extra Income</span>
                  </button>
                </div>

                {/* Monthly Fixed Cost Summary Card */}
                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.6)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: 20,
                    padding: '20px 22px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                    <h3 style={{ fontSize: 15, fontWeight: 700, margin: 0, color: '#cbd5e1' }}>
                      Monthly Burn Rate (Fixed Costs)
                    </h3>
                    <span style={{ fontSize: 16, fontWeight: 800, color: '#f87171' }}>
                      {formatCurrency(debitsOverview.totalMonthlyCost)}/mo
                    </span>
                  </div>

                  <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
                    Normalized estimate based on {debitsOverview.activeCount} active recurring direct debits ({debitsOverview.pausedCount} paused).
                  </p>

                  <div style={{ display: 'flex', gap: 14, marginTop: 14, paddingTop: 14, borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                    <div>
                      <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Weekly Cost</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                        {formatCurrency(debitsOverview.totalMonthlyCost / 4.333)}
                      </span>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Fortnightly Cost</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                        {formatCurrency((debitsOverview.totalMonthlyCost / 4.333) * 2)}
                      </span>
                    </div>
                    <div>
                      <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Annual Cost</span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                        {formatCurrency(debitsOverview.totalMonthlyCost * 12)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ===================== DIRECT DEBITS SUB-TAB ===================== */}
        {activeSubTab === 'bills' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Direct Debits & Recurring Bills</h2>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  Manage subscriptions, insurance, loans and recurring expenses
                </span>
              </div>

              <button
                type="button"
                onClick={() => setEditingDebit('new')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 18px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(239, 68, 68, 0.3)',
                }}
              >
                <Plus size={16} />
                <span>Add Direct Debit</span>
              </button>
            </div>

            {moneyState.directDebits.length === 0 ? (
              <EmptyState
                icon={CreditCard}
                title="No bills yet."
                description="Add your recurring expenses to see how much of your next pay is already committed."
                actionLabel="Add Direct Debit"
                onAction={() => setEditingDebit('new')}
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
                {moneyState.directDebits.map((bill) => {
                  const category = moneyState.billCategories.find((c) => c.id === bill.categoryId);
                  const dueInfo = isBillOverdueOrDueSoon(bill.nextPaymentDate);
                  return (
                    <div
                      key={bill.id}
                      style={{
                        background: 'rgba(15, 23, 42, 0.7)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        borderRadius: 18,
                        padding: '18px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 12,
                        opacity: bill.active ? 1 : 0.65,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div
                            style={{
                              width: 10,
                              height: 10,
                              borderRadius: '50%',
                              backgroundColor: category?.color || '#94a3b8',
                            }}
                          />
                          <span style={{ fontSize: 12, fontWeight: 600, color: category?.color || '#94a3b8' }}>
                            {category?.name || 'Uncategorized'}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            onClick={() => handleToggleDebitActive(bill.id)}
                            title={bill.active ? 'Pause Bill' : 'Resume Bill'}
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: bill.active ? '#10b981' : '#64748b',
                              cursor: 'pointer',
                              padding: 4,
                            }}
                          >
                            {bill.active ? <PlayCircle size={17} /> : <PauseCircle size={17} />}
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingDebit(bill)}
                            title="Edit"
                            style={{
                              background: 'transparent',
                              border: 'none',
                              color: '#94a3b8',
                              cursor: 'pointer',
                              padding: 4,
                            }}
                          >
                            <Edit2 size={16} />
                          </button>
                        </div>
                      </div>

                      <div>
                        <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 4px 0', color: '#f8fafc' }}>
                          {bill.title}
                        </h3>
                        <div style={{ fontSize: 20, fontWeight: 800, color: '#f87171' }}>
                          {formatCurrency(bill.amount)}
                          <span style={{ fontSize: 12, fontWeight: 500, color: '#94a3b8', marginLeft: 4 }}>
                            / {bill.frequency.replace('_', ' ')}
                          </span>
                        </div>
                      </div>

                      <div
                        style={{
                          paddingTop: 10,
                          borderTop: '1px solid rgba(255, 255, 255, 0.06)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: '#94a3b8' }}>
                          Next: <strong style={{ color: '#f8fafc' }}>{formatDateAU(bill.nextPaymentDate)}</strong>
                        </span>

                        {dueInfo.isOverdue ? (
                          <span style={{ color: '#ef4444', fontWeight: 700 }}>OVERDUE</span>
                        ) : dueInfo.isDueSoon ? (
                          <span style={{ color: '#f59e0b', fontWeight: 700 }}>Due in {dueInfo.daysUntilDue}d</span>
                        ) : (
                          <span style={{ color: '#10b981', fontWeight: 600 }}>Active</span>
                        )}
                      </div>

                      {bill.linkedReminderId && (
                        <div
                          onClick={() => onOpenReminderModal?.(bill.linkedReminderId)}
                          style={{
                            fontSize: 11,
                            color: '#818cf8',
                            background: 'rgba(99, 102, 241, 0.1)',
                            padding: '4px 8px',
                            borderRadius: 6,
                            cursor: 'pointer',
                          }}
                        >
                          Linked to MindMesh Task ↗
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===================== INCOME & SHIFTS SUB-TAB ===================== */}
        {activeSubTab === 'income' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            {!moneyState.incomeConfig ? (
              <EmptyState
                icon={Briefcase}
                title="No pay configured."
                description="Set up your income to calculate money remaining after bills."
                actionLabel="Configure Income"
                onAction={() => setIsIncomeConfigOpen(true)}
              />
            ) : (
              /* Income Configuration Banner */
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 20,
                  padding: '22px 24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: 16,
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <Briefcase size={18} color="#10b981" />
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>
                      {moneyState.incomeConfig.title}
                    </h3>
                    <span style={{ fontSize: 11, background: 'rgba(16, 185, 129, 0.15)', color: '#34d399', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                      {moneyState.incomeConfig.employmentType.replace('_', ' ')}
                    </span>
                    {hasActiveOverride && (
                      <span style={{ fontSize: 11, background: 'rgba(245, 158, 11, 0.2)', color: '#fbbf24', padding: '2px 8px', borderRadius: 999, fontWeight: 600 }}>
                        Cycle Override: {formatCurrency(payCycleSummary.expectedPayThisCycle)}
                      </span>
                    )}
                  </div>
                  <p style={{ fontSize: 13, color: '#94a3b8', margin: 0 }}>
                    Average Pay: {formatCurrency(moneyState.incomeConfig.averagePay)} per {moneyState.incomeConfig.frequency}
                    {moneyState.incomeConfig.nextPayDate && ` • Next Pay Date: ${formatDateAU(moneyState.incomeConfig.nextPayDate)} (${payCycleSummary.daysRemainingInCycle} days)`}
                    {moneyState.incomeConfig.employerName && ` • Employer: ${moneyState.incomeConfig.employerName}`}
                  </p>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button
                    type="button"
                    onClick={() => {
                      setOverrideInput(String(payCycleSummary.expectedPayThisCycle));
                      setShowOverrideModal(true);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 12,
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: hasActiveOverride ? '#fbbf24' : '#f8fafc',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <RotateCcw size={14} />
                    <span>{hasActiveOverride ? 'Adjust Override' : 'Override Cycle Pay'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setIsIncomeConfigOpen(true)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 16px',
                      borderRadius: 12,
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      background: 'rgba(255, 255, 255, 0.05)',
                      color: '#f8fafc',
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Settings size={15} />
                    <span>Edit Income Settings</span>
                  </button>
                </div>
              </div>
            )}

            {/* Casual Shifts Section */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Casual Shift Log</h3>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>
                    Calculate hours and estimated gross earnings with penalty rate breakdown
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => setEditingShift('new')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '8px 16px',
                    borderRadius: 12,
                    border: 'none',
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(59, 130, 246, 0.3)',
                  }}
                >
                  <Plus size={16} />
                  <span>Log Shift</span>
                </button>
              </div>

              {/* Shift stats strip */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
                <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Total Logged Hours</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#60a5fa' }}>{shiftStats.totalHours} hrs</span>
                </div>
                <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Total Estimated Shift Pay</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#10b981' }}>{formatCurrency(shiftStats.totalEarnings)}</span>
                </div>
                <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Average Effective Rate</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#fbbf24' }}>
                    {shiftStats.totalHours > 0 ? formatCurrency(shiftStats.totalEarnings / shiftStats.totalHours) + '/hr' : '$0.00/hr'}
                  </span>
                </div>
              </div>

              {moneyState.shifts.length === 0 ? (
                <EmptyState
                  icon={Clock}
                  title="No Shifts Logged"
                  description="Add your upcoming or completed shifts to calculate your expected pay before pay day."
                  actionLabel="Add Shift"
                  onAction={() => setEditingShift('new')}
                />
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {moneyState.shifts.map((shift) => (
                    <div
                      key={shift.id}
                      onClick={() => setEditingShift(shift)}
                      style={{
                        padding: '14px 18px',
                        borderRadius: 14,
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            background: 'rgba(59, 130, 246, 0.12)',
                            color: '#60a5fa',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontWeight: 700,
                            fontSize: 13,
                          }}
                        >
                          {shift.paidHours}h
                        </div>
                        <div>
                          <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', display: 'block' }}>
                            {formatDateAU(shift.date)} ({shift.rateType})
                          </span>
                          <span style={{ fontSize: 12, color: '#94a3b8' }}>
                            {shift.startTime} — {shift.endTime} • {shift.breakMinutes}m break • @{formatCurrency(shift.hourlyRate)}/hr
                          </span>
                        </div>
                      </div>

                      <div style={{ textAlign: 'right' }}>
                        <span style={{ fontSize: 16, fontWeight: 800, color: '#60a5fa', display: 'block' }}>
                          {formatCurrency(shift.estimatedPay)}
                        </span>
                        {shift.notes && (
                          <span style={{ fontSize: 11, color: '#94a3b8' }}>{shift.notes}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ===================== EXTRA INCOME SUB-TAB ===================== */}
        {activeSubTab === 'extra' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Extra Income & Side Gigs</h2>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  Cash jobs, marketplace sales, freelance projects, refunds & side hustle money
                </span>
              </div>

              <button
                type="button"
                onClick={() => setEditingExtra('new')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 18px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(16, 185, 129, 0.3)',
                }}
              >
                <Plus size={16} />
                <span>Record Income</span>
              </button>
            </div>

            {moneyState.extraIncomeList.length === 0 ? (
              <EmptyState
                icon={Sparkles}
                title="No extra income yet."
                description="Sold something on Marketplace? Picked up a cash job? Track every bonus dollar here."
                actionLabel="Record Income"
                onAction={() => setEditingExtra('new')}
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}>
                {moneyState.extraIncomeList.map((item) => {
                  const category = moneyState.extraIncomeCategories.find((c) => c.id === item.categoryId);
                  return (
                    <div
                      key={item.id}
                      onClick={() => setEditingExtra(item)}
                      style={{
                        padding: '16px 18px',
                        borderRadius: 16,
                        background: 'rgba(15, 23, 42, 0.7)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: 11, fontWeight: 700, color: category?.color || '#34d399', textTransform: 'uppercase' }}>
                          {category?.name || 'Income'}
                        </span>
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            padding: '2px 8px',
                            borderRadius: 999,
                            background: item.received ? 'rgba(16, 185, 129, 0.15)' : 'rgba(245, 158, 11, 0.15)',
                            color: item.received ? '#34d399' : '#fbbf24',
                          }}
                        >
                          {item.received ? 'Received' : 'Pending'}
                        </span>
                      </div>

                      <div>
                        <h4 style={{ fontSize: 15, fontWeight: 700, margin: '0 0 2px 0', color: '#f8fafc' }}>
                          {item.title}
                        </h4>
                        <div style={{ fontSize: 18, fontWeight: 800, color: '#34d399' }}>
                          +{formatCurrency(item.amount)}
                        </div>
                      </div>

                      <div style={{ fontSize: 11, color: '#94a3b8', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
                        {formatDateAU(item.date)} {item.includeInCurrentPayCycle ? '• In Pay Cycle' : ''} {item.notes && `• ${item.notes}`}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ===================== TIPS SUB-TAB ===================== */}
        {activeSubTab === 'tips' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>Tip Tracking</h2>
                <span style={{ fontSize: 12, color: '#94a3b8' }}>
                  Fast logging for hospitality, venue and service workers
                </span>
              </div>

              <button
                type="button"
                onClick={() => setEditingTip('new')}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 18px',
                  borderRadius: 12,
                  border: 'none',
                  background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)',
                  color: '#ffffff',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  boxShadow: '0 4px 14px rgba(245, 158, 11, 0.3)',
                }}
              >
                <Plus size={16} />
                <span>Log Tip</span>
              </button>
            </div>

            {/* Tip Stats (Today, This Week, This Month, This Year, Average per shift, Highest tip day) */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
              <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Tips Today</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#fbbf24' }}>{formatCurrency(tipSummaries.todayTotal)}</span>
              </div>
              <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Tips This Week</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#38bdf8' }}>{formatCurrency(tipSummaries.weekTotal)}</span>
              </div>
              <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Tips This Month</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#34d399' }}>{formatCurrency(tipSummaries.monthTotal)}</span>
              </div>
              <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Tips This Year</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#a855f7' }}>{formatCurrency(tipSummaries.yearTotal)}</span>
              </div>
              <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Average Per Shift</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: '#60a5fa' }}>{formatCurrency(tipSummaries.averagePerEntry)}</span>
              </div>
              <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Highest Tip Day</span>
                <span style={{ fontSize: 18, fontWeight: 800, color: '#10b981' }}>
                  {tipSummaries.highestTipDay.date ? formatCurrency(tipSummaries.highestTipDay.amount) : '$0.00'}
                </span>
                {tipSummaries.highestTipDay.date && (
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>
                    {formatDateAU(tipSummaries.highestTipDay.date)}
                  </span>
                )}
              </div>
            </div>

            {moneyState.tipEntries.length === 0 ? (
              <EmptyState
                icon={Coins}
                title="No tips yet."
                description="Add your first tip to start tracking totals."
                actionLabel="Log First Tip"
                onAction={() => setEditingTip('new')}
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {moneyState.tipEntries.map((tip) => (
                  <div
                    key={tip.id}
                    onClick={() => setEditingTip(tip)}
                    style={{
                      padding: '14px 18px',
                      borderRadius: 14,
                      background: 'rgba(15, 23, 42, 0.6)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        style={{
                          width: 36,
                          height: 36,
                          borderRadius: 10,
                          background: 'rgba(245, 158, 11, 0.15)',
                          color: '#fbbf24',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Coins size={18} />
                      </div>
                      <div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc', display: 'block' }}>
                          {formatDateAU(tip.date)} • {tip.shiftType} shift
                        </span>
                        <span style={{ fontSize: 11, color: '#94a3b8' }}>
                          {tip.venue || tip.locationOrRole || 'General venue'} {tip.categoryId ? `• ${tip.categoryId}` : ''} {tip.notes && `• ${tip.notes}`}
                        </span>
                      </div>
                    </div>

                    <div style={{ fontSize: 18, fontWeight: 800, color: '#fbbf24' }}>
                      +{formatCurrency(tip.amount)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ===================== SETTINGS SUB-TAB ===================== */}
        {activeSubTab === 'categories' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
            <div>
              <h2 style={{ fontSize: 20, fontWeight: 700, margin: '0 0 4px 0' }}>Financial Categories & Rules</h2>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>
                Organize your bills and extra income streams with custom color tags
              </span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
              {/* Direct Debit Categories */}
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 20,
                  padding: '20px 22px',
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px 0' }}>
                  Bill Categories ({moneyState.billCategories.length})
                </h3>

                <form onSubmit={handleAddBillCategory} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input
                    type="color"
                    value={newBillCatColor}
                    onChange={(e) => setNewBillCatColor(e.target.value)}
                    style={{ width: 40, height: 38, border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}
                  />
                  <input
                    type="text"
                    value={newBillCatName}
                    onChange={(e) => setNewBillCatName(e.target.value)}
                    placeholder="New category name..."
                    style={{
                      flex: 1,
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 10,
                      padding: '8px 12px',
                      color: '#fff',
                      fontSize: 13,
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: '#6366f1',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Add
                  </button>
                </form>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {moneyState.billCategories.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        borderRadius: 8,
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: c.color }} />
                      <span>{c.name}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Extra Income Categories */}
              <div
                style={{
                  background: 'rgba(15, 23, 42, 0.7)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 20,
                  padding: '20px 22px',
                }}
              >
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: '0 0 14px 0' }}>
                  Extra Income Categories ({moneyState.extraIncomeCategories.length})
                </h3>

                <form onSubmit={handleAddExtraCategory} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                  <input
                    type="color"
                    value={newExtraCatColor}
                    onChange={(e) => setNewExtraCatColor(e.target.value)}
                    style={{ width: 40, height: 38, border: 'none', borderRadius: 8, background: 'transparent', cursor: 'pointer' }}
                  />
                  <input
                    type="text"
                    value={newExtraCatName}
                    onChange={(e) => setNewExtraCatName(e.target.value)}
                    placeholder="New source type..."
                    style={{
                      flex: 1,
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.1)',
                      borderRadius: 10,
                      padding: '8px 12px',
                      color: '#fff',
                      fontSize: 13,
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      padding: '8px 14px',
                      borderRadius: 10,
                      border: 'none',
                      background: '#10b981',
                      color: '#fff',
                      fontWeight: 600,
                      fontSize: 12,
                      cursor: 'pointer',
                    }}
                  >
                    Add
                  </button>
                </form>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {moneyState.extraIncomeCategories.map((c) => (
                    <div
                      key={c.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        padding: '6px 12px',
                        borderRadius: 8,
                        background: 'rgba(255, 255, 255, 0.04)',
                        border: '1px solid rgba(255, 255, 255, 0.08)',
                        fontSize: 12,
                      }}
                    >
                      <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: c.color }} />
                      <span>{c.name}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Pay Cycle Override Modal */}
      {showOverrideModal && (
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
          onClick={() => setShowOverrideModal(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: '100%',
              maxWidth: 420,
              backgroundColor: '#0f172a',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: 20,
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={{ fontSize: 17, fontWeight: 700, margin: 0 }}>Override Cycle Expected Pay</h3>
              <button
                type="button"
                onClick={() => setShowOverrideModal(false)}
                style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0, lineHeight: 1.5 }}>
              Override your expected income for the pay cycle ending {formatDateAU(nextPayKey)} without altering your normal baseline average pay ({formatCurrency(moneyState.incomeConfig?.averagePay || 0)}).
            </p>

            <div>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#cbd5e1', marginBottom: 6 }}>
                Cycle Expected Pay ($ AUD)
              </label>
              <input
                type="number"
                step="0.01"
                placeholder={String(moneyState.incomeConfig?.averagePay || 1150)}
                value={overrideInput}
                onChange={(e) => setOverrideInput(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: 10,
                  padding: '10px 12px',
                  color: '#10b981',
                  fontSize: 16,
                  fontWeight: 700,
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              {hasActiveOverride ? (
                <button
                  type="button"
                  onClick={() => handleSaveOverride(null)}
                  style={{
                    padding: '8px 12px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'rgba(239, 68, 68, 0.15)',
                    color: '#f87171',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Reset to Normal Pay
                </button>
              ) : <div />}

              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setShowOverrideModal(false)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    background: 'transparent',
                    color: '#94a3b8',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const parsed = parseFloat(overrideInput);
                    if (!isNaN(parsed) && parsed >= 0) {
                      handleSaveOverride(parsed);
                    }
                  }}
                  style={{
                    padding: '8px 16px',
                    borderRadius: 10,
                    border: 'none',
                    background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  Apply Override
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      {editingDebit !== null && (
        <DirectDebitModal
          isOpen={true}
          onClose={() => setEditingDebit(null)}
          debit={editingDebit === 'new' ? null : editingDebit}
          categories={moneyState.billCategories}
          reminders={reminders}
          onSave={handleSaveDebit}
          onDelete={handleDeleteDebit}
        />
      )}

      {isIncomeConfigOpen && (
        <IncomeConfigModal
          isOpen={true}
          onClose={() => setIsIncomeConfigOpen(false)}
          config={moneyState.incomeConfig}
          onSave={handleSaveIncomeConfig}
        />
      )}

      {editingShift !== null && (
        <ShiftCalculatorModal
          isOpen={true}
          onClose={() => setEditingShift(null)}
          incomeConfig={moneyState.incomeConfig}
          shift={editingShift === 'new' ? null : editingShift}
          onSave={handleSaveShift}
          onDelete={handleDeleteShift}
        />
      )}

      {editingExtra !== null && (
        <ExtraIncomeModal
          isOpen={true}
          onClose={() => setEditingExtra(null)}
          categories={moneyState.extraIncomeCategories}
          reminders={reminders}
          incomeConfig={moneyState.incomeConfig}
          extraIncome={editingExtra === 'new' ? null : editingExtra}
          onSave={handleSaveExtra}
          onDelete={handleDeleteExtra}
        />
      )}

      {editingTip !== null && (
        <TipEntryModal
          isOpen={true}
          onClose={() => setEditingTip(null)}
          tip={editingTip === 'new' ? null : editingTip}
          shifts={moneyState.shifts}
          onSave={handleSaveTip}
          onDelete={handleDeleteTip}
        />
      )}
    </div>
  );
};
