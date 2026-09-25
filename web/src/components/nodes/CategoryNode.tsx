import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Folder, Car, Heart, ShoppingBag, Home, Briefcase, DollarSign } from 'lucide-react';
import { MeshNodeData } from '../../types';
import { withAlpha } from '../../services/appearance';

function getCategoryIcon(name: string, size = 18) {
  const lower = name.toLowerCase();
  if (lower.includes('car') || lower.includes('drive')) return <Car size={size} />;
  if (lower.includes('health') || lower.includes('med') || lower.includes('body')) return <Heart size={size} />;
  if (lower.includes('errand') || lower.includes('shop') || lower.includes('grocery') || lower.includes('grocer')) return <ShoppingBag size={size} />;
  if (lower.includes('home') || lower.includes('house')) return <Home size={size} />;
  if (lower.includes('work') || lower.includes('job')) return <Briefcase size={size} />;
  if (lower.includes('money') || lower.includes('finance')) return <DollarSign size={size} />;
  return <Folder size={size} />;
}

export const CategoryNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as MeshNodeData;
  const color = nodeData.accentColor || nodeData.color || '#06b6d4';
  const isFocused = nodeData.isFocused;
  const isCompleted = nodeData.isCompletedView;

  const surface = nodeData.surfaceColor || '#182234';
  const surfaceAlt = nodeData.surfaceAltColor || '#0b111e';
  const text = nodeData.textColor || '#f1f5f9';
  const muted = nodeData.mutedTextColor || (isCompleted ? '#94a3b8' : withAlpha(color, 0.85));
  const glow = nodeData.glowColor || withAlpha(color, 0.4);
  const hover = nodeData.hoverColor || color;

  const countDisplay = isCompleted
    ? `${nodeData.completedCount ?? 0} done`
    : `${nodeData.count ?? 0} tasks`;

  const hoverVars = {
    '--mm-hover': hover,
  } as React.CSSProperties;

  return (
    <div
      onClick={() => nodeData.onNodeClick?.(nodeData.id, 'category')}
      style={{
        width: 78,
        height: 78,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, ${surface}, ${surfaceAlt})`,
        border: `2.5px solid ${isFocused ? hover : nodeData.borderColor || color}`,
        boxShadow: isFocused
          ? `0 0 20px ${glow}, inset 0 0 12px ${glow}`
          : `0 0 12px rgba(0,0,0,0.6), 0 0 6px ${withAlpha(color, 0.4)}`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'grab',
        touchAction: 'none',
        position: 'relative',
        userSelect: 'none',
        transform: isFocused ? 'scale(1.08)' : 'scale(1)',
        transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
        padding: 4,
        ...hoverVars,
      }}
      className="mm-node"
    >
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

      <div style={{ color: isFocused ? hover : color, marginBottom: 2 }}>
        {getCategoryIcon(nodeData.label, 17)}
      </div>

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: text,
          textAlign: 'center',
          lineHeight: 1.1,
          maxWidth: 68,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        <span className="mm-node-label">{nodeData.label}</span>
      </div>

      <div
        className="mm-node-detail"
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: muted,
          marginTop: 2,
        }}
      >
        {countDisplay}
      </div>
    </div>
  );
});

CategoryNode.displayName = 'CategoryNode';
