import React, { useState } from 'react';
import { Reminder, Category } from '../../types';
import { MoneyState, DashboardTimeRange } from '../../types/finance';
import { computeDashboardMetrics } from '../../utils/dashboard';
import { formatCurrency, formatDateAU } from '../../utils/finance';
import { CompletionGauge } from './CompletionGauge';
import { EmptyState } from '../common/EmptyState';
import {
  LayoutDashboard,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Flame,
  CreditCard,
  Wallet,
  Coins,
  TrendingUp,
  Calendar,
  Layers,
  ChevronRight,
} from 'lucide-react';

interface DashboardModuleProps {
  reminders: Reminder[];
  categories: Category[];
  moneyState: MoneyState;
  onNavigateToMoney?: () => void;
  onNavigateToReminders?: () => void;
  onOpenReminderModal?: (reminderId: string) => void;
}

export const DashboardModule: React.FC<DashboardModuleProps> = ({
  reminders,
  categories,
  moneyState,
  onNavigateToMoney,
  onNavigateToReminders,
  onOpenReminderModal,
}) => {
  const [timeRange, setTimeRange] = useState<DashboardTimeRange>('all_time');

  const metrics = computeDashboardMetrics(reminders, categories, moneyState, timeRange);

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
      {/* Dashboard Sticky Header */}
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 20,
          background: 'rgba(15, 23, 42, 0.85)',
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
              width: 34,
              height: 34,
              borderRadius: 10,
              background: 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 4px 14px rgba(99, 102, 241, 0.3)',
            }}
          >
            <LayoutDashboard size={18} />
          </div>
          <div>
            <h1 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: '-0.02em' }}>
              MindMesh & Money Dashboard
            </h1>
            <span style={{ fontSize: 11, color: '#94a3b8' }}>
              Productivity, completion velocity, upcoming bills and financial health
            </span>
          </div>
        </div>

        {/* Time range selector */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            background: 'rgba(255, 255, 255, 0.04)',
            borderRadius: 999,
            padding: 3,
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          {(['7_days', '30_days', 'this_month', 'all_time'] as DashboardTimeRange[]).map((r) => {
            const labelMap: Record<DashboardTimeRange, string> = {
              '7_days': '7 Days',
              '30_days': '30 Days',
              'this_month': 'This Month',
              'all_time': 'All Time',
            };
            const isActive = timeRange === r;
            return (
              <button
                key={r}
                type="button"
                onClick={() => setTimeRange(r)}
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
                {labelMap[r]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Container */}
      <div style={{ padding: '24px', maxWidth: 1180, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
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
                completedCount={metrics.completedTasks}
                totalCount={metrics.totalTasks}
                color="#10b981"
              />

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, minWidth: 160 }}>
                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Active MindMesh
                  </span>
                  <div style={{ fontSize: 24, fontWeight: 800, color: '#f8fafc' }}>
                    {metrics.activeTasks} pending
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Overdue Reminders
                  </span>
                  <div style={{ fontSize: 20, fontWeight: 800, color: metrics.overdueTasks > 0 ? '#ef4444' : '#10b981' }}>
                    {metrics.overdueTasks} {metrics.overdueTasks > 0 ? 'overdue' : 'none!'}
                  </div>
                </div>

                <div>
                  <span style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', textTransform: 'uppercase' }}>
                    Subtasks Completed
                  </span>
                  <div style={{ fontSize: 16, fontWeight: 700, color: '#a5b4fc' }}>
                    {metrics.completedSubtasks} / {metrics.totalSubtasks}
                  </div>
                </div>
              </div>
            </div>

            {/* Money Pulse Quick Summary */}
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
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Wallet size={18} color="#10b981" />
                  <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Financial Snapshot</h3>
                </div>
                {onNavigateToMoney && (
                  <button
                    type="button"
                    onClick={onNavigateToMoney}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#10b981',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>Go to Money</span>
                    <ChevronRight size={14} />
                  </button>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Monthly Bills</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: '#f87171' }}>
                    {formatCurrency(metrics.monthlyBillsTotal)}
                  </span>
                </div>

                <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Cycle Safe Remainder</span>
                  <span
                    style={{
                      fontSize: 18,
                      fontWeight: 800,
                      color: metrics.safeSpendRemaining >= 0 ? '#38bdf8' : '#ef4444',
                    }}
                  >
                    {formatCurrency(metrics.safeSpendRemaining)}
                  </span>
                </div>

                <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Extra Income Logged</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: '#34d399' }}>
                    {formatCurrency(metrics.extraIncomeTotal)}
                  </span>
                </div>

                <div style={{ padding: 12, borderRadius: 14, background: 'rgba(255,255,255,0.03)' }}>
                  <span style={{ fontSize: 11, color: '#94a3b8', display: 'block' }}>Total Tips Logged</span>
                  <span style={{ fontSize: 18, fontWeight: 800, color: '#fbbf24' }}>
                    {formatCurrency(metrics.tipsTotal)}
                  </span>
                </div>
              </div>

              <div style={{ fontSize: 11, color: '#64748b' }}>
                Next pay cycle date: {formatDateAU(metrics.nextPayDate)}
              </div>
            </div>
          </div>

          {/* Middle Row: Category Breakdown Cards */}
          <div
            style={{
              background: 'rgba(15, 23, 42, 0.6)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: 20,
              padding: '22px 24px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
              <Layers size={18} color="#6366f1" />
              <h3 style={{ fontSize: 16, fontWeight: 700, margin: 0 }}>Category Completion Velocity</h3>
            </div>

            {metrics.categoryBreakdown.length === 0 ? (
              <p style={{ color: '#94a3b8', fontSize: 13 }}>No category task activity found.</p>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 14 }}>
                {metrics.categoryBreakdown.map((cat) => {
                  const pct = cat.total > 0 ? Math.round((cat.completed / cat.total) * 100) : 0;
                  return (
                    <div
                      key={cat.id}
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        background: 'rgba(255, 255, 255, 0.03)',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
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
                        <span>{cat.completed} done</span>
                        <span>{cat.active} pending</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom Row: Overdue / Urgent Alert List */}
          {metrics.overdueRemindersList.length > 0 && (
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
                  Overdue Reminders Requiring Attention ({metrics.overdueRemindersList.length})
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
