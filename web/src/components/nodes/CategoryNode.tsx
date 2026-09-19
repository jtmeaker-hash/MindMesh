import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Folder, Car, Heart, ShoppingBag, Home, Briefcase, DollarSign, Star } from 'lucide-react';
import { MeshNodeData } from '../../types';

function getCategoryIcon(name: string, size = 18) {
  const lower = name.toLowerCase();
  if (lower.includes('car') || lower.includes('drive')) return <Car size={size} />;
  if (lower.includes('health') || lower.includes('med') || lower.includes('body')) return <Heart size={size} />;
  if (lower.includes('errand') || lower.includes('shop') || lower.includes('grocer')) return <ShoppingBag size={size} />;
  if (lower.includes('home') || lower.includes('house')) return <Home size={size} />;
  if (lower.includes('work') || lower.includes('job')) return <Briefcase size={size} />;
  if (lower.includes('money') || lower.includes('finance')) return <DollarSign size={size} />;
  return <Folder size={size} />;
}

export const CategoryNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as MeshNodeData;
  const color = nodeData.color || '#06b6d4';
  const isFocused = nodeData.isFocused;
  const isCompleted = nodeData.isCompletedView;

  const countDisplay = isCompleted
    ? `${nodeData.completedCount ?? 0} done`
    : `${nodeData.count ?? 0} tasks`;

  return (
    <div
      onClick={() => nodeData.onNodeClick?.(nodeData.id, 'category')}
      style={{
        width: 78,
        height: 78,
        borderRadius: '50%',
        background: `radial-gradient(circle at 35% 35%, #182234, #0b111e)`,
        border: `2.5px solid ${isFocused ? '#ffffff' : color}`,
        boxShadow: isFocused
          ? `0 0 20px ${color}, inset 0 0 12px ${color}`
          : `0 0 12px rgba(0,0,0,0.6), 0 0 6px ${color}66`,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        position: 'relative',
        userSelect: 'none',
        transform: isFocused ? 'scale(1.08)' : 'scale(1)',
        transition: 'all 0.25s cubic-bezier(0.34, 1.56, 0.64, 1)',
        padding: 4,
      }}
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

      <div style={{ color: isFocused ? '#ffffff' : color, marginBottom: 2 }}>
        {getCategoryIcon(nodeData.label, 17)}
      </div>

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          color: '#f1f5f9',
          textAlign: 'center',
          lineHeight: 1.1,
          maxWidth: 68,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {nodeData.label}
      </div>

      <div
        style={{
          fontSize: 9,
          fontWeight: 600,
          color: isCompleted ? '#94a3b8' : `${color}dd`,
          marginTop: 2,
        }}
      >
        {countDisplay}
      </div>
    </div>
  );
});

CategoryNode.displayName = 'CategoryNode';
