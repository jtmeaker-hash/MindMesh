import React from 'react';
import { X } from 'lucide-react';
import type { VehicleServiceStatus } from '../../types/vehicle';

/** Shared visual tokens so the vehicle module matches MindMesh's dark theme. */
export const V = {
  panel: 'rgba(15, 23, 42, 0.72)',
  panelAlt: 'rgba(30, 41, 59, 0.55)',
  border: 'rgba(255, 255, 255, 0.08)',
  borderStrong: 'rgba(56, 189, 248, 0.4)',
  accent: '#38bdf8',
  accentSoft: 'rgba(56, 189, 248, 0.14)',
  text: '#e2e8f0',
  muted: '#94a3b8',
  faint: '#64748b',
  danger: '#ef4444',
};

export const STATUS_COLORS: Record<VehicleServiceStatus, { color: string; bg: string }> = {
  ok: { color: '#34d399', bg: 'rgba(52, 211, 153, 0.14)' },
  approaching: { color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.14)' },
  urgent: { color: '#fb923c', bg: 'rgba(251, 146, 60, 0.16)' },
  due: { color: '#f87171', bg: 'rgba(248, 113, 113, 0.16)' },
  overdue: { color: '#ef4444', bg: 'rgba(239, 68, 68, 0.2)' },
};

export const Panel: React.FC<{ title?: string; right?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }> = ({
  title,
  right,
  children,
  style,
}) => (
  <section
    style={{
      background: V.panel,
      border: `1px solid ${V.border}`,
      borderRadius: 16,
      padding: 16,
      ...style,
    }}
  >
    {(title || right) && (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 10 }}>
        {title && <h3 style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: V.muted }}>{title}</h3>}
        {right}
      </div>
    )}
    {children}
  </section>
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' | 'subtle' };

export const Button: React.FC<ButtonProps> = ({ variant = 'primary', style, children, ...rest }) => {
  const base: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '9px 14px',
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 600,
    cursor: rest.disabled ? 'not-allowed' : 'pointer',
    border: '1px solid transparent',
    opacity: rest.disabled ? 0.55 : 1,
    transition: 'all 0.15s ease',
  };
  const variants: Record<string, React.CSSProperties> = {
    primary: { background: V.accent, color: '#04121f', border: `1px solid ${V.accent}` },
    ghost: { background: 'transparent', color: V.text, border: `1px solid ${V.border}` },
    subtle: { background: V.accentSoft, color: '#bae6fd', border: `1px solid ${V.borderStrong}` },
    danger: { background: 'rgba(239, 68, 68, 0.16)', color: '#fca5a5', border: '1px solid rgba(239, 68, 68, 0.4)' },
  };
  return (
    <button type="button" style={{ ...base, ...variants[variant], ...style }} {...rest}>
      {children}
    </button>
  );
};

export const StatusPill: React.FC<{ status: VehicleServiceStatus; label: string }> = ({ status, label }) => {
  const c = STATUS_COLORS[status];
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 999,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.05em',
        color: c.color,
        background: c.bg,
        border: `1px solid ${c.color}55`,
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: c.color, boxShadow: `0 0 8px ${c.color}` }} />
      {label}
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
    <span style={{ fontSize: 11, fontWeight: 700, color: V.muted, letterSpacing: '0.03em', textTransform: 'uppercase' }}>{label}</span>
    {children}
    {hint && <span style={{ fontSize: 10.5, color: V.faint }}>{hint}</span>}
  </label>
);

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '9px 11px',
  borderRadius: 10,
  background: 'rgba(2, 6, 23, 0.6)',
  border: `1px solid ${V.border}`,
  color: V.text,
  fontSize: 13.5,
  outline: 'none',
  boxSizing: 'border-box',
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
      position: 'fixed',
      inset: 0,
      zIndex: 600,
      background: 'rgba(2, 6, 23, 0.72)',
      backdropFilter: 'blur(4px)',
      display: 'flex',
      alignItems: 'flex-end',
      justifyContent: 'center',
      padding: 0,
    }}
    onClick={onClose}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: '100%',
        maxWidth: wide ? 720 : 560,
        maxHeight: '90dvh',
        overflowY: 'auto',
        background: '#0b1220',
        borderTopLeftRadius: 20,
        borderTopRightRadius: 20,
        border: `1px solid ${V.border}`,
        padding: '18px 18px calc(20px + env(safe-area-inset-bottom, 0px)) 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <h2 style={{ fontSize: 16, fontWeight: 800, color: '#f8fafc' }}>{title}</h2>
        <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: V.muted, cursor: 'pointer', padding: 4, display: 'flex' }}>
          <X size={18} />
        </button>
      </div>
      {children}
    </div>
  </div>
);

export function formatDateAU(value: string | undefined): string {
  if (!value) return '—';
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function money(value: number | undefined): string {
  if (value === undefined || value === null || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-AU', { maximumFractionDigits: 2 })}`;
}

export function vehicleLabel(vehicle: { nickname?: string; make?: string; model?: string }): string {
  return vehicle.nickname?.trim() || [vehicle.make, vehicle.model].filter(Boolean).join(' ') || 'Vehicle';
}

