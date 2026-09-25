import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { MeshNodeData } from '../../types';
import { getReadableTextColor, withAlpha } from '../../services/appearance';

export const RootNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as MeshNodeData;
  const isCompleted = nodeData.isCompletedView;

  const accent = nodeData.accentColor || nodeData.color || '#6366f1';
  const surface = nodeData.surfaceColor || (isCompleted ? '#1e293b' : '#312e81');
  const surfaceAlt = nodeData.surfaceAltColor || '#0f172a';
  const text = nodeData.textColor || '#f8fafc';
  const muted = nodeData.mutedTextColor || withAlpha(accent, 0.85);
  const glow = nodeData.glowColor || withAlpha(accent, 0.35);
  const hover = nodeData.hoverColor || accent;
  const iconColor = getReadableTextColor(surface, accent, '#0b1220');

  const hoverVars = {
    '--mm-hover': hover,
    '--mm-glow': withAlpha(accent, 0.4),
    '--mm-glow-strong': withAlpha(accent, 0.65),
  } as React.CSSProperties;

  return (
    <div
      onClick={() => nodeData.onNodeClick?.(nodeData.id, 'root')}
      style={{
        width: 104,
        height: 104,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, ${surface}, ${surfaceAlt})`,
        border: `2px solid ${nodeData.borderColor || accent}`,
        boxShadow: `0 0 28px ${glow}, inset 0 0 16px ${withAlpha(accent, 0.25)}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        touchAction: 'none',
        position: 'relative',
        userSelect: 'none',
        ...hoverVars,
      }}
      className="root-node-glow mm-node"
    >
      {/* Centered handles for all radial connections */}
      <Handle
        type="target"
        position={Position.Top}
        style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ opacity: 0, left: '50%', top: '50%', transform: 'translate(-50%, -50%)' }}
      />

      <div style={{ marginBottom: 4 }}>
        {isCompleted ? (
          <CheckCircle2 size={24} color={iconColor} />
        ) : (
          <Sparkles size={24} color={iconColor} />
        )}
      </div>

      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: text,
          textAlign: 'center',
          lineHeight: 1.1,
        }}
      >
        <span className="mm-node-label">{nodeData.label}</span>
      </div>

      <div
        className="mm-node-detail"
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: muted,
          marginTop: 3,
        }}
      >
        {isCompleted
          ? `${nodeData.count ?? 0} finished`
          : `${nodeData.count ?? 0} active`}
      </div>
    </div>
  );
});

RootNode.displayName = 'RootNode';
