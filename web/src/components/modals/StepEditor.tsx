import React, { useState } from 'react';
import { ArrowDown, ArrowUp, CheckCircle2, Circle, ListOrdered, Lock, Plus, X } from 'lucide-react';
import { Step } from '../../types';
import {
  addStep,
  deleteStep,
  getStepProgress,
  moveStep,
  toggleStep,
  updateStep,
} from '../../services/steps';

interface StepEditorProps {
  steps: Step[];
  reminderId: string;
  onChange: (steps: Step[]) => void;
}

/**
 * Sequential Steps editor.
 *
 * This is a separate surface from the Subtask checklist on purpose: it owns the
 * ordered process, the locked/active/completed states, reordering and the
 * add/edit/delete operations. All sequencing rules come from services/steps so
 * the same enforcement applies no matter where a Step is toggled.
 */
export const StepEditor: React.FC<StepEditorProps> = ({ steps, reminderId, onChange }) => {
  const [newTitle, setNewTitle] = useState('');
  const [newDescription, setNewDescription] = useState('');

  const progress = getStepProgress(steps);
  const activeIndex = progress.currentNumber > 0 ? progress.currentNumber - 1 : steps.length;

  const handleAdd = () => {
    if (!newTitle.trim()) return;
    onChange(addStep(steps, { title: newTitle, description: newDescription }, reminderId));
    setNewTitle('');
    setNewDescription('');
  };

  const handleToggle = (id: string) => {
    const result = toggleStep(steps, id);
    if (result.changed) onChange(result.steps);
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 600, color: '#94a3b8' }}>
          <ListOrdered size={13} color="#67e8f9" />
          STEPS ({progress.completed}/{progress.total})
        </label>
        <span style={{ fontSize: 11, color: '#67e8f9', fontWeight: 600 }}>
          {progress.total === 0
            ? 'No steps yet'
            : progress.allComplete
              ? 'All steps complete'
              : `Current Step: ${progress.currentNumber} of ${progress.total}`}
        </span>
      </div>

      {steps.length === 0 ? (
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8 }}>
          Steps run in order. Complete each step before the next becomes available.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
          {steps.map((step, index) => {
            const isDone = step.completed;
            const isActive = index === activeIndex;
            const isLocked = index > activeIndex;
            return (
              <div
                key={step.id}
                data-step-state={isDone ? 'completed' : isActive ? 'active' : isLocked ? 'locked' : 'pending'}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'stretch',
                  padding: '8px 10px',
                  borderRadius: 10,
                  backgroundColor: isActive ? 'rgba(6, 182, 212, 0.10)' : '#1E293B',
                  border: isActive ? '1px solid rgba(103, 232, 249, 0.55)' : '1px solid #334155',
                  opacity: isLocked ? 0.72 : 1,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2, width: 18, flexShrink: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: isDone ? '#10b981' : isActive ? '#67e8f9' : '#64748b' }}>
                    {isDone ? '✓' : isLocked ? '🔒' : '→'}
                  </span>
                  <span style={{ fontSize: 10, color: '#64748b' }}>{index + 1}</span>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
                  <input
                    type="text"
                    aria-label={`Step ${index + 1} title`}
                    value={step.title}
                    onChange={(e) => onChange(updateStep(steps, step.id, { title: e.target.value }))}
                    style={{ width: '100%', padding: '7px 9px', borderRadius: 8, backgroundColor: '#0F172A', border: '1px solid #334155', color: isDone ? '#94a3b8' : '#F8FAFC', fontSize: 13, fontWeight: 600, outline: 'none', textDecoration: isDone ? 'line-through' : 'none' }}
                  />
                  <input
                    type="text"
                    aria-label={`Step ${index + 1} description`}
                    placeholder="Optional description"
                    value={step.description || ''}
                    onChange={(e) => onChange(updateStep(steps, step.id, { description: e.target.value }))}
                    style={{ width: '100%', padding: '6px 9px', borderRadius: 8, backgroundColor: '#0F172A', border: '1px solid #293548', color: '#cbd5e1', fontSize: 12, outline: 'none' }}
                  />
                  {isLocked && (
                    <span style={{ fontSize: 10, color: '#f59e0b' }}>
                      Locked — complete step {activeIndex + 1} first
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, justifyContent: 'center' }}>
                  <button
                    type="button"
                    title="Move step up"
                    disabled={index === 0}
                    onClick={() => onChange(moveStep(steps, step.id, -1))}
                    style={{ width: 24, height: 20, borderRadius: 6, border: '1px solid #334155', background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', cursor: index === 0 ? 'not-allowed' : 'pointer', opacity: index === 0 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    title="Move step down"
                    disabled={index === steps.length - 1}
                    onClick={() => onChange(moveStep(steps, step.id, 1))}
                    style={{ width: 24, height: 20, borderRadius: 6, border: '1px solid #334155', background: 'rgba(255,255,255,0.05)', color: '#cbd5e1', cursor: index === steps.length - 1 ? 'not-allowed' : 'pointer', opacity: index === steps.length - 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    <ArrowDown size={13} />
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                  <button
                    type="button"
                    title={isDone ? 'Revert step' : isLocked ? 'Locked until earlier steps are complete' : 'Complete step'}
                    disabled={isLocked && !isDone}
                    onClick={() => handleToggle(step.id)}
                    style={{ width: 30, height: 30, borderRadius: 8, border: isDone ? '1px solid #10b981' : '1px solid #475569', background: isDone ? '#10b981' : 'rgba(255,255,255,0.05)', color: '#fff', cursor: isLocked && !isDone ? 'not-allowed' : 'pointer', opacity: isLocked && !isDone ? 0.5 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}
                  >
                    {isDone ? <CheckCircle2 size={15} /> : isLocked ? <Lock size={13} /> : <Circle size={14} />}
                  </button>
                </div>

                <button
                  type="button"
                  title="Delete step"
                  onClick={() => onChange(deleteStep(steps, step.id))}
                  style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4, alignSelf: 'center' }}
                >
                  <X size={14} />
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            type="text"
            placeholder="Add a step title..."
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                handleAdd();
              }
            }}
            style={{ flex: 1, padding: '9px 12px', borderRadius: 10, backgroundColor: '#1E293B', border: '1px solid #334155', color: '#F8FAFC', fontSize: 13, outline: 'none' }}
          />
          <button
            type="button"
            onClick={handleAdd}
            style={{ padding: '9px 14px', borderRadius: 10, backgroundColor: 'rgba(6, 182, 212, 0.18)', border: '1px solid rgba(103, 232, 249, 0.4)', color: '#a5f3fc', fontSize: 13, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
          >
            <Plus size={16} /> Add Step
          </button>
        </div>
        <input
          type="text"
          placeholder="Optional step description"
          value={newDescription}
          onChange={(e) => setNewDescription(e.target.value)}
          style={{ width: '100%', padding: '8px 12px', borderRadius: 10, backgroundColor: '#1E293B', border: '1px solid #334155', color: '#F8FAFC', fontSize: 12, outline: 'none' }}
        />
      </div>
    </div>
  );
};
