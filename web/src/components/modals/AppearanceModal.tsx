import React, { useMemo, useRef, useState } from 'react';
import { X, Palette, Droplet, Sparkles, Image as ImageIcon, RotateCcw, Trash2, AlertTriangle, Layers } from 'lucide-react';
import { AppearanceSettings } from '../../types/appearance';
import {
  APPEARANCE_PRESETS,
  applyPreset,
  getChromeTheme,
  getDefaultAppearance,
  resolveNodeTheme,
} from '../../services/appearance';

interface AppearanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  appearance: AppearanceSettings;
  onChange: (next: AppearanceSettings) => void;
}

const MAX_IMAGE_CHARS = 2_600_000;

/** Downscales an imported photo to keep localStorage + backups small. */
function downscaleImage(dataUrl: string, maxWidth = 1600, quality = 0.82): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => {
        try {
          const scale = Math.min(1, maxWidth / (img.width || maxWidth));
          const canvas = document.createElement('canvas');
          canvas.width = Math.max(1, Math.round((img.width || maxWidth) * scale));
          canvas.height = Math.max(1, Math.round((img.height || maxWidth) * scale));
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            resolve(dataUrl);
            return;
          }
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        } catch {
          resolve(dataUrl);
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    } catch {
      resolve(dataUrl);
    }
  });
}

type TabId = 'themes' | 'nodes' | 'depth' | 'background' | 'matrix';

const TABS: { id: TabId; label: string; icon: React.ReactNode }[] = [
  { id: 'themes', label: 'Themes', icon: <Sparkles size={14} /> },
  { id: 'nodes', label: 'Nodes & Lines', icon: <Palette size={14} /> },
  { id: 'background', label: 'Background', icon: <ImageIcon size={14} /> },
  { id: 'depth', label: '3D Depth', icon: <Layers size={14} /> },
  { id: 'matrix', label: 'Code Rain', icon: <Droplet size={14} /> },
];

interface RowProps {
  label: string;
  hint?: string;
  disabled?: boolean;
  children: React.ReactNode;
}

const ControlRow: React.FC<RowProps> = ({ label, hint, disabled, children }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '10px 12px',
      borderRadius: 12,
      backgroundColor: 'rgba(30, 41, 59, 0.45)',
      border: '1px solid rgba(255, 255, 255, 0.06)',
      opacity: disabled ? 0.45 : 1,
    }}
  >
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>{label}</div>
      {hint && <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>{hint}</div>}
    </div>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>{children}</div>
  </div>
);

interface ColorRowProps {
  label: string;
  value: string;
  disabled?: boolean;
  hint?: string;
  onChange: (value: string) => void;
}

const ColorRow: React.FC<ColorRowProps> = ({ label, value, disabled, hint, onChange }) => (
  <ControlRow label={label} hint={hint} disabled={disabled}>
    <input
      type="color"
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={{
        width: 34,
        height: 28,
        padding: 0,
        border: '1px solid rgba(255,255,255,0.15)',
        borderRadius: 8,
        background: 'transparent',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    />
    <span style={{ fontSize: 11, fontFamily: 'monospace', color: '#94a3b8', width: 62 }}>{value}</span>
  </ControlRow>
);

interface SliderRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  onChange: (value: number) => void;
}

const SliderRow: React.FC<SliderRowProps> = ({ label, value, min, max, step, display, onChange }) => (
  <ControlRow label={label}>
    <input
      type="range"
      aria-label={label}
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: 120, accentColor: '#6366f1' }}
    />
    <span style={{ fontSize: 11, color: '#94a3b8', width: 44, textAlign: 'right' }}>{display}</span>
  </ControlRow>
);

interface ToggleRowProps {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

const ToggleRow: React.FC<ToggleRowProps> = ({ label, hint, checked, onChange }) => (
  <ControlRow label={label} hint={hint}>
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      style={{
        width: 46,
        height: 26,
        borderRadius: 999,
        border: 'none',
        cursor: 'pointer',
        backgroundColor: checked ? '#10b981' : '#334155',
        position: 'relative',
        transition: 'background-color 0.18s ease',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 3,
          left: checked ? 23 : 3,
          width: 20,
          height: 20,
          borderRadius: '50%',
          backgroundColor: '#ffffff',
          transition: 'left 0.18s ease',
        }}
      />
    </button>
  </ControlRow>
);

interface SegmentProps<T extends string> {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  ariaLabel: string;
}

function Segmented<T extends string>({ value, options, onChange, ariaLabel }: SegmentProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      style={{ display: 'flex', backgroundColor: '#1E293B', borderRadius: 12, padding: 3, gap: 3 }}
    >
      {options.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          style={{
            flex: 1,
            padding: '7px 10px',
            borderRadius: 9,
            border: 'none',
            backgroundColor: value === opt.value ? '#6366f1' : 'transparent',
            color: value === opt.value ? '#ffffff' : '#94a3b8',
            fontSize: 12,
            fontWeight: 600,
            cursor: 'pointer',
            whiteSpace: 'nowrap',
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** Live miniature mesh used for visual previews inside the modal. */
const MeshPreview: React.FC<{ appearance: AppearanceSettings }> = ({ appearance }) => {
  const accent = appearance.nodeColors.root;
  const category = appearance.nodeColorMode === 'custom' ? appearance.nodeColors.category : '#06b6d4';
  const reminder = appearance.nodeColorMode === 'custom' ? appearance.nodeColors.reminder : '#3b82f6';
  const branchLine = appearance.connectionColorMode === 'custom' ? appearance.connectionColors.branch : '#06b6d4';
  const reminderLine = appearance.connectionColorMode === 'custom' ? appearance.connectionColors.reminder : '#3b82f6';
  const theme = resolveNodeTheme(appearance, accent);
  const categoryTheme = resolveNodeTheme(appearance, category);
  const reminderTheme = resolveNodeTheme(appearance, reminder);

  const base =
    appearance.background.kind === 'white'
      ? '#ffffff'
      : appearance.background.kind === 'black'
      ? '#000000'
      : appearance.background.kind === 'void'
      ? '#05060f'
      : appearance.background.color;

  return (
    <div
      style={{
        position: 'relative',
        height: 118,
        borderRadius: 14,
        overflow: 'hidden',
        border: `1px solid ${getChromeTheme(appearance).panelBorder}`,
        background:
          appearance.background.kind === 'void'
            ? 'radial-gradient(120% 100% at 50% 10%, #0b1024 0%, #05060f 55%, #010103 100%)'
            : base,
        flexShrink: 0,
      }}
    >
      {appearance.background.kind === 'image' && appearance.background.image.dataUrl && (
        <img
          src={appearance.background.image.dataUrl}
          alt=""
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: appearance.background.image.fit,
            objectPosition: appearance.background.image.position,
            opacity: appearance.background.image.opacity,
            filter: appearance.background.image.blur > 0 ? `blur(${appearance.background.image.blur}px)` : undefined,
          }}
        />
      )}
      {appearance.background.dim > 0 && (
        <div style={{ position: 'absolute', inset: 0, backgroundColor: `rgba(0,0,0,${appearance.background.dim})` }} />
      )}
      <svg viewBox="0 0 300 118" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
        <line x1="58" y1="58" x2="162" y2="32" stroke={branchLine} strokeWidth="2" opacity="0.75" />
        <line x1="162" y1="32" x2="248" y2="72" stroke={reminderLine} strokeWidth="1.6" opacity="0.7" />
        <circle cx="58" cy="58" r="24" fill={theme.surface} stroke={theme.accent} strokeWidth="2" />
        <circle cx="162" cy="32" r="16" fill={categoryTheme.surface} stroke={categoryTheme.accent} strokeWidth="2" />
        <rect
          x="222"
          y="62"
          width="56"
          height="20"
          rx="6"
          fill={reminderTheme.surface}
          stroke={reminderTheme.accent}
          strokeWidth="1.5"
        />
        <text x="58" y="62" textAnchor="middle" fontSize="9" fill={theme.text} fontWeight="700">
          Mesh
        </text>
        <text x="250" y="76" textAnchor="middle" fontSize="8" fill={reminderTheme.text}>
          Task
        </text>
      </svg>
    </div>
  );
};

export const AppearanceModal: React.FC<AppearanceModalProps> = ({ isOpen, onClose, appearance, onChange }) => {
  const [activeTab, setActiveTab] = useState<TabId>('themes');
  const [imageError, setImageError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const chrome = useMemo(() => getChromeTheme(appearance), [appearance]);

  if (!isOpen) return null;

  const patch = (partial: Partial<AppearanceSettings>) => {
    onChange({ ...appearance, ...partial, themeId: partial.themeId ?? 'custom' });
  };

  const patchBackground = (partial: Partial<AppearanceSettings['background']>) => {
    onChange({
      ...appearance,
      themeId: 'custom',
      background: { ...appearance.background, ...partial },
    });
  };

  const patchImage = (partial: Partial<AppearanceSettings['background']['image']>) => {
    onChange({
      ...appearance,
      themeId: 'custom',
      background: {
        ...appearance.background,
        kind: 'image',
        image: { ...appearance.background.image, ...partial },
      },
    });
  };

  const patchMatrix = (partial: Partial<AppearanceSettings['matrix']>) => {
    onChange({ ...appearance, themeId: 'custom', matrix: { ...appearance.matrix, ...partial } });
  };

  const handleImageSelection = (file: File | undefined) => {
    if (!file) return;
    setImageError(null);

    if (!file.type.startsWith('image/')) {
      setImageError('Please choose an image file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = async (event) => {
      const result = event.target?.result;
      if (typeof result !== 'string') {
        setImageError('Could not read that image.');
        return;
      }
      const processed = await downscaleImage(result);
      if (processed.length > MAX_IMAGE_CHARS) {
        setImageError('That image is too large even after compression. Try a smaller photo.');
        return;
      }
      patchImage({ dataUrl: processed });
    };
    reader.onerror = () => setImageError('Could not read that image.');
    reader.readAsDataURL(file);
  };

  const removeImage = () => {
    setImageError(null);
    onChange({
      ...appearance,
      themeId: 'custom',
      background: {
        ...appearance.background,
        kind: appearance.background.kind === 'image' ? 'default' : appearance.background.kind,
        image: { ...appearance.background.image, dataUrl: undefined },
      },
    });
  };

  const backgroundOptions: { value: AppearanceSettings['background']['kind']; label: string; description: string }[] = [
    { value: 'default', label: 'Dark', description: 'Original MindMesh night tone' },
    { value: 'black', label: 'Black', description: 'Pure solid black' },
    { value: 'white', label: 'White', description: 'Light interface contrast' },
    { value: 'void', label: 'Void', description: 'Deep cyberspace atmosphere' },
    { value: 'image', label: 'Photo', description: 'Use your own image' },
  ];

  return (
    <div
      className="mm-depth-enter"
      role="dialog"
      aria-modal="true"
      aria-label="Appearance settings"
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(3, 7, 18, 0.78)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        alignItems: 'center',
        padding: 16,
        animation: 'fadeIn 0.2s ease',
      }}
      onClick={onClose}
    >
      <div
        className="mm-card"
        style={{
          backgroundColor: '#0F172A',
          border: `1px solid ${chrome.panelBorder}`,
          borderRadius: 24,
          padding: '22px 20px',
          maxHeight: '90vh',
          overflowY: 'auto',
          boxShadow: '0 20px 60px rgba(0,0,0,0.85)',
          width: '100%',
          maxWidth: 620,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                backgroundColor: 'rgba(99, 102, 241, 0.15)',
                color: '#818cf8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Palette size={20} />
            </div>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 700, color: '#F8FAFC', margin: 0 }}>Appearance</h2>
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Themes, node colours, backgrounds & code rain</span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close appearance settings"
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

        <MeshPreview appearance={appearance} />

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 6, margin: '16px 0 16px 0', flexWrap: 'wrap' }}>
          {TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '7px 12px',
                borderRadius: 999,
                border: 'none',
                backgroundColor: activeTab === tab.id ? '#6366f1' : 'rgba(255,255,255,0.06)',
                color: activeTab === tab.id ? '#ffffff' : '#94a3b8',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>

        {/* THEMES */}
        {activeTab === 'themes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {APPEARANCE_PRESETS.map((preset) => {
              const isActive = appearance.themeId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => onChange(applyPreset(appearance, preset.id))}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 14,
                    padding: 14,
                    borderRadius: 16,
                    textAlign: 'left',
                    cursor: 'pointer',
                    backgroundColor: isActive ? 'rgba(99, 102, 241, 0.12)' : 'rgba(30, 41, 59, 0.45)',
                    border: `1px solid ${isActive ? '#6366f1' : 'rgba(255,255,255,0.06)'}`,
                  }}
                >
                  <div style={{ display: 'flex', gap: 6 }}>
                    {[preset.nodeColors.root, preset.nodeColors.category, preset.nodeColors.reminder].map((c) => (
                      <span
                        key={c}
                        style={{
                          width: 20,
                          height: 20,
                          borderRadius: '50%',
                          backgroundColor: preset.backgroundKind === 'black' ? '#000000' : '#0b111e',
                          border: `2px solid ${c}`,
                          boxShadow: `0 0 8px ${c}55`,
                        }}
                      />
                    ))}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: '#f8fafc' }}>
                      {preset.name}
                      {preset.id === 'matrix' && (
                        <span style={{ fontSize: 10, marginLeft: 8, color: '#34d399', fontWeight: 600 }}>
                          includes code rain
                        </span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2 }}>{preset.description}</div>
                  </div>
                  {isActive && <span style={{ fontSize: 11, fontWeight: 700, color: '#a5b4fc' }}>ACTIVE</span>}
                </button>
              );
            })}

            <div style={{ fontSize: 11, color: '#64748b', lineHeight: 1.5 }}>
              Presets set sensible defaults — every colour stays individually adjustable in{' '}
              <strong style={{ color: '#94a3b8' }}>Nodes &amp; Lines</strong>, and the code rain can be switched off
              independently in <strong style={{ color: '#94a3b8' }}>Code Rain</strong>.
            </div>
          </div>
        )}

        {/* NODES & LINES */}
        {activeTab === 'nodes' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em' }}>NODE COLOURS</div>
            <Segmented
              ariaLabel="Node colour source"
              value={appearance.nodeColorMode}
              onChange={(value) => patch({ nodeColorMode: value })}
              options={[
                { value: 'category', label: 'Use category colours' },
                { value: 'custom', label: 'Custom palette' },
              ]}
            />
            <ColorRow
              label="Main / root node"
              value={appearance.nodeColors.root}
              onChange={(root) => patch({ nodeColors: { ...appearance.nodeColors, root } })}
            />
            <ColorRow
              label="Category nodes"
              value={appearance.nodeColors.category}
              disabled={appearance.nodeColorMode !== 'custom'}
              hint={appearance.nodeColorMode !== 'custom' ? 'Using each category’s own colour' : undefined}
              onChange={(category) => patch({ nodeColors: { ...appearance.nodeColors, category } })}
            />
            <ColorRow
              label="Reminder / task nodes"
              value={appearance.nodeColors.reminder}
              disabled={appearance.nodeColorMode !== 'custom'}
              onChange={(reminder) => patch({ nodeColors: { ...appearance.nodeColors, reminder } })}
            />
            <ColorRow
              label="Subtask nodes"
              value={appearance.nodeColors.subtask}
              disabled={appearance.nodeColorMode !== 'custom'}
              onChange={(subtask) => patch({ nodeColors: { ...appearance.nodeColors, subtask } })}
            />
            <ColorRow
              label="Completed nodes"
              value={appearance.nodeColors.completed}
              disabled={appearance.nodeColorMode !== 'custom'}
              hint="Used across the Completed view"
              onChange={(completed) => patch({ nodeColors: { ...appearance.nodeColors, completed } })}
            />
            <ColorRow
              label="Selected / highlighted node"
              value={appearance.nodeColors.selected}
              onChange={(selected) => patch({ nodeColors: { ...appearance.nodeColors, selected } })}
            />
            <ColorRow
              label="Hover state"
              value={appearance.nodeColors.hover}
              onChange={(hover) => patch({ nodeColors: { ...appearance.nodeColors, hover } })}
            />

            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', marginTop: 6 }}>
              CONNECTION LINES
            </div>
            <Segmented
              ariaLabel="Connection colour source"
              value={appearance.connectionColorMode}
              onChange={(value) => patch({ connectionColorMode: value })}
              options={[
                { value: 'inherit', label: 'Follow nodes' },
                { value: 'custom', label: 'Custom lines' },
              ]}
            />
            <ColorRow
              label="Root → category branches"
              value={appearance.connectionColors.branch}
              disabled={appearance.connectionColorMode !== 'custom'}
              onChange={(branch) => patch({ connectionColors: { ...appearance.connectionColors, branch } })}
            />
            <ColorRow
              label="Category → task branches"
              value={appearance.connectionColors.reminder}
              disabled={appearance.connectionColorMode !== 'custom'}
              onChange={(reminder) => patch({ connectionColors: { ...appearance.connectionColors, reminder } })}
            />
            <ColorRow
              label="Task → subtask branches"
              value={appearance.connectionColors.subtask}
              disabled={appearance.connectionColorMode !== 'custom'}
              onChange={(subtask) => patch({ connectionColors: { ...appearance.connectionColors, subtask } })}
            />
            <ColorRow
              label="Completed / finished links"
              value={appearance.connectionColors.completed}
              disabled={appearance.connectionColorMode !== 'custom'}
              onChange={(completed) => patch({ connectionColors: { ...appearance.connectionColors, completed } })}
            />

            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', letterSpacing: '0.06em', marginTop: 6 }}>
              CONTRAST & READABILITY
            </div>
            <Segmented
              ariaLabel="Interface surface"
              value={appearance.surfaceMode}
              onChange={(value) => patch({ surfaceMode: value })}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'dark', label: 'Dark panels' },
                { value: 'light', label: 'Light panels' },
              ]}
            />
            <div style={{ fontSize: 11, color: '#64748b' }}>
              Node labels always pick a foreground that stays readable against the panel colour — Auto follows the
              selected background.
            </div>
          </div>
        )}

        {/* BACKGROUND */}
        {activeTab === 'background' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 8 }}>
              {backgroundOptions.map((opt) => {
                const isActive = appearance.background.kind === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setImageError(null);
                      if (opt.value === 'image' && !appearance.background.image.dataUrl) {
                        fileInputRef.current?.click();
                        patchBackground({ kind: 'image' });
                        return;
                      }
                      patchBackground({ kind: opt.value });
                    }}
                    style={{
                      padding: '10px 12px',
                      borderRadius: 14,
                      textAlign: 'left',
                      cursor: 'pointer',
                      backgroundColor: isActive ? 'rgba(99, 102, 241, 0.12)' : 'rgba(30, 41, 59, 0.45)',
                      border: `1px solid ${isActive ? '#6366f1' : 'rgba(255,255,255,0.06)'}`,
                    }}
                  >
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>{opt.label}</div>
                    <div style={{ fontSize: 10, color: '#94a3b8', marginTop: 2 }}>{opt.description}</div>
                  </button>
                );
              })}
            </div>

            {appearance.background.kind === 'default' && (
              <ColorRow
                label="Dark base tint"
                value={appearance.background.color}
                onChange={(color) => patchBackground({ color })}
              />
            )}

            {appearance.background.kind === 'void' && (
              <ToggleRow
                label="Atmospheric drift"
                hint="Slow, GPU-cheap haze movement"
                checked={appearance.background.voidAnimated}
                onChange={(voidAnimated) => patchBackground({ voidAnimated })}
              />
            )}

            <input
              type="file"
              accept="image/*"
              ref={fileInputRef}
              aria-label="Import background image"
              onChange={(e) => handleImageSelection(e.target.files?.[0])}
              style={{ display: 'none' }}
            />

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 10,
                padding: 12,
                borderRadius: 14,
                backgroundColor: 'rgba(30, 41, 59, 0.35)',
                border: '1px solid rgba(255,255,255,0.06)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Imported photo</div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>
                    {appearance.background.image.dataUrl ? 'Stored locally & included in backups' : 'No image selected'}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    style={{
                      padding: '7px 12px',
                      borderRadius: 10,
                      border: 'none',
                      backgroundColor: '#6366f1',
                      color: '#ffffff',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    {appearance.background.image.dataUrl ? 'Replace' : 'Choose image'}
                  </button>
                  {appearance.background.image.dataUrl && (
                    <button
                      type="button"
                      onClick={removeImage}
                      aria-label="Remove background image"
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '7px 10px',
                        borderRadius: 10,
                        border: '1px solid rgba(239, 68, 68, 0.4)',
                        backgroundColor: 'transparent',
                        color: '#f87171',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      <Trash2 size={13} />
                      <span>Remove</span>
                    </button>
                  )}
                </div>
              </div>

              {imageError && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '8px 10px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                    border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171',
                    fontSize: 12,
                  }}
                >
                  <AlertTriangle size={14} />
                  <span>{imageError}</span>
                </div>
              )}

              <Segmented
                ariaLabel="Image fit"
                value={appearance.background.image.fit}
                onChange={(fit) => patchImage({ fit })}
                options={[
                  { value: 'cover', label: 'Cover' },
                  { value: 'contain', label: 'Contain' },
                ]}
              />

              <Segmented
                ariaLabel="Image position"
                value={appearance.background.image.position}
                onChange={(position) => patchImage({ position })}
                options={[
                  { value: 'center', label: 'Centre' },
                  { value: 'top', label: 'Top' },
                  { value: 'bottom', label: 'Bottom' },
                  { value: 'left', label: 'Left' },
                  { value: 'right', label: 'Right' },
                ]}
              />

              <SliderRow
                label="Image opacity"
                value={appearance.background.image.opacity}
                min={0.05}
                max={1}
                step={0.05}
                display={`${Math.round(appearance.background.image.opacity * 100)}%`}
                onChange={(opacity) => patchImage({ opacity })}
              />
              <SliderRow
                label="Image blur"
                value={appearance.background.image.blur}
                min={0}
                max={24}
                step={1}
                display={`${appearance.background.image.blur}px`}
                onChange={(blur) => patchImage({ blur })}
              />
            </div>

            <SliderRow
              label="Background dimming"
              value={appearance.background.dim}
              min={0}
              max={0.9}
              step={0.05}
              display={`${Math.round(appearance.background.dim * 100)}%`}
              onChange={(dim) => patchBackground({ dim })}
            />

            <ToggleRow
              label="Subtle dot grid"
              hint="Guides the eye across the mesh canvas"
              checked={appearance.showGrid}
              onChange={(showGrid) => patch({ showGrid })}
            />
            {appearance.showGrid && (
              <ColorRow
                label="Grid colour"
                value={appearance.gridColor.startsWith('#') ? appearance.gridColor : '#6366f1'}
                onChange={(gridColor) => patch({ gridColor })}
              />
            )}
          </div>
        )}

        {/* 3D DEPTH */}
        {activeTab === 'depth' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontSize: 11, color: '#94a3b8', lineHeight: 1.5 }}>
              Lightweight depth layers use CSS transforms, gradients and shadows. They remain readable and battery-friendly on older devices.
            </div>
            <Segmented
              ariaLabel="3D effect quality"
              value={appearance.threeD.level}
              onChange={(level) => onChange({ ...appearance, themeId: 'custom', threeD: { ...appearance.threeD, level } })}
              options={[
                { value: 'off', label: 'Off' },
                { value: 'low', label: 'Low' },
                { value: 'medium', label: 'Medium' },
                { value: 'high', label: 'High' },
              ]}
            />
            <SliderRow
              label="Perspective strength"
              value={appearance.threeD.perspective}
              min={500}
              max={1800}
              step={50}
              display={`${appearance.threeD.perspective}px`}
              onChange={(perspective) => onChange({ ...appearance, themeId: 'custom', threeD: { ...appearance.threeD, perspective } })}
            />
            <SliderRow
              label="Shadow intensity"
              value={appearance.threeD.shadowIntensity}
              min={0}
              max={1}
              step={0.05}
              display={`${Math.round(appearance.threeD.shadowIntensity * 100)}%`}
              onChange={(shadowIntensity) => onChange({ ...appearance, themeId: 'custom', threeD: { ...appearance.threeD, shadowIntensity } })}
            />
            <SliderRow
              label="Glow intensity"
              value={appearance.threeD.glowIntensity}
              min={0}
              max={1}
              step={0.05}
              display={`${Math.round(appearance.threeD.glowIntensity * 100)}%`}
              onChange={(glowIntensity) => onChange({ ...appearance, themeId: 'custom', threeD: { ...appearance.threeD, glowIntensity } })}
            />
            <SliderRow
              label="Animation intensity"
              value={appearance.threeD.animationIntensity}
              min={0}
              max={1}
              step={0.05}
              display={`${Math.round(appearance.threeD.animationIntensity * 100)}%`}
              onChange={(animationIntensity) => onChange({ ...appearance, themeId: 'custom', threeD: { ...appearance.threeD, animationIntensity } })}
            />
            <ToggleRow
              label="Graph rotation cues"
              hint="Adds subtle perspective response without moving the graph itself"
              checked={appearance.threeD.graphRotation}
              onChange={(graphRotation) => onChange({ ...appearance, themeId: 'custom', threeD: { ...appearance.threeD, graphRotation } })}
            />
          </div>
        )}

        {/* MATRIX */}
        {activeTab === 'matrix' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <ToggleRow
              label="Matrix falling code"
              hint="Decorative layer rendered behind every node and connection"
              checked={appearance.matrix.enabled}
              onChange={(enabled) => patchMatrix({ enabled })}
            />
            <ColorRow
              label="Stream colour"
              value={appearance.matrix.color}
              disabled={!appearance.matrix.enabled}
              onChange={(color) => patchMatrix({ color })}
            />
            <SliderRow
              label="Speed"
              value={appearance.matrix.speed}
              min={0.25}
              max={3}
              step={0.25}
              display={`${appearance.matrix.speed}×`}
              onChange={(speed) => patchMatrix({ speed })}
            />
            <SliderRow
              label="Opacity"
              value={appearance.matrix.opacity}
              min={0.05}
              max={1}
              step={0.05}
              display={`${Math.round(appearance.matrix.opacity * 100)}%`}
              onChange={(opacity) => patchMatrix({ opacity })}
            />
            <SliderRow
              label="Stream density"
              value={appearance.matrix.density}
              min={0.05}
              max={1}
              step={0.05}
              display={`${Math.round(appearance.matrix.density * 100)}%`}
              onChange={(density) => patchMatrix({ density })}
            />
            <SliderRow
              label="Glyph size"
              value={appearance.matrix.fontSize}
              min={10}
              max={30}
              step={1}
              display={`${appearance.matrix.fontSize}px`}
              onChange={(fontSize) => patchMatrix({ fontSize })}
            />

            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 8,
                padding: '10px 12px',
                borderRadius: 12,
                backgroundColor: 'rgba(99, 102, 241, 0.08)',
                border: '1px solid rgba(99, 102, 241, 0.2)',
                color: '#a5b4fc',
                fontSize: 11,
                lineHeight: 1.5,
              }}
            >
              <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                The code rain renders on a single canvas, pauses when the app is in the background, and is replaced by a
                still frame when your device requests reduced motion. On very light backgrounds increase dimming or lower
                the opacity for readability.
              </span>
            </div>
          </div>
        )}

        {/* Footer */}
        <button
          type="button"
          onClick={() => onChange(getDefaultAppearance())}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 18,
            padding: '12px',
            borderRadius: 14,
            border: '1px solid rgba(255,255,255,0.12)',
            backgroundColor: 'transparent',
            color: '#e2e8f0',
            fontSize: 13,
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          <RotateCcw size={15} />
          <span>Reset appearance to defaults</span>
        </button>
      </div>
    </div>
  );
};

AppearanceModal.displayName = 'AppearanceModal';
