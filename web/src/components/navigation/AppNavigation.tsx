import React from 'react';
import { AppNavTab } from '../../types/finance';
import { Network, Users, Wallet, LayoutDashboard, ListChecks } from 'lucide-react';

interface AppNavigationProps {
  currentTab: AppNavTab;
  onSelectTab: (tab: AppNavTab) => void;
  activeRemindersCount?: number;
  upcomingBillsCount?: number;
  contactsCount?: number;
}

export const AppNavigation: React.FC<AppNavigationProps> = ({
  currentTab,
  onSelectTab,
  activeRemindersCount = 0,
  upcomingBillsCount = 0,
  contactsCount = 0,
}) => {
  return (
    <nav
      className="mm-navigation mm-surface"
      aria-label="Primary Navigation"
      style={{
        display: 'flex',
        alignItems: 'center',
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        borderRadius: 999,
        padding: '3px 4px',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)',
      }}
    >
      {/* Reminders / MindMesh */}
      <button
        type="button"
        onClick={() => onSelectTab('reminders')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          borderRadius: 999,
          border: 'none',
          background: currentTab === 'reminders'
            ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
            : 'transparent',
          color: currentTab === 'reminders' ? '#ffffff' : '#94a3b8',
          fontWeight: currentTab === 'reminders' ? 600 : 500,
          fontSize: 13,
          cursor: 'pointer',
          transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: currentTab === 'reminders' ? '0 2px 10px rgba(99, 102, 241, 0.4)' : 'none',
          minHeight: 34,
        }}
      >
        <Network size={15} />
        <span>MindMesh</span>
        {activeRemindersCount > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              background: currentTab === 'reminders' ? 'rgba(255,255,255,0.25)' : 'rgba(99, 102, 241, 0.3)',
              color: currentTab === 'reminders' ? '#ffffff' : '#a5b4fc',
              padding: '1px 6px',
              borderRadius: 999,
              marginLeft: 1,
            }}
          >
            {activeRemindersCount}
          </span>
        )}
      </button>

      {/* Routines */}
      <button
        type="button"
        onClick={() => onSelectTab('routines')}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', borderRadius: 999,
          border: 'none', background: currentTab === 'routines' ? 'linear-gradient(135deg, #0891b2 0%, #0e7490 100%)' : 'transparent',
          color: currentTab === 'routines' ? '#ffffff' : '#94a3b8', fontWeight: currentTab === 'routines' ? 600 : 500,
          fontSize: 13, cursor: 'pointer', transition: 'all 0.18s ease', minHeight: 34,
          boxShadow: currentTab === 'routines' ? '0 2px 10px rgba(8,145,178,.4)' : 'none',
        }}
      >
        <ListChecks size={15} />
        <span>Routines</span>
      </button>

      {/* Contacts */}
      <button
        type="button"
        onClick={() => onSelectTab('contacts')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          borderRadius: 999,
          border: 'none',
          background: currentTab === 'contacts'
            ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
            : 'transparent',
          color: currentTab === 'contacts' ? '#ffffff' : '#94a3b8',
          fontWeight: currentTab === 'contacts' ? 600 : 500,
          fontSize: 13,
          cursor: 'pointer',
          transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: currentTab === 'contacts' ? '0 2px 10px rgba(99, 102, 241, 0.4)' : 'none',
          minHeight: 34,
        }}
      >
        <Users size={15} />
        <span>Contacts</span>
        {contactsCount > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              background: currentTab === 'contacts' ? 'rgba(255,255,255,0.25)' : 'rgba(99, 102, 241, 0.3)',
              color: currentTab === 'contacts' ? '#ffffff' : '#a5b4fc',
              padding: '1px 6px',
              borderRadius: 999,
              marginLeft: 1,
            }}
          >
            {contactsCount}
          </span>
        )}
      </button>

      {/* Money */}
      <button
        type="button"
        onClick={() => onSelectTab('money')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          borderRadius: 999,
          border: 'none',
          background: currentTab === 'money'
            ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
            : 'transparent',
          color: currentTab === 'money' ? '#ffffff' : '#94a3b8',
          fontWeight: currentTab === 'money' ? 600 : 500,
          fontSize: 13,
          cursor: 'pointer',
          transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: currentTab === 'money' ? '0 2px 10px rgba(99, 102, 241, 0.4)' : 'none',
          minHeight: 34,
        }}
      >
        <Wallet size={15} />
        <span>Money</span>
        {upcomingBillsCount > 0 && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              background: currentTab === 'money' ? 'rgba(255,255,255,0.25)' : 'rgba(99, 102, 241, 0.3)',
              color: currentTab === 'money' ? '#ffffff' : '#a5b4fc',
              padding: '1px 6px',
              borderRadius: 999,
              marginLeft: 1,
            }}
          >
            {upcomingBillsCount}
          </span>
        )}
      </button>

      {/* Dashboard */}
      <button
        type="button"
        onClick={() => onSelectTab('dashboard')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 14px',
          borderRadius: 999,
          border: 'none',
          background: currentTab === 'dashboard'
            ? 'linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)'
            : 'transparent',
          color: currentTab === 'dashboard' ? '#ffffff' : '#94a3b8',
          fontWeight: currentTab === 'dashboard' ? 600 : 500,
          fontSize: 13,
          cursor: 'pointer',
          transition: 'all 0.18s cubic-bezier(0.4, 0, 0.2, 1)',
          boxShadow: currentTab === 'dashboard' ? '0 2px 10px rgba(99, 102, 241, 0.4)' : 'none',
          minHeight: 34,
        }}
      >
        <LayoutDashboard size={15} />
        <span>Dashboard</span>
      </button>
    </nav>
  );
};
