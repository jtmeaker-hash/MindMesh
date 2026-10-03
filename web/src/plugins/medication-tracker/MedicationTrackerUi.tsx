import React from 'react';
import { X } from 'lucide-react';
import type { DoseDisplayStatus } from './logic';

/** Shared visual tokens so the plugin matches MindMesh's dark theme. */
export const M = {
  panel: 'rgba(15, 23, 42, 0.72)',
  panelAlt: 'rgba(30, 41, 59, 0.55)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(52, 211, 153, 0.4)',
  accent: '#34d399',
  accentSoft: 'rgba(52, 211, 153, 0.14)',
  text: '#e2e8f0',
  muted: '#94a3b8',
  faint: '#64748b',
};

export const DOSE_STATUS_COLORS: Record<DoseDisplayStatus, { color: string; bg: string; label: string }> = {
  taken: { color: '#34d399', bg: 'rgba(52, 211, 153, 0.16)', label: 'Taken' },
  skipped: { color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.16)', label: 'Skipped' },
  upcoming: { color: '#7dd3fc', bg: 'rgba(125, 211, 252, 0.14)', label: 'Upcoming' },
  due: { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.16)', label: 'Due now' },
  missed: { color: '#f87171', bg: 'rgba(248, 113, 113, 0.16)', label: 'Missed' },
};

export const Panel: React.FC<{ title?: string; right?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }> = ({
  title,
  right,
  children,
  style,
}) => (
  <section style={{ background: M.panel, border: `1px solid ${M.border}`, borderRadius: 16, padding: 16, ...style }}>
    {(title || right) && (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 }}>
        {title && (
          <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: M.muted }}>
            {title}
          </h3>
        )}
        {right}
      </div>
    )}
    {children}
  </section>
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'subtle' };

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', style, children, ...rest }) => {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '9px 14px',
    borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: rest.disabled ? 'not-allowed' : 'pointer',
    border: '1px solid transparent', opacity: rest.disabled ? 0.55 : 1, transition: 'all 0.15s ease',
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: M.accent, color: '#04140e', border: `1px solid ${M.accent}` },
    ghost: { background: 'transparent', color: M.text, border: `1px solid ${M.border}` },
    subtle: { background: M.accentSoft, color: '#a7f3d0', border: `1px solid ${M.borderStrong}` },
    danger: { background: 'rgba(239, 68, 68, 0.16)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.4)' },
  };
  return (
    <button type="button" style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {children}
    </button>
  );
};

export const StatusPill: React.FC<{ status: DoseDisplayStatus; label?: string }> = ({ status, label }) => {
  const c = DOSE_STATUS_COLORS[status];
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999,
        fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', color: c.color, background: c.bg,
        border: `1px solid ${c.color}55`, whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
      {label ?? c.label}
    </span>
  );
};

export const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode; style?: React.CSSProperties }> = ({
  label,
  hint,
  children,
  style,
}) => (
  <label style={{ display: 'flex', flexDirection: 'column', gap: 5, flex: '1 1 160px', minWidth: 0, ...style }}>
    <span style={{ fontSize: 11, fontWeight: 700, color: M.muted, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
      {label}
    </span>
    {children}
    {hint && <span style={{ fontSize: 10.5, color: M.faint }}>{hint}</span>}
  </label>
);

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '9px 11px', borderRadius: 10, background: 'rgba(2, 6, 23, 0.6)',
  border: `1px solid ${M.border}`, color: M.text, fontSize: 13.5, outline: 'none', boxSizing: 'border-box', colorScheme: 'dark',
};

export const TextInput: React.FC<React.InputHTMLAttributes<HTMLInputElement>> = ({ style, ...rest }) => (
  <input style={{ ...inputStyle, ...style }} {...rest} />
);
export const TextArea: React.FC<React.TextareaHTMLAttributes<HTMLTextAreaElement>> = ({ style, ...rest }) => (
  <textarea style={{ ...inputStyle, resize: 'vertical', minHeight: 68, ...style }} {...rest} />
);
export const Select: React.FC<React.SelectHTMLAttributes<HTMLSelectElement>> = ({ style, children, ...rest }) => (
  <select style={{ ...inputStyle, ...style }} {...rest}>
    {children}
  </select>
);
export const Row: React.FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', ...style }}>{children}</div>
);

export const Modal: React.FC<{ title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }> = ({
  title,
  onClose,
  children,
  wide,
}) => (
  <div
    style={{
      position: 'fixed', inset: 0, zIndex: 600, background: 'rgba(2, 6, 23, 0.72)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }}
    onClick={onClose}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', maxWidth: wide ? 720 : 560, maxHeight: '90dvh', overflowY: 'auto', background: '#0b1220',
        borderTopLeftRadius: 20, borderTopRightRadius: 20, border: `1px solid ${M.border}`,
        padding: '18px 18px calc(20px + env(safe-area-inset-bottom, 0px)) 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>{title}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{ background: 'transparent', border: 'none', color: M.muted, cursor: 'pointer', padding: 4, display: 'flex' }}
        >
          <X size={18} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

export function relativeDayLabel(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDiff = Math.round((target.getTime() - today.getTime()) / 86_400_000);
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Tomorrow';
  if (dayDiff === -1) return 'Yesterday';
  return date.toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' });
}
