import React, { useMemo, useState } from 'react';
import { Reminder, Category } from '../../types';
import { Routine } from '../../types/routine';
import { analyzeRoutine, buildTodayPlan } from '../../services/routineAnalytics';
import { MoneyState, DashboardTimeFilter } from '../../types/finance';
import { computeDashboardMetrics } from '../../utils/dashboard';
import { formatCurrency, formatDateAU } from '../../utils/finance';
import { CompletionGauge } from './CompletionGauge';
import {
  LayoutDashboard,
  Clock,
  AlertTriangle,
  Wallet,
  Calendar,
  Layers,
  Repeat,
  Filter,
  ArrowRight,
  ChevronRight,
} from 'lucide-react';

interface DashboardModuleProps {
  reminders: Reminder[];
  categories: Category[];
  moneyState: MoneyState;
  onNavigateToMoney?: () => void;
  onNavigateToReminders?: () => void;
  onNavigateToRoutines?: () => void;
  onOpenReminderModal?: (reminderId: string) => void;
  routines?: Routine[];
  onOpenRoutine?: () => void;
}

const summaryLabel: React.CSSProperties = { display: 'block', color: '#67e8f9', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.1em', fontWeight: 800 };
const summaryValue: React.CSSProperties = { display: 'block', color: '#f8fafc', fontSize: 25, fontWeight: 800, marginTop: 3 };
const summaryHint: React.CSSProperties = { display: 'block', color: '#94a3b8', fontSize: 11, marginTop: 3 };
const summaryCard: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 18, padding: 18, borderRadius: 18, background: 'linear-gradient(135deg,rgba(8,47,73,.65),rgba(15,23,42,.85))', border: '1px solid rgba(34,211,238,.22)' };
const buttonStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 5, justifyContent: 'center', border: '1px solid rgba(103,232,249,.3)', background: 'rgba(8,145,178,.16)', color: '#67e8f9', borderRadius: 999, padding: '8px 12px', cursor: 'pointer', fontWeight: 700, fontSize: 12 };
function routineProgress(routines: Routine[]): number { const active = routines.filter((routine) => routine.activeSession); const total = active.reduce((sum, routine) => sum + routine.steps.length, 0); const done = active.reduce((sum, routine) => sum + (routine.activeSession?.completedStepIds.length || 0), 0); return total ? Math.round((done / total) * 100) : 0; }

const TIME_FILTER_OPTIONS: { id: DashboardTimeFilter; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: '7days', label: 'Last 7 Days' },
  { id: '30days', label: 'Last 30 Days' },
  { id: '3months', label: 'Last 3 Months' },
  { id: 'all', label: 'All Time' },
];

export const DashboardModule: React.FC<DashboardModuleProps> = ({
  reminders,
  categories,
  moneyState,
  onNavigateToMoney,
  onNavigateToReminders,
  onNavigateToRoutines,
  onOpenReminderModal,
  routines = [],
  onOpenRoutine,
}) => {
  const [timeFilter, setTimeFilter] = useState<DashboardTimeFilter>('all');
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('all');

  const activeCategoryFilter = selectedCategoryId === 'all' ? null : selectedCategoryId;
  const metrics = computeDashboardMetrics(reminders, categories, moneyState, timeFilter, activeCategoryFilter);
  const todayPlan = useMemo(() => buildTodayPlan(routines, reminders, moneyState.directDebits), [routines, reminders, moneyState.directDebits]);
  const nextSuggestion = useMemo(() => {
    const candidate = routines.filter((routine) => routine.status === 'active' && routine.activeSession?.status !== 'completed').sort((a, b) => (b.priority === 'critical' ? 1 : 0) - (a.priority === 'critical' ? 1 : 0))[0];
    if (!candidate) return null;
    const analytics = analyzeRoutine(candidate);
    return { routine: candidate, reason: candidate.activeSession?.status === 'running' ? 'It is already in progress.' : analytics.streak > 0 ? `It supports your ${analytics.streak}-day consistency streak.` : 'It is an active routine ready for a small next step.' };
  }, [routines]);

  return (
    <div
      className="mm-module dashboard-module"
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
      {/* Dashboard Sticky Header with Filter Controls */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          padding: '14px 24px',
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
              width: 36,
              height: 36,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)',
            }}
          >
            <LayoutDashboard size={19} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              MindMesh & Financial Dashboard
            </h1>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Completion velocity, overdue insights, recurrence & financial health
            </span>
          </div>
        </div>

        {/* Filter Controls: Time & Category */}
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          {onNavigateToRoutines && <button type="button" onClick={onNavigateToRoutines} style={{ padding: '7px 11px', borderRadius: 999, border: '1px solid rgba(34,211,238,.35)', background: 'rgba(8,145,178,.16)', color: '#67e8f9', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}>Open Routines</button>}
          {/* Category Filter Dropdown */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Filter size={14} color="#94a3b8" />
            <select
              aria-label="Filter by Category"
              value={selectedCategoryId}
              onChange={(e) => setSelectedCategoryId(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: 999,
                background: '#1e293b',
                color: '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              <option value="all">All Categories</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          {/* Time Filter Pills */}
          <div
            role="tablist"
            aria-label="Time Filter"
            style={{
              display: 'flex',
              alignItems: 'center',
              background: 'rgba(255, 255, 255, 0.04)',
              borderRadius: 999,
              padding: 3,
              border: '1px solid rgba(255, 255, 255, 0.08)',
            }}
          >
            {TIME_FILTER_OPTIONS.map((opt) => {
              const isActive = timeFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setTimeFilter(opt.id)}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 999,
                    border: 'none',
                    background: isActive
                      ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
                      : 'transparent',
                    color: isActive ? '#ffffff' : '#94a3b8',
                    fontWeight: isActive ? 600 : 500,
                    fontSize: 12,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div style={{ padding: '24px', maxWidth: 1180, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <section aria-label="Routine summary" style={{ ...summaryCard, marginBottom: 20 }}>
          <div><span style={summaryLabel}>Routines today</span><strong style={summaryValue}>{routines.filter((routine) => routine.status === 'active' || routine.status === 'paused').length}</strong><span style={summaryHint}>{routines.filter((routine) => routine.activeSession?.status === 'running').length} currently running · {routines.filter((routine) => routine.activeSession?.status === 'completed').length} completed this session</span></div>
          <div><span style={summaryLabel}>Routine progress</span><strong style={summaryValue}>{routineProgress(routines)}%</strong><span style={summaryHint}>Across completed steps in active sessions</span></div>
          {onOpenRoutine && <button type="button" onClick={onOpenRoutine} style={{ ...buttonStyle, alignSelf: 'center' }}>Open Routines <ChevronRight size={14} /></button>}
        </section>
        <section aria-label="Today plan" style={{ ...summaryCard, marginBottom: 20, gridTemplateColumns: 'minmax(240px,1fr) minmax(240px,1fr)' }}><div><span style={summaryLabel}>What should I do next?</span>{nextSuggestion ? <><strong style={{ ...summaryValue, fontSize: 20 }}>{nextSuggestion.routine.name}</strong><span style={summaryHint}>{nextSuggestion.reason} This is guidance, not a forced action.</span></> : <span style={summaryHint}>Nothing is asking for attention right now. You can choose a routine when ready.</span>}</div><div><span style={summaryLabel}>Today plan</span><strong style={{ ...summaryValue, fontSize: 20 }}>{todayPlan.length} items</strong><span style={summaryHint}>{todayPlan.slice(0, 3).map((item) => item.title).join(' · ') || 'No scheduled routines, reminders, or bills.'}</span></div></section>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {/* Top Row: Task Completion Gauge & High-Level Productivity */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: 20,
            }}
          >
            {/* Completion Gauge Hero */}
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 24,
                padding: '24px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-around',
                flexWrap: 'wrap',
                gap: 20,
              }}
            >
              <CompletionGauge
                percentage={metrics.completionRate}
                completedCount={metrics.totalCompleted}
                totalCount={metrics.totalTasks}
                color="#10b981"
                label="Tasks Done"
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 14, minWidth: 160 }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Completion Rate
                  </span>
                  <div style={{ fontSize: 28, fontWeight: 800, color: '#10b981' }}>
                    {metrics.completionRate}%
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Completed</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#34d399' }}>
                      {metrics.totalCompleted}
                    </span>
                  </div>
                  <div>
                    <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Remaining</span>
                    <span style={{ fontSize: 18, fontWeight: 700, color: '#f8fafc' }}>
                      {metrics.totalActive}
                    </span>
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Active Tasks</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: '#a5b4fc' }}>
                    {metrics.totalActive} pending across {metrics.activeCategoriesCount} categories
                  </span>
                </div>
              </div>
            </div>

            {/* Completion Velocity & Time to Complete */}
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 24,
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'space-between',
                gap: 16,
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <Clock size={18} color="#6366f1" />
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Average Completion Time</h3>
                </div>
                <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 14px 0' }}>
                  Calculated from reminder creation to completion timestamp (completed date minus created date).
                </p>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
                  <span style={{ fontSize: 32, fontWeight: 800, color: '#818cf8' }}>
                    {metrics.formattedOverallDuration}
                  </span>
                  <span style={{ fontSize: 12, color: '#94a3b8' }}>overall average</span>
                </div>
              </div>

              {/* By Category Completion Times */}
              <div>
                <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: 8 }}>
                  Average Completion Time by Category
                </span>
                {metrics.categoryStats.length === 0 ? (
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    Complete reminders to generate category completion velocity benchmarks.
                  </span>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }}>
                    {metrics.categoryStats.map((stat) => (
                      <div
                        key={stat.categoryId}
                        style={{
                          padding: '8px 10px',
                          borderRadius: 10,
                          background: 'rgba(255, 255, 255, 0.03)',
                          border: '1px solid rgba(255, 255, 255, 0.06)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 2,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: stat.color }} />
                          <span style={{ fontSize: 12, fontWeight: 600, color: '#f8fafc', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {stat.categoryName}
                          </span>
                        </div>
                        <span style={{ fontSize: 13, fontWeight: 700, color: stat.color }}>
                          {stat.formattedDuration}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Quick Metrics Strip: Due Today, Due This Week, Recurring, Overdue, Oldest Overdue */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
              gap: 14,
            }}
          >
            {/* Due Today */}
            <div
              style={{
                padding: '16px 18px',
                borderRadius: 16,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={16} color="#38bdf8" />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Tasks Due Today</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#38bdf8' }}>
                {metrics.dueTodayCount}
              </div>
            </div>

            {/* Due This Week */}
            <div
              style={{
                padding: '16px 18px',
                borderRadius: 16,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Calendar size={16} color="#818cf8" />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Tasks Due This Week</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#818cf8' }}>
                {metrics.dueThisWeekCount}
              </div>
            </div>

            {/* Recurring Tasks */}
            <div
              style={{
                padding: '16px 18px',
                borderRadius: 16,
                background: 'rgba(15, 23, 42, 0.6)',
                border: '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Repeat size={16} color="#a855f7" />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Recurring Tasks</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: '#a855f7' }}>
                {metrics.recurringCount}
              </div>
            </div>

            {/* Overdue Tasks */}
            <div
              style={{
                padding: '16px 18px',
                borderRadius: 16,
                background: metrics.overdueCount > 0 ? 'rgba(239, 68, 68, 0.08)' : 'rgba(15, 23, 42, 0.6)',
                border: metrics.overdueCount > 0 ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} color={metrics.overdueCount > 0 ? '#ef4444' : '#10b981'} />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Overdue Tasks</span>
              </div>
              <div style={{ fontSize: 24, fontWeight: 800, color: metrics.overdueCount > 0 ? '#ef4444' : '#10b981' }}>
                {metrics.overdueCount}
              </div>
            </div>

            {/* Oldest Overdue Task */}
            <div
              onClick={() => {
                if (metrics.oldestOverdueReminder && onOpenReminderModal) {
                  onOpenReminderModal(metrics.oldestOverdueReminder.id);
                }
              }}
              style={{
                padding: '16px 18px',
                borderRadius: 16,
                background: metrics.oldestOverdueReminder ? 'rgba(239, 68, 68, 0.08)' : 'rgba(15, 23, 42, 0.6)',
                border: metrics.oldestOverdueReminder ? '1px solid rgba(239, 68, 68, 0.25)' : '1px solid rgba(255, 255, 255, 0.08)',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                cursor: metrics.oldestOverdueReminder ? 'pointer' : 'default',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <AlertTriangle size={16} color={metrics.oldestOverdueReminder ? '#f87171' : '#94a3b8'} />
                <span style={{ fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>Oldest Overdue Task</span>
              </div>
              {metrics.oldestOverdueReminder ? (
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: '#fca5a5', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {metrics.oldestOverdueReminder.title}
                  </div>
                  <span style={{ fontSize: 11, color: '#f87171' }}>
                    {metrics.oldestOverdueDays} days overdue • Click to view
                  </span>
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#10b981', fontWeight: 600, marginTop: 4 }}>
                  No overdue tasks!
                </div>
              )}
            </div>
          </div>

          {/* FINANCIAL DASHBOARD INFORMATION SECTION (Only if user has configured Money Management) */}
          {metrics.hasFinancialConfig ? (
            <div
              style={{
                background: 'linear-gradient(135deg, rgba(30, 41, 59, 0.7) 0%, rgba(15, 23, 42, 0.9) 100%)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                borderRadius: 24,
                padding: '24px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
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
                      color: '#ffffff',
                    }}
                  >
                    <Wallet size={16} />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Financial Dashboard</h3>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>
                      Bills, safe remainder and monthly revenue snapshot
                    </span>
                  </div>
                </div>

                {onNavigateToMoney && (
                  <button
                    type="button"
                    onClick={onNavigateToMoney}
                    style={{
                      background: 'rgba(16, 185, 129, 0.15)',
                      border: '1px solid rgba(16, 185, 129, 0.3)',
                      color: '#34d399',
                      padding: '6px 14px',
                      borderRadius: 999,
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>Manage Money</span>
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>

              {/* 6 Required Financial Cards */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                  gap: 12,
                }}
              >
                {/* 1. Upcoming Bills */}
                <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Upcoming Bills</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#f8fafc' }}>
                    {metrics.upcomingBillsCount} active
                  </span>
                </div>

                {/* 2. Bills Before Next Pay */}
                <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Bills Before Next Pay</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#f87171' }}>
                    {formatCurrency(metrics.billsBeforePayTotal)}
                  </span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>
                    {metrics.billsBeforePayCount} bills due
                  </span>
                </div>

                {/* 3. Estimated Remaining Money */}
                <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Estimated Remaining</span>
                  <span
                    style={{
                      fontSize: 20,
                      fontWeight: 800,
                      color: metrics.remainingAfterBills >= 0 ? '#38bdf8' : '#ef4444',
                    }}
                  >
                    {formatCurrency(metrics.remainingAfterBills)}
                  </span>
                  <span style={{ fontSize: 10, color: '#94a3b8' }}>
                    After bills this cycle
                  </span>
                </div>

                {/* 4. Income This Month */}
                <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Income This Month</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#34d399' }}>
                    {formatCurrency(metrics.incomeThisMonth)}
                  </span>
                </div>

                {/* 5. Extra Income This Month */}
                <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Extra Income Month</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#10b981' }}>
                    {formatCurrency(metrics.extraIncomeThisMonth)}
                  </span>
                </div>

                {/* 6. Tips This Month */}
                <div style={{ padding: 14, borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Tips This Month</span>
                  <span style={{ fontSize: 20, fontWeight: 800, color: '#fbbf24' }}>
                    {formatCurrency(metrics.tipsThisMonth)}
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          {/* Category Tasks Breakdown */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 20,
              padding: '22px 24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Layers size={18} color="#6366f1" />
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Category Task Breakdown</h3>
              </div>
              {onNavigateToReminders && (
                <button
                  type="button"
                  onClick={onNavigateToReminders}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#818cf8',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <span>Open MindMesh Graph</span>
                  <ArrowRight size={14} />
                </button>
              )}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
              {categories.map((cat) => {
                const catReminders = reminders.filter((r) => r.categoryId === cat.id);
                const completed = catReminders.filter((r) => r.completed).length;
                const total = catReminders.length;
                const active = total - completed;
                const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

                return (
                  <div
                    key={cat.id}
                    onClick={() => {
                      setSelectedCategoryId(selectedCategoryId === cat.id ? 'all' : cat.id);
                    }}
                    style={{
                      padding: 14,
                      borderRadius: 14,
                      background: selectedCategoryId === cat.id ? 'rgba(99, 102, 241, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                      border: selectedCategoryId === cat.id ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid rgba(255, 255, 255, 0.06)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                      cursor: 'pointer',
                      transition: 'all 0.15s ease',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', backgroundColor: cat.color }} />
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{cat.name}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: cat.color }}>{pct}%</span>
                    </div>

                    {/* Progress bar */}
                    <div style={{ width: '100%', height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 999, overflow: 'hidden' }}>
                      <div
                        style={{
                          width: `${pct}%`,
                          height: '100%',
                          backgroundColor: cat.color,
                          borderRadius: 999,
                          transition: 'width 0.4s ease',
                        }}
                      />
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#94a3b8' }}>
                      <span>{completed} completed</span>
                      <span>{active} active</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Overdue / Urgent Alert List */}
          {metrics.overdueRemindersList && metrics.overdueRemindersList.length > 0 && (
            <div
              style={{
                background: 'rgba(239, 68, 68, 0.06)',
                border: '1px solid rgba(239, 68, 68, 0.2)',
                borderRadius: 20,
                padding: '20px 24px',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                <AlertTriangle size={18} color="#ef4444" />
                <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0, color: '#fca5a5' }}>
                  Overdue Reminders ({metrics.overdueRemindersList.length})
                </h3>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {metrics.overdueRemindersList.map((rem) => {
                  const cat = categories.find((c) => c.id === rem.categoryId);
                  return (
                    <div
                      key={rem.id}
                      onClick={() => onOpenReminderModal?.(rem.id)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '12px 16px',
                        borderRadius: 12,
                        background: 'rgba(15, 23, 42, 0.6)',
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ width: 8, height: 8, borderRadius: '50%', backgroundColor: cat?.color || '#ef4444' }} />
                        <span style={{ fontSize: 14, fontWeight: 600, color: '#f8fafc' }}>{rem.title}</span>
                      </div>

                      <span style={{ fontSize: 12, color: '#ef4444', fontWeight: 700 }}>
                        Due {formatDateAU(rem.dueDate || '')}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
