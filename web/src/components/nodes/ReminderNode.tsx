import React, { memo } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import { Check, ListChecks, Calendar, Repeat, DollarSign } from 'lucide-react';
import { MeshNodeData } from '../../types';

export const ReminderNode = memo(({ data }: NodeProps) => {
  const nodeData = data as unknown as MeshNodeData;
  const color = nodeData.color || '#3b82f6';
  const isCompleted = nodeData.completed || nodeData.isCompletedView;

  const priorityColor =
    nodeData.priority === 'high'
      ? '#ef4444'
      : nodeData.priority === 'medium'
      ? '#f59e0b'
      : '#10b981';

  const hasSubtasks = (nodeData.subtaskCount ?? 0) > 0;

  return (
    <div
      onClick={() => nodeData.onNodeClick?.(nodeData.id, 'reminder')}
      style={{
        minWidth: 130,
        maxWidth: 165,
        padding: '8px 10px',
        borderRadius: 14,
        background: isCompleted ? '#131b2c' : '#141d2f',
        border: `1.5px solid ${isCompleted ? '#334155' : `${color}88`}`,
        boxShadow: isCompleted
          ? '0 2px 8px rgba(0,0,0,0.5)'
          : `0 4px 14px rgba(0,0,0,0.6), 0 0 10px ${color}22`,
        display: 'flex',
        flexDirection: 'column',
        gap: 5,
        cursor: 'pointer',
        position: 'relative',
        userSelect: 'none',
        transition: 'transform 0.15s ease, border-color 0.15s ease',
      }}
      className="reminder-node-card"
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

      {/* Top Header: Priority Dot & Quick Complete Button */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <div
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              backgroundColor: priorityColor,
              boxShadow: `0 0 6px ${priorityColor}`,
            }}
          />
          {nodeData.priority && (
            <span
              style={{
                fontSize: 9,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: '#94a3b8',
              }}
            >
              {nodeData.priority}
            </span>
          )}

          {(nodeData.isRecurring || (nodeData.recurrence && nodeData.recurrence.frequency !== 'none')) && (
            <span
              title="Recurring Task"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                color: '#818cf8',
                marginLeft: 2,
              }}
            >
              <Repeat size={10} strokeWidth={2.5} />
            </span>
          )}

          {nodeData.isFinancialLinked && (
            <span
              title="Linked to Financial Event"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                color: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.15)',
                padding: '1px 3px',
                borderRadius: 4,
                marginLeft: 2,
              }}
            >
              <DollarSign size={10} strokeWidth={3} />
            </span>
          )}
        </div>


        {/* Quick Complete Toggle Button */}
        {!nodeData.isCompletedView && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              nodeData.onReminderCompleteToggle?.(nodeData.id);
            }}
            title="Mark Complete"
            style={{
              width: 22,
              height: 22,
              borderRadius: '50%',
              border: `1.5px solid ${isCompleted ? '#10b981' : '#475569'}`,
              background: isCompleted ? '#10b981' : 'rgba(255,255,255,0.05)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: '#ffffff',
              padding: 0,
              transition: 'all 0.15s ease',
            }}
          >
            {isCompleted ? <Check size={13} strokeWidth={3} /> : null}
          </button>
        )}
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: isCompleted ? '#94a3b8' : '#f8fafc',
          textDecoration: isCompleted ? 'line-through' : 'none',
          lineHeight: 1.25,
          wordBreak: 'break-word',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {nodeData.label}
      </div>

      {/* Footer Info: Subtasks badge or Due Date */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
        {hasSubtasks ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 10,
              fontWeight: 600,
              color: nodeData.completedSubtaskCount === nodeData.subtaskCount ? '#10b981' : '#a5b4fc',
              background: 'rgba(255,255,255,0.06)',
              padding: '2px 5px',
              borderRadius: 6,
            }}
          >
            <ListChecks size={11} />
            <span>
              {nodeData.completedSubtaskCount}/{nodeData.subtaskCount}
            </span>
          </div>
        ) : (
          <div />
        )}

        {nodeData.dueDate && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              fontSize: 9,
              color: '#94a3b8',
            }}
          >
            <Calendar size={10} />
            <span>{nodeData.dueDate.slice(5)}</span>
          </div>
        )}
      </div>
    </div>
  );
});

ReminderNode.displayName = 'ReminderNode';
