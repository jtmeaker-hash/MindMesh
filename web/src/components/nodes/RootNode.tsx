import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Sparkles, CheckCircle2 } from 'lucide-react';
import { MeshNodeData } from '../../types';

export const RootNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as MeshNodeData;
  const isCompleted = nodeData.isCompletedView;

  return (
    <div
      onClick={() => nodeData.onNodeClick?.(nodeData.id, 'root')}
      style={{
        width: 104,
        height: 104,
        borderRadius: '50%',
        background: isCompleted
          ? 'radial-gradient(circle at 35% 35%, #1e293b, #0f172a)'
          : 'radial-gradient(circle at 35% 35%, #312e81, #0f172a)',
        border: `2px solid ${isCompleted ? '#38bdf8' : '#6366f1'}`,
        boxShadow: isCompleted
          ? '0 0 24px rgba(56, 189, 248, 0.35), inset 0 0 16px rgba(56, 189, 248, 0.2)'
          : '0 0 28px rgba(99, 102, 241, 0.4), inset 0 0 16px rgba(99, 102, 241, 0.25)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        position: 'relative',
        userSelect: 'none',
        transition: 'transform 0.2s ease, box-shadow 0.2s ease',
      }}
      className="root-node-glow"
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
          <CheckCircle2 size={24} color="#38bdf8" />
        ) : (
          <Sparkles size={24} color="#818cf8" />
        )}
      </div>

      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          letterSpacing: '-0.02em',
          color: '#f8fafc',
          textAlign: 'center',
          lineHeight: 1.1,
        }}
      >
        {nodeData.label}
      </div>

      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          color: isCompleted ? '#94a3b8' : '#a5b4fc',
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
