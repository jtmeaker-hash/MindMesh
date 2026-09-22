import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Archive, Check, ChevronDown, ChevronRight, Copy, Grid3X3, List, Plus, Save, Search, Trash2, Undo2, Redo2, X, Play, Pause, Clock3, SkipForward } from 'lucide-react';
import { Category, Contact, Reminder } from '../../types';
import { DirectDebit } from '../../types/finance';
import { RoutineAiProposal } from '../../types/routine';
import { AppearanceSettings } from '../../types/appearance';
import { getDefaultAppearance } from '../../services/appearance';
import { generateRoutineGraph, routineGraphLevelOfDetail } from '../../services/routineGraph';
import { SpatialGraph } from '../graph/SpatialGraph';
import { saveRoutineAsTemplate } from '../../services/routineTemplates';
import { createRoutineAiProposal, applyApprovedAiChanges } from '../../services/routineAi';
import { Routine, RoutineStep, createEmptyRoutine, createRoutineStep } from '../../types/routine';
import { previewRoutineImport, applyRoutineImport, serializeRoutineExport, serializeRoutineHistoryJson, serializeRoutineHistoryCsv, serializeRoutineBulkExport, RoutineImportPreview } from '../../services/routineTransfer';
import { createRoutine, duplicateRoutine, promoteChildrenWhenRemovingStep, readRoutines, trashRoutine, archiveRoutine, restoreRoutineFromTrash, updateRoutine } from '../../services/routines';
import { applyRoutineRuntimeAction, getEligibleRoutineSteps, startRoutine, startRoutineStepTimer, addRoutineStepTime, skipRoutineStep } from '../../services/routineEngine';
import { attachRoutineNotificationActions, syncRoutineNativeNotifications } from '../../services/routineNotifications';
import { analyzeRoutine, getRoutineReasonOptions } from '../../services/routineAnalytics';

interface RoutineModuleProps {
  categories: Category[];
  contacts?: Contact[];
  reminders?: Reminder[];
  directDebits?: DirectDebit[];
  onRoutinesChange?: (routines: Routine[]) => void;
  appearance?: AppearanceSettings;
}
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const surface: React.CSSProperties = { background: 'rgba(15,23,42,.78)', border: '1px solid rgba(148,163,184,.16)', borderRadius: 16 };
const input: React.CSSProperties = { width: '100%', background: '#111827', color: '#e2e8f0', border: '1px solid #334155', borderRadius: 9, padding: '9px 10px', outline: 'none' };

const starterSteps = (routineId: string, template: boolean): RoutineStep[] => {
  const first = createRoutineStep({ id: uid('step'), routineId, title: template ? 'Set up your space' : 'First step', order: 0 });
  return [first];
};

export const RoutineModule: React.FC<RoutineModuleProps> = ({ categories, contacts = [], reminders = [], directDebits = [], onRoutinesChange, appearance = getDefaultAppearance() }) => {
  const [routines, setRoutines] = useState<Routine[]>(() => readRoutines({ includeArchived: true }));
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'draft' | 'active' | 'paused' | 'archived' | 'trash'>('all');
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [saved, setSaved] = useState(true);
  const [history, setHistory] = useState<Routine[][]>([]);
  const [future, setFuture] = useState<Routine[][]>([]);
  const [selectedBulk, setSelectedBulk] = useState<string[]>([]);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiProposal, setAiProposal] = useState<RoutineAiProposal | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [importPreview, setImportPreview] = useState<RoutineImportPreview | null>(null);
  const [importDecisions, setImportDecisions] = useState<Record<string, 'keep' | 'unlink' | 'use-existing' | 'duplicate' | 'skip'>>({});
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [skipReason, setSkipReason] = useState('No time');
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = routines.find((r) => r.id === selectedId) || null;
  const visible = useMemo(() => routines.filter((routine) => {
    const text = `${routine.name} ${routine.description || ''} ${(routine.tags || []).join(' ')}`.toLowerCase();
    const matchesQuery = text.includes(query.toLowerCase());
    const matchesStatus = status === 'all' ? !routine.trashedAt : status === 'trash' ? Boolean(routine.trashedAt) : !routine.trashedAt && (status === 'archived' ? Boolean(routine.archivedAt) : routine.status === status);
    return matchesQuery && matchesStatus;
  }), [routines, query, status]);

  const commit = (next: Routine[], snapshot = routines) => {
    setHistory((items) => [...items.slice(-19), snapshot]);
    setFuture([]);
    setRoutines(next);
    onRoutinesChange?.(next);
    setSaved(false);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    const changedRoutine = next.find((item) => item.id === selectedId);
    if (changedRoutine) {
      autoSaveTimer.current = setTimeout(() => {
        const savedRoutine = updateRoutine(changedRoutine);
        setRoutines((items) => { const updated = items.map((item) => item.id === savedRoutine.id ? savedRoutine : item); onRoutinesChange?.(updated); return updated; });
        setSaved(true);
      }, 650);
    }
  };
  const persist = (routine: Routine) => {
    const savedRoutine = updateRoutine(routine);
    setRoutines((items) => { const updated = items.map((item) => item.id === savedRoutine.id ? savedRoutine : item); onRoutinesChange?.(updated); return updated; });
    setSaved(true);
  };
  const create = (template: boolean) => {
    const categoryId = categories[0]?.id || 'uncategorized';
    const routineId = uid('routine');
    const routine = createEmptyRoutine({ id: routineId, name: template ? 'New morning routine' : 'Untitled routine', categoryId, steps: starterSteps(routineId, template), status: 'draft', template: { isTemplate: false, source: template ? 'starter' : undefined } });
    createRoutine(routine);
    setRoutines((items) => { const updated = [routine, ...items]; onRoutinesChange?.(updated); return updated; });
    setSelectedId(routine.id);
    setSaved(true);
  };
  const updateSelected = (patch: Partial<Routine>) => {
    if (!selected) return;
    const next = routines.map((item) => item.id === selected.id ? { ...item, ...patch } : item);
    commit(next);
  };
  const saveSelected = () => { if (selected) persist(selected); };
  const applyRuntime = (action: 'start' | 'complete' | 'skip' | 'pause' | 'resume' | 'snooze' | 'expire' | 'timer' | 'add-time') => {
    if (!selected) return;
    try {
      const next = action === 'start' ? startRoutine(selected) : action === 'timer' ? startRoutineStepTimer(selected) : action === 'add-time' ? addRoutineStepTime(selected, 5) : action === 'skip' ? skipRoutineStep(selected, undefined, skipReason) : applyRoutineRuntimeAction(selected, action);
      const savedRoutine = updateRoutine(next);
      setRoutines((items) => {
        const updated = items.map((item) => item.id === savedRoutine.id ? savedRoutine : item);
        onRoutinesChange?.(updated);
        return updated;
      });
      setSaved(true);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'That step is not ready yet.');
    }
  };
  const addStep = () => {
    if (!selected) return;
    const step = createRoutineStep({ id: uid('step'), routineId: selected.id, title: 'New step', order: selected.steps.length });
    updateSelected({ steps: [...selected.steps, step] });
  };
  const editStep = (stepId: string, patch: Partial<RoutineStep>) => {
    if (!selected) return;
    updateSelected({ steps: selected.steps.map((step) => step.id === stepId ? { ...step, ...patch } : step) });
  };
  const removeStep = (stepId: string) => {
    if (!selected) return;
    const promoted = promoteChildrenWhenRemovingStep(selected.id, stepId);
    const next = promoted ? routines.map((item) => item.id === promoted.id ? promoted : item) : routines;
    commit(next);
  };
  const moveStep = (stepId: string, direction: -1 | 1) => {
    if (!selected) return;
    const ordered = [...selected.steps].sort((a, b) => a.order - b.order);
    const index = ordered.findIndex((step) => step.id === stepId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    updateSelected({ steps: ordered.map((step, order) => ({ ...step, order })) });
  };
  const undo = () => { const previous = history[history.length - 1]; if (!previous) return; setFuture((items) => [...items, routines]); setHistory((items) => items.slice(0, -1)); setRoutines(previous); setSaved(false); };
  const redo = () => { const next = future[future.length - 1]; if (!next) return; setHistory((items) => [...items, routines]); setFuture((items) => items.slice(0, -1)); setRoutines(next); setSaved(false); };
  const downloadText = (filename: string, content: string, mime = 'application/json') => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importRoutineFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const references = { categories: new Set(categories.map((item) => item.id)), reminders: new Set(reminders.map((item) => item.id)), contacts: new Set(contacts.map((item) => item.id)), directDebits: new Set(directDebits.map((item) => item.id)), routineIds: new Set(routines.map((item) => item.id)), fallbackCategoryId: categories[0]?.id };
      const preview = previewRoutineImport(String(reader.result || ''), references);
      setImportDecisions(Object.fromEntries(preview.conflicts.map((conflict) => [conflict.id, conflict.resolution])));
      setImportPreview(preview);
    };
    reader.readAsText(file);
  };
  const commitImportedRoutine = () => {
    if (!importPreview) return;
    const imported = applyRoutineImport(importPreview, { conflicts: importDecisions, fallbackCategoryId: categories[0]?.id });
    if (!imported) return;
    createRoutine(imported);
    const next = [imported, ...routines];
    setRoutines(next); onRoutinesChange?.(next); setSelectedId(imported.id); setImportPreview(null);
  };
  const bulk = (action: 'pause' | 'archive' | 'trash') => {
    const ids = new Set(selectedBulk);
    const next = routines.map((routine) => ids.has(routine.id) ? action === 'pause' ? { ...routine, status: 'paused' as const } : action === 'archive' ? { ...routine, status: 'archived' as const, archivedAt: new Date().toISOString() } : { ...routine, status: 'archived' as const, trashedAt: new Date().toISOString() } : routine);
    commit(next); setSelectedBulk([]);
  };

  useEffect(() => {
    syncRoutineNativeNotifications(routines);
    return attachRoutineNotificationActions((routineId, action) => {
      const target = routines.find((routine) => routine.id === routineId);
      if (!target) return;
      setSelectedId(routineId);
      if (action === 'open') return;
      try {
        const runtimeAction = action === 'start' ? 'start' : action === 'failed' ? 'expire' : action === 'skip' ? 'skip' : action === 'snooze' ? 'snooze' : 'complete';
        const next = runtimeAction === 'start' ? startRoutine(target) : applyRoutineRuntimeAction(target, runtimeAction);
        const savedRoutine = updateRoutine(next);
        setRoutines((items) => items.map((item) => item.id === savedRoutine.id ? savedRoutine : item));
      } catch {
        // Keep notification actions safe when a routine was edited or removed while closed.
      }
    });
  }, [routines]);

  return <div className="mm-module routine-module" style={{ flex: '1 1 0%', minHeight: 0, overflow: 'auto', width: '100%', minWidth: 0, boxSizing: 'border-box', padding: '24px', color: '#e2e8f0', background: '#090d16' }}>
    <div style={{ maxWidth: 1400, minWidth: 0, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap', marginBottom: 22 }}>
        <div><div style={{ color: '#67e8f9', fontSize: 11, letterSpacing: '.16em', textTransform: 'uppercase', fontWeight: 800 }}>MindMesh / Build calmly</div><h1 style={{ margin: '5px 0', fontSize: 30, color: '#f8fafc' }}>Routines</h1><p style={{ margin: 0, color: '#94a3b8' }}>Turn intention into a sequence you can actually start.</p></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" onClick={() => create(false)} style={{ ...button('#0891b2'), display: 'flex', gap: 7, alignItems: 'center' }}><Plus size={16} /> Blank routine</button><button type="button" onClick={() => create(true)} style={{ ...button('#334155'), display: 'flex', gap: 7, alignItems: 'center' }}><Grid3X3 size={16} /> From template</button></div>
      </header>
      <section style={{ ...surface, padding: 12, marginBottom: 14, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 220px' }}><Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: '#64748b' }} /><input aria-label="Search routines" placeholder="Search routines, tags, descriptions" value={query} onChange={(e) => setQuery(e.target.value)} style={{ ...input, paddingLeft: 32 }} /></div>
        <select aria-label="Routine status" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} style={{ ...input, width: 'auto' }}><option value="all">Active library</option><option value="draft">Drafts</option><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option><option value="trash">Recently deleted</option></select>
        {selectedBulk.length > 0 && <><button type="button" onClick={() => bulk('pause')} style={button('#334155')}>Pause {selectedBulk.length}</button><button type="button" onClick={() => bulk('archive')} style={button('#334155')}>Archive</button><button type="button" onClick={() => bulk('trash')} style={button('#7f1d1d')}>Trash</button><button type="button" onClick={() => downloadText('mindmesh-routines.json', serializeRoutineBulkExport(routines.filter((item) => selectedBulk.includes(item.id))))} style={button('#155e75')}>Export selected</button></>}
        <button type="button" onClick={() => importInputRef.current?.click()} style={button('#334155')}>Import Routine JSON</button><input ref={importInputRef} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; if (file) importRoutineFile(file); event.currentTarget.value = ''; }} />
      </section>
      <div style={{ display: 'grid', gridTemplateColumns: selected ? 'minmax(0, .75fr) minmax(0, 1.5fr)' : 'minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
        <section style={{ ...surface, overflow: 'hidden' }}><div style={sectionHeader}><strong>{visible.length} {visible.length === 1 ? 'routine' : 'routines'}</strong><span style={{ color: '#64748b', fontSize: 12 }}>Local & private</span></div>{visible.length === 0 ? <div style={{ padding: 28, color: '#94a3b8', textAlign: 'center' }}>Nothing here yet. Start with a blank routine or a template.</div> : visible.map((routine) => <div key={routine.id} onClick={() => setSelectedId(routine.id)} style={{ padding: '14px 16px', borderTop: '1px solid rgba(148,163,184,.1)', background: selectedId === routine.id ? 'rgba(8,145,178,.14)' : 'transparent', cursor: 'pointer' }}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={selectedBulk.includes(routine.id)} onChange={(e) => { e.stopPropagation(); setSelectedBulk((ids) => e.target.checked ? [...ids, routine.id] : ids.filter((id) => id !== routine.id)); }} onClick={(e) => e.stopPropagation()} /><span style={{ flex: 1, fontWeight: 700, color: '#f8fafc' }}>{routine.name || 'Untitled routine'}</span><span style={badge(routine.status)}>{routine.status}</span></div><div style={{ paddingLeft: 24, marginTop: 6, color: '#94a3b8', fontSize: 12 }}>{routine.steps.length} steps · {routine.tags?.join(', ') || 'No tags'}{routine.description ? ` · ${routine.description}` : ''}</div></div>)}</section>
        {selected && <section style={{ ...surface, overflow: 'hidden' }}><div style={sectionHeader}><div style={{ display: 'flex', alignItems: 'center', gap: 8 }}><strong>Builder</strong><span style={{ color: saved ? '#34d399' : '#fbbf24', fontSize: 12, display: 'flex', alignItems: 'center', gap: 4 }}>{saved ? <Check size={13} /> : <Save size={13} />} {saved ? 'Saved' : 'Unsaved changes'}</span></div><div style={{ display: 'flex', gap: 5 }}><button type="button" onClick={undo} disabled={!history.length} style={iconButton}><Undo2 size={15} /></button><button type="button" onClick={redo} disabled={!future.length} style={iconButton}><Redo2 size={15} /></button><button type="button" onClick={() => setSelectedId(null)} style={iconButton}><X size={15} /></button></div></div>
          <div style={{ padding: 18 }}><div style={{ display: 'flex', gap: 6, marginBottom: 14 }}><button type="button" onClick={() => setView('list')} style={toggle(view === 'list')}><List size={15} /> List editor</button><button type="button" onClick={() => setView('graph')} style={toggle(view === 'graph')}><Grid3X3 size={15} /> Node graph</button></div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 10, marginBottom: 18 }}><label style={label}>Name<input value={selected.name} onChange={(e) => updateSelected({ name: e.target.value })} style={input} /></label><label style={label}>Category<select value={selected.categoryId} onChange={(e) => updateSelected({ categoryId: e.target.value })} style={input}>{categories.length ? categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>) : <option value="uncategorized">Uncategorized</option>}</select></label><label style={label}>Status<select value={selected.status} onChange={(e) => updateSelected({ status: e.target.value as Routine['status'] })} style={input}><option value="draft">Draft</option><option value="active">Active</option><option value="paused">Paused</option><option value="disabled">Disabled</option></select></label><label style={label}>Priority<select value={selected.priority} onChange={(e) => updateSelected({ priority: e.target.value as Routine['priority'] })} style={input}><option value="low">Low</option><option value="medium">Normal</option><option value="high">High</option><option value="critical">Important / Critical</option></select></label></div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}><label style={{ ...label, display: 'flex', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={selected.visual?.inheritCategoryColor !== false} onChange={(e) => updateSelected({ visual: { ...selected.visual, inheritCategoryColor: e.target.checked } })} /> Inherit category colour</label><label style={{ ...label, display: 'flex', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 6 }}>Routine colour<input type="color" value={selected.visual?.color || appearance.nodeColors.category} onChange={(e) => updateSelected({ visual: { ...selected.visual, color: e.target.value, inheritCategoryColor: false } })} style={{ width: 42, height: 28, padding: 2, background: 'transparent', border: 0 }} /></label><label style={{ ...label, display: 'flex', gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={Boolean(selected.visual?.performanceMode)} onChange={(e) => updateSelected({ visual: { ...selected.visual, performanceMode: e.target.checked } })} /> Performance Mode</label></div>
            <label style={{ ...label, display: 'block', marginBottom: 10 }}>Description<textarea value={selected.description || ''} onChange={(e) => updateSelected({ description: e.target.value })} placeholder="What makes this routine easier to start?" rows={2} style={{ ...input, resize: 'vertical' }} /></label>
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginBottom: 14 }}><button type="button" onClick={() => { const template = saveRoutineAsTemplate(selected); window.alert(`Saved “${template.name}” as a reusable template.`); }} style={button('#334155')}>Save as template</button><button type="button" onClick={() => downloadText(`${selected.name || 'routine'}.json`, serializeRoutineExport(selected))} style={button('#334155')}>Export JSON</button><button type="button" onClick={() => downloadText(`${selected.name || 'routine'}-history.json`, serializeRoutineHistoryJson(selected))} style={button('#334155')}>History JSON</button><button type="button" onClick={() => downloadText(`${selected.name || 'routine'}-history.csv`, serializeRoutineHistoryCsv(selected), 'text/csv')} style={button('#334155')}>History CSV</button><input aria-label="AI routine prompt" value={aiPrompt} onChange={(e) => setAiPrompt(e.target.value)} placeholder="Optional AI request…" style={{ ...input, flex: '1 1 220px' }} /><button type="button" disabled={aiBusy || !aiPrompt.trim()} onClick={async () => { setAiBusy(true); setAiProposal(await createRoutineAiProposal('suggest', aiPrompt, selected)); setAiBusy(false); }} style={button('#155e75')}>{aiBusy ? 'Preparing…' : 'Propose AI changes'}</button></div>
            {aiProposal && <div role="dialog" aria-label="AI proposal" style={{ ...surface, padding: 12, marginBottom: 14, borderColor: '#22d3ee' }}><strong>{aiProposal.provider === 'offline' ? 'Offline proposal' : 'AI proposal'} — review before applying</strong>{aiProposal.changes.map((change) => <label key={change.id} style={{ display: 'flex', gap: 8, padding: '7px 0', color: '#cbd5e1', fontSize: 12 }}><input type="checkbox" defaultChecked value={change.id} /> <span>{change.description}</span></label>)}<div style={{ display: 'flex', gap: 7, marginTop: 8 }}><button type="button" onClick={() => { const ids = Array.from(document.querySelectorAll('[aria-label="AI proposal"] input:checked')).map((node) => (node as HTMLInputElement).value); const next = applyApprovedAiChanges(selected, aiProposal, ids); persist(next); setAiProposal(null); }} style={button('#0f766e')}>Apply selected</button><button type="button" onClick={() => setAiProposal(null)} style={button('#334155')}>Discard</button></div></div>}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, marginBottom: 18 }}>
              <label style={label}>Execution<select value={selected.executionMode} onChange={(e) => updateSelected({ executionMode: e.target.value as Routine['executionMode'] })} style={input}><option value="sequential">Sequential</option><option value="flexible">Flexible</option></select></label>
              <label style={label}>Repeat<select value={selected.schedule.recurrence.frequency} onChange={(e) => updateSelected({ schedule: { ...selected.schedule, recurrence: { ...selected.schedule.recurrence, frequency: e.target.value as Routine['schedule']['recurrence']['frequency'], interval: 1 } } })} style={input}><option value="none">Manual / one-off</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="custom">Custom</option></select></label>
              <label style={label}>Start date<input type="date" value={selected.schedule.startDate || ''} onChange={(e) => updateSelected({ schedule: { ...selected.schedule, startDate: e.target.value || undefined } })} style={input} /></label>
              <label style={label}>Start time<input type="time" value={selected.schedule.startTime || ''} onChange={(e) => updateSelected({ schedule: { ...selected.schedule, startTime: e.target.value || undefined } })} style={input} /></label>
              <label style={label}>Deadline<input type="time" value={selected.schedule.deadline || ''} onChange={(e) => updateSelected({ schedule: { ...selected.schedule, deadline: e.target.value || undefined } })} style={input} /></label>
              <label style={label}>Target minutes<input type="number" min="0" value={selected.schedule.durationTargetMinutes || ''} onChange={(e) => updateSelected({ schedule: { ...selected.schedule, durationTargetMinutes: Number(e.target.value) || undefined } })} style={input} /></label>
            </div>
            <RuntimePanel routine={selected} onAction={applyRuntime} onQuickStart={(minutes) => { const started = startRoutine(selected); persist(startRoutineStepTimer(started, undefined, minutes)); }} skipReason={skipReason} onSkipReasonChange={setSkipReason} />
            <RoutineAnalyticsPanel routine={selected} />
            {view === 'list' ? <div><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}><div><strong>Steps</strong><span style={{ color: '#64748b', fontSize: 12, marginLeft: 8 }}>Indenting creates a nested branch</span></div><button type="button" onClick={addStep} style={{ ...button('#0f766e'), display: 'flex', gap: 5, alignItems: 'center' }}><Plus size={14} /> Add step</button></div>{selected.steps.slice().sort((a, b) => a.order - b.order).map((step, index) => <StepRow key={step.id} step={step} index={index} allSteps={selected.steps} reminders={reminders} contacts={contacts} directDebits={directDebits} onChange={editStep} onRemove={removeStep} onMove={moveStep} />)}</div> : <GraphView routine={selected} appearance={appearance} onChange={editStep} />}
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 20, flexWrap: 'wrap' }}><div style={{ display: 'flex', gap: 7 }}><button type="button" onClick={() => { const copy = duplicateRoutine(selected.id); if (copy) { setRoutines((items) => [copy, ...items]); setSelectedId(copy.id); } }} style={button('#334155')}><Copy size={14} /> Duplicate</button><button type="button" onClick={() => { archiveRoutine(selected.id); setRoutines(readRoutines({ includeArchived: true })); }} style={button('#334155')}><Archive size={14} /> Archive</button><button type="button" onClick={() => { trashRoutine(selected.id); setRoutines(readRoutines({ includeArchived: true, includeTrash: true })); setSelectedId(null); }} style={button('#7f1d1d')}><Trash2 size={14} /> Trash</button></div><button type="button" onClick={saveSelected} style={{ ...button('#0891b2'), display: 'flex', gap: 6, alignItems: 'center' }}><Save size={14} /> Save routine</button></div>
          </div></section>}
      </div>
      {importPreview && <div role="dialog" aria-label="Routine import preview" style={{ ...surface, padding: 16, marginTop: 14, borderColor: '#22d3ee' }}><div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><div><strong>{importPreview.valid ? `Preview: ${importPreview.routine?.name}` : 'Routine import could not be previewed'}</strong><div style={{ color: '#94a3b8', fontSize: 12, marginTop: 4 }}>{importPreview.error || `${importPreview.routine?.steps.length || 0} steps · ${importPreview.conflicts.length} conflict(s)`}</div></div><button type="button" onClick={() => setImportPreview(null)} style={iconButton}><X size={15} /></button></div>{importPreview.warnings.map((warning) => <div key={warning} style={{ color: '#fbbf24', fontSize: 12, marginTop: 8 }}>{warning}</div>)}{importPreview.conflicts.map((conflict) => <label key={conflict.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center', padding: '9px 0', borderTop: '1px solid rgba(148,163,184,.1)', color: '#cbd5e1', fontSize: 12 }}><span>{conflict.message}</span><select value={importDecisions[conflict.id] || conflict.resolution} onChange={(event) => setImportDecisions((current) => ({ ...current, [conflict.id]: event.target.value as typeof conflict.resolution }))} style={{ ...input, width: 'auto' }}>{conflict.kind === 'routine-id' ? <option value="duplicate">Import as copy</option> : conflict.kind === 'category' ? <><option value="use-existing">Use first existing category</option><option value="skip">Cancel import</option></> : <><option value="unlink">Unlink missing target</option><option value="keep">Keep broken link flagged</option><option value="skip">Cancel import</option></>}</select></label>)}{importPreview.valid && <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button type="button" onClick={commitImportedRoutine} style={button('#0f766e')}>Import reviewed Routine</button><button type="button" onClick={() => setImportPreview(null)} style={button('#334155')}>Cancel</button></div>}</div>}
      {status === 'trash' && routines.filter((r) => r.trashedAt).map((routine) => <div key={routine.id} style={{ ...surface, padding: 12, marginTop: 14, display: 'flex', justifyContent: 'space-between' }}><span>{routine.name}</span><button type="button" onClick={() => { restoreRoutineFromTrash(routine.id); setRoutines(readRoutines({ includeArchived: true, includeTrash: true })); }} style={button('#334155')}>Restore</button></div>)}
    </div>
  </div>;
};

const RoutineAnalyticsPanel: React.FC<{ routine: Routine }> = ({ routine }) => {
  const [open, setOpen] = useState(false);
  const analytics = useMemo(() => analyzeRoutine(routine), [routine]);
  if (!routine.history.length && !routine.occurrences.length) return null;
  return <div style={{ ...surface, padding: 12, marginBottom: 18 }}><button type="button" onClick={() => setOpen((value) => !value)} style={{ ...button('#1e293b'), width: '100%', textAlign: 'left' }}>{open ? 'Hide history & analytics' : 'View history & analytics'} · {analytics.completionRate}% completion · {analytics.skips} skips</button>{open && <div style={{ marginTop: 12, display: 'grid', gap: 10 }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(120px,1fr))', gap: 8 }}>{[['Completed', analytics.completed], ['Expected', analytics.expected], ['Avg minutes', analytics.averageDurationMinutes], ['Overdue', analytics.overdue], ['Failed', analytics.failed], ['Streak', analytics.streak]].map(([labelText, value]) => <div key={String(labelText)} style={{ ...surface, padding: 9 }}><span style={{ display: 'block', color: '#94a3b8', fontSize: 10 }}>{labelText}</span><strong style={{ fontSize: 18 }}>{value}</strong></div>)}</div><div style={{ color: '#94a3b8', fontSize: 12 }}>{analytics.unrealisticDuration ? 'Your actual time is trending above the target. Consider a gentler duration.' : 'Targets look reasonable from the available history.'}{analytics.bottleneckStepIds.length ? ` ${analytics.bottleneckStepIds.length} step(s) may be a bottleneck.` : ''}</div><div style={{ maxHeight: 180, overflow: 'auto' }}>{routine.history.slice(0, 12).map((entry) => <div key={entry.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '6px 0', borderTop: '1px solid rgba(148,163,184,.1)', fontSize: 11 }}><span>{entry.event} {entry.reason ? `· ${entry.reason}` : ''}</span><span style={{ color: '#64748b' }}>{new Date(entry.at).toLocaleString()}</span></div>)}</div></div>}</div>;
};

const RuntimePanel: React.FC<{ routine: Routine; onAction: (action: 'start' | 'complete' | 'skip' | 'pause' | 'resume' | 'snooze' | 'expire' | 'timer' | 'add-time') => void; onQuickStart: (minutes: number) => void; skipReason: string; onSkipReasonChange: (reason: string) => void }> = ({ routine, onAction, onQuickStart, skipReason, onSkipReasonChange }) => {
  const [mode, setMode] = useState<'list' | 'graph' | 'focus'>('focus');
  const session = routine.activeSession;
  const current = session?.currentStepId ? routine.steps.find((step) => step.id === session.currentStepId) : undefined;
  const eligible = getEligibleRoutineSteps(routine);
  const displayStep = current || eligible[0];
  const running = session?.status === 'running';
  const finished = session?.status === 'completed' || session?.status === 'expired';
  return <div style={{ ...surface, borderColor: 'rgba(34,211,238,.25)', padding: 14, marginBottom: 18, background: 'linear-gradient(135deg, rgba(8,47,73,.72), rgba(15,23,42,.72))' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}><div><div style={{ color: '#67e8f9', fontSize: 10, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 800 }}>Run this routine</div><strong style={{ fontSize: 16 }}>{finished ? 'Occurrence complete' : displayStep ? `Next: ${displayStep.title}` : 'Ready when you are'}</strong></div><div style={{ display: 'flex', gap: 5 }}>{(['list', 'graph', 'focus'] as const).map((item) => <button key={item} type="button" onClick={() => setMode(item)} style={toggle(mode === item)}>{item}</button>)}</div></div>
    {mode === 'focus' && displayStep && <div style={{ marginTop: 12, padding: 14, borderRadius: 12, background: 'rgba(2,6,23,.45)', color: '#f8fafc' }}><div style={{ color: '#94a3b8', fontSize: 11 }}>One step at a time · {routine.executionMode}</div><div style={{ fontSize: 20, fontWeight: 800, marginTop: 3 }}>{displayStep.title}</div><div style={{ color: '#94a3b8', marginTop: 5 }}>{displayStep.description || 'Start small. You can return to the full routine whenever you need.'}</div></div>}
    {mode !== 'focus' && <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>{routine.steps.slice().sort((a, b) => a.order - b.order).map((step, index) => <div key={step.id} style={{ ...surface, padding: '8px 10px', opacity: session?.completedStepIds.includes(step.id) ? .45 : 1, borderColor: step.id === displayStep?.id ? '#22d3ee' : undefined }}>{index + 1}. {step.title}</div>)}</div>}
    <div style={{ display: 'flex', gap: 7, marginTop: 12, flexWrap: 'wrap' }}>{!session || finished ? <><button type="button" onClick={() => onAction('start')} style={{ ...button('#0f766e'), display: 'flex', gap: 5, alignItems: 'center' }}><Play size={14} /> Start</button><button type="button" onClick={() => onQuickStart(2)} style={button('#155e75')}>2 min start</button><button type="button" onClick={() => onQuickStart(5)} style={button('#155e75')}>5 min start</button><button type="button" onClick={() => onQuickStart(10)} style={button('#155e75')}>10 min start</button></> : <><button type="button" onClick={() => onAction('complete')} disabled={!displayStep} style={{ ...button('#0f766e'), display: 'flex', gap: 5, alignItems: 'center' }}><Check size={14} /> Complete step</button><select aria-label="Skip reason" value={skipReason} onChange={(event) => onSkipReasonChange(event.target.value)} style={{ ...input, width: 'auto', minWidth: 140 }}><option value="No time">No time</option>{getRoutineReasonOptions().filter((reason) => reason !== 'No time').map((reason) => <option key={reason} value={reason}>{reason}</option>)}</select><button type="button" onClick={() => onAction('skip')} disabled={!displayStep} style={{ ...button('#334155'), display: 'flex', gap: 5, alignItems: 'center' }}><SkipForward size={14} /> Skip once</button><button type="button" onClick={() => onAction(running ? 'pause' : 'resume')} style={button('#334155')}><Pause size={14} /> {running ? 'Pause' : 'Resume'}</button><button type="button" onClick={() => onAction('snooze')} style={{ ...button('#334155'), display: 'flex', gap: 5, alignItems: 'center' }}><Clock3 size={14} /> Snooze 10m</button><button type="button" onClick={() => onAction('timer')} style={button('#334155')}>Start 5m timer</button>{session?.stepTimerTargetAt && <button type="button" onClick={() => onAction('add-time')} style={button('#334155')}>Add 5m</button>}</>}</div>
  </div>;
};

const StepRow: React.FC<{ step: RoutineStep; index: number; allSteps: RoutineStep[]; reminders: Reminder[]; contacts: Contact[]; directDebits: DirectDebit[]; onChange: (id: string, patch: Partial<RoutineStep>) => void; onRemove: (id: string) => void; onMove: (id: string, direction: -1 | 1) => void }> = ({ step, index, allSteps, reminders, contacts, directDebits, onChange, onRemove, onMove }) => {
  const [open, setOpen] = useState(true);
  const parent = allSteps.find((candidate) => candidate.id === step.parentStepId);
  return <div draggable onDragEnd={() => undefined} style={{ marginLeft: `min(${step.depth * 20}px, 12px)`, minWidth: 0, border: '1px solid rgba(148,163,184,.13)', borderRadius: 10, marginBottom: 8, background: 'rgba(30,41,59,.5)' }}><div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: 8 }}><button type="button" onClick={() => setOpen(!open)} style={iconButton}>{open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</button><span style={{ color: '#64748b', fontSize: 11, minWidth: 20 }}>{index + 1}.</span><input aria-label={`Step ${index + 1}`} value={step.title} onChange={(e) => onChange(step.id, { title: e.target.value })} style={{ ...input, flex: 1, padding: '7px 9px' }} /><button type="button" onClick={() => onMove(step.id, -1)} disabled={index === 0} style={iconButton}>↑</button><button type="button" onClick={() => onMove(step.id, 1)} disabled={index === allSteps.length - 1} style={iconButton}>↓</button><button type="button" onClick={() => onChange(step.id, { parentStepId: parent ? null : allSteps[index - 1]?.id || null, depth: parent ? 0 : 1 })} title="Nest / unnest" style={iconButton}>{parent ? '↖' : '↘'}</button><button type="button" onClick={() => onRemove(step.id)} aria-label={`Delete ${step.title}`} style={{ ...iconButton, color: '#fca5a5' }}><Trash2 size={14} /></button></div>{open && <div className="routine-step-fields" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 100px 100px', gap: 8, padding: '0 10px 10px 42px', minWidth: 0 }}><input aria-label={`${step.title} description`} placeholder="Step note" value={step.description || ''} onChange={(e) => onChange(step.id, { description: e.target.value })} style={input} /><input aria-label={`${step.title} minutes`} type="number" min="0" placeholder="Minutes" value={step.durationTargetMinutes || ''} onChange={(e) => onChange(step.id, { durationTargetMinutes: Number(e.target.value) || undefined })} style={input} /><label style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#94a3b8', fontSize: 11 }}><input type="checkbox" checked={step.optional} onChange={(e) => onChange(step.id, { optional: e.target.checked })} /> Optional</label><label style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#94a3b8', fontSize: 11 }}><input type="checkbox" checked={Boolean(step.minimumVersion)} onChange={(e) => onChange(step.id, { minimumVersion: e.target.checked })} /> Minimum version</label><label style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#94a3b8', fontSize: 11 }}><input type="checkbox" checked={Boolean(step.minimumCompleted)} onChange={(e) => onChange(step.id, { minimumCompleted: e.target.checked })} /> Minimum completed</label><select aria-label={`${step.title} reminder link`} value={step.links?.reminderId || ''} onChange={(e) => onChange(step.id, { links: { ...step.links, reminderId: e.target.value || undefined, completionBehaviour: step.links?.completionBehaviour || 'ask-first' } })} style={input}><option value="">Link reminder…</option>{reminders.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select aria-label={`${step.title} contact link`} value={step.links?.contactId || ''} onChange={(e) => onChange(step.id, { links: { ...step.links, contactId: e.target.value || undefined } })} style={input}><option value="">Link contact…</option>{contacts.map((item) => <option key={item.id} value={item.id}>{item.displayName || item.fullName}</option>)}</select><select aria-label={`${step.title} bill link`} value={step.links?.directDebitId || ''} onChange={(e) => onChange(step.id, { links: { ...step.links, directDebitId: e.target.value || undefined } })} style={input}><option value="">Link bill…</option>{directDebits.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><select aria-label={`${step.title} link completion`} value={step.links?.completionBehaviour || 'ask-first'} onChange={(e) => onChange(step.id, { links: { ...step.links, completionBehaviour: e.target.value as NonNullable<RoutineStep['links']>['completionBehaviour'] } })} style={input}><option value="ask-first">Ask before linked action</option><option value="complete-step">Complete step with link</option><option value="open-target">Open linked target</option></select></div>}</div>;
};

const GraphView: React.FC<{ routine: Routine; appearance: AppearanceSettings; onChange: (id: string, patch: Partial<RoutineStep>) => void }> = ({ routine, appearance, onChange }) => {
  const [spatial, setSpatial] = useState(true);
  const [performanceMode, setPerformanceMode] = useState(Boolean(routine.visual?.performanceMode));
  const automaticPerformanceMode = routine.steps.length >= 100;
  const effectivePerformanceMode = performanceMode || automaticPerformanceMode;
  const detailLevel = routineGraphLevelOfDetail(routine.steps.length + 1, effectivePerformanceMode);
  const graph = useMemo(() => generateRoutineGraph(routine, appearance, { performanceMode: effectivePerformanceMode }), [appearance, effectivePerformanceMode, routine]);
  const persistPosition = (nodeId: string, position: { x: number; y: number }) => {
    const step = routine.steps.find((candidate) => candidate.id === nodeId);
    if (step) onChange(nodeId, { position });
  };

  return <div data-testid="routine-graph" style={{ minHeight: 320, borderRadius: 12, overflow: 'hidden', background: 'radial-gradient(circle at 50% 20%, rgba(8,145,178,.14), transparent 55%), #0b1220', border: '1px solid #1e3a4a' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', padding: '12px 14px', borderBottom: '1px solid rgba(148,163,184,.12)' }}>
      <div><div style={{ color: '#67e8f9', fontSize: 11, textTransform: 'uppercase', letterSpacing: '.14em' }}>Routine spatial graph</div><span style={{ color: '#94a3b8', fontSize: 11 }}>{graph.nodes.length - 1} steps · current path highlighted · dashed links are dependencies{automaticPerformanceMode ? ` · automatic ${detailLevel} detail` : ''}</span></div>
      <div style={{ display: 'flex', gap: 6 }}><button type="button" onClick={() => setSpatial(false)} style={toggle(!spatial)}>2D</button><button type="button" onClick={() => setSpatial(true)} style={toggle(spatial)}>3D explore</button><button type="button" onClick={() => setPerformanceMode((value) => !value)} style={toggle(effectivePerformanceMode)}>{automaticPerformanceMode ? 'Large routine optimized' : performanceMode ? 'Performance on' : 'Performance off'}</button></div>
    </div>
    {spatial ? <div style={{ height: 390 }}><SpatialGraph nodes={graph.nodes} edges={graph.edges} appearance={{ ...appearance, threeD: performanceMode ? { ...appearance.threeD, level: 'low', animationIntensity: 0, connectionAnimationIntensity: 0 } : appearance.threeD }} onEmptyClick={() => undefined} /></div> : <div style={{ minHeight: 260, padding: 20 }}><div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>{routine.steps.slice().sort((a, b) => a.order - b.order).map((step, index) => <React.Fragment key={step.id}><div draggable onDragEnd={(event) => { const rect = event.currentTarget.getBoundingClientRect(); persistPosition(step.id, { x: Math.round(rect.left), y: Math.round(rect.top) }); }} style={{ ...surface, padding: '13px 16px', minWidth: 150, borderColor: step.id === routine.activeSession?.currentStepId ? '#ffffff' : step.completed ? '#34d399' : '#155e75', opacity: step.completed ? .55 : 1, cursor: 'grab' }}><div style={{ color: '#64748b', fontSize: 10 }}>NODE {index + 1}</div><strong>{step.title}</strong><div style={{ color: '#94a3b8', fontSize: 11 }}>{step.durationTargetMinutes ? `${step.durationTargetMinutes} min` : 'No target'}</div></div>{index < routine.steps.length - 1 && <span style={{ color: '#22d3ee', fontSize: 20 }}>→</span>}</React.Fragment>)}</div></div>}
  </div>;
};

const button = (background: string): React.CSSProperties => ({ border: '1px solid rgba(255,255,255,.12)', background, color: '#f8fafc', borderRadius: 9, padding: '8px 11px', cursor: 'pointer', fontWeight: 700, fontSize: 12 });
const iconButton: React.CSSProperties = { border: '1px solid transparent', background: 'transparent', color: '#94a3b8', borderRadius: 7, padding: 6, cursor: 'pointer' };
const sectionHeader: React.CSSProperties = { padding: '13px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(148,163,184,.12)' };
const label: React.CSSProperties = { color: '#94a3b8', fontSize: 11, display: 'grid', gap: 5 };
const badge = (status: string): React.CSSProperties => ({ color: status === 'active' ? '#6ee7b7' : '#cbd5e1', background: 'rgba(148,163,184,.12)', borderRadius: 999, padding: '3px 7px', fontSize: 10, textTransform: 'capitalize' });
const toggle = (active: boolean): React.CSSProperties => ({ ...button(active ? '#155e75' : '#1e293b'), display: 'flex', gap: 6, alignItems: 'center' });
