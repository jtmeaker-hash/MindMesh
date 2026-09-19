import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Check } from 'lucide-react';
import { MeshNodeData } from '../../types';

export const SubtaskNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as MeshNodeData;
  const isDone = Boolean(nodeData.completed);
  const color = nodeData.color || '#3b82f6';

  return (
    <div
      onClick={() => {
        if (nodeData.reminderId) {
          nodeData.onSubtaskToggle?.(nodeData.id, nodeData.reminderId);
        }
      }}
      style={{
        minWidth: 95,
        maxWidth: 130,
        padding: '5px 8px',
        borderRadius: 10,
        background: isDone ? '#0d131f' : '#111827',
        border: `1px solid ${isDone ? '#334155' : `${color}55`}`,
        boxShadow: isDone
          ? '0 1px 4px rgba(0,0,0,0.4)'
          : '0 2px 8px rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: 'pointer',
        userSelect: 'none',
        opacity: isDone ? 0.65 : 1,
        transition: 'all 0.15s ease',
      }}
      title="Tap to toggle subtask"
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

      {/* Mini checkbox */}
      <div
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          border: `1.5px solid ${isDone ? '#10b981' : '#64748b'}`,
          background: isDone ? '#10b981' : 'transparent',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {isDone && <Check size={11} color="#ffffff" strokeWidth={3} />}
      </div>

      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: isDone ? '#64748b' : '#e2e8f0',
          textDecoration: isDone ? 'line-through' : 'none',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {nodeData.label}
      </span>
    </div>
  );
});

SubtaskNode.displayName = 'SubtaskNode';
