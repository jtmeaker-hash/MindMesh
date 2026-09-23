import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  ReactFlowProvider,
  BackgroundVariant,
  Node,
  Edge,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';

import {
  Sparkles,
  CheckCircle2,
  Plus,
  RotateCcw,
  Trash2,
  Maximize2,
  ArrowLeft,
  Settings,
  Palette,
  X,
  Bell,
  Activity,
  AlertTriangle,
} from 'lucide-react';

import {
  Category,
  Reminder,
  ViewMode,
  MeshNodeData,
  NodePositionMap,
  AppNavTab,
  MoneyState,
  Contact,
  AppearanceSettings,
  AppNotificationSettings,
  NotificationHistoryEntry,
} from './types';
import { getChromeTheme } from './services/appearance';
import {
  configureNotificationEngine,
  cancelReminderNotifications,
  getReminderNotificationStatus,
  initNotificationEnvironment,
  attachNativeBridgeHandlers,
  subscribeNotificationEngine,
} from './services/notifications';
import { runStartupSelfCheck } from './services/diagnostics';
import { OPEN_DIAGNOSTICS_FLAG, recordStartup } from './services/diagnosticsStore';
import { logger } from './services/logger';
import {
  loadCategories,
  saveCategories,
  loadReminders,
  saveReminders,
  loadNodePositions,
  saveNodePositions,
  clearNodePositions,
  removeNodePosition,
  resetToSample,
  clearAllData,
  loadMoneyState,
  saveMoneyState,
  loadContacts,
  saveContacts,
  loadContactCategories,
  saveContactCategories,
  loadContactRelationships,
  saveContactRelationships,
  loadAppearance,
  saveAppearance,
  loadNotificationSettings,
  saveNotificationSettings,
  loadNotificationHistory,
  saveNotificationHistory,
  loadAllData,
  loadRoutines,
} from './utils/storage';
import { generateCompletedCategoryMesh } from './utils/layout';
import { generateNestedActiveMesh, generateNestedCompletedOverviewMesh } from './utils/nestedLayout';
import { normalizeCategories, validateCategoryParent, getCategoryDescendantIds, applyCategoryDelete } from './services/categories';
import { handleReminderCompletion } from './services/recurrence';
import { upsertReminder } from './services/reminders';
import { commitNodePosition, resetNodePosition } from './services/nodePositions';
import { didNodeDrag, focusZoomForNodeType, nodeCentre, resolveNodeTap } from './services/graphNavigation';

import { RootNode } from './components/nodes/RootNode';
import { CategoryNode } from './components/nodes/CategoryNode';
import { ReminderNode } from './components/nodes/ReminderNode';
import { SubtaskNode } from './components/nodes/SubtaskNode';

import { ReminderModal } from './components/modals/ReminderModal';
import { CategoryModal } from './components/modals/CategoryModal';
import { CategoryActionsSheet } from './components/modals/CategoryActionsSheet';
import { QuickAddModal } from './components/modals/QuickAddModal';
import { SettingsBackupModal } from './components/modals/SettingsBackupModal';
import { AppearanceModal } from './components/modals/AppearanceModal';
import { NotificationsModal } from './components/notifications/NotificationsModal';
import { DiagnosticsModal } from './components/diagnostics/DiagnosticsModal';
import { AppBackground } from './components/background/AppBackground';

import { AppNavigation } from './components/navigation/AppNavigation';
import { MoneyModule } from './components/money/MoneyModule';
import { DashboardModule } from './components/dashboard/DashboardModule';
import { RoutineModule } from './components/routines/RoutineModule';
import { ContactsModule } from './components/contacts/ContactsModule';
import { SpatialGraph } from './components/graph/SpatialGraph';

const nodeTypes = {
  rootNode: RootNode,
  categoryNode: CategoryNode,
  reminderNode: ReminderNode,
  subtaskNode: SubtaskNode,
};

function MindMeshFlow() {
  // Persistence state
  const [categories, setCategories] = useState<Category[]>(() => loadCategories());
  const [reminders, setReminders] = useState<Reminder[]>(() => loadReminders());
  const [nodePositions, setNodePositions] = useState<NodePositionMap>(() => loadNodePositions());
  const [moneyState, setMoneyState] = useState<MoneyState>(() => loadMoneyState());
  const [contacts, setContacts] = useState<Contact[]>(() => loadContacts());
  const [contactCategories, setContactCategories] = useState<string[]>(() => loadContactCategories());
  const [contactRelationships, setContactRelationships] = useState<string[]>(() => loadContactRelationships());
  const [appearance, setAppearance] = useState<AppearanceSettings>(() => loadAppearance());
  const [notificationSettings, setNotificationSettings] = useState<AppNotificationSettings>(() =>
    loadNotificationSettings()
  );
  const [notificationHistory, setNotificationHistory] = useState<NotificationHistoryEntry[]>(() =>
    loadNotificationHistory()
  );
  const [routines, setRoutines] = useState(() => loadRoutines());

  // Navigation state
  const [mainNavTab, setMainNavTab] = useState<AppNavTab>('reminders');
  const [viewMode, setViewMode] = useState<ViewMode>('active');
  const [focusedCategoryId, setFocusedCategoryId] = useState<string | null>(null);
  const [selectedCompletedCategory, setSelectedCompletedCategory] = useState<Category | null>(null);
  // Node the user has navigated to. First tap focuses the camera on it; a second
  // tap on the same node opens its existing options (see handleNodeClick).
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState<string | null>(null);

  // Modals state
  const [reminderModalOpen, setReminderModalOpen] = useState(false);
  const [activeReminder, setActiveReminder] = useState<Reminder | null>(null);
  const [defaultCategoryIdForNewReminder, setDefaultCategoryIdForNewReminder] = useState<string | undefined>();

  const [categoryModalOpen, setCategoryModalOpen] = useState(false);
  const [activeCategory, setActiveCategory] = useState<Category | null>(null);
  const [newCategoryParentId, setNewCategoryParentId] = useState<string | null>(null);

  const [categoryActionsCategory, setCategoryActionsCategory] = useState<Category | null>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [backupModalOpen, setBackupModalOpen] = useState(false);
  const [appearanceModalOpen, setAppearanceModalOpen] = useState(false);
  const [notificationsModalOpen, setNotificationsModalOpen] = useState(false);
  const [diagnosticsModalOpen, setDiagnosticsModalOpen] = useState(false);
  const [positionMenu, setPositionMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [startupNotice, setStartupNotice] = useState<string | null>(null);
  // Bumped only when the notification environment changes (never on every sweep),
  // so the graph is not re-rendered by the scheduling engine.
  const [notificationEnvKey, setNotificationEnvKey] = useState('');

  // React Flow graph state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<MeshNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const { fitView, setCenter } = useReactFlow();

  // Drag tracking refs
  const dragStartPosRef = useRef<{ id: string; x: number; y: number } | null>(null);
  // A drag must never be mistaken for a navigation tap (which would move the
  // camera or open a node's options). Consumed by handleNodeClick.
  const nodeDragMovedRef = useRef(false);
  const isInitialMount = useRef(true);
  const prevViewModeRef = useRef(viewMode);
  const prevCompletedCatRef = useRef(selectedCompletedCategory?.id);
  // Read inside stable callbacks so node changes never re-create handleNodeClick
  // (which would re-trigger the layout effect and fight the camera).
  const nodesRef = useRef<Node<MeshNodeData>[]>([]);
  const selectedGraphNodeIdRef = useRef<string | null>(null);
  const graphViewportRef = useRef<HTMLDivElement>(null);
  const lastGraphViewportSizeRef = useRef<{ width: number; height: number } | null>(null);

  // Save changes to localStorage
  useEffect(() => {
    saveCategories(categories);
  }, [categories]);

  useEffect(() => {
    saveReminders(reminders);
  }, [reminders]);

  useEffect(() => {
    saveNodePositions(nodePositions);
  }, [nodePositions]);

  useEffect(() => {
    saveMoneyState(moneyState);
  }, [moneyState]);

  useEffect(() => {
    saveContacts(contacts);
  }, [contacts]);

  useEffect(() => {
    saveContactCategories(contactCategories);
  }, [contactCategories]);

  useEffect(() => {
    saveContactRelationships(contactRelationships);
  }, [contactRelationships]);

  useEffect(() => {
    saveAppearance(appearance);
  }, [appearance]);

  useEffect(() => {
    saveNotificationSettings(notificationSettings);
  }, [notificationSettings]);

  useEffect(() => {
    saveNotificationHistory(notificationHistory);
  }, [notificationHistory]);

  const chrome = useMemo(() => getChromeTheme(appearance), [appearance]);

  // ---------------------------------------------------------------------
  // Notifications engine (lives outside React; no re-render while animating)
  // ---------------------------------------------------------------------

  useEffect(() => {
    const environment = initNotificationEnvironment();
    attachNativeBridgeHandlers();
    setNotificationEnvKey(`${environment.platform}:${environment.permission}`);

    return subscribeNotificationEngine((state) => {
      setNotificationEnvKey(`${state.platform}:${state.permission}`);
    });
  }, []);

  // If the crash screen asked for diagnostics, open the panel straight away.
  useEffect(() => {
    try {
      if (sessionStorage.getItem(OPEN_DIAGNOSTICS_FLAG) === '1') {
        sessionStorage.removeItem(OPEN_DIAGNOSTICS_FLAG);
        setStartupNotice('MindMesh recovered from an earlier error. Showing diagnostics.');
        setDiagnosticsModalOpen(true);
      }
    } catch {
      // sessionStorage unavailable: the options menu still exposes Diagnostics.
    }
  }, []);

  useEffect(() => {
    logger.info('App', 'MindMesh started', {
      categories: categories.length,
      reminders: reminders.length,
      contacts: contacts.length,
    });
  }, []);

  // Startup self-check: deliberately delayed and non-blocking so launch is never
  // measurably slower. Minor warnings stay quiet; genuine failures raise a banner.
  useEffect(() => {
    let cancelled = false;
    runStartupSelfCheck()
      .then((result) => {
        if (cancelled) return;
        recordStartup({
          passed: result.summary.passed,
          warnings: result.summary.warnings,
          failed: result.summary.failed,
        });
        if (result.bannerMessage) {
          setStartupNotice(result.bannerMessage);
          logger.warn('App', 'Startup self-check found issues', {
            failed: result.summary.failed,
            warnings: result.summary.warnings,
          });
        }
      })
      .catch((err) => {
        logger.error('App', 'Startup self-check failed to run', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleOpenReminderById = useCallback(
    (remId: string) => {
      const target = reminders.find((r) => r.id === remId);
      if (!target) {
        logger.warn('Notifications', 'Notification opened for a reminder that no longer exists', {
          reminderId: remId,
        });
        return;
      }
      setMainNavTab('reminders');
      setActiveReminder(target);
      setReminderModalOpen(true);
    },
    [reminders]
  );

  useEffect(() => {
    configureNotificationEngine({
      reminders,
      settings: notificationSettings,
      history: notificationHistory,
      onHistoryChange: setNotificationHistory,
      onOpenReminder: handleOpenReminderById,
      onCompleteReminder: (remId) => {
        setReminders((prev) => handleReminderCompletion(remId, prev));
      },
      onActionError: (message) => {
        logger.warn('Notifications', 'Notification action failed', { message });
      },
    });
  }, [reminders, notificationSettings, notificationHistory, handleOpenReminderById]);

  // Compact per-reminder notification status for the mesh node badges.
  const notificationStatusMap = useMemo(() => {
    const map: Record<string, { status: 'off' | 'on' | 'permission' | 'failed' | 'unsupported'; label: string; count: number }> = {};
    for (const reminder of reminders) {
      const status = getReminderNotificationStatus(reminder, notificationSettings, notificationHistory);
      map[reminder.id] = { status: status.status, label: status.label, count: status.pendingCount };
    }
    return map;
    // notificationEnvKey intentionally participates: permission changes must refresh badges.
  }, [reminders, notificationSettings, notificationHistory, notificationEnvKey]);

  // React Flow normally observes its parent, but the graph also needs a single
  // fit after a real viewport change (orientation, safe-area, or toolbar resize).
  // This observer deliberately does not run during pan/zoom, so it cannot fight
  // normal user interaction.
  useEffect(() => {
    if (mainNavTab !== 'reminders' || appearance.threeD.level !== 'off') return;
    const viewport = graphViewportRef.current;
    if (!viewport) return;

    let frame = 0;
    let settleFrame = 0;
    lastGraphViewportSizeRef.current = null;

    const fitAfterResize = () => {
      const rect = viewport.getBoundingClientRect();
      const width = Math.round(rect.width);
      const height = Math.round(rect.height);
      if (width <= 0 || height <= 0) return;

      const previous = lastGraphViewportSizeRef.current;
      if (previous && previous.width === width && previous.height === height) return;
      lastGraphViewportSizeRef.current = { width, height };

      cancelAnimationFrame(frame);
      cancelAnimationFrame(settleFrame);
      // ResizeObserver fires after layout, but Android WebView may apply its
      // orientation/safe-area metrics one frame later. Wait for that settle
      // without fitting during normal pan/zoom interaction.
      frame = requestAnimationFrame(() => {
        settleFrame = requestAnimationFrame(() => {
          fitView({ padding: 0.18, duration: 300 });
        });
      });
    };

    const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fitAfterResize) : null;
    observer?.observe(viewport);
    fitAfterResize();
    window.addEventListener('resize', fitAfterResize, { passive: true });
    window.addEventListener('orientationchange', fitAfterResize, { passive: true });

    return () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      cancelAnimationFrame(settleFrame);
      window.removeEventListener('resize', fitAfterResize);
      window.removeEventListener('orientationchange', fitAfterResize);
    };
  }, [appearance.threeD.level, fitView, mainNavTab]);

  // Keep the selection ref aligned with state for resets/restores/background taps.
  useEffect(() => {
    selectedGraphNodeIdRef.current = selectedGraphNodeId;
  }, [selectedGraphNodeId]);

  // Navigates the camera toward a node. Purely a view change: node coordinates
  // and manual positions are never touched. In 3D mode SpatialGraph reacts to
  // the selectedGraphNodeId prop and animates its own camera instead.
  const focusGraphNode = useCallback(
    (nodeId: string) => {
      if (appearance.threeD.level !== 'off') return;
      const node = nodesRef.current.find((entry) => entry.id === nodeId);
      if (!node) return;
      const centre = nodeCentre(node.position, node.measured ?? undefined);
      setCenter(centre.x, centre.y, { zoom: focusZoomForNodeType(node.data.type), duration: 520 });
    },
    [appearance.threeD.level, setCenter]
  );

  // Handle node interaction: tap once to travel to a node, tap the same node
  // again to open its existing options. Tapping a different node only moves the
  // focus. Dragging never reaches here (surfaces suppress the post-drag click).
  const handleNodeClick = useCallback(
    (nodeId: string, type: string) => {
      if (nodeDragMovedRef.current) {
        nodeDragMovedRef.current = false;
        return;
      }
      const alreadyFocused = resolveNodeTap(selectedGraphNodeIdRef.current, nodeId) === 'open';
      selectedGraphNodeIdRef.current = nodeId;
      setSelectedGraphNodeId(nodeId);

      if (!alreadyFocused) {
        focusGraphNode(nodeId);
        return;
      }

      if (type === 'root') {
        setFocusedCategoryId(null);
        if (appearance.threeD.level === 'off') {
          fitView({ padding: 0.2, duration: 400 });
        } else {
          window.dispatchEvent(new Event('mindmesh-spatial-home'));
        }
        return;
      }

      if (type === 'category') {
        const cat = categories.find((c) => c.id === nodeId);
        if (!cat) return;

        if (viewMode === 'completed') {
          // Open completed category detail mesh
          setSelectedCompletedCategory(cat);
        } else {
          // Active view: focus the branch & open category actions
          setFocusedCategoryId((prev) => (prev === nodeId ? null : nodeId));
          setCategoryActionsCategory(cat);
        }
        return;
      }

      if (type === 'reminder') {
        const rem = reminders.find((r) => r.id === nodeId);
        if (rem) {
          setActiveReminder(rem);
          setReminderModalOpen(true);
        }
        return;
      }
    },
    [appearance.threeD.level, categories, reminders, viewMode, fitView, focusGraphNode]
  );

  // Subtask toggle
  const handleSubtaskToggle = useCallback((subtaskId: string, reminderId: string) => {
    setReminders((prev) =>
      prev.map((r) => {
        if (r.id !== reminderId) return r;
        return {
          ...r,
          subtasks: r.subtasks.map((s) =>
            s.id === subtaskId
              ? {
                  ...s,
                  completed: !s.completed,
                  completedAt: !s.completed ? new Date().toISOString() : undefined,
                }
              : s
          ),
        };
      })
    );
  }, []);

  // Quick toggle reminder complete
  const handleReminderCompleteToggle = useCallback((reminderId: string) => {
    setReminders((prev) => {
      const next = handleReminderCompletion(reminderId, prev);
      const updated = next.find((r) => r.id === reminderId);
      logger.info('Reminders', 'Reminder completion toggled', {
        reminderId,
        completed: updated?.completed ?? false,
        recurring: Boolean(updated?.recurrence && updated.recurrence.frequency !== 'none'),
      });
      return next;
    });
    // Completing a reminder must stop its remaining scheduled notifications.
    cancelReminderNotifications(reminderId);
  }, []);

  // Node Drag Handlers (Manual Reorganization)
  const handleNodeDragStart = useCallback((_: unknown, node: Node) => {
    dragStartPosRef.current = {
      id: node.id,
      x: Math.round(node.position.x),
      y: Math.round(node.position.y),
    };
  }, []);

  const handleNodeDragStop = useCallback(
    (_: unknown, node: Node) => {
      // XYFlow reports world coordinates here, already accounting for its
      // viewport transform. Persist only once, after the gesture completes.
      const start = dragStartPosRef.current;
      if (start && didNodeDrag(start, node.position)) {
        nodeDragMovedRef.current = true;
        window.setTimeout(() => { nodeDragMovedRef.current = false; }, 350);
      }
      setNodePositions((prev) => {
        const next = commitNodePosition(prev, node.id, node.position.x, node.position.y);
        saveNodePositions(next);
        return next;
      });
      dragStartPosRef.current = null;
    },
    []
  );

  const handleSpatialNodePositionChange = useCallback((nodeId: string, x: number, y: number) => {
    setNodePositions((prev) => {
      const next = commitNodePosition(prev, nodeId, x, y);
      saveNodePositions(next);
      return next;
    });
  }, []);

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setPositionMenu({ id: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const handleResetNodePosition = useCallback(() => {
    if (!positionMenu) return;
    const nodeId = positionMenu.id;
    setNodePositions((prev) => {
      const next = resetNodePosition(prev, nodeId);
      removeNodePosition(nodeId);
      return next;
    });
    setPositionMenu(null);
  }, [positionMenu]);

  // Generate Graph Elements based on current viewMode & manual positions
  useEffect(() => {
    let graph;
    if (viewMode === 'active') {
      graph = generateNestedActiveMesh(
        categories,
        reminders,
        focusedCategoryId,
        {
          onNodeClick: handleNodeClick,
          onSubtaskToggle: handleSubtaskToggle,
          onReminderCompleteToggle: handleReminderCompleteToggle,
        },
        nodePositions,
        contacts,
        appearance,
        notificationStatusMap
      );
    } else {
      // Completed mode
      if (selectedCompletedCategory) {
        graph = generateCompletedCategoryMesh(
          selectedCompletedCategory,
          reminders,
          {
            onNodeClick: handleNodeClick,
          },
          nodePositions,
          contacts,
          appearance,
          notificationStatusMap
        );
      } else {
        graph = generateNestedCompletedOverviewMesh(
          categories,
          reminders,
          { onNodeClick: handleNodeClick },
          nodePositions,
          appearance
        );
      }
    }

    nodesRef.current = graph.nodes;
    setNodes(graph.nodes);
    setEdges(graph.edges);

    // Only auto fit view on genuine screen transitions (first mount, active vs
    // completed, or entering a completed category). Focusing a branch, moving a
    // node or any data update must NOT refit or re-centre the camera.
    const shouldFit =
      isInitialMount.current ||
      prevViewModeRef.current !== viewMode ||
      prevCompletedCatRef.current !== selectedCompletedCategory?.id;

    if (shouldFit) {
      isInitialMount.current = false;
      prevViewModeRef.current = viewMode;
      prevCompletedCatRef.current = selectedCompletedCategory?.id;

      const timeout = setTimeout(() => {
        fitView({ padding: 0.18, duration: 350 });
      }, 60);

      return () => clearTimeout(timeout);
    }
  }, [
    categories,
    reminders,
    nodePositions,
    viewMode,
    focusedCategoryId,
    selectedCompletedCategory,
    contacts,
    appearance,
    notificationStatusMap,
    handleNodeClick,
    handleSubtaskToggle,
    handleReminderCompleteToggle,
    setNodes,
    setEdges,
    fitView,
  ]);

  // Reset all manual node positions to return to automatic radial layout
  const handleResetLayout = useCallback(() => {
    if (!window.confirm('Reset the entire graph layout? Your reminders, categories, routines, contacts, money data, and settings will be kept.')) return;
    clearNodePositions();
    setNodePositions({});
    setPositionMenu(null);
    setMenuOpen(false);
    setSelectedGraphNodeId(null);
    setTimeout(() => {
      fitView({ padding: 0.2, duration: 400 });
    }, 60);
  }, [fitView]);

  // CRUD for Categories
  const handleSaveCategory = (cat: Category) => {
    setCategories((prev) => {
      const error = validateCategoryParent(prev, cat.id, cat.parentCategoryId);
      if (error) {
        window.alert(error);
        return prev;
      }
      const idx = prev.findIndex((c) => c.id === cat.id);
      const next = idx >= 0 ? prev.map((existing) => existing.id === cat.id ? cat : existing) : [...prev, cat];
      return normalizeCategories(next);
    });
  };

  const handleDeleteCategory = (catId: string) => {
    const descendants = new Set([catId, ...getCategoryDescendantIds(categories, catId)]);
    const moveContents = window.confirm('Move child categories and reminders to the parent category? Choose Cancel to delete this category and its descendants instead.')
      ? 'move-contents'
      : 'delete-descendants';
    setCategories((prev) => applyCategoryDelete(prev, catId, moveContents));
    setReminders((prev) => moveContents === 'move-contents'
      ? prev.map((reminder) => descendants.has(reminder.categoryId) && reminder.categoryId === catId
        ? { ...reminder, categoryId: categories.find((category) => category.id === catId)?.parentCategoryId || categories[0]?.id || reminder.categoryId }
        : reminder).filter((reminder) => moveContents === 'move-contents' || !descendants.has(reminder.categoryId))
      : prev.filter((reminder) => !descendants.has(reminder.categoryId)));
    if (focusedCategoryId === catId) setFocusedCategoryId(null);
    if (selectedCompletedCategory?.id === catId) setSelectedCompletedCategory(null);

    // Clean up node positions for this category and its subtree
    setNodePositions((prev) => {
      const next = { ...prev };
      delete next[catId];
      const catReminders = reminders.filter((r) => r.categoryId === catId);
      catReminders.forEach((r) => {
        delete next[r.id];
        r.subtasks?.forEach((st) => delete next[st.id]);
      });
      saveNodePositions(next);
      return next;
    });
  };

  // CRUD for Reminders
  const handleSaveReminder = (rem: Reminder) => {
    setReminders((prev) => {
      const previous = prev.find((r) => r.id === rem.id);
      if (previous) {
        const next = upsertReminder(prev, rem);
        if (previous.completed !== rem.completed) {
          logger.info('Reminders', 'Reminder completion state changed by edit', {
            reminderId: rem.id,
            completed: rem.completed,
          });
          cancelReminderNotifications(rem.id);
        } else if (previous.dueDate !== rem.dueDate || previous.dueTime !== rem.dueTime) {
          logger.info('Reminders', 'Reminder rescheduled', {
            reminderId: rem.id,
            from: `${previous.dueDate ?? 'none'} ${previous.dueTime ?? ''}`.trim(),
            to: `${rem.dueDate ?? 'none'} ${rem.dueTime ?? ''}`.trim(),
          });
        } else {
          logger.info('Reminders', 'Reminder edited', {
            reminderId: rem.id,
            notificationsEnabled: rem.notifications?.enabled === true,
          });
        }
        return next;
      }
      logger.info('Reminders', 'Reminder created', {
        categoryId: rem.categoryId,
        hasDueDate: Boolean(rem.dueDate),
        notificationsEnabled: rem.notifications?.enabled === true,
        advanceCount: rem.notifications?.advanceMinutes.length ?? 0,
      });
      return [rem, ...prev];
    });
  };

  const handleDeleteReminder = (remId: string) => {
    logger.info('Reminders', 'Reminder deleted', { reminderId: remId });
    // Cancel every notification still scheduled for this reminder.
    cancelReminderNotifications(remId);
    setReminders((prev) => prev.filter((r) => r.id !== remId));

    // Clean up node position
    setNodePositions((prev) => {
      const next = { ...prev };
      delete next[remId];
      const targetRem = reminders.find((r) => r.id === remId);
      targetRem?.subtasks?.forEach((st) => delete next[st.id]);
      saveNodePositions(next);
      return next;
    });
  };

  // Reset to Sample Data
  const handleResetSample = () => {
    if (confirm('Reset to initial sample tasks?')) {
      const { categories: newCats, reminders: newRems } = resetToSample();
      clearNodePositions();
      setNodePositions({});
      setCategories(newCats);
      setReminders(newRems);
      setFocusedCategoryId(null);
      setSelectedCompletedCategory(null);
      setSelectedGraphNodeId(null);
      setMenuOpen(false);
      setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 60);
    }
  };

  // Clear All Tasks
  const handleClearAll = () => {
    if (confirm('Clear all tasks? (Categories will be kept)')) {
      const { reminders: emptyRems } = clearAllData();
      clearNodePositions();
      setNodePositions({});
      setReminders(emptyRems);
      setFocusedCategoryId(null);
      setSelectedCompletedCategory(null);
      setSelectedGraphNodeId(null);
      setMenuOpen(false);
      setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 60);
    }
  };


  // Reload full data after restore or complete reset
  const handleReloadAllPersistedState = useCallback(() => {
    const full = loadAllData();
    setCategories(full.categories || []);
    setReminders(full.reminders || []);
    setNodePositions(full.nodePositions || {});
    setMoneyState(full.money || loadMoneyState());
    setContacts(full.contacts || []);
    setContactCategories(full.contactCategories || loadContactCategories());
    setContactRelationships(full.contactRelationships || loadContactRelationships());
    setAppearance(full.appearance || loadAppearance());

    // Restored notification settings/history are picked up by the engine effect,
    // which re-schedules everything against the restored reminders.
    setNotificationSettings(full.notifications || loadNotificationSettings());
    setNotificationHistory(full.notificationHistory || loadNotificationHistory());

    setFocusedCategoryId(null);
    setSelectedCompletedCategory(null);
    setSelectedGraphNodeId(null);
    setMenuOpen(false);
    setTimeout(() => fitView({ padding: 0.2, duration: 400 }), 80);
  }, [fitView]);

  const focusedCategory = useMemo(() => {
    return categories.find((c) => c.id === focusedCategoryId) || null;
  }, [categories, focusedCategoryId]);

  const activeCount = reminders.filter((r) => !r.completed).length;
  const completedCount = reminders.filter((r) => r.completed).length;

  return (
    <div
      className="mm-app-shell"
      data-3d-level={appearance.threeD.level}
      style={{
        width: '100%',
        height: '100dvh',
        backgroundColor: '#080B12',
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        '--mm-perspective': `${appearance.threeD.perspective}px`,
        '--mm-shadow-strength': appearance.threeD.shadowIntensity,
        '--mm-glow-strength': appearance.threeD.glowIntensity,
        '--mm-motion': appearance.threeD.animationIntensity,
        '--mm-connection-motion': appearance.threeD.connectionAnimationIntensity,
        '--mm-node-depth': `${Math.round(appearance.threeD.nodeDepth * 28)}px`,
        '--mm-connection-depth': `${Math.round(appearance.threeD.connectionDepth * 18)}px`,
        '--mm-card-depth': `${Math.round(appearance.threeD.cardDepth * 22)}px`,
        '--mm-accent': appearance.nodeColors.root,
      } as React.CSSProperties}
    >
      {/* APPEARANCE BACKGROUND STACK (base / photo / void / matrix rain) */}
      <AppBackground appearance={appearance} />

      {/* STARTUP SELF-CHECK BANNER (only shown for genuine problems) */}
      {startupNotice && (
        <div
          role="status"
          style={{
            position: 'absolute',
            top: 70,
            left: 16,
            right: 16,
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            padding: '9px 12px',
            borderRadius: 12,
            backgroundColor: 'rgba(245, 158, 11, 0.14)',
            border: '1px solid rgba(245, 158, 11, 0.4)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <AlertTriangle size={15} color="#f59e0b" />
            <span style={{ fontSize: 12.5, color: '#fcd34d' }}>{startupNotice}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={() => setDiagnosticsModalOpen(true)}
              style={{
                padding: '5px 11px',
                borderRadius: 999,
                border: '1px solid rgba(245, 158, 11, 0.5)',
                backgroundColor: 'rgba(245, 158, 11, 0.18)',
                color: '#fcd34d',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              View Diagnostics
            </button>
            <button
              type="button"
              onClick={() => setStartupNotice(null)}
              aria-label="Dismiss system warning"
              style={{
                background: 'transparent',
                border: 'none',
                color: '#fcd34d',
                cursor: 'pointer',
                padding: 4,
                display: 'flex',
              }}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      )}

      {/* TOP HEADER */}
      <header
        className="mm-topbar"
        style={{
          position: 'relative',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 50,
          padding: 'max(12px, env(safe-area-inset-top, 0px)) 16px 12px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: chrome.headerGradient,
          backdropFilter: 'blur(10px)',
          pointerEvents: 'none',
        }}
      >
        <div className="mm-topbar__left" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 14 }}>
          {selectedCompletedCategory ? (
            <button
              type="button"
              onClick={() => setSelectedCompletedCategory(null)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.08)',
                border: '1px solid rgba(255,255,255,0.15)',
                color: '#f8fafc',
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <ArrowLeft size={16} /> Back to Categories
            </button>
          ) : (
            <div className="mm-topbar__brand">
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h1
                  style={{
                    fontSize: 20,
                    fontWeight: 800,
                    letterSpacing: '-0.03em',
                    background: chrome.titleGradient,
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                  }}
                >
                  MindMesh
                </h1>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 7px',
                    borderRadius: 8,
                    backgroundColor: viewMode === 'active' ? '#312e81' : '#1e293b',
                    color: viewMode === 'active' ? '#a5b4fc' : '#94a3b8',
                    border: '1px solid rgba(255,255,255,0.1)',
                  }}
                >
                  {viewMode === 'active' ? `${activeCount} Active` : `${completedCount} Done`}
                </span>
              </div>
              <p style={{ fontSize: 11, color: chrome.mutedText, marginTop: 1 }}>
                See what’s on your mind.
              </p>
            </div>
          )}

          {/* Primary App Navigation in Top Bar */}
          <AppNavigation
            currentTab={mainNavTab}
            onSelectTab={(tab) => {
              setMainNavTab(tab);
              logger.debug('Navigation', 'Switched tab', { tab });
              if (tab === 'reminders') {
                setTimeout(() => fitView({ padding: 0.2, duration: 300 }), 50);
              }
            }}
            activeRemindersCount={activeCount}
            upcomingBillsCount={moneyState.directDebits.filter((b) => b.active).length}
            contactsCount={contacts.length}
          />
        </div>

        {/* Right Controls */}
        <div className="mm-topbar__right" style={{ pointerEvents: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Auto-Arrange pill if manual positioning is active and on reminders tab */}
          {mainNavTab === 'reminders' && Object.keys(nodePositions).length > 0 && (
            <button
              type="button"
              onClick={handleResetLayout}
              title="Reset layout to radial grid"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                padding: '6px 11px',
                borderRadius: 20,
                backgroundColor: 'rgba(99, 102, 241, 0.16)',
                border: '1px solid rgba(99, 102, 241, 0.35)',
                color: '#a5b4fc',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <Sparkles size={13} color="#818cf8" />
              <span>Auto-Arrange</span>
            </button>
          )}

          {/* Fit view button on reminders tab */}
          {mainNavTab === 'reminders' && (
            <button
              type="button"
              onClick={() => {
                if (appearance.threeD.level === 'off') {
                  fitView({ padding: 0.18, duration: 400 });
                } else {
                  window.dispatchEvent(new Event('mindmesh-spatial-home'));
                }
              }}
              title="Fit Mesh to Screen"
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                backgroundColor: 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Maximize2 size={17} />
            </button>
          )}

          {/* Menu / Settings */}
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              onClick={() => setMenuOpen((p) => !p)}
              title="Options"
              style={{
                width: 36,
                height: 36,
                borderRadius: 12,
                backgroundColor: menuOpen ? '#6366f1' : 'rgba(255,255,255,0.07)',
                border: '1px solid rgba(255,255,255,0.12)',
                color: menuOpen ? '#ffffff' : '#94a3b8',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
              }}
            >
              <Settings size={17} />
            </button>

            {menuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: 44,
                  right: 0,
                  width: 220,
                  backgroundColor: '#0F172A',
                  border: '1px solid #334155',
                  borderRadius: 16,
                  padding: 8,
                  boxShadow: '0 12px 30px rgba(0,0,0,0.8)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  zIndex: 200,
                }}
              >
                <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                  LAYOUT & PREFERENCES
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setAppearanceModalOpen(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    color: '#a5b4fc',
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  <Palette size={15} color="#818cf8" />
                  <span>Appearance & Theme</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setNotificationsModalOpen(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    color: '#a5b4fc',
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  <Bell size={15} color="#818cf8" />
                  <span>Notifications</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetLayout}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 10,
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: '#e2e8f0',
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <Sparkles size={15} color="#818cf8" />
                  <span>Auto-Arrange Mesh</span>
                </button>
                <div style={{ padding: '6px 10px', fontSize: 11, fontWeight: 700, color: '#64748b' }}>
                  DATA & BACKUP
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setBackupModalOpen(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    color: '#a5b4fc',
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  <span>Backup & Restore Data</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    setDiagnosticsModalOpen(true);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 10,
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    border: '1px solid rgba(99, 102, 241, 0.3)',
                    color: '#a5b4fc',
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontWeight: 600,
                  }}
                >
                  <Activity size={15} color="#818cf8" />
                  <span>Diagnostics</span>
                </button>
                <button
                  type="button"
                  onClick={handleResetSample}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 10,
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: '#e2e8f0',
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <RotateCcw size={15} color="#38bdf8" />
                  <span>Reset Demo Tasks</span>
                </button>
                <button
                  type="button"
                  onClick={handleClearAll}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '9px 12px',
                    borderRadius: 10,
                    backgroundColor: 'transparent',
                    border: 'none',
                    color: '#ef4444',
                    fontSize: 13,
                    textAlign: 'left',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={15} />
                  <span>Clear All Tasks</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      {/* MAIN CONTENT AREA ACCORDING TO SELECTED TAB */}
      {mainNavTab === 'reminders' && (
        <>
          {/* FOCUSED CATEGORY BANNER (If a branch is focused) */}
          {viewMode === 'active' && focusedCategory && (
            <div
              style={{
                position: 'absolute',
                top: 72,
                left: 16,
                right: 16,
                zIndex: 40,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 14px',
                borderRadius: 12,
                backgroundColor: 'rgba(15, 23, 42, 0.85)',
                border: `1px solid ${focusedCategory.color}66`,
                boxShadow: `0 4px 16px rgba(0,0,0,0.5), 0 0 10px ${focusedCategory.color}22`,
                backdropFilter: 'blur(8px)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor: focusedCategory.color,
                    boxShadow: `0 0 8px ${focusedCategory.color}`,
                  }}
                />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                  Focused: {focusedCategory.name} Branch
                </span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  onClick={() => {
                    setDefaultCategoryIdForNewReminder(focusedCategory.id);
                    setActiveReminder(null);
                    setReminderModalOpen(true);
                  }}
                  style={{
                    background: `${focusedCategory.color}22`,
                    border: `1px solid ${focusedCategory.color}`,
                    color: '#ffffff',
                    padding: '4px 8px',
                    borderRadius: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  + Task
                </button>
                <button
                  type="button"
                  onClick={() => setFocusedCategoryId(null)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                  title="Unfocus"
                >
                  <X size={16} />
                </button>
              </div>
            </div>
          )}

          {/* MAIN SPIDERWEB CANVAS */}
          <div
            ref={graphViewportRef}
            className="mm-graph-stage"
            data-testid="graph-viewport"
            style={{ position: 'relative', width: '100%', minWidth: 0, flex: '1 1 0%', minHeight: 0 }}
          >
            {appearance.threeD.level === 'off' ? (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDragStart={handleNodeDragStart}
                onNodeDragStop={handleNodeDragStop}
                onNodeContextMenu={handleNodeContextMenu}
                onPaneClick={() => {
                  setPositionMenu(null);
                  setSelectedGraphNodeId(null);
                }}
                nodesDraggable={true}
                panOnDrag={true}
                selectionOnDrag={false}
                zoomOnPinch={true}
                preventScrolling={true}
                nodesConnectable={false}
                nodeTypes={nodeTypes}
                // Wide dolly range so large graphs can be viewed whole and single
                // nodes can be inspected closely without re-fitting the world.
                minZoom={0.05}
                maxZoom={4}
                proOptions={{ hideAttribution: true }}
                defaultEdgeOptions={{ type: 'default', animated: false }}
              >
                {appearance.showGrid && (
                  <Background
                    variant={BackgroundVariant.Dots}
                    gap={28}
                    size={1.5}
                    color={appearance.gridColor}
                  />
                )}
                <Controls
                  position="bottom-left"
                  showInteractive={false}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: 10,
                    overflow: 'hidden',
                    boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                    marginBottom: 14,
                    marginLeft: 14,
                  }}
                />
              </ReactFlow>
            ) : (
              <SpatialGraph
                nodes={nodes}
                edges={edges}
                appearance={appearance}
                onNodePositionChange={handleSpatialNodePositionChange}
                focusNodeId={selectedGraphNodeId}
                selectedNodeId={selectedGraphNodeId}
                onEmptyClick={() => {
                  setFocusedCategoryId(null);
                  setSelectedCompletedCategory(null);
                  setSelectedGraphNodeId(null);
                }}
              />
            )}
            {positionMenu && (
              <div
                role="menu"
                style={{ position: 'fixed', left: positionMenu.x, top: positionMenu.y, zIndex: 500, minWidth: 170, padding: 6, borderRadius: 12, background: '#0F172A', border: '1px solid #334155', boxShadow: '0 10px 28px rgba(0,0,0,0.55)' }}
              >
                <button type="button" onClick={handleResetNodePosition} style={{ width: '100%', padding: '9px 10px', border: 0, borderRadius: 8, background: 'transparent', color: '#e2e8f0', textAlign: 'left', cursor: 'pointer', fontSize: 12 }}>
                  Return to auto layout
                </button>
              </div>
            )}
          </div>

          {/* BOTTOM NAVIGATION & FLOATING ACTION BUTTON */}
          <div
            style={{
              position: 'relative',
              flex: '0 0 auto',
              left: 0,
              right: 0,
              zIndex: 50,
              padding: '12px 16px calc(12px + env(safe-area-inset-bottom, 0px)) 16px',
              background: chrome.bottomGradient,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 16,
              backdropFilter: 'blur(8px)',
            }}
          >
            {/* Navigation Switcher Capsule */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                backgroundColor: '#0F172A',
                border: '1px solid #334155',
                borderRadius: 30,
                padding: 4,
                boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
              }}
            >
              {/* ACTIVE TAB */}
              <button
                type="button"
                onClick={() => {
                  setViewMode('active');
                  setSelectedCompletedCategory(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 20px',
                  borderRadius: 24,
                  border: 'none',
                  backgroundColor: viewMode === 'active' ? '#6366F1' : 'transparent',
                  color: viewMode === 'active' ? '#ffffff' : '#94A3B8',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <Sparkles size={16} />
                <span>Active ({activeCount})</span>
              </button>

              {/* COMPLETED TAB */}
              <button
                type="button"
                onClick={() => {
                  setViewMode('completed');
                  setFocusedCategoryId(null);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '8px 20px',
                  borderRadius: 24,
                  border: 'none',
                  backgroundColor: viewMode === 'completed' ? '#0284C7' : 'transparent',
                  color: viewMode === 'completed' ? '#ffffff' : '#94A3B8',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                }}
              >
                <CheckCircle2 size={16} />
                <span>Completed ({completedCount})</span>
              </button>
            </div>

            {/* FLOATING ACTION BUTTON (+) */}
            <button
              type="button"
              onClick={() => setQuickAddOpen(true)}
              title="Quick Add Task or Category"
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                backgroundColor: '#6366F1',
                border: '2px solid rgba(255,255,255,0.2)',
                color: '#ffffff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                boxShadow: '0 0 20px rgba(99, 102, 241, 0.5), 0 4px 12px rgba(0,0,0,0.5)',
                transition: 'transform 0.15s ease',
              }}
            >
              <Plus size={26} strokeWidth={2.5} />
            </button>
          </div>
        </>
      )}

      {/* ROUTINES SECTION */}
      {mainNavTab === 'routines' && (
        <RoutineModule categories={categories} contacts={contacts} reminders={reminders} directDebits={moneyState.directDebits} appearance={appearance} onRoutinesChange={setRoutines} />
      )}

      {/* CONTACTS SECTION */}
      {mainNavTab === 'contacts' && (
        <div className="mm-module" style={{ flex: '1 1 0%', minHeight: 0, minWidth: 0, paddingTop: 0, width: '100%', display: 'flex' }}>
          <ContactsModule
            contacts={contacts}
            onUpdateContacts={(updater) => {
              setContacts((prev) => {
                const nextContacts = typeof updater === 'function' ? updater(prev) : updater;
                // Gracefully remove broken contact references from reminders if a contact was deleted
                const nextIds = new Set(nextContacts.map((c) => c.id));
                setReminders((prevReminders) =>
                  prevReminders.map((r) => {
                    if (r.linkedContactId && !nextIds.has(r.linkedContactId)) {
                      const copy = { ...r };
                      delete copy.linkedContactId;
                      return copy;
                    }
                    return r;
                  })
                );
                return nextContacts;
              });
            }}
            contactCategories={contactCategories}
            onUpdateContactCategories={setContactCategories}
            contactRelationships={contactRelationships}
            onUpdateContactRelationships={setContactRelationships}
            reminders={reminders}
            onOpenReminderModal={(remId) => {
              const r = reminders.find((rem) => rem.id === remId);
              if (r) {
                setActiveReminder(r);
                setReminderModalOpen(true);
              }
            }}
          />
        </div>
      )}

      {/* MONEY SECTION */}
      {mainNavTab === 'money' && (
        <div className="mm-module" style={{ flex: '1 1 0%', minHeight: 0, minWidth: 0, paddingTop: 0, width: '100%', display: 'flex' }}>
          <MoneyModule
            moneyState={moneyState}
            onUpdateMoneyState={setMoneyState}
            reminders={reminders}
            categories={categories}
            onUpdateReminders={setReminders}
            onUpdateCategories={setCategories}
            onOpenReminderModal={(remId) => {
              const r = reminders.find((rem) => rem.id === remId);
              if (r) {
                setActiveReminder(r);
                setReminderModalOpen(true);
              }
            }}
          />
        </div>
      )}

      {/* DASHBOARD SECTION */}
      {mainNavTab === 'dashboard' && (
        <div className="mm-module" style={{ flex: '1 1 0%', minHeight: 0, minWidth: 0, paddingTop: 0, width: '100%', display: 'flex' }}>
          <DashboardModule
            reminders={reminders}
            categories={categories}
            moneyState={moneyState}
            onNavigateToMoney={() => setMainNavTab('money')}
            onNavigateToReminders={() => setMainNavTab('reminders')}
            onNavigateToRoutines={() => setMainNavTab('routines')}
            routines={routines}
            onOpenRoutine={() => setMainNavTab('routines')}
            onOpenReminderModal={(remId) => {
              const r = reminders.find((rem) => rem.id === remId);
              if (r) {
                setActiveReminder(r);
                setReminderModalOpen(true);
              }
            }}
          />
        </div>
      )}

      {/* MODALS */}
      <ReminderModal
        isOpen={reminderModalOpen}
        onClose={() => {
          setReminderModalOpen(false);
          setActiveReminder(null);
          setDefaultCategoryIdForNewReminder(undefined);
        }}
        reminder={activeReminder}
        categories={categories}
        defaultCategoryId={defaultCategoryIdForNewReminder}
        directDebits={moneyState.directDebits}
        extraIncomes={moneyState.extraIncomeList}
        contacts={contacts}
        notificationSettings={notificationSettings}
        notificationHistory={notificationHistory}
        onSave={handleSaveReminder}
        onDelete={handleDeleteReminder}
        onToggleComplete={handleReminderCompleteToggle}
      />

      <CategoryModal
        isOpen={categoryModalOpen}
        onClose={() => {
          setCategoryModalOpen(false);
          setActiveCategory(null);
          setNewCategoryParentId(null);
        }}
        category={activeCategory}
        categories={categories}
        parentCategoryId={activeCategory?.parentCategoryId ?? newCategoryParentId}
        onSave={handleSaveCategory}
        onDelete={handleDeleteCategory}
      />

      <CategoryActionsSheet
        category={categoryActionsCategory}
        isOpen={Boolean(categoryActionsCategory)}
        onClose={() => setCategoryActionsCategory(null)}
        onAddReminder={(catId) => {
          setDefaultCategoryIdForNewReminder(catId);
          setActiveReminder(null);
          setReminderModalOpen(true);
        }}
        onEditCategory={(cat) => {
          setActiveCategory(cat);
          setCategoryModalOpen(true);
        }}
        onAddSubcategory={(parentCategoryId) => {
          setActiveCategory(null);
          setNewCategoryParentId(parentCategoryId);
          setCategoryModalOpen(true);
        }}
        onDeleteCategory={handleDeleteCategory}
        onUnfocus={() => setFocusedCategoryId(null)}
      />

      <QuickAddModal
        isOpen={quickAddOpen}
        onClose={() => setQuickAddOpen(false)}
        focusedCategory={focusedCategory}
        onSelectAddReminder={(preselectedCatId) => {
          setDefaultCategoryIdForNewReminder(preselectedCatId || focusedCategoryId || categories[0]?.id);
          setActiveReminder(null);
          setReminderModalOpen(true);
        }}
        onSelectAddCategory={() => {
          setActiveCategory(null);
          setNewCategoryParentId(null);
          setCategoryModalOpen(true);
        }}
      />

      <SettingsBackupModal
        isOpen={backupModalOpen}
        onClose={() => setBackupModalOpen(false)}
        onRestoreComplete={handleReloadAllPersistedState}
        onResetComplete={handleReloadAllPersistedState}
      />

      <AppearanceModal
        isOpen={appearanceModalOpen}
        onClose={() => setAppearanceModalOpen(false)}
        appearance={appearance}
        onChange={setAppearance}
      />

      <NotificationsModal
        isOpen={notificationsModalOpen}
        onClose={() => setNotificationsModalOpen(false)}
        settings={notificationSettings}
        onChange={setNotificationSettings}
        history={notificationHistory}
        onChangeHistory={setNotificationHistory}
        onOpenReminder={(remId) => {
          setNotificationsModalOpen(false);
          handleOpenReminderById(remId);
        }}
        onOpenDiagnostics={() => {
          setNotificationsModalOpen(false);
          setDiagnosticsModalOpen(true);
        }}
      />

      <DiagnosticsModal
        isOpen={diagnosticsModalOpen}
        onClose={() => setDiagnosticsModalOpen(false)}
        startupNotice={startupNotice ?? undefined}
        onOpenBackup={() => {
          setDiagnosticsModalOpen(false);
          setBackupModalOpen(true);
        }}
      />
    </div>
  );
}

export default function App() {
  return (
    <ReactFlowProvider>
      <MindMeshFlow />
    </ReactFlowProvider>
  );
}
