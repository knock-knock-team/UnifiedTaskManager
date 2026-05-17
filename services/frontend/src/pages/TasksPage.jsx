import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, requestWithMeta, storage } from '../lib/api';
import { etagFromVersion } from '../lib/boardMerge';
import { rememberColumn, rememberColumns, rememberTasks, updateTaskVersion } from '../lib/taskVersions';
import {
  applyBoardEventToColumns,
  applyBoardEventToTasks,
  applyBoardSnapshot,
  patchTask,
  reorderColumns,
  reorderTasksInColumn
} from '../lib/tasksBoardApi';
import { useBoardSync } from '../hooks/useBoardSync';
import { BoardPresence } from '../components/BoardPresence';
import { TaskConflictDialog } from '../components/TaskConflictDialog';
import { formatDateTimeLocal, parseDateTimeLocal } from '../lib/date';
import {
  BASIC_PROJECT_PERMISSION_KEYS,
  BASIC_TEAM_PERMISSION_KEYS,
  PROJECT_PERMISSION_OPTIONS,
  TEAM_PERMISSION_OPTIONS,
  priorityLabel,
  statusLabel
} from '../lib/tasks';
import { buildTasksCsv, buildTasksJson, downloadBlob } from '../lib/taskExport';
import { TaskMindMapPanel } from '../components/TaskMindMapPanel';
import {
  buildAssigneesPayload,
  formatAssigneesDisplay,
  hasTaskAssignees,
  parseTagsInput,
  tagsInputFromTask,
  taskAssigneesList
} from '../lib/taskAssignees';

export function TasksPage({ accessToken, apiBase, taskApiBase, profile, showNotification, onUpdateAccessToken }) {
  const navigate = useNavigate();
  const [teams, setTeams] = useState([]);
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [columns, setColumns] = useState([]);
  const [selectedTeamId, setSelectedTeamId] = useState(storage.taskTeamId);
  const [selectedProjectId, setSelectedProjectId] = useState(storage.taskProjectId);
  const [teamName, setTeamName] = useState('');
  const [projectName, setProjectName] = useState('');
  const [columnTitle, setColumnTitle] = useState('');
  const [taskForm, setTaskForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    dueAt: '',
    columnId: '',
    assigneeUserIds: [],
    tags: ''
  });
  const [editorTask, setEditorTask] = useState(null);
  const [editorTaskForm, setEditorTaskForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    dueAt: '',
    columnId: '',
    assigneeUserIds: [],
    tags: ''
  });
  const [pendingInvites, setPendingInvites] = useState([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRoleKey, setInviteRoleKey] = useState('member');
  const [teamRoles, setTeamRoles] = useState([]);
  const [teamMembers, setTeamMembers] = useState([]);
  const [projectRoles, setProjectRoles] = useState([]);
  const [projectMembers, setProjectMembers] = useState([]);
  const [selectedTeamMemberUserId, setSelectedTeamMemberUserId] = useState('');
  const [selectedTeamMemberRoleKey, setSelectedTeamMemberRoleKey] = useState('member');
  const [selectedProjectMemberUserId, setSelectedProjectMemberUserId] = useState('');
  const [selectedProjectMemberRoleKey, setSelectedProjectMemberRoleKey] = useState('member');
  const [newTeamRoleKey, setNewTeamRoleKey] = useState('');
  const [newTeamRoleName, setNewTeamRoleName] = useState('');
  const [newTeamRolePermissions, setNewTeamRolePermissions] = useState([]);
  const [showAdvancedTeamPermissions, setShowAdvancedTeamPermissions] = useState(false);
  const [newProjectRoleKey, setNewProjectRoleKey] = useState('');
  const [newProjectRoleName, setNewProjectRoleName] = useState('');
  const [newProjectRolePermissions, setNewProjectRolePermissions] = useState([]);
  const [showAdvancedProjectPermissions, setShowAdvancedProjectPermissions] = useState(false);
  const [taskComments, setTaskComments] = useState([]);
  const [projectActivity, setProjectActivity] = useState([]);
  const [taskHistory, setTaskHistory] = useState([]);
  const [commentDraft, setCommentDraft] = useState('');
  const [isLoadingComments, setIsLoadingComments] = useState(false);
  const [isLoadingActivity, setIsLoadingActivity] = useState(false);
  const [isLoadingTaskHistory, setIsLoadingTaskHistory] = useState(false);
  const [isSavingComment, setIsSavingComment] = useState(false);
  const [inlineEditTaskId, setInlineEditTaskId] = useState('');
  const [inlineEditTitle, setInlineEditTitle] = useState('');
  const [isLoadingTeams, setIsLoadingTeams] = useState(false);
  const [isLoadingProjects, setIsLoadingProjects] = useState(false);
  const [isLoadingTasks, setIsLoadingTasks] = useState(false);
  const [isSavingTask, setIsSavingTask] = useState(false);
  const [pendingNotificationTaskId, setPendingNotificationTaskId] = useState('');
  const [deadlineSettings, setDeadlineSettings] = useState({
    notifyBeforeMinutes: 1440,
    urgentBeforeMinutes: 120
  });
  const [deadlineSettingsForm, setDeadlineSettingsForm] = useState({
    notifyBeforeMinutes: '1440',
    urgentBeforeMinutes: '120'
  });
  const [isLoadingDeadlineSettings, setIsLoadingDeadlineSettings] = useState(false);
  const [isSavingDeadlineSettings, setIsSavingDeadlineSettings] = useState(false);
  const [isGeneratingTaskContent, setIsGeneratingTaskContent] = useState(false);
  const [taskSuggestion, setTaskSuggestion] = useState(null);
  const [editorTaskSuggestion, setEditorTaskSuggestion] = useState(null);
  const [draggingTaskId, setDraggingTaskId] = useState('');
  const [draggingColumnId, setDraggingColumnId] = useState('');
  const [dragOverColumnId, setDragOverColumnId] = useState('');
  const [columnDropPosition, setColumnDropPosition] = useState('before');
  const [dragOverTaskColumnId, setDragOverTaskColumnId] = useState('');
  const [dragOverTaskId, setDragOverTaskId] = useState('');
  const [taskDropPosition, setTaskDropPosition] = useState('before');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterColumnIds, setFilterColumnIds] = useState(new Set());
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [lastReorderNotificationTime, setLastReorderNotificationTime] = useState(0);
  const [memberDirectory, setMemberDirectory] = useState({});
  const [selectedMemberStatsUserId, setSelectedMemberStatsUserId] = useState('');
  const [openTaskMenuTaskId, setOpenTaskMenuTaskId] = useState('');
  const [taskBoardView, setTaskBoardView] = useState(() => localStorage.getItem('taskBoardView') || 'board');
  const [boardConnected, setBoardConnected] = useState(false);
  const [taskConflict, setTaskConflict] = useState(null);
  const [confirmDialog, setConfirmDialog] = useState(null);
  const editorBaseTaskRef = useRef(null);
  const editorDirtyRef = useRef(false);
  const confirmResolverRef = useRef(null);
  const [calendarCursor, setCalendarCursor] = useState(() => new Date());

  const formatNotificationError = useCallback((error, fallbackMessage) => {
    const message = String(error?.message || '').trim();
    const lower = message.toLowerCase();
    if (!message) return fallbackMessage;
    if (lower.includes('dependency unavailable')) {
      return 'Сервис уведомлений сейчас недоступен.';
    }
    if (lower.includes('deadline is not set')) {
      return 'У задачи не указан дедлайн.';
    }
    if (lower.includes('assignee is not set')) {
      return 'У задачи не назначен исполнитель.';
    }
    if (lower.includes('assignee email was not found') || lower.includes('assignee email is empty')) {
      return 'У исполнителя не заполнен email, уведомление отправить нельзя.';
    }
    if (
      lower.includes('smtp host is not configured')
      || lower.includes('smtp username is not configured')
      || lower.includes('smtp password is not configured')
      || lower.includes('username and password not accepted')
      || lower.includes('authentication failed')
      || lower.includes('smtp')
    ) {
      return 'Почтовый сервис уведомлений не настроен.';
    }
    if (lower.includes('task is already done')) {
      return 'Для выполненной задачи уведомление не отправляется.';
    }
    return message || fallbackMessage;
  }, []);

  const closeConfirmDialog = useCallback((result) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmDialog(null);
    resolver?.(result);
  }, []);

  const requestConfirm = useCallback((options) => new Promise((resolve) => {
    confirmResolverRef.current?.(false);
    confirmResolverRef.current = resolve;
    setConfirmDialog({
      title: options?.title || 'Подтвердите действие',
      message: options?.message || 'Это действие нельзя отменить.',
      confirmLabel: options?.confirmLabel || 'Подтвердить',
      cancelLabel: options?.cancelLabel || 'Отмена',
      tone: options?.tone || 'danger'
    });
  }), []);

  // Загрузить поиск из localStorage (был сохранён ранее)
  useEffect(() => {
    const saved = localStorage.getItem('taskBoardSearchQuery');
    if (saved) {
      setSearchQuery(saved);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem('taskBoardView', taskBoardView);
  }, [taskBoardView]);

  const areColumnOrdersEqual = useCallback((left, right) => {
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      if (left[index]?.id !== right[index]?.id) {
        return false;
      }
    }
    return true;
  }, []);

  const shouldShowReorderNotification = useCallback(() => {
    const now = Date.now();
    if (now - lastReorderNotificationTime > 2000) {
      setLastReorderNotificationTime(now);
      return true;
    }
    return false;
  }, [lastReorderNotificationTime]);

  const activeTeam = useMemo(() => teams.find((item) => item.id === selectedTeamId) || null, [teams, selectedTeamId]);
  const activeProject = useMemo(() => projects.find((item) => item.id === selectedProjectId) || null, [projects, selectedProjectId]);
  const canManageDeadlineSettings = useMemo(() => {
    const userId = String(profile?.id || '').trim();
    if (!userId) return false;
    if (profile?.role === 'admin') return true;
    if (String(activeTeam?.createdBy || '').trim() === userId) return true;
    if (String(activeProject?.createdBy || '').trim() === userId) return true;
    const teamRole = teamMembers.find((item) => String(item?.userId || '').trim() === userId)?.roleKey || '';
    if (teamRole === 'owner' || teamRole === 'admin') return true;
    const projectRole = projectMembers.find((item) => String(item?.userId || '').trim() === userId)?.roleKey || '';
    return projectRole === 'owner' || projectRole === 'admin';
  }, [activeProject, activeTeam, profile, projectMembers, teamMembers]);
  const lookupUserById = useCallback(async (userId) => {
    const id = String(userId || '').trim();
    if (!id) return null;
    const data = await request(apiBase, accessToken, `/v1/users/lookup?id=${encodeURIComponent(id)}`, { auth: true }, onUpdateAccessToken);
    return data || null;
  }, [accessToken, apiBase, onUpdateAccessToken]);

  const assigneeOptions = useMemo(() => {
    const byUserID = new Map();
    const collect = (items) => {
      for (const item of items) {
        const userId = String(item?.userId || '').trim();
        if (!userId || byUserID.has(userId)) {
          continue;
        }
        const profileItem = memberDirectory[userId] || {};
        const displayName = String(
          profileItem?.name || profileItem?.tag || item?.name || item?.fullName || item?.email || userId
        ).trim() || userId;
        byUserID.set(userId, { userId, displayName });
      }
    };
    collect(projectMembers);
    collect(teamMembers);
    return Array.from(byUserID.values());
  }, [teamMembers, projectMembers, memberDirectory]);

  const assigneeLabelById = useMemo(() => {
    const map = new Map();
    assigneeOptions.forEach((item) => map.set(item.userId, item.displayName));
    return map;
  }, [assigneeOptions]);

  const userLabelById = useMemo(() => {
    const map = new Map();
    if (profile?.id) {
      map.set(profile.id, profile.name || profile.email || profile.id);
    }
    Object.entries(memberDirectory).forEach(([id, user]) => {
      map.set(id, user?.name || user?.email || user?.tag || id);
    });
    assigneeOptions.forEach((item) => map.set(item.userId, item.displayName));
    return map;
  }, [assigneeOptions, memberDirectory, profile]);

  const actorLabel = useCallback((actorUserId) => {
    const id = String(actorUserId || '').trim();
    if (!id) return 'Система';
    return userLabelById.get(id) || id;
  }, [userLabelById]);

  const formatActivityTime = useCallback((value) => {
    if (!value) return '';
    return new Date(value).toLocaleString();
  }, []);

  const changeLabels = useMemo(() => ({
    title: 'Название',
    description: 'Описание',
    status: 'Колонка',
    priority: 'Приоритет',
    dueAt: 'Срок',
    assignees: 'Исполнители',
    tags: 'Теги',
    completed: 'Готовность'
  }), []);

  const activityChangeLabels = useCallback((event) => {
    const changes = event?.metadata?.changes;
    if (!changes || typeof changes !== 'object') return [];
    return Object.keys(changes).map((key) => changeLabels[key] || key);
  }, [changeLabels]);

  const shouldRefreshActivityForBoardEvent = useCallback((event) => {
    return [
      'task.created',
      'task.updated',
      'task.deleted',
      'tasks.reordered',
      'task.comment.added',
      'column.created',
      'column.updated',
      'column.deleted',
      'columns.reordered'
    ].includes(event?.type);
  }, []);

  const visibleTeamPermissionOptions = useMemo(() => {
    if (showAdvancedTeamPermissions) {
      return TEAM_PERMISSION_OPTIONS;
    }
    return TEAM_PERMISSION_OPTIONS.filter((option) => BASIC_TEAM_PERMISSION_KEYS.includes(option.key));
  }, [showAdvancedTeamPermissions]);

  const visibleProjectPermissionOptions = useMemo(() => {
    if (showAdvancedProjectPermissions) {
      return PROJECT_PERMISSION_OPTIONS;
    }
    return PROJECT_PERMISSION_OPTIONS.filter((option) => BASIC_PROJECT_PERMISSION_KEYS.includes(option.key));
  }, [showAdvancedProjectPermissions]);

  const boardColumns = useMemo(() => {
    const known = new Set(columns.map((column) => column.id));
    const imported = [];
    for (const task of tasks) {
      const status = String(task.status || '').trim();
      if (!status || known.has(status)) {
        continue;
      }
      known.add(status);
      imported.push({ id: status, title: statusLabel(status), locked: true });
    }
    return [...columns, ...imported];
  }, [columns, tasks]);

  useEffect(() => {
    if (!accessToken) {
      setMemberDirectory({});
      return;
    }
    const ids = new Set();
    [...teamMembers, ...projectMembers].forEach((item) => {
      const id = String(item?.userId || '').trim();
      if (id && !memberDirectory[id]) {
        ids.add(id);
      }
    });
    if (ids.size === 0) return;

    let cancelled = false;
    const fetchUsers = async () => {
      const pairs = await Promise.all(Array.from(ids).map(async (id) => {
        try {
          const user = await lookupUserById(id);
          return user?.id ? [user.id, user] : null;
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      setMemberDirectory((prev) => {
        const next = { ...prev };
        pairs.forEach((pair) => {
          if (pair) {
            const [id, user] = pair;
            next[id] = user;
          }
        });
        return next;
      });
    };

    void fetchUsers();
    return () => {
      cancelled = true;
    };
  }, [accessToken, lookupUserById, memberDirectory, projectMembers, teamMembers]);

  const filteredTasks = useMemo(() => {
    let result = tasks;
    
    // Фильтр по поиску
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((task) => {
        const titleMatch = (task.title || '').toLowerCase().includes(query);
        const descriptionMatch = (task.description || '').toLowerCase().includes(query);
        const tagMatch = Array.isArray(task.tags) && task.tags.some((tag) => (tag || '').toLowerCase().includes(query));
        const assigneeMatch = taskAssigneesList(task).some((a) => {
          const label = (a.displayName || assigneeLabelById.get(a.userId) || a.userId || '').toLowerCase();
          return label.includes(query);
        });
        return titleMatch || descriptionMatch || tagMatch || assigneeMatch;
      });
    }
    
    // Фильтр по статусам (колонкам)
    if (filterColumnIds.size > 0) {
      result = result.filter((task) => {
        const status = String(task.status || '').trim();
        return filterColumnIds.has(status);
      });
    }
    
    return result;
  }, [assigneeLabelById, tasks, searchQuery, filterColumnIds]);

  const tasksByColumn = useMemo(() => {
    const map = {};
    for (const column of boardColumns) {
      map[column.id] = [];
    }
    for (const task of filteredTasks) {
      const status = String(task.status || '').trim();
      if (!status) continue;
      if (!map[status]) {
        map[status] = [];
      }
      map[status].push(task);
    }
    const sortInColumn = (a, b) => {
      const pa = Number(a.sortPosition ?? 0);
      const pb = Number(b.sortPosition ?? 0);
      if (pa !== pb) return pa - pb;
      const da = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const db = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return db - da;
    };
    Object.keys(map).forEach((key) => {
      map[key].sort(sortInColumn);
    });
    return map;
  }, [boardColumns, filteredTasks]);

  const columnTitleById = useMemo(() => {
    const map = new Map();
    boardColumns.forEach((col) => map.set(col.id, col.title || col.id));
    return map;
  }, [boardColumns]);

  const listSortedTasks = useMemo(() => {
    const list = [...filteredTasks];
    list.sort((a, b) => {
      const da = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
      const db = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
      if (da !== db) return da - db;
      return String(a.title || '').localeCompare(String(b.title || ''), 'ru');
    });
    return list;
  }, [filteredTasks]);

  const calendarMonthLabel = useMemo(
    () => calendarCursor.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }),
    [calendarCursor]
  );

  const calendarCells = useMemo(() => {
    const y = calendarCursor.getFullYear();
    const m = calendarCursor.getMonth();
    const monthStart = new Date(y, m, 1);
    const startWeekday = monthStart.getDay();
    const mondayOffset = (startWeekday + 6) % 7;
    const gridStart = new Date(monthStart);
    gridStart.setDate(monthStart.getDate() - mondayOffset);
    const cells = [];
    for (let i = 0; i < 42; i += 1) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const inMonth = d.getMonth() === m;
      const dayTasks = filteredTasks.filter((task) => {
        if (!task.dueAt) return false;
        const t = new Date(task.dueAt);
        const tiso = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
        return tiso === iso;
      });
      cells.push({ date: d, iso, inMonth, tasks: dayTasks });
    }
    return cells;
  }, [calendarCursor, filteredTasks]);

  const exportFileSlug = useMemo(() => {
    const raw = (activeProject?.name || activeProject?.title || selectedProjectId || 'project').toString();
    return raw.replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '').slice(0, 64) || 'project';
  }, [activeProject, selectedProjectId]);

  const handleExportCsv = useCallback(() => {
    if (!filteredTasks.length) {
      showNotification('Нет задач для экспорта', 'error');
      return;
    }
    const csv = buildTasksCsv(filteredTasks, columnTitleById);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBlob(`tasks-${exportFileSlug}-${stamp}.csv`, csv, 'text/csv;charset=utf-8', true);
    showNotification('CSV сохранён', 'success');
  }, [columnTitleById, exportFileSlug, filteredTasks, showNotification]);

  const handleExportJson = useCallback(() => {
    if (!filteredTasks.length) {
      showNotification('Нет задач для экспорта', 'error');
      return;
    }
    const json = buildTasksJson(filteredTasks, {
      teamId: selectedTeamId,
      projectId: selectedProjectId,
      teamName: activeTeam?.name,
      projectName: activeProject?.name || activeProject?.title
    });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadBlob(`tasks-${exportFileSlug}-${stamp}.json`, json, 'application/json;charset=utf-8', false);
    showNotification('JSON сохранён', 'success');
  }, [activeProject, activeTeam, exportFileSlug, filteredTasks, selectedProjectId, selectedTeamId, showNotification]);

  const isTaskDone = useCallback((task) => {
    if (!task) return false;
    if (task.completedAt) return true;
    return String(task.status || '').trim() === 'done';
  }, []);

  const isTaskOverdue = useCallback((task) => {
    if (!task?.dueAt || isTaskDone(task)) return false;
    const dueAtTime = new Date(task.dueAt).getTime();
    if (!Number.isFinite(dueAtTime)) return false;
    return dueAtTime < Date.now();
  }, [isTaskDone]);

  const memberStats = useMemo(() => {
    const byUserId = new Map();

    const ensureMember = (userId, fallbackName = '') => {
      const normalizedUserId = String(userId || '').trim();
      if (!normalizedUserId) return null;
      if (!byUserId.has(normalizedUserId)) {
        const profileItem = memberDirectory[normalizedUserId] || {};
        const displayName = String(
          profileItem?.name || profileItem?.tag || fallbackName || normalizedUserId
        ).trim() || normalizedUserId;
        byUserId.set(normalizedUserId, {
          userId: normalizedUserId,
          displayName,
          assignedCount: 0,
          completedCount: 0,
          overdueCount: 0,
          activeCount: 0,
          completedTasks: [],
          overdueTasks: [],
          activeTasks: []
        });
      }
      return byUserId.get(normalizedUserId);
    };

    assigneeOptions.forEach((member) => {
      ensureMember(member.userId, member.displayName);
    });

    tasks.forEach((task) => {
      const assigneeRows = taskAssigneesList(task);
      if (!assigneeRows.length) return;
      for (const row of assigneeRows) {
        const assigneeUserId = String(row.userId || '').trim();
        if (!assigneeUserId) continue;
        const member = ensureMember(
          assigneeUserId,
          row.displayName || task.assigneeName || assigneeLabelById.get(assigneeUserId) || assigneeUserId
        );
        if (!member) continue;
        member.assignedCount += 1;
        if (isTaskDone(task)) {
          member.completedCount += 1;
          member.completedTasks.push(task);
          continue;
        }
        if (isTaskOverdue(task)) {
          member.overdueCount += 1;
          member.overdueTasks.push(task);
          continue;
        }
        member.activeCount += 1;
        member.activeTasks.push(task);
      }
    });

    return Array.from(byUserId.values()).sort((left, right) => left.displayName.localeCompare(right.displayName));
  }, [assigneeLabelById, assigneeOptions, isTaskDone, isTaskOverdue, memberDirectory, tasks]);

  const selectedMemberStats = useMemo(
    () => memberStats.find((item) => item.userId === selectedMemberStatsUserId) || null,
    [memberStats, selectedMemberStatsUserId]
  );
  const selectedMemberCompletionRate = useMemo(() => {
    if (!selectedMemberStats || selectedMemberStats.assignedCount === 0) return 0;
    return Math.round((selectedMemberStats.completedCount / selectedMemberStats.assignedCount) * 100);
  }, [selectedMemberStats]);

  const isUrgentDeadline = useCallback((task) => {
    if (!task?.dueAt || isTaskDone(task)) return false;
    const dueTime = new Date(task.dueAt).getTime();
    if (!Number.isFinite(dueTime)) return false;
    const minutesLeft = (dueTime - Date.now()) / 60000;
    return minutesLeft >= 0 && minutesLeft <= Number(deadlineSettings.urgentBeforeMinutes || 0);
  }, [deadlineSettings.urgentBeforeMinutes, isTaskDone]);

  const resetTaskForm = useCallback((nextColumnId = '') => {
    setTaskForm({
      title: '',
      description: '',
      priority: 'medium',
      dueAt: '',
      columnId: nextColumnId || boardColumns[0]?.id || '',
      assigneeUserIds: [],
      tags: ''
    });
    setTaskSuggestion(null);
  }, [boardColumns]);

  const closeTaskEditor = useCallback(() => {
    setEditorTask(null);
    setEditorTaskForm({
      title: '',
      description: '',
      priority: 'medium',
      dueAt: '',
      columnId: '',
      assigneeUserIds: [],
      tags: ''
    });
    setEditorTaskSuggestion(null);
    setTaskComments([]);
    setCommentDraft('');
    setIsLoadingComments(false);
    setIsSavingComment(false);
  }, []);

  const loadTeams = useCallback(async () => {
    if (!accessToken) return;
    setIsLoadingTeams(true);
    try {
      const data = await request(apiBase, accessToken, '/v1/teams', { auth: true }, onUpdateAccessToken);
      const items = Array.isArray(data.items) ? data.items : [];
      setTeams(items);
      const preferred = storage.taskTeamId && items.some((item) => item.id === storage.taskTeamId)
        ? storage.taskTeamId
        : (items[0]?.id || '');
      setSelectedTeamId(preferred);
      storage.taskTeamId = preferred;
      if (!preferred) {
        setProjects([]);
        setSelectedProjectId('');
        setTasks([]);
        setColumns([]);
      }
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить команды', 'error');
    } finally {
      setIsLoadingTeams(false);
    }
  }, [accessToken, apiBase, onUpdateAccessToken, showNotification]);

  const loadPendingInvites = useCallback(async () => {
    if (!accessToken) return;
    try {
      const data = await request(apiBase, accessToken, '/v1/teams/invites', { auth: true }, onUpdateAccessToken);
      setPendingInvites(Array.isArray(data.items) ? data.items : []);
    } catch {
      setPendingInvites([]);
    }
  }, [accessToken, apiBase, onUpdateAccessToken]);

  const loadTeamDirectory = useCallback(async (teamId) => {
    if (!accessToken || !teamId) {
      setTeamRoles([]);
      setTeamMembers([]);
      return;
    }
    try {
      const data = await request(apiBase, accessToken, `/v1/teams/${teamId}`, { auth: true }, onUpdateAccessToken);
      setTeamRoles(Array.isArray(data.roles) ? data.roles : []);
      setTeamMembers(Array.isArray(data.members) ? data.members : []);
    } catch {
      setTeamRoles([]);
      setTeamMembers([]);
    }
  }, [accessToken, apiBase, onUpdateAccessToken]);

  const loadProjectDirectory = useCallback(async (teamId, projectId) => {
    if (!accessToken || !teamId || !projectId) {
      setProjectRoles([]);
      setProjectMembers([]);
      return;
    }
    try {
      const data = await request(apiBase, accessToken, `/v1/teams/${teamId}/projects/${projectId}`, { auth: true }, onUpdateAccessToken);
      setProjectRoles(Array.isArray(data.roles) ? data.roles : []);
      setProjectMembers(Array.isArray(data.members) ? data.members : []);
    } catch {
      setProjectRoles([]);
      setProjectMembers([]);
    }
  }, [accessToken, apiBase, onUpdateAccessToken]);

  const toggleTeamPermission = (permission) => {
    setNewTeamRolePermissions((prev) => (prev.includes(permission)
      ? prev.filter((item) => item !== permission)
      : [...prev, permission]));
  };

  const toggleProjectPermission = (permission) => {
    setNewProjectRolePermissions((prev) => (prev.includes(permission)
      ? prev.filter((item) => item !== permission)
      : [...prev, permission]));
  };

  const loadProjects = useCallback(async (teamId) => {
    if (!accessToken || !teamId) return;
    setIsLoadingProjects(true);
    try {
      const data = await request(apiBase, accessToken, `/v1/teams/${teamId}/projects`, { auth: true }, onUpdateAccessToken);
      const items = Array.isArray(data.items) ? data.items : [];
      setProjects(items);
      const preferred = storage.taskProjectId && items.some((item) => item.id === storage.taskProjectId)
        ? storage.taskProjectId
        : (items[0]?.id || '');
      setSelectedProjectId(preferred);
      storage.taskProjectId = preferred;
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить проекты', 'error');
    } finally {
      setIsLoadingProjects(false);
    }
  }, [accessToken, apiBase, onUpdateAccessToken, showNotification]);

  const loadTasks = useCallback(async (teamId, projectId) => {
    if (!accessToken || !teamId || !projectId) return;
    setIsLoadingTasks(true);
    try {
      const data = await request(
        taskApiBase,
        accessToken,
        `/v1/tasks?projectId=${encodeURIComponent(projectId)}&limit=200`,
        { auth: true, headers: { 'X-Team-Id': teamId } },
        onUpdateAccessToken
      );
      const items = Array.isArray(data.items) ? data.items : [];
      setTasks(items);
      rememberTasks(items);
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить задачи', 'error');
    } finally {
      setIsLoadingTasks(false);
    }
  }, [accessToken, onUpdateAccessToken, showNotification, taskApiBase]);

  const loadColumns = useCallback(async (teamId, projectId) => {
    if (!accessToken || !teamId || !projectId) return;
    try {
      const data = await request(
        taskApiBase,
        accessToken,
        `/v1/task-columns?projectId=${encodeURIComponent(projectId)}`,
        { auth: true, headers: { 'X-Team-Id': teamId } },
        onUpdateAccessToken
      );
      const items = Array.isArray(data.items) ? data.items : [];
      setColumns(items);
      rememberColumns(items);
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить колонки', 'error');
      setColumns([]);
    }
  }, [accessToken, onUpdateAccessToken, showNotification, taskApiBase]);

  const loadProjectActivity = useCallback(async (teamId, projectId, options = {}) => {
    if (!accessToken || !teamId || !projectId) return;
    const silent = Boolean(options.silent);
    if (!silent) {
      setIsLoadingActivity(true);
    }
    try {
      const data = await request(
        taskApiBase,
        accessToken,
        `/v1/task-activity?projectId=${encodeURIComponent(projectId)}&limit=40`,
        { auth: true, headers: { 'X-Team-Id': teamId } },
        onUpdateAccessToken
      );
      setProjectActivity(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить активность', 'error');
    } finally {
      if (!silent) {
        setIsLoadingActivity(false);
      }
    }
  }, [accessToken, onUpdateAccessToken, showNotification, taskApiBase]);

  const loadTaskHistory = useCallback(async (taskId, options = {}) => {
    if (!accessToken || !taskId || !selectedTeamId) return;
    const silent = Boolean(options.silent);
    if (!silent) {
      setIsLoadingTaskHistory(true);
    }
    try {
      const data = await request(
        taskApiBase,
        accessToken,
        `/v1/tasks/${encodeURIComponent(taskId)}/history?limit=40`,
        { auth: true, headers: { 'X-Team-Id': selectedTeamId } },
        onUpdateAccessToken
      );
      setTaskHistory(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить историю задачи', 'error');
    } finally {
      if (!silent) {
        setIsLoadingTaskHistory(false);
      }
    }
  }, [accessToken, onUpdateAccessToken, selectedTeamId, showNotification, taskApiBase]);

  const resyncBoard = useCallback(() => {
    if (!selectedTeamId || !selectedProjectId) return;
    void loadColumns(selectedTeamId, selectedProjectId);
    void loadTasks(selectedTeamId, selectedProjectId);
    void loadProjectActivity(selectedTeamId, selectedProjectId);
  }, [loadColumns, loadProjectActivity, loadTasks, selectedProjectId, selectedTeamId]);

  const handleBoardEvent = useCallback((event) => {
    if (!event?.type) return;
    if (event.type === 'board.snapshot') {
      applyBoardSnapshot(setTasks, setColumns, event);
      if (selectedTeamId && selectedProjectId) {
        void loadProjectActivity(selectedTeamId, selectedProjectId, { silent: true });
      }
      return;
    }
    applyBoardEventToTasks(setTasks, event, {
      currentUserId: profile?.id || '',
      onRemoteTaskUpdate: (remoteTask) => {
        if (editorTask?.id !== remoteTask.id) {
          return;
        }
        if (editorDirtyRef.current) {
          showNotification('Коллега изменил открытую задачу. Сохраните или закройте карточку, чтобы увидеть актуальную версию.', 'error');
          return;
        }
        setEditorTask(remoteTask);
        editorBaseTaskRef.current = remoteTask;
        setEditorTaskForm({
          title: remoteTask.title || '',
          description: remoteTask.description || '',
          priority: remoteTask.priority || 'medium',
          dueAt: formatDateTimeLocal(remoteTask.dueAt),
          columnId: String(remoteTask.status || '').trim(),
          assigneeUserIds: taskAssigneesList(remoteTask).map((a) => a.userId),
          tags: tagsInputFromTask(remoteTask.tags)
        });
      }
    });
    applyBoardEventToColumns(setColumns, event, profile?.id || '');
    if (shouldRefreshActivityForBoardEvent(event)) {
      void loadProjectActivity(selectedTeamId, selectedProjectId, { silent: true });
      if (editorTask?.id && (event.taskId === editorTask.id || event.task?.id === editorTask.id)) {
        void loadTaskHistory(editorTask.id, { silent: true });
      }
    }
  }, [editorTask?.id, loadProjectActivity, loadTaskHistory, profile?.id, selectedProjectId, selectedTeamId, shouldRefreshActivityForBoardEvent, showNotification]);

  useBoardSync({
    apiBase: taskApiBase,
    accessToken,
    teamId: selectedTeamId,
    projectId: selectedProjectId,
    displayName: (profile?.name || profile?.email || '').trim(),
    enabled: Boolean(accessToken && selectedTeamId && selectedProjectId),
    onEvent: handleBoardEvent,
    onResync: resyncBoard,
    onConnectionChange: setBoardConnected
  });

  const applyTaskPatch = useCallback(async (taskId, baseTask, patch) => {
    if (!selectedTeamId) return null;
    const result = await patchTask({
      taskApiBase,
      accessToken,
      teamId: selectedTeamId,
      taskId,
      baseTask,
      patch,
      onTokenRefresh: onUpdateAccessToken,
      onConflict: (details) => setTaskConflict({ ...details, taskId })
    });
    if (result.conflict) {
      return null;
    }
    setTasks((prev) => prev.map((item) => (item.id === result.task.id ? { ...item, ...result.task } : item)));
    if (editorTask?.id === result.task.id) {
      setEditorTask(result.task);
      editorBaseTaskRef.current = result.task;
    }
    return result.task;
  }, [accessToken, editorTask?.id, onUpdateAccessToken, selectedTeamId, taskApiBase]);

  const loadTaskComments = useCallback(async (taskId) => {
    if (!accessToken || !taskId || !selectedTeamId) return;
    setIsLoadingComments(true);
    try {
      const data = await request(
        taskApiBase,
        accessToken,
        `/v1/tasks/${encodeURIComponent(taskId)}/comments`,
        { auth: true, headers: { 'X-Team-Id': selectedTeamId } },
        onUpdateAccessToken
      );
      setTaskComments(Array.isArray(data.items) ? data.items : []);
      try {
        await request(
          taskApiBase,
          accessToken,
          `/v1/tasks/${encodeURIComponent(taskId)}/comments/read`,
          {
            method: 'POST',
            auth: true,
            headers: { 'X-Team-Id': selectedTeamId }
          },
          onUpdateAccessToken
        );
      } catch {
        // Ignore read marker errors so the thread still opens.
      }
      setTasks((prev) => prev.map((item) => (
        item.id === taskId ? { ...item, unreadComments: 0 } : item
      )));
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить переписку', 'error');
    } finally {
      setIsLoadingComments(false);
    }
  }, [accessToken, onUpdateAccessToken, selectedTeamId, showNotification, taskApiBase]);

  const loadDeadlineSettings = useCallback(async (teamId, projectId) => {
    if (!accessToken || !teamId || !projectId) return;
    setIsLoadingDeadlineSettings(true);
    try {
      const data = await request(
        apiBase,
        accessToken,
        `/v1/projects/${encodeURIComponent(projectId)}/notification-settings`,
        { auth: true, headers: { 'X-Team-Id': teamId } },
        onUpdateAccessToken
      );
      const next = {
        notifyBeforeMinutes: Number(data.notifyBeforeMinutes || 1440),
        urgentBeforeMinutes: Number(data.urgentBeforeMinutes || 120)
      };
      setDeadlineSettings(next);
      setDeadlineSettingsForm({
        notifyBeforeMinutes: String(next.notifyBeforeMinutes),
        urgentBeforeMinutes: String(next.urgentBeforeMinutes)
      });
    } catch {
      const fallback = { notifyBeforeMinutes: 1440, urgentBeforeMinutes: 120 };
      setDeadlineSettings(fallback);
      setDeadlineSettingsForm({
        notifyBeforeMinutes: String(fallback.notifyBeforeMinutes),
        urgentBeforeMinutes: String(fallback.urgentBeforeMinutes)
      });
    } finally {
      setIsLoadingDeadlineSettings(false);
    }
  }, [accessToken, apiBase, onUpdateAccessToken]);

  useEffect(() => {
    void loadTeams();
    void loadPendingInvites();
  }, [loadPendingInvites, loadTeams]);

  useEffect(() => {
    storage.taskTeamId = selectedTeamId;
    storage.taskTeamName = activeTeam?.name || activeTeam?.title || '';
    if (!selectedTeamId) {
      storage.taskTeamName = '';
      storage.taskProjectName = '';
      setProjects([]);
      setSelectedProjectId('');
      setTasks([]);
      setColumns([]);
      setProjectActivity([]);
      setTaskHistory([]);
      setTeamRoles([]);
      setTeamMembers([]);
      return;
    }
    void loadProjects(selectedTeamId);
    void loadTeamDirectory(selectedTeamId);
  }, [activeTeam, closeTaskEditor, loadProjects, selectedTeamId, loadTeamDirectory]);

  useEffect(() => {
    storage.taskProjectId = selectedProjectId;
    storage.taskProjectName = activeProject?.name || activeProject?.title || '';
    if (!selectedProjectId || !selectedTeamId) {
      storage.taskProjectName = '';
      setTasks([]);
      setColumns([]);
      setProjectActivity([]);
      setTaskHistory([]);
      closeTaskEditor();
      return;
    }
    closeTaskEditor();
    void loadColumns(selectedTeamId, selectedProjectId);
    void loadTasks(selectedTeamId, selectedProjectId);
    void loadProjectActivity(selectedTeamId, selectedProjectId);
    void loadProjectDirectory(selectedTeamId, selectedProjectId);
    void loadDeadlineSettings(selectedTeamId, selectedProjectId);
  }, [activeProject, closeTaskEditor, selectedProjectId, selectedTeamId, loadColumns, loadDeadlineSettings, loadProjectActivity, loadProjectDirectory, loadTasks]);

  useEffect(() => {
    if (!selectedTeamId || !selectedProjectId) return undefined;
    const handleAssistantRefresh = () => {
      void loadColumns(selectedTeamId, selectedProjectId);
      void loadTasks(selectedTeamId, selectedProjectId);
      void loadProjectActivity(selectedTeamId, selectedProjectId);
      void loadProjectDirectory(selectedTeamId, selectedProjectId);
    };
    window.addEventListener('assistant:task-data-changed', handleAssistantRefresh);
    return () => window.removeEventListener('assistant:task-data-changed', handleAssistantRefresh);
  }, [loadColumns, loadProjectActivity, loadProjectDirectory, loadTasks, selectedProjectId, selectedTeamId]);

  useEffect(() => {
    if (!selectedProjectId) {
      resetTaskForm('');
      closeTaskEditor();
      return;
    }
    setTaskForm((prev) => {
      if (prev.columnId) {
        return prev;
      }
      return { ...prev, columnId: boardColumns[0]?.id || '' };
    });
  }, [boardColumns, selectedProjectId, resetTaskForm]);

  useEffect(() => {
    if (!editorTask) return;
    void loadTaskComments(editorTask.id);
    void loadTaskHistory(editorTask.id);
  }, [editorTask, loadTaskComments, loadTaskHistory]);

  useEffect(() => {
    if (!selectedMemberStatsUserId) return;
    if (memberStats.some((item) => item.userId === selectedMemberStatsUserId)) return;
    setSelectedMemberStatsUserId('');
  }, [memberStats, selectedMemberStatsUserId]);

  useEffect(() => {
    if (!openTaskMenuTaskId) return;
    if (tasks.some((item) => item.id === openTaskMenuTaskId)) return;
    setOpenTaskMenuTaskId('');
  }, [openTaskMenuTaskId, tasks]);

  useEffect(() => {
    if (!openTaskMenuTaskId) return;
    const handlePointerDown = (event) => {
      if (event.target instanceof Element && event.target.closest('.task-card-menu-shell')) {
        return;
      }
      setOpenTaskMenuTaskId('');
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpenTaskMenuTaskId('');
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [openTaskMenuTaskId]);

  useEffect(() => {
    if (!confirmDialog) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeConfirmDialog(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [closeConfirmDialog, confirmDialog]);

  const handleCreateTeam = async (event) => {
    event.preventDefault();
    const name = teamName.trim();
    if (!name) {
      showNotification('Введите название команды', 'error');
      return;
    }
    try {
      const team = await request(apiBase, accessToken, '/v1/teams', {
        method: 'POST',
        auth: true,
        body: { name }
      }, onUpdateAccessToken);
      setTeamName('');
      showNotification(`Команда «${team.name}» создана`, 'success');
      await loadTeams();
      setSelectedTeamId(team.id);
    } catch (error) {
      showNotification(error.message || 'Не удалось создать команду', 'error');
    }
  };

  const handleCreateProject = async (event) => {
    event.preventDefault();
    if (!selectedTeamId) {
      showNotification('Сначала выберите команду', 'error');
      return;
    }
    const name = projectName.trim();
    if (!name) {
      showNotification('Введите название проекта', 'error');
      return;
    }
    try {
      const project = await request(apiBase, accessToken, `/v1/teams/${selectedTeamId}/projects`, {
        method: 'POST',
        auth: true,
        body: { name }
      }, onUpdateAccessToken);
      setProjectName('');
      showNotification(`Проект «${project.name}» создан`, 'success');
      await loadProjects(selectedTeamId);
      setSelectedProjectId(project.id);
    } catch (error) {
      showNotification(error.message || 'Не удалось создать проект', 'error');
    }
  };

  const handleSendInvite = async (event) => {
    event.preventDefault();
    if (!selectedTeamId) {
      showNotification('Сначала выберите команду', 'error');
      return;
    }
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      showNotification('Введите email для приглашения', 'error');
      return;
    }
    try {
      await request(apiBase, accessToken, `/v1/teams/${selectedTeamId}/invite`, {
        method: 'POST',
        auth: true,
        body: { email, roleKey: inviteRoleKey || 'member', ttlHours: 168 }
      }, onUpdateAccessToken);
      setInviteEmail('');
      showNotification('Приглашение отправлено', 'success');
      await loadPendingInvites();
    } catch (error) {
      showNotification(error.message || 'Не удалось отправить приглашение', 'error');
    }
  };

  const handleAcceptInvite = async (inviteId) => {
    try {
      await request(apiBase, accessToken, `/v1/teams/invites/${encodeURIComponent(inviteId)}/accept`, {
        method: 'POST',
        auth: true
      }, onUpdateAccessToken);
      showNotification('Приглашение принято', 'success');
      await loadPendingInvites();
      await loadTeams();
    } catch (error) {
      showNotification(error.message || 'Не удалось принять приглашение', 'error');
    }
  };

  const handleCreateTeamRole = async (event) => {
    event.preventDefault();
    if (!selectedTeamId) return;
    const key = newTeamRoleKey.trim();
    const name = newTeamRoleName.trim();
    if (!key || !name) {
      showNotification('Укажите ключ и название роли команды', 'error');
      return;
    }
    try {
      await request(apiBase, accessToken, `/v1/teams/${selectedTeamId}/roles`, {
        method: 'POST',
        auth: true,
        body: { key, name, permissions: newTeamRolePermissions }
      }, onUpdateAccessToken);
      setNewTeamRoleKey('');
      setNewTeamRoleName('');
      setNewTeamRolePermissions([]);
      await loadTeamDirectory(selectedTeamId);
      showNotification('Роль команды создана', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось создать роль команды', 'error');
    }
  };

  const handleUpdateTeamMemberRole = async (event) => {
    event.preventDefault();
    if (!selectedTeamId || !selectedTeamMemberUserId || !selectedTeamMemberRoleKey) return;
    try {
      await request(apiBase, accessToken, `/v1/teams/${selectedTeamId}/members/${encodeURIComponent(selectedTeamMemberUserId)}`, {
        method: 'PATCH',
        auth: true,
        body: { roleKey: selectedTeamMemberRoleKey }
      }, onUpdateAccessToken);
      await loadTeamDirectory(selectedTeamId);
      showNotification('Роль участника команды обновлена', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось изменить роль участника', 'error');
    }
  };

  const handleCreateProjectRole = async (event) => {
    event.preventDefault();
    if (!selectedTeamId || !selectedProjectId) return;
    const key = newProjectRoleKey.trim();
    const name = newProjectRoleName.trim();
    if (!key || !name) {
      showNotification('Укажите ключ и название роли проекта', 'error');
      return;
    }
    try {
      await request(apiBase, accessToken, `/v1/teams/${selectedTeamId}/projects/${selectedProjectId}/roles`, {
        method: 'POST',
        auth: true,
        body: { key, name, permissions: newProjectRolePermissions }
      }, onUpdateAccessToken);
      setNewProjectRoleKey('');
      setNewProjectRoleName('');
      setNewProjectRolePermissions([]);
      await loadProjectDirectory(selectedTeamId, selectedProjectId);
      showNotification('Роль проекта создана', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось создать роль проекта', 'error');
    }
  };

  const handleAssignMemberToProject = async (event) => {
    event.preventDefault();
    if (!selectedTeamId || !selectedProjectId || !selectedProjectMemberUserId) return;
    try {
      await request(apiBase, accessToken, `/v1/teams/${selectedTeamId}/projects/${selectedProjectId}/members`, {
        method: 'POST',
        auth: true,
        body: { userId: selectedProjectMemberUserId, roleKey: selectedProjectMemberRoleKey || 'member' }
      }, onUpdateAccessToken);
      await loadProjectDirectory(selectedTeamId, selectedProjectId);
      showNotification('Участник назначен в проект', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось назначить участника в проект', 'error');
    }
  };

  const handleDeleteProject = async () => {
    if (!selectedTeamId || !selectedProjectId) return;
    const project = projects.find((item) => item.id === selectedProjectId);
    const projectTitle = project?.name || 'проект';
    const confirmed = await requestConfirm({
      title: 'Удалить проект?',
      message: `Проект «${projectTitle}» будет удалён вместе с настройками доступа. Это действие нельзя отменить.`,
      confirmLabel: 'Удалить проект'
    });
    if (!confirmed) {
      return;
    }
    try {
      await request(apiBase, accessToken, `/v1/teams/${selectedTeamId}/projects/${selectedProjectId}`, {
        method: 'DELETE',
        auth: true
      }, onUpdateAccessToken);
      storage.taskProjectId = '';
      storage.taskProjectName = '';
      showNotification(`Проект «${projectTitle}» удалён`, 'success');
      setTasks([]);
      setColumns([]);
      setFilterColumnIds(new Set());
      setSearchQuery('');
      closeTaskEditor();
      await loadProjects(selectedTeamId);
    } catch (error) {
      showNotification(error.message || 'Не удалось удалить проект', 'error');
    }
  };

  const handleDeleteTeam = async () => {
    if (!selectedTeamId) return;
    const team = teams.find((item) => item.id === selectedTeamId);
    const teamTitle = team?.name || 'команду';
    const confirmed = await requestConfirm({
      title: 'Удалить команду?',
      message: `Команда «${teamTitle}» и связанные данные будут удалены. Это действие нельзя отменить.`,
      confirmLabel: 'Удалить команду'
    });
    if (!confirmed) {
      return;
    }
    try {
      await request(apiBase, accessToken, `/v1/teams/${selectedTeamId}`, {
        method: 'DELETE',
        auth: true
      }, onUpdateAccessToken);
      storage.taskTeamId = '';
      storage.taskTeamName = '';
      storage.taskProjectId = '';
      storage.taskProjectName = '';
      setSelectedTeamId('');
      setSelectedProjectId('');
      setProjects([]);
      setTasks([]);
      setColumns([]);
      setFilterColumnIds(new Set());
      setSearchQuery('');
      closeTaskEditor();
      showNotification(`Команда «${teamTitle}» удалена`, 'success');
      await loadTeams();
    } catch (error) {
      showNotification(error.message || 'Не удалось удалить команду', 'error');
    }
  };

  const handleCreateColumn = async (event) => {
    event.preventDefault();
    if (!selectedTeamId || !selectedProjectId) {
      showNotification('Сначала выберите команду и проект', 'error');
      return;
    }
    const title = columnTitle.trim();
    if (!title) {
      showNotification('Введите название колонки', 'error');
      return;
    }

    try {
      const created = await request(taskApiBase, accessToken, `/v1/task-columns?projectId=${encodeURIComponent(selectedProjectId)}`, {
        method: 'POST',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId },
        body: { title }
      }, onUpdateAccessToken);
      setColumnTitle('');
      if (created?.id) {
        rememberColumn(created);
        setColumns((prev) => [...prev, created].sort((a, b) => a.position - b.position));
      } else {
        await loadColumns(selectedTeamId, selectedProjectId);
      }
      await loadProjectActivity(selectedTeamId, selectedProjectId, { silent: true });
    } catch (error) {
      showNotification(error.message || 'Не удалось создать колонку', 'error');
    }
  };

  const handleDeleteColumn = async (columnId) => {
    if (!selectedTeamId || !selectedProjectId) return;
    const column = boardColumns.find((item) => item.id === columnId);
    const columnTitle = column?.title || 'эту колонку';
    const confirmed = await requestConfirm({
      title: 'Удалить колонку?',
      message: `Колонка «${columnTitle}» будет удалена, если в ней нет задач.`,
      confirmLabel: 'Удалить колонку'
    });
    if (!confirmed) {
      return;
    }
    if (tasks.some((task) => String(task.status || '').trim() === String(columnId || '').trim())) {
      showNotification('Нельзя удалить колонку, пока в ней есть задачи', 'error');
      return;
    }
    try {
      await request(taskApiBase, accessToken, `/v1/task-columns/${encodeURIComponent(columnId)}`, {
        method: 'DELETE',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId }
      }, onUpdateAccessToken);
      await loadColumns(selectedTeamId, selectedProjectId);
      await loadProjectActivity(selectedTeamId, selectedProjectId, { silent: true });
      setTaskForm((prev) => ({
        ...prev,
        columnId: prev.columnId === columnId ? '' : prev.columnId
      }));
    } catch (error) {
      const message = String(error?.message || '');
      if (/task|задач|not empty|cannot delete/i.test(message)) {
        showNotification('Нельзя удалить колонку, пока в ней есть задачи', 'error');
      } else {
        showNotification(error.message || 'Не удалось удалить колонку', 'error');
      }
    }
  };

  const handleTaskChange = (field, value) => {
    setTaskForm((prev) => ({ ...prev, [field]: value }));
  };

  const toggleTaskFormAssignee = (userId, checked) => {
    const id = String(userId || '').trim();
    if (!id) return;
    setTaskForm((prev) => {
      const next = new Set(prev.assigneeUserIds || []);
      if (checked) next.add(id);
      else next.delete(id);
      return { ...prev, assigneeUserIds: [...next] };
    });
  };

  const toggleEditorTaskAssignee = (userId, checked) => {
    editorDirtyRef.current = true;
    const id = String(userId || '').trim();
    if (!id) return;
    setEditorTaskForm((prev) => {
      const next = new Set(prev.assigneeUserIds || []);
      if (checked) next.add(id);
      else next.delete(id);
      return { ...prev, assigneeUserIds: [...next] };
    });
  };

  const hasThreeOrMoreWords = (text) => String(text || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .length >= 3;

  const autoResizeTextarea = (target, maxHeight = 180) => {
    if (!target) return;
    target.style.height = 'auto';
    target.style.height = `${Math.min(target.scrollHeight, maxHeight)}px`;
  };

  const generateRewriteRequestId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const requestTaskContentRewrite = async ({ currentTitle, currentDescription, isEditor = false }) => {
    if (!hasThreeOrMoreWords(currentDescription)) {
      return;
    }

    const requestId = generateRewriteRequestId();
    const payload = {
      request_id: requestId,
      raw_task_description: String(currentDescription || ''),
      current_task_name: String(currentTitle || '')
    };

    setIsGeneratingTaskContent(true);
    try {
      const response = await request(
        taskApiBase,
        accessToken,
        '/task_name_description',
        {
          method: 'POST',
          auth: true,
          body: payload
        },
        onUpdateAccessToken
      );

      if (!response || response.request_id !== requestId) {
        throw new Error('request_id не совпал');
      }

      const nextSuggestion = {
        requestId,
        title: String(response.task_name || ''),
        description: String(response.task_description || ''),
        currentTitle: String(currentTitle || ''),
        currentDescription: String(currentDescription || '')
      };

      if (isEditor) {
        setEditorTaskSuggestion(nextSuggestion);
      } else {
        setTaskSuggestion(nextSuggestion);
      }
    } catch (error) {
      showNotification(error.message || 'Не удалось переформулировать задачу', 'error');
    } finally {
      setIsGeneratingTaskContent(false);
    }
  };

  const clearSuggestionField = (setSuggestion, field) => {
    setSuggestion((prev) => {
      if (!prev) return null;
      const next = { ...prev };
      delete next[field];
      if (!next.title && !next.description) {
        return null;
      }
      return next;
    });
  };

  const applyTaskSuggestion = (field, isEditor = false) => {
    const suggestion = isEditor ? editorTaskSuggestion : taskSuggestion;
    if (!suggestion || !suggestion[field]) return;

    const setter = isEditor ? setEditorTaskForm : setTaskForm;
    const setSuggestion = isEditor ? setEditorTaskSuggestion : setTaskSuggestion;

    setter((prev) => ({ ...prev, [field]: suggestion[field] }));
    clearSuggestionField(setSuggestion, field);
  };

  const rejectTaskSuggestion = (field, isEditor = false) => {
    const setSuggestion = isEditor ? setEditorTaskSuggestion : setTaskSuggestion;
    clearSuggestionField(setSuggestion, field);
  };

  const handleDeadlineKeyDown = (event) => {
    if (event.key !== 'Tab') {
      event.preventDefault();
    }
  };

  const handleDeadlineFocus = (event) => {
    if (typeof event.currentTarget.showPicker === 'function') {
      event.currentTarget.showPicker();
    }
  };

  const handleEditTask = (task) => {
    editorDirtyRef.current = false;
    editorBaseTaskRef.current = task;
    setEditorTask(task);
    setEditorTaskForm({
      title: task.title || '',
      description: task.description || '',
      priority: task.priority || 'medium',
      dueAt: formatDateTimeLocal(task.dueAt),
      columnId: String(task.status || '').trim(),
      assigneeUserIds: taskAssigneesList(task).map((a) => a.userId),
      tags: tagsInputFromTask(task.tags)
    });
    setCommentDraft('');
    setTaskComments([]);
  };

  const handleInlineEditStart = (task) => {
    setInlineEditTaskId(task.id);
    setInlineEditTitle(task.title || '');
  };

  const handleInlineEditCancel = () => {
    setInlineEditTaskId('');
    setInlineEditTitle('');
  };

  const handleInlineEditSave = async (taskId) => {
    const newTitle = inlineEditTitle.trim();
    if (!newTitle) {
      handleInlineEditCancel();
      return;
    }
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.title === newTitle) {
      handleInlineEditCancel();
      return;
    }
    if (!selectedTeamId || !selectedProjectId) {
      handleInlineEditCancel();
      return;
    }
    try {
      const updated = await applyTaskPatch(taskId, task, { title: newTitle });
      if (!updated) {
        return;
      }
      showNotification('Задача обновлена', 'success');
      handleInlineEditCancel();
    } catch (error) {
      showNotification(error.message || 'Не удалось обновить задачу', 'error');
      handleInlineEditCancel();
    }
  };

  const handleTaskSubmit = async (event) => {
    event.preventDefault();
    if (!selectedTeamId || !selectedProjectId) {
      showNotification('Выберите команду и проект', 'error');
      return;
    }
    const title = taskForm.title.trim();
    if (!title) {
      showNotification('Введите название задачи', 'error');
      return;
    }
    if (!taskForm.columnId) {
      showNotification('Создайте и выберите колонку', 'error');
      return;
    }

    const assigneesPayload = buildAssigneesPayload(taskForm.assigneeUserIds, assigneeLabelById);
    const tagsPayload = parseTagsInput(taskForm.tags);
    const primaryId = assigneesPayload[0]?.userId || '';

    const payload = {
      title,
      description: taskForm.description.trim(),
      status: taskForm.columnId,
      priority: taskForm.priority,
      assignees: assigneesPayload,
      tags: tagsPayload,
      assigneeUserId: primaryId,
      assigneeName: primaryId ? (assigneeLabelById.get(primaryId) || '') : ''
    };
    const dueAt = parseDateTimeLocal(taskForm.dueAt);
    if (dueAt) payload.dueAt = dueAt;

    setIsSavingTask(true);
    try {
      await request(taskApiBase, accessToken, '/v1/tasks', {
        method: 'POST',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId },
        body: { ...payload, projectId: selectedProjectId }
      }, onUpdateAccessToken);
      showNotification('Задача создана', 'success');
      setTaskSuggestion(null);
      resetTaskForm(taskForm.columnId);
      await loadTasks(selectedTeamId, selectedProjectId);
      await loadProjectActivity(selectedTeamId, selectedProjectId, { silent: true });
    } catch (error) {
      showNotification(error.message || 'Не удалось сохранить задачу', 'error');
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleEditorTaskChange = (field, value) => {
    editorDirtyRef.current = true;
    setEditorTaskForm((prev) => ({ ...prev, [field]: value }));
  };

  const handleEditorTaskSubmit = async (event) => {
    event.preventDefault();
    if (!editorTask || !selectedTeamId || !selectedProjectId) {
      showNotification('Выберите команду и проект', 'error');
      return;
    }
    const title = editorTaskForm.title.trim();
    if (!title) {
      showNotification('Введите название задачи', 'error');
      return;
    }
    const assigneesPayload = buildAssigneesPayload(editorTaskForm.assigneeUserIds, assigneeLabelById);
    const tagsPayload = parseTagsInput(editorTaskForm.tags);
    const primaryId = assigneesPayload[0]?.userId || '';

    const payload = {
      title,
      description: editorTaskForm.description.trim(),
      status: editorTaskForm.columnId,
      priority: editorTaskForm.priority,
      assignees: assigneesPayload,
      tags: tagsPayload,
      assigneeUserId: primaryId,
      assigneeName: primaryId ? (assigneeLabelById.get(primaryId) || '') : ''
    };
    const dueAt = parseDateTimeLocal(editorTaskForm.dueAt);
    if (dueAt) payload.dueAt = dueAt;
    try {
      const baseTask = editorBaseTaskRef.current || editorTask;
      const updated = await applyTaskPatch(editorTask.id, baseTask, payload);
      if (!updated) {
        return;
      }
      editorBaseTaskRef.current = updated;
      editorDirtyRef.current = false;
      showNotification('Задача обновлена', 'success');
      setEditorTaskSuggestion(null);
      await loadTaskHistory(editorTask.id, { silent: true });
      await loadProjectActivity(selectedTeamId, selectedProjectId, { silent: true });
    } catch (error) {
      showNotification(error.message || 'Не удалось обновить задачу', 'error');
    }
  };

  const handleCommentSubmit = async (event) => {
    event.preventDefault();
    if (!editorTask || !selectedTeamId || !selectedProjectId) {
      return;
    }
    const body = commentDraft.trim();
    if (!body) {
      showNotification('Введите сообщение', 'error');
      return;
    }
    setIsSavingComment(true);
    try {
      await request(taskApiBase, accessToken, `/v1/tasks/${editorTask.id}/comments`, {
        method: 'POST',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId },
        body: { body, authorName: (profile?.name || profile?.email || '').trim() }
      }, onUpdateAccessToken);
      setCommentDraft('');
      await loadTaskComments(editorTask.id);
      await loadTaskHistory(editorTask.id, { silent: true });
      await loadProjectActivity(selectedTeamId, selectedProjectId, { silent: true });
      showNotification('Сообщение отправлено', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось отправить сообщение', 'error');
    } finally {
      setIsSavingComment(false);
    }
  };

  const handleDeleteComment = async (commentId) => {
    if (!editorTask || !selectedTeamId || !commentId) {
      return;
    }
    const confirmed = await requestConfirm({
      title: 'Удалить сообщение?',
      message: 'Комментарий исчезнет из переписки по задаче.',
      confirmLabel: 'Удалить сообщение'
    });
    if (!confirmed) {
      return;
    }
    try {
      await request(taskApiBase, accessToken, `/v1/tasks/${editorTask.id}/comments/${encodeURIComponent(commentId)}`, {
        method: 'DELETE',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId }
      }, onUpdateAccessToken);
      await loadTaskComments(editorTask.id);
      await loadTaskHistory(editorTask.id, { silent: true });
      await loadProjectActivity(selectedTeamId, selectedProjectId, { silent: true });
      showNotification('Сообщение удалено', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось удалить сообщение', 'error');
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!selectedTeamId || !selectedProjectId) return;
    const task = tasks.find((item) => item.id === taskId);
    const confirmed = await requestConfirm({
      title: 'Удалить задачу?',
      message: task?.title ? `Задача «${task.title}» будет удалена из проекта.` : 'Задача будет удалена из проекта.',
      confirmLabel: 'Удалить задачу'
    });
    if (!confirmed) return;
    try {
      await request(taskApiBase, accessToken, `/v1/tasks/${taskId}`, {
        method: 'DELETE',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId }
      }, onUpdateAccessToken);
      showNotification('Задача удалена', 'success');
      await loadTasks(selectedTeamId, selectedProjectId);
      await loadProjectActivity(selectedTeamId, selectedProjectId, { silent: true });
    } catch (error) {
      showNotification(error.message || 'Не удалось удалить задачу', 'error');
    }
  };

  const handleToggleTaskDone = async (task) => {
    const taskId = String(task?.id || '').trim();
    if (!taskId || !selectedTeamId || !selectedProjectId) return;
    const nextCompleted = !isTaskDone(task);
    try {
      const updated = await applyTaskPatch(taskId, task, { completed: nextCompleted });
      if (!updated) {
        return;
      }
      showNotification(nextCompleted ? 'Задача отмечена выполненной' : 'Отметка выполнения снята', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось обновить состояние задачи', 'error');
    }
  };

  const handleSendDeadlineNotification = async (task) => {
    if (!task || !selectedTeamId) return;
    if (isTaskDone(task)) {
      showNotification('Для выполненной задачи уведомления не отправляются', 'error');
      return;
    }
    if (!task.dueAt) {
      showNotification('У задачи нет дедлайна', 'error');
      return;
    }
    if (!hasTaskAssignees(task)) {
      showNotification('У задачи не назначен исполнитель', 'error');
      return;
    }
    setPendingNotificationTaskId(task.id);
    try {
      await request(apiBase, accessToken, `/v1/tasks/${encodeURIComponent(task.id)}/deadline-notification`, {
        method: 'POST',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId }
      }, onUpdateAccessToken);
      showNotification('Уведомление о дедлайне отправлено', 'success');
    } catch (error) {
      showNotification(formatNotificationError(error, 'Не удалось отправить уведомление'), 'error');
    } finally {
      setPendingNotificationTaskId('');
    }
  };

  const handleDeadlineSettingsSubmit = async (event) => {
    event.preventDefault();
    if (!selectedTeamId || !selectedProjectId) return;
    const notifyBeforeMinutes = Number(deadlineSettingsForm.notifyBeforeMinutes);
    const urgentBeforeMinutes = Number(deadlineSettingsForm.urgentBeforeMinutes);
    if (!Number.isFinite(notifyBeforeMinutes) || notifyBeforeMinutes < 1) {
      showNotification('Укажите время авто-уведомления больше 0 минут', 'error');
      return;
    }
    if (!Number.isFinite(urgentBeforeMinutes) || urgentBeforeMinutes < 0 || urgentBeforeMinutes > notifyBeforeMinutes) {
      showNotification('Горящий дедлайн должен быть от 0 до времени авто-уведомления', 'error');
      return;
    }
    setIsSavingDeadlineSettings(true);
    try {
      const data = await request(
        apiBase,
        accessToken,
        `/v1/projects/${encodeURIComponent(selectedProjectId)}/notification-settings`,
        {
          method: 'PATCH',
          auth: true,
          headers: { 'X-Team-Id': selectedTeamId },
          body: { notifyBeforeMinutes, urgentBeforeMinutes }
        },
        onUpdateAccessToken
      );
      const next = {
        notifyBeforeMinutes: Number(data.notifyBeforeMinutes || notifyBeforeMinutes),
        urgentBeforeMinutes: Number(data.urgentBeforeMinutes || urgentBeforeMinutes)
      };
      setDeadlineSettings(next);
      setDeadlineSettingsForm({
        notifyBeforeMinutes: String(next.notifyBeforeMinutes),
        urgentBeforeMinutes: String(next.urgentBeforeMinutes)
      });
      showNotification('Настройки дедлайнов сохранены', 'success');
    } catch (error) {
      showNotification(formatNotificationError(error, 'Не удалось сохранить настройки дедлайнов'), 'error');
    } finally {
      setIsSavingDeadlineSettings(false);
    }
  };

  const handleConflictKeepServer = (serverTask) => {
    if (!serverTask?.id) {
      setTaskConflict(null);
      return;
    }
    updateTaskVersion(serverTask);
    setTasks((prev) => prev.map((item) => (item.id === serverTask.id ? { ...item, ...serverTask } : item)));
    if (editorTask?.id === serverTask.id) {
      setEditorTask(serverTask);
      editorBaseTaskRef.current = serverTask;
    }
    setTaskConflict(null);
    showNotification('Подставлена версия с сервера', 'success');
  };

  const handleConflictForceLocal = async (patch, serverTask) => {
    if (!taskConflict?.taskId || !selectedTeamId || !serverTask) {
      setTaskConflict(null);
      return;
    }
    try {
      const { data } = await requestWithMeta(
        taskApiBase,
        accessToken,
        `/v1/tasks/${encodeURIComponent(taskConflict.taskId)}`,
        {
          method: 'PATCH',
          auth: true,
          headers: { 'X-Team-Id': selectedTeamId },
          body: patch,
          ifMatch: etagFromVersion(serverTask.version)
        },
        onUpdateAccessToken
      );
      updateTaskVersion(data);
      setTasks((prev) => prev.map((item) => (item.id === data.id ? { ...item, ...data } : item)));
      if (editorTask?.id === data.id) {
        setEditorTask(data);
        editorBaseTaskRef.current = data;
      }
      setTaskConflict(null);
      showNotification('Ваши изменения сохранены', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось сохранить задачу', 'error');
    }
  };

  const handleReorderColumns = async (nextColumns, options = {}) => {
    if (!selectedTeamId || !selectedProjectId) return false;
    const { showSuccess = false } = options;
    try {
      const items = await reorderColumns({
        taskApiBase,
        accessToken,
        teamId: selectedTeamId,
        projectId: selectedProjectId,
        columns: nextColumns,
        onTokenRefresh: onUpdateAccessToken
      });
      setColumns(items);
      if (showSuccess && shouldShowReorderNotification()) {
        showNotification('Порядок колонок сохранен', 'success');
      }
      return true;
    } catch (error) {
      if (error?.status === 412 && Array.isArray(error.current)) {
        setColumns(error.current);
        showNotification('Колонки обновил другой участник — подставлен актуальный порядок', 'error');
        return false;
      }
      showNotification(error.message || 'Не удалось изменить порядок колонок', 'error');
      return false;
    }
  };

  const moveColumn = async (columnId, direction) => {
    const index = columns.findIndex((item) => item.id === columnId);
    if (index < 0) return;
    const nextIndex = direction === 'left' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= columns.length) return;
    const nextColumns = [...columns];
    const [moved] = nextColumns.splice(index, 1);
    nextColumns.splice(nextIndex, 0, moved);
    if (areColumnOrdersEqual(columns, nextColumns)) return;
    const previousColumns = columns;
    setColumns(nextColumns);
    const ok = await handleReorderColumns(nextColumns, { showSuccess: true });
    if (!ok) {
      setColumns(previousColumns);
    }
  };

  const onColumnHandleKeyDown = (event, columnId) => {
    if (!event.altKey) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? 'left' : 'right';
    void moveColumn(columnId, direction);
  };

  const onColumnDragStart = (event, columnId) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/column-id', columnId);
    setDraggingColumnId(columnId);
  };

  const onColumnDragEnd = () => {
    setDraggingColumnId('');
    setDragOverColumnId('');
    setColumnDropPosition('before');
  };

  const onColumnDragOver = (event, targetColumnId, isLocked) => {
    if (isLocked) return;
    const sourceColumnId = event.dataTransfer.getData('text/column-id') || draggingColumnId;
    if (!sourceColumnId || sourceColumnId === targetColumnId) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const nextPosition = pointerX < rect.width / 2 ? 'before' : 'after';
    setDragOverColumnId(targetColumnId);
    setColumnDropPosition(nextPosition);
  };

  const onColumnHeaderDrop = async (event, targetColumnId, isLocked) => {
    event.preventDefault();
    setDragOverColumnId('');
    setColumnDropPosition('before');
    if (isLocked) return;
    const sourceColumnId = event.dataTransfer.getData('text/column-id') || draggingColumnId;
    if (!sourceColumnId || sourceColumnId === targetColumnId) return;
    const sourceIndex = columns.findIndex((item) => item.id === sourceColumnId);
    const targetIndex = columns.findIndex((item) => item.id === targetColumnId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const previousColumns = columns;
    const moved = columns[sourceIndex];
    const remaining = columns.filter((item) => item.id !== sourceColumnId);
    const remainingTargetIndex = remaining.findIndex((item) => item.id === targetColumnId);
    if (remainingTargetIndex < 0) return;
    const insertionOffset = columnDropPosition === 'after' ? 1 : 0;
    const insertionIndex = remainingTargetIndex + insertionOffset;
    const nextColumns = [...remaining];
    nextColumns.splice(insertionIndex, 0, moved);
    if (areColumnOrdersEqual(columns, nextColumns)) {
      setDraggingColumnId('');
      return;
    }
    setColumns(nextColumns);
    setDraggingColumnId('');

    const ok = await handleReorderColumns(nextColumns, { showSuccess: true });
    if (!ok) {
      setColumns(previousColumns);
    }
  };

  const onTaskDragStart = (event, taskID) => {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/task-id', taskID);
    setDraggingTaskId(taskID);
  };

  const onTaskDragEnd = () => {
    setDraggingTaskId('');
    setDragOverTaskColumnId('');
    setDragOverTaskId('');
    setTaskDropPosition('before');
  };

  const onTaskColumnDragOver = (event, targetColumnId) => {
    if (!draggingTaskId) return;
    event.preventDefault();
    setDragOverTaskColumnId(targetColumnId);
  };

  const onTaskCardDragOver = (event, columnId, taskId) => {
    if (!draggingTaskId || draggingTaskId === taskId) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const before = event.clientY < rect.top + rect.height / 2;
    setDragOverTaskColumnId(columnId);
    setDragOverTaskId(taskId);
    setTaskDropPosition(before ? 'before' : 'after');
  };

  const onTaskColumnDragLeave = (targetColumnId) => {
    if (dragOverTaskColumnId === targetColumnId) {
      setDragOverTaskColumnId('');
      setDragOverTaskId('');
      setTaskDropPosition('before');
    }
  };

  const onColumnDrop = async (event, targetColumnId) => {
    event.preventDefault();
    event.stopPropagation();
    const taskID = event.dataTransfer.getData('text/task-id');
    if (!taskID || !selectedTeamId || !selectedProjectId) {
      setDragOverTaskColumnId('');
      setDragOverTaskId('');
      setDraggingTaskId('');
      return;
    }
    const task = tasks.find((item) => item.id === taskID);
    if (!task) {
      setDragOverTaskColumnId('');
      setDragOverTaskId('');
      setDraggingTaskId('');
      return;
    }

    const sourceCol = String(task.status || '').trim();
    const columnItems = tasksByColumn[targetColumnId] || [];
    const currentIds = columnItems.map((t) => t.id);
    const baseIds = currentIds.filter((id) => id !== taskID);
    let nextIds;

    if (
      dragOverTaskId &&
      dragOverTaskId !== taskID &&
      dragOverTaskColumnId === targetColumnId
    ) {
      let insertIndex = baseIds.indexOf(dragOverTaskId);
      if (insertIndex < 0) {
        nextIds = [...baseIds, taskID];
      } else {
        if (taskDropPosition === 'after') insertIndex += 1;
        nextIds = [...baseIds.slice(0, insertIndex), taskID, ...baseIds.slice(insertIndex)];
      }
    } else {
      nextIds = [...baseIds, taskID];
    }

    const sameOrder =
      currentIds.length === nextIds.length &&
      currentIds.every((id, idx) => id === nextIds[idx]);
    if (sameOrder) {
      setDragOverTaskColumnId('');
      setDragOverTaskId('');
      setDraggingTaskId('');
      return;
    }

    const crossColumn = sourceCol !== targetColumnId;

    try {
      if (crossColumn) {
        const updated = await applyTaskPatch(task.id, task, { status: targetColumnId });
        if (!updated) {
          await loadTasks(selectedTeamId, selectedProjectId);
          setDragOverTaskColumnId('');
          setDragOverTaskId('');
          setDraggingTaskId('');
          return;
        }
      }
      const reordered = await reorderTasksInColumn({
        taskApiBase,
        accessToken,
        teamId: selectedTeamId,
        projectId: selectedProjectId,
        columnId: targetColumnId,
        ids: nextIds,
        onTokenRefresh: onUpdateAccessToken
      });
      setTasks((prev) => {
        const byId = new Map(prev.map((t) => [t.id, { ...t }]));
        for (const u of reordered) {
          const row = byId.get(u.id);
          if (row) Object.assign(row, u);
        }
        return [...byId.values()];
      });
    } catch (error) {
      showNotification(error.message || 'Не удалось изменить порядок задач', 'error');
      await loadTasks(selectedTeamId, selectedProjectId);
    } finally {
      setDragOverTaskColumnId('');
      setDragOverTaskId('');
      setDraggingTaskId('');
    }
  };

  return (
    <section className="single-page wide-page tasks-page" lang="ru">
      <article className={`pane tasks-shell minimalist-board yougile-layout ${isSidebarOpen ? '' : 'sidebar-hidden'}`}>
        <aside className={`tasks-sidebar ${isSidebarOpen ? 'open' : 'collapsed'}`}>
          <div className="sidebar-title-row">
            <div>
              <p className="section-label">ПАНЕЛЬ УПРАВЛЕНИЯ</p>
              <h3>Рабочее пространство</h3>
            </div>
            <button type="button" className="ghost" onClick={() => setIsSidebarOpen(false)}>×</button>
          </div>

          <details className="sidebar-card">
            <summary>Команда и проект</summary>
            <form className="sidebar-form" onSubmit={handleCreateTeam}>
              <label>
                <span>Команда</span>
                <select value={selectedTeamId} onChange={(event) => setSelectedTeamId(event.target.value)} disabled={isLoadingTeams || !teams.length}>
                  <option value="">Выберите команду</option>
                  {teams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <div className="inline-form">
                <input value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Новая команда" />
                <button type="submit">+</button>
              </div>
              <button type="button" className="ghost danger" onClick={() => void handleDeleteTeam()} disabled={!selectedTeamId}>Удалить команду</button>
            </form>

            <form className="sidebar-form" onSubmit={handleCreateProject}>
              <label>
                <span>Проект</span>
                <select value={selectedProjectId} onChange={(event) => setSelectedProjectId(event.target.value)} disabled={!selectedTeamId || isLoadingProjects || !projects.length}>
                  <option value="">Выберите проект</option>
                  {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
                </select>
              </label>
              <div className="inline-form">
                <input value={projectName} onChange={(event) => setProjectName(event.target.value)} placeholder="Новый проект" disabled={!selectedTeamId} />
                <button type="submit" disabled={!selectedTeamId}>+</button>
              </div>
              <button type="button" className="ghost danger" onClick={() => void handleDeleteProject()} disabled={!selectedProjectId}>Удалить проект</button>
            </form>

            <form className="sidebar-form" onSubmit={handleSendInvite}>
              <label>
                <span>Пригласить по email</span>
                <input value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="user@example.com" disabled={!selectedTeamId} />
              </label>
              <label>
                <span>Начальная роль в команде</span>
                <select value={inviteRoleKey} onChange={(event) => setInviteRoleKey(event.target.value)} disabled={!selectedTeamId}>
                  {(teamRoles.length ? teamRoles : [{ key: 'member', name: 'Member' }]).map((role) => (
                    <option key={role.key} value={role.key}>{role.name || role.key}</option>
                  ))}
                </select>
              </label>
              <button type="submit" disabled={!selectedTeamId}>Отправить приглашение</button>
            </form>
          </details>

          {selectedProjectId && (
            <details className="sidebar-card">
              <summary>Авто-дедлайны</summary>
              <form className="sidebar-form" onSubmit={handleDeadlineSettingsSubmit}>
                <label>
                  <span>Уведомить за, минут</span>
                  <input
                    type="number"
                    min="1"
                    max="43200"
                    value={deadlineSettingsForm.notifyBeforeMinutes}
                    onChange={(event) => setDeadlineSettingsForm((prev) => ({ ...prev, notifyBeforeMinutes: event.target.value }))}
                    disabled={!canManageDeadlineSettings || isLoadingDeadlineSettings}
                  />
                </label>
                <label>
                  <span>Горящий дедлайн за, минут</span>
                  <input
                    type="number"
                    min="0"
                    max={deadlineSettingsForm.notifyBeforeMinutes || 43200}
                    value={deadlineSettingsForm.urgentBeforeMinutes}
                    onChange={(event) => setDeadlineSettingsForm((prev) => ({ ...prev, urgentBeforeMinutes: event.target.value }))}
                    disabled={!canManageDeadlineSettings || isLoadingDeadlineSettings}
                  />
                </label>
                <button type="submit" disabled={!canManageDeadlineSettings || isSavingDeadlineSettings || isLoadingDeadlineSettings}>
                  {isSavingDeadlineSettings ? 'Сохраняем...' : 'Сохранить настройки'}
                </button>
                {!canManageDeadlineSettings && (
                  <p className="muted-caption">Настройки доступны создателю и администратору.</p>
                )}
              </form>
            </details>
          )}

          <details className="sidebar-card">
            <summary>Входящие приглашения</summary>
            {pendingInvites.length === 0 ? <p className="muted-caption">Нет приглашений</p> : pendingInvites.map((invite) => (
              <div key={invite.id} className="sidebar-inline-row compact-row">
                <span className="compact-meta">{invite.teamName || invite.teamId} ({invite.roleKey})</span>
                <button type="button" className="compact-btn" onClick={() => void handleAcceptInvite(invite.id)}>Принять</button>
              </div>
            ))}
          </details>

          <details className="sidebar-card">
            <summary>Статистика участников</summary>
            {!selectedProjectId ? (
              <p className="muted-caption">Выберите проект, чтобы увидеть статистику по задачам.</p>
            ) : memberStats.length === 0 ? (
              <p className="muted-caption">Пока нет участников или назначенных задач.</p>
            ) : (
              <div className="list-block">
                {memberStats.map((member) => (
                  <article key={member.userId} className="list-item compact-item">
                    <div>
                      <strong>{member.displayName}</strong>
                      <p>
                        Выполнил: {member.completedCount}
                        <br />
                        Просрочил: {member.overdueCount}
                        <br />
                        Активных: {member.activeCount}
                      </p>
                    </div>
                    <button type="button" className="compact-btn" onClick={() => setSelectedMemberStatsUserId(member.userId)}>
                      Открыть
                    </button>
                  </article>
                ))}
              </div>
            )}
            {selectedProjectId && (
              <p className="muted-caption">Статистика считается по задачам текущего проекта.</p>
            )}
          </details>

          <details className="sidebar-card sidebar-card-compact roles-card">
            <summary>Роли и права</summary>
            <form className="sidebar-form compact-form" onSubmit={handleCreateTeamRole}>
              <p className="compact-subtitle">Роль команды</p>
              <label><span>Новая роль команды (key)</span><input value={newTeamRoleKey} onChange={(event) => setNewTeamRoleKey(event.target.value)} placeholder="qa" disabled={!selectedTeamId} /></label>
              <label><span>Название</span><input value={newTeamRoleName} onChange={(event) => setNewTeamRoleName(event.target.value)} placeholder="QA" disabled={!selectedTeamId} /></label>
              <div className="sidebar-inline-row compact-toggle-row">
                <span className="muted-caption">Права команды</span>
                <button type="button" className="ghost compact-toggle" onClick={() => setShowAdvancedTeamPermissions((prev) => !prev)}>
                  {showAdvancedTeamPermissions ? 'Простой режим' : 'Расширенный'}
                </button>
              </div>
              <div className="permission-grid compact-permission-grid two-columns">
                {visibleTeamPermissionOptions.map((option) => (
                <label key={option.key} className="permission-option compact-permission-option">
                  <input className="compact-checkbox" type="checkbox" checked={newTeamRolePermissions.includes(option.key)} onChange={() => toggleTeamPermission(option.key)} disabled={!selectedTeamId} />
                  <span>{option.label}</span>
                </label>
              ))}
              </div>
              <button type="submit" className="compact-btn" disabled={!selectedTeamId}>Создать роль команды</button>
            </form>

            <form className="sidebar-form compact-form" onSubmit={handleUpdateTeamMemberRole}>
              <p className="compact-subtitle">Назначение роли в команде</p>
              <label>
                <span>Участник команды</span>
                <select value={selectedTeamMemberUserId} onChange={(event) => setSelectedTeamMemberUserId(event.target.value)} disabled={!selectedTeamId}>
                  <option value="">Выберите участника</option>
                  {teamMembers.map((member) => {
                    const label = assigneeLabelById.get(member.userId) || member.userId;
                    return <option key={member.userId} value={member.userId}>{label}</option>;
                  })}
                </select>
              </label>
              <label>
                <span>Роль</span>
                <select value={selectedTeamMemberRoleKey} onChange={(event) => setSelectedTeamMemberRoleKey(event.target.value)} disabled={!selectedTeamId}>
                  {teamRoles.map((role) => <option key={role.key} value={role.key}>{role.name || role.key}</option>)}
                </select>
              </label>
              <button type="submit" className="compact-btn" disabled={!selectedTeamMemberUserId || !selectedTeamId}>Назначить роль в команде</button>
            </form>

            <form className="sidebar-form compact-form" onSubmit={handleCreateProjectRole}>
              <p className="compact-subtitle">Роль проекта</p>
              <label><span>Новая роль проекта (key)</span><input value={newProjectRoleKey} onChange={(event) => setNewProjectRoleKey(event.target.value)} placeholder="executor" disabled={!selectedProjectId} /></label>
              <label><span>Название</span><input value={newProjectRoleName} onChange={(event) => setNewProjectRoleName(event.target.value)} placeholder="Executor" disabled={!selectedProjectId} /></label>
              <div className="sidebar-inline-row compact-toggle-row">
                <span className="muted-caption">Права проекта</span>
                <button type="button" className="ghost compact-toggle" onClick={() => setShowAdvancedProjectPermissions((prev) => !prev)}>
                  {showAdvancedProjectPermissions ? 'Простой режим' : 'Расширенный'}
                </button>
              </div>
              <div className="permission-grid compact-permission-grid two-columns">
                {visibleProjectPermissionOptions.map((option) => (
                <label key={option.key} className="permission-option compact-permission-option">
                  <input className="compact-checkbox" type="checkbox" checked={newProjectRolePermissions.includes(option.key)} onChange={() => toggleProjectPermission(option.key)} disabled={!selectedProjectId} />
                  <span>{option.label}</span>
                </label>
              ))}
              </div>
              <button type="submit" className="compact-btn" disabled={!selectedProjectId}>Создать роль проекта</button>
            </form>

            <form className="sidebar-form compact-form" onSubmit={handleAssignMemberToProject}>
              <p className="compact-subtitle">Назначение в проект</p>
              <label>
                <span>Участник команды</span>
                <select value={selectedProjectMemberUserId} onChange={(event) => setSelectedProjectMemberUserId(event.target.value)} disabled={!selectedProjectId}>
                  <option value="">Выберите участника</option>
                  {teamMembers.map((member) => {
                    const label = assigneeLabelById.get(member.userId) || member.userId;
                    return <option key={member.userId} value={member.userId}>{label}</option>;
                  })}
                </select>
              </label>
              <label>
                <span>Роль проекта</span>
                <select value={selectedProjectMemberRoleKey} onChange={(event) => setSelectedProjectMemberRoleKey(event.target.value)} disabled={!selectedProjectId}>
                  {(projectRoles.length ? projectRoles : [{ key: 'member', name: 'Member' }]).map((role) => <option key={role.key} value={role.key}>{role.name || role.key}</option>)}
                </select>
              </label>
              <button type="submit" className="compact-btn" disabled={!selectedProjectId || !selectedProjectMemberUserId}>Назначить в проект</button>
            </form>
          </details>

          <details className="sidebar-card">
            <summary>Активность проекта</summary>
            <div className="activity-feed">
              {isLoadingActivity ? (
                <p className="muted-caption">Загружаем активность...</p>
              ) : projectActivity.length === 0 ? (
                <p className="muted-caption">История появится после изменений задач.</p>
              ) : projectActivity.map((event) => {
                const labels = activityChangeLabels(event);
                return (
                  <article key={event.id} className="activity-item">
                    <div className="activity-item__dot" aria-hidden="true" />
                    <div className="activity-item__body">
                      <strong>{event.summary || event.eventType}</strong>
                      <span>{actorLabel(event.actorUserId)} · {formatActivityTime(event.createdAt)}</span>
                      {event.metadata?.title && <p>{event.metadata.title}</p>}
                      {labels.length > 0 && <p>Поля: {labels.join(', ')}</p>}
                    </div>
                  </article>
                );
              })}
            </div>
            <button type="button" className="ghost compact-btn" disabled={!selectedProjectId || isLoadingActivity} onClick={() => void loadProjectActivity(selectedTeamId, selectedProjectId)}>Обновить ленту</button>
          </details>

          <details className="sidebar-card">
            <summary>Колонки</summary>
            <form className="sidebar-form" onSubmit={handleCreateColumn}>
              <div className="inline-form">
                <input value={columnTitle} onChange={(event) => setColumnTitle(event.target.value)} placeholder="Новая колонка" disabled={!selectedProjectId} />
                <button type="submit" disabled={!selectedProjectId}>+</button>
              </div>
            </form>
            <p className="muted-caption">Колонок: {boardColumns.length}</p>
          </details>

          <details className="sidebar-card">
            <summary>Добавить задачу</summary>
            <form className="task-form pane-inset minimalist-form sidebar-form" onSubmit={handleTaskSubmit}>
              <div className="task-form-grid task-form-grid-compact task-create-grid">
                <label className="task-name-block">
                  <span>Название</span>
                  <textarea
                    value={taskForm.title}
                    onChange={(event) => handleTaskChange('title', event.target.value)}
                    onInput={(event) => autoResizeTextarea(event.currentTarget, 200)}
                    placeholder="Новая задача"
                    rows={1}
                    className="task-field-textarea-title"
                  />
                  {taskSuggestion?.title && taskSuggestion.title.trim() !== taskForm.title.trim() && (
                    <div className="task-ai-suggestion">
                      <div className="task-ai-suggestion__body">{taskSuggestion.title}</div>
                      <div className="task-ai-suggestion__actions">
                        <button type="button" className="ghost icon-btn" title="Заменить название" aria-label="Заменить название" onClick={() => applyTaskSuggestion('title')}>✓</button>
                        <button type="button" className="ghost icon-btn danger" title="Отклонить название" aria-label="Отклонить название" onClick={() => rejectTaskSuggestion('title')}>✕</button>
                      </div>
                    </div>
                  )}
                </label>
                <label>
                  <span>Колонка</span>
                  <select value={taskForm.columnId} onChange={(event) => handleTaskChange('columnId', event.target.value)}>
                    <option value="">Выберите колонку</option>
                    {boardColumns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
                  </select>
                </label>
                <label>
                  <span>Приоритет</span>
                  <select value={taskForm.priority} onChange={(event) => handleTaskChange('priority', event.target.value)}>
                    <option value="low">Низкий</option>
                    <option value="medium">Средний</option>
                    <option value="high">Высокий</option>
                  </select>
                </label>
                <label>
                  <span>Срок</span>
                  <input
                    value={taskForm.dueAt}
                    onChange={(event) => handleTaskChange('dueAt', event.target.value)}
                    onKeyDown={handleDeadlineKeyDown}
                    onFocus={handleDeadlineFocus}
                    onPaste={(event) => event.preventDefault()}
                    type="datetime-local"
                  />
                </label>
                <label>
                  <span>Теги</span>
                  <input
                    value={taskForm.tags}
                    onChange={(event) => handleTaskChange('tags', event.target.value)}
                    placeholder="через запятую: баг, спринт-2"
                  />
                </label>
                <div className="assignee-multi-field">
                  <span className="assignee-multi-label">Исполнители</span>
                  {assigneeOptions.length === 0 ? (
                    <p className="muted-caption compact">Участники появятся после добавления в команду или проект.</p>
                  ) : (
                    <div className="assignee-multi-list">
                      {assigneeOptions.map((member) => (
                        <label key={member.userId} className="assignee-multi-item">
                          <input
                            type="checkbox"
                            checked={taskForm.assigneeUserIds.includes(member.userId)}
                            onChange={(event) => toggleTaskFormAssignee(member.userId, event.target.checked)}
                          />
                          <span>{member.displayName}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <label className="task-description-field">
                  <div className="task-label-row">
                    <span>Описание</span>
                    {hasThreeOrMoreWords(taskForm.description) && (
                      <button
                        type="button"
                        className="ghost icon-btn"
                        title="Переформулировать описание и название задачи"
                        aria-label="Переформулировать описание и название задачи"
                        disabled={isGeneratingTaskContent}
                        onClick={() => void requestTaskContentRewrite({
                          currentTitle: taskForm.title,
                          currentDescription: taskForm.description,
                          isEditor: false
                        })}
                      >
                        ✨
                      </button>
                    )}
                  </div>
                  <textarea
                    value={taskForm.description}
                    onChange={(event) => handleTaskChange('description', event.target.value)}
                    onInput={(event) => autoResizeTextarea(event.currentTarget, 220)}
                    rows={3}
                    placeholder="Кратко и по делу"
                    className="task-field-textarea-desc"
                  />
                  {taskSuggestion?.description && taskSuggestion.description.trim() !== taskForm.description.trim() && (
                    <div className="task-ai-suggestion">
                      <div className="task-ai-suggestion__body">{taskSuggestion.description}</div>
                      <div className="task-ai-suggestion__actions">
                        <button type="button" className="ghost icon-btn" title="Заменить описание" aria-label="Заменить описание" onClick={() => applyTaskSuggestion('description')}>✓</button>
                        <button type="button" className="ghost icon-btn danger" title="Отклонить описание" aria-label="Отклонить описание" onClick={() => rejectTaskSuggestion('description')}>✕</button>
                      </div>
                    </div>
                  )}
                </label>
              </div>
              <div className="row">
                <button type="submit" disabled={!selectedTeamId || !selectedProjectId || isSavingTask}>{isSavingTask ? 'Сохраняем...' : 'Добавить задачу'}</button>
                <button type="button" className="ghost" onClick={() => resetTaskForm(boardColumns[0]?.id || '')}>Очистить</button>
              </div>
            </form>
          </details>
        </aside>

        <div className="board-main">
          <header className="tasks-pro-header">
            <div className="tasks-pro-header-main">
              <p className="section-label">Рабочая область</p>
              <h2 className="tasks-pro-title">{activeProject?.name || activeProject?.title || 'Доска проекта'}</h2>
              {selectedTeamId && selectedProjectId && (
                <p className="tasks-pro-sub">
                  {activeTeam?.name || 'Команда'}
                  <span className="tasks-pro-dot" aria-hidden="true" />
                  {filteredTasks.length} задач в текущем фильтре
                </p>
              )}
            </div>
            <div className="tasks-pro-header-actions">
              {selectedTeamId && selectedProjectId ? (
                <BoardPresence connected={boardConnected} />
              ) : null}
              <div className="view-segmented" role="tablist" aria-label="Представление задач">
                {[
                  { id: 'board', label: 'Доска' },
                  { id: 'list', label: 'Список' },
                  { id: 'calendar', label: 'Календарь' },
                  { id: 'mindmap', label: 'Mind map' }
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={taskBoardView === item.id}
                    className={`view-segment ${taskBoardView === item.id ? 'active' : ''}`}
                    onClick={() => setTaskBoardView(item.id)}
                    disabled={!selectedProjectId}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <div className="tasks-pro-toolbar-row">
                <div className="export-actions">
                  <button type="button" className="ghost export-btn" onClick={handleExportCsv} disabled={!selectedProjectId || !filteredTasks.length} title="Экспорт в CSV">
                    CSV
                  </button>
                  <button type="button" className="ghost export-btn" onClick={handleExportJson} disabled={!selectedProjectId || !filteredTasks.length} title="Экспорт в JSON">
                    JSON
                  </button>
                </div>
                <button type="button" className="ghost" onClick={() => setIsSidebarOpen((prev) => !prev)}>{isSidebarOpen ? 'Скрыть панель' : 'Панель'}</button>
                <button type="button" className="ghost" onClick={() => navigate('/cabinet')}>Профиль</button>
                <button type="button" className="ghost" onClick={() => void loadTasks(selectedTeamId, selectedProjectId)} disabled={!selectedTeamId || !selectedProjectId}>Обновить</button>
              </div>
            </div>
          </header>

          <div className="search-filter-bar">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск по названию, описанию, тегам или исполнителям"
              className="search-input"
              disabled={!selectedProjectId}
            />
            {searchQuery && (
              <button
                type="button"
                className="ghost search-clear"
                onClick={() => setSearchQuery('')}
                title="Очистить поиск"
              >
                ✕
              </button>
            )}
            {searchQuery && (
              <span className="search-result-count">
                Найдено: {Object.values(tasksByColumn).flat().length} из {tasks.length}
              </span>
            )}
          </div>

          {boardColumns.length > 0 && (
            <div className="filter-tags">
              {boardColumns.map((column) => (
                <button
                  key={column.id}
                  type="button"
                  className={`filter-tag ${filterColumnIds.has(column.id) ? 'active' : ''}`}
                  onClick={() => {
                    const nextFilter = new Set(filterColumnIds);
                    if (nextFilter.has(column.id)) {
                      nextFilter.delete(column.id);
                    } else {
                      nextFilter.add(column.id);
                    }
                    setFilterColumnIds(nextFilter);
                  }}
                  title={filterColumnIds.has(column.id) ? `Скрыть ${column.title}` : `Показать ${column.title}`}
                >
                  {column.title}
                </button>
              ))}
              {filterColumnIds.size > 0 && (
                <button
                  type="button"
                  className="filter-tag reset"
                  onClick={() => setFilterColumnIds(new Set())}
                  title="Сбросить фильтр по статусам"
                >
                  Показать все
                </button>
              )}
            </div>
          )}

          <div className="task-view-surface">
          {taskBoardView === 'board' && (
          <div className="task-board">
          {boardColumns.length === 0 ? (
            <p className="empty-state tasks-view-empty">Создайте первую колонку, чтобы начать работу с задачами.</p>
          ) : boardColumns.map((column, index) => {
            const items = tasksByColumn[column.id] || [];
            const persistedIndex = columns.findIndex((item) => item.id === column.id);
            const canMoveLeft = !column.locked && persistedIndex > 0;
            const canMoveRight = !column.locked && persistedIndex >= 0 && persistedIndex < columns.length - 1;
            return (
              <article
                key={column.id}
                className={`task-column ${dragOverColumnId === column.id && draggingColumnId ? 'drop-target' : ''} ${dragOverColumnId === column.id && draggingColumnId && columnDropPosition === 'before' ? 'column-drop-before' : ''} ${dragOverColumnId === column.id && draggingColumnId && columnDropPosition === 'after' ? 'column-drop-after' : ''} ${draggingColumnId === column.id ? 'dragging-column' : ''}`}
              >
                <header
                  className="task-column-header"
                  onDragOver={(event) => onColumnDragOver(event, column.id, Boolean(column.locked))}
                  onDrop={(event) => void onColumnHeaderDrop(event, column.id, Boolean(column.locked))}
                >
                  <div>
                    <h3>{column.title}</h3>
                    <p>{items.length} задач</p>
                  </div>
                  <div className="column-actions">
                    {!column.locked && (
                      <button
                        type="button"
                        className="ghost drag-handle"
                        draggable
                        title="Перетащить колонку (Alt+←/→ для клавиатуры)"
                        aria-label="Перетащить колонку"
                        onDragStart={(event) => onColumnDragStart(event, column.id)}
                        onDragEnd={onColumnDragEnd}
                        onKeyDown={(event) => onColumnHandleKeyDown(event, column.id)}
                      >
                        ↕
                      </button>
                    )}
                    <button type="button" className="ghost" onClick={() => void moveColumn(column.id, 'left')} title="Сдвинуть влево" aria-label="Сдвинуть колонку влево" disabled={!canMoveLeft}>←</button>
                    <button type="button" className="ghost" onClick={() => void moveColumn(column.id, 'right')} title="Сдвинуть вправо" aria-label="Сдвинуть колонку вправо" disabled={!canMoveRight}>→</button>
                    {!column.locked && (
                      <button type="button" className="ghost danger" title="Удалить колонку" aria-label="Удалить колонку" onClick={() => void handleDeleteColumn(column.id)}>✕</button>
                    )}
                  </div>
                </header>
                <div
                  className={`task-list ${dragOverTaskColumnId === column.id && draggingTaskId ? 'task-drop-target' : ''}`}
                  onDragOver={(event) => onTaskColumnDragOver(event, column.id)}
                  onDragLeave={() => onTaskColumnDragLeave(column.id)}
                  onDrop={(event) => void onColumnDrop(event, column.id)}
                >
                  {items.length === 0 ? <p className="empty-state">Пусто</p> : items.map((task) => (
                    <article
                      key={task.id}
                      className={`task-card ${openTaskMenuTaskId === task.id ? 'task-card--menu-open' : ''} ${draggingTaskId === task.id ? 'dragging' : ''} ${isTaskOverdue(task) ? 'overdue' : ''} ${isUrgentDeadline(task) ? 'urgent-deadline' : ''} ${isTaskDone(task) ? 'completed' : ''} ${draggingTaskId && dragOverTaskColumnId === column.id && dragOverTaskId === task.id && taskDropPosition === 'before' ? 'task-drag-insert-before' : ''} ${draggingTaskId && dragOverTaskColumnId === column.id && dragOverTaskId === task.id && taskDropPosition === 'after' ? 'task-drag-insert-after' : ''}`}
                      draggable
                      onDragStart={(event) => onTaskDragStart(event, task.id)}
                      onDragEnd={onTaskDragEnd}
                      onDragOver={(event) => onTaskCardDragOver(event, column.id, task.id)}
                      onDrop={(event) => void onColumnDrop(event, column.id)}
                    >
                      <div className="task-card-top">
                        <div className="task-card-title-row">
                          <button
                            type="button"
                            className={`task-completion-toggle ${isTaskDone(task) ? 'done' : ''}`}
                            onClick={() => void handleToggleTaskDone(task)}
                            title={isTaskDone(task) ? 'Снять отметку выполнения' : 'Отметить выполненной'}
                            aria-label={isTaskDone(task) ? 'Снять отметку выполнения' : 'Отметить выполненной'}
                          >
                            <span className="task-completion-box" aria-hidden="true">
                              {isTaskDone(task) && <span className="task-completion-mark" />}
                            </span>
                          </button>
                          {inlineEditTaskId === task.id ? (
                            <input
                              type="text"
                              autoFocus
                              value={inlineEditTitle}
                              onChange={(event) => setInlineEditTitle(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  void handleInlineEditSave(task.id);
                                } else if (event.key === 'Escape') {
                                  handleInlineEditCancel();
                                }
                              }}
                              onBlur={() => void handleInlineEditSave(task.id)}
                              className="inline-edit-input"
                              placeholder="Название задачи"
                            />
                          ) : (
                            <strong
                              className="task-card-title"
                              lang="ru"
                              onDoubleClick={() => handleInlineEditStart(task)}
                              title="Двойной клик для редактирования"
                              aria-label="Название задачи"
                            >
                              {task.title}
                            </strong>
                          )}
                        </div>
                        <div className="task-card-top-meta">
                          <span
                            className={`task-priority-badge priority-${String(task.priority || 'medium').toLowerCase()}`}
                          >
                            {priorityLabel(task.priority)}
                          </span>
                          {isTaskOverdue(task) && <span className="task-overdue-badge">Просрочено</span>}
                          <div className="task-card-menu-shell">
                            <button
                              type="button"
                              className="ghost task-card-menu-trigger"
                              onClick={() => setOpenTaskMenuTaskId((current) => (current === task.id ? '' : task.id))}
                              title="Действия"
                              aria-label="Действия"
                            >
                              ...
                            </button>
                            {openTaskMenuTaskId === task.id && (
                              <div className="task-card-menu">
                                <button
                                  type="button"
                                  className="task-card-menu-item"
                                  onClick={() => {
                                    setOpenTaskMenuTaskId('');
                                    void handleSendDeadlineNotification(task);
                                  }}
                                  disabled={!task.dueAt || !hasTaskAssignees(task) || pendingNotificationTaskId === task.id || isTaskDone(task)}
                                >
                                  {pendingNotificationTaskId === task.id ? 'Отправляем...' : 'Напомнить о дедлайне'}
                                </button>
                                <button
                                  type="button"
                                  className="task-card-menu-item"
                                  onClick={() => {
                                    setOpenTaskMenuTaskId('');
                                    handleEditTask(task);
                                  }}
                                >
                                  Изменить
                                </button>
                                <button
                                  type="button"
                                  className="task-card-menu-item danger"
                                  onClick={() => {
                                    setOpenTaskMenuTaskId('');
                                    void handleDeleteTask(task.id);
                                  }}
                                >
                                  Удалить
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      {Array.isArray(task.tags) && task.tags.length > 0 && (
                        <div className="task-card-tags" aria-label="Теги">
                          {task.tags.map((tag, idx) => (
                            <span key={`${task.id}-${tag}-${idx}`} className="task-chip task-chip-tag">{tag}</span>
                          ))}
                        </div>
                      )}
                      {task.description && <p>{task.description}</p>}
                      <div className="task-card-meta">
                        {task.dueAt ? (
                          <span className={isTaskOverdue(task) ? 'task-card-due-overdue' : ''}>
                            Срок: {new Date(task.dueAt).toLocaleString()}
                          </span>
                        ) : <span>Без срока</span>}
                        {hasTaskAssignees(task) ? (
                          <span className="task-card-assignees-row">
                            <span className="task-card-meta-kicker">Исп.</span>
                            <span className="task-card-assignees">{formatAssigneesDisplay(task, assigneeLabelById) || '—'}</span>
                          </span>
                        ) : (
                          <span className="task-card-assignees-row task-card-assignees-row--empty">
                            <span className="task-card-meta-kicker">Исп.</span>
                            <span className="task-card-assignees">—</span>
                          </span>
                        )}
                        {task.unreadComments > 0 && <span className="task-unread-pill">Новых сообщений: {task.unreadComments}</span>}
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
        )}
        {taskBoardView === 'list' && (
          <div className="task-list-view-wrap">
            {boardColumns.length === 0 ? (
              <p className="empty-state tasks-view-empty">Создайте первую колонку, чтобы начать работу с задачами.</p>
            ) : listSortedTasks.length === 0 ? (
              <p className="empty-state tasks-view-empty">Нет задач по текущим фильтрам.</p>
            ) : (
              <div className="task-table-scroll">
                <table className="task-list-pro">
                  <thead>
                    <tr>
                      <th className="task-list-col-check" aria-label="Выполнено" />
                      <th>Задача</th>
                      <th>Колонка</th>
                      <th>Приоритет</th>
                      <th>Теги</th>
                      <th>Срок</th>
                      <th>Исп.</th>
                      <th className="task-list-col-actions" aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {listSortedTasks.map((task) => {
                      const st = String(task.status || '').trim();
                      const colTitle = columnTitleById.get(st) || st || '—';
                      return (
                        <tr key={task.id} className={`task-list-row ${isTaskDone(task) ? 'completed' : ''} ${isTaskOverdue(task) ? 'overdue' : ''}`}>
                          <td>
                            <button
                              type="button"
                              className={`task-completion-toggle sm ${isTaskDone(task) ? 'done' : ''}`}
                              onClick={() => void handleToggleTaskDone(task)}
                              title={isTaskDone(task) ? 'Снять выполнение' : 'Выполнено'}
                              aria-label={isTaskDone(task) ? 'Снять выполнение' : 'Отметить выполненной'}
                            >
                              <span className="task-completion-box" aria-hidden="true">
                                {isTaskDone(task) && <span className="task-completion-mark" />}
                              </span>
                            </button>
                          </td>
                          <td>
                            <strong className="task-list-title" lang="ru">{task.title}</strong>
                            {task.description && <p className="task-list-desc">{task.description}</p>}
                          </td>
                          <td><span className="task-list-pill">{colTitle}</span></td>
                          <td>
                            <span className={`task-priority-badge sm priority-${String(task.priority || 'medium').toLowerCase()}`}>
                              {priorityLabel(task.priority)}
                            </span>
                          </td>
                          <td>
                            {Array.isArray(task.tags) && task.tags.length
                              ? (
                                <span className="task-list-tags">{task.tags.join(', ')}</span>
                              )
                              : '—'}
                          </td>
                          <td>{task.dueAt ? new Date(task.dueAt).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' }) : '—'}</td>
                          <td className="task-list-assignees-cell">{formatAssigneesDisplay(task, assigneeLabelById) || '—'}</td>
                          <td>
                            <button type="button" className="ghost task-list-open" onClick={() => handleEditTask(task)}>Открыть</button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {taskBoardView === 'calendar' && (
          <div className="task-calendar-wrap">
            {boardColumns.length === 0 ? (
              <p className="empty-state tasks-view-empty">Создайте колонки, чтобы назначать задачи.</p>
            ) : (
              <>
                <div className="task-cal-nav">
                  <button
                    type="button"
                    className="ghost task-cal-nav-btn"
                    onClick={() => setCalendarCursor(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() - 1, 1))}
                    aria-label="Предыдущий месяц"
                  >
                    ←
                  </button>
                  <span className="task-cal-month">{calendarMonthLabel}</span>
                  <button
                    type="button"
                    className="ghost task-cal-nav-btn"
                    onClick={() => setCalendarCursor(new Date(calendarCursor.getFullYear(), calendarCursor.getMonth() + 1, 1))}
                    aria-label="Следующий месяц"
                  >
                    →
                  </button>
                  <button type="button" className="ghost task-cal-today" onClick={() => setCalendarCursor(new Date())}>Сегодня</button>
                </div>
                <div className="task-cal-grid">
                  {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((wd) => (
                    <div key={wd} className="task-cal-weekday">{wd}</div>
                  ))}
                  {calendarCells.map((cell) => (
                    <div key={cell.iso} className={`task-cal-cell ${cell.inMonth ? '' : 'out-month'}`}>
                      <span className="task-cal-day-num">{cell.date.getDate()}</span>
                      <div className="task-cal-tasks">
                        {cell.tasks.slice(0, 4).map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className={`task-cal-pill ${isTaskDone(t) ? 'done' : ''} ${isTaskOverdue(t) ? 'overdue' : ''}`}
                            onClick={() => handleEditTask(t)}
                          >
                            {(t.title || 'Задача').slice(0, 28)}{(t.title || '').length > 28 ? '…' : ''}
                          </button>
                        ))}
                        {cell.tasks.length > 4 && (
                          <span className="task-cal-more">+{cell.tasks.length - 4}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {taskBoardView === 'mindmap' && (
          <div className="task-mindmap-wrap">
            {boardColumns.length === 0 ? (
              <p className="empty-state tasks-view-empty">Добавьте колонки — mind map построит схему проекта → колонки → задачи. Режим «Рисовать» — отдельный слой поверх (whiteboard).</p>
            ) : (
              <TaskMindMapPanel
                storageKey={selectedTeamId && selectedProjectId ? `taskMindMap:${selectedTeamId}:${selectedProjectId}` : ''}
                projectLabel={activeProject?.name || activeProject?.title || 'Проект'}
                columns={boardColumns}
                tasksByColumn={tasksByColumn}
                onOpenTask={handleEditTask}
                isTaskDone={isTaskDone}
                isTaskOverdue={isTaskOverdue}
              />
            )}
          </div>
        )}
          </div>
        </div>

        {selectedMemberStats && (
          <div className="task-modal-backdrop" onMouseDown={() => setSelectedMemberStatsUserId('')} role="presentation">
            <div className="task-modal member-stats-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Статистика участника">
              <div className="task-modal-header member-stats-header">
                <div className="member-stats-header-main">
                  <div className="member-stats-avatar" aria-hidden="true">
                    {(selectedMemberStats.displayName || '?').slice(0, 1).toUpperCase()}
                  </div>
                  <div>
                    <p className="section-label">СТАТИСТИКА УЧАСТНИКА</p>
                    <h3>{selectedMemberStats.displayName}</h3>
                    <p className="muted-caption">Текущий проект: {activeProject?.name || 'Не выбран'}</p>
                  </div>
                </div>
                <div className="member-stats-header-side">
                  <div className="member-stats-rate-card">
                    <span className="mini-label">Процент выполнения</span>
                    <strong>{selectedMemberCompletionRate}%</strong>
                    <p>{selectedMemberStats.completedCount} из {selectedMemberStats.assignedCount} задач завершено</p>
                  </div>
                  <button type="button" className="ghost icon-btn" onClick={() => setSelectedMemberStatsUserId('')} aria-label="Закрыть">✕</button>
                </div>
              </div>

              <div className="tasks-meta-grid member-stats-grid">
                <article className="mini-panel member-stats-summary-card">
                  <span className="mini-label">Назначено</span>
                  <strong>{selectedMemberStats.assignedCount}</strong>
                  <p>Всего задач у участника в текущем проекте.</p>
                </article>
                <article className="mini-panel member-stats-summary-card">
                  <span className="mini-label">Выполнено</span>
                  <strong>{selectedMemberStats.completedCount}</strong>
                  <p>Задач с отдельной отметкой выполнения.</p>
                </article>
                <article className="mini-panel member-stats-summary-card">
                  <span className="mini-label">Просрочено</span>
                  <strong>{selectedMemberStats.overdueCount}</strong>
                  <p>Есть дедлайн в прошлом и задача еще не завершена.</p>
                </article>
                <article className="mini-panel member-stats-summary-card">
                  <span className="mini-label">В работе</span>
                  <strong>{selectedMemberStats.activeCount}</strong>
                  <p>Активные задачи без отметки выполнения.</p>
                </article>
              </div>

              <div className="task-access-grid member-stats-sections">
                <section className="task-access-panel member-stats-section">
                  <div className="task-access-header member-stats-section-header">
                    <div>
                      <span>В работе</span>
                      <strong>{selectedMemberStats.activeCount}</strong>
                    </div>
                    <p className="muted-caption">Текущая нагрузка по проекту.</p>
                  </div>
                  <div className="list-block member-stats-list">
                    {selectedMemberStats.activeTasks.length === 0 ? (
                      <p className="empty-state">Нет активных задач.</p>
                    ) : selectedMemberStats.activeTasks.map((task) => (
                      <article key={task.id} className="list-item compact-item member-stats-list-item">
                        <div>
                          <strong>{task.title}</strong>
                          <p>{task.dueAt ? `Срок: ${new Date(task.dueAt).toLocaleString()}` : 'Без срока'}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="task-access-panel member-stats-section">
                  <div className="task-access-header member-stats-section-header">
                    <div>
                      <span>Выполнено</span>
                      <strong>{selectedMemberStats.completedCount}</strong>
                    </div>
                    <p className="muted-caption">Уже закрытые задачи участника.</p>
                  </div>
                  <div className="list-block member-stats-list">
                    {selectedMemberStats.completedTasks.length === 0 ? (
                      <p className="empty-state">Пока нет выполненных задач.</p>
                    ) : selectedMemberStats.completedTasks.map((task) => (
                      <article key={task.id} className="list-item compact-item member-stats-list-item">
                        <div>
                          <strong>{task.title}</strong>
                          <p>{task.description || 'Без описания'}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>

                <section className="task-access-panel member-stats-section">
                  <div className="task-access-header member-stats-section-header">
                    <div>
                      <span>Просрочено</span>
                      <strong>{selectedMemberStats.overdueCount}</strong>
                    </div>
                    <p className="muted-caption">Задачи, требующие внимания.</p>
                  </div>
                  <div className="list-block member-stats-list">
                    {selectedMemberStats.overdueTasks.length === 0 ? (
                      <p className="empty-state">Нет просроченных задач.</p>
                    ) : selectedMemberStats.overdueTasks.map((task) => (
                      <article key={task.id} className="list-item compact-item member-stats-list-item">
                        <div>
                          <strong>{task.title}</strong>
                          <p>{task.dueAt ? `Просрочена с ${new Date(task.dueAt).toLocaleString()}` : 'Без срока'}</p>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {editorTask && (
          <div className="task-modal-backdrop" onMouseDown={closeTaskEditor} role="presentation">
            <div className="task-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Редактирование задачи">
              <div className="task-modal-header">
                <div>
                  <p className="section-label">РЕДАКТИРОВАНИЕ ЗАДАЧИ</p>
                  <h3>{editorTask.title}</h3>
                </div>
                <div className="task-modal-header-actions">
                  <button
                    type="button"
                    className={`ghost task-completion-chip ${isTaskDone(editorTask) ? 'done' : ''}`}
                    onClick={() => void handleToggleTaskDone(editorTask)}
                  >
                    <span className="task-completion-box" aria-hidden="true">
                      {isTaskDone(editorTask) && <span className="task-completion-mark" />}
                    </span>
                    {isTaskDone(editorTask) ? 'Выполнена' : 'Отметить выполненной'}
                  </button>
                  <button type="button" className="ghost icon-btn" onClick={closeTaskEditor} aria-label="Закрыть">✕</button>
                </div>
              </div>

              <div className="task-modal-body">
                <form className="task-modal-form" onSubmit={handleEditorTaskSubmit}>
                  <div className="task-form-grid task-form-grid-compact task-edit-grid">
                    <label className="task-name-block">
                      <span>Название</span>
                      <textarea
                        value={editorTaskForm.title}
                        onChange={(event) => handleEditorTaskChange('title', event.target.value)}
                        onInput={(event) => autoResizeTextarea(event.currentTarget, 200)}
                        placeholder="Название задачи"
                        rows={1}
                        className="task-field-textarea-title"
                      />
                      {editorTaskSuggestion?.title && editorTaskSuggestion.title.trim() !== editorTaskForm.title.trim() && (
                        <div className="task-ai-suggestion">
                          <div className="task-ai-suggestion__body">{editorTaskSuggestion.title}</div>
                          <div className="task-ai-suggestion__actions">
                            <button type="button" className="ghost icon-btn" title="Заменить название" aria-label="Заменить название" onClick={() => applyTaskSuggestion('title', true)}>✓</button>
                            <button type="button" className="ghost icon-btn danger" title="Отклонить название" aria-label="Отклонить название" onClick={() => rejectTaskSuggestion('title', true)}>✕</button>
                          </div>
                        </div>
                      )}
                    </label>
                    <label>
                      <span>Колонка</span>
                      <select value={editorTaskForm.columnId} onChange={(event) => handleEditorTaskChange('columnId', event.target.value)}>
                        <option value="">Выберите колонку</option>
                        {boardColumns.map((column) => <option key={column.id} value={column.id}>{column.title}</option>)}
                      </select>
                    </label>
                    <label>
                      <span>Приоритет</span>
                      <select value={editorTaskForm.priority} onChange={(event) => handleEditorTaskChange('priority', event.target.value)}>
                        <option value="low">Низкий</option>
                        <option value="medium">Средний</option>
                        <option value="high">Высокий</option>
                      </select>
                    </label>
                    <label>
                      <span>Срок</span>
                      <input
                        value={editorTaskForm.dueAt}
                        onChange={(event) => handleEditorTaskChange('dueAt', event.target.value)}
                        onKeyDown={handleDeadlineKeyDown}
                        onFocus={handleDeadlineFocus}
                        onPaste={(event) => event.preventDefault()}
                        type="datetime-local"
                      />
                    </label>
                    <label>
                      <span>Теги</span>
                      <input
                        value={editorTaskForm.tags}
                        onChange={(event) => handleEditorTaskChange('tags', event.target.value)}
                        placeholder="через запятую"
                      />
                    </label>
                    <div className="assignee-multi-field">
                      <span className="assignee-multi-label">Исполнители</span>
                      {assigneeOptions.length === 0 ? (
                        <p className="muted-caption compact">Участники появятся после добавления в команду или проект.</p>
                      ) : (
                        <div className="assignee-multi-list">
                          {assigneeOptions.map((member) => (
                            <label key={`ed-${member.userId}`} className="assignee-multi-item">
                              <input
                                type="checkbox"
                                checked={editorTaskForm.assigneeUserIds.includes(member.userId)}
                                onChange={(event) => toggleEditorTaskAssignee(member.userId, event.target.checked)}
                              />
                              <span>{member.displayName}</span>
                            </label>
                          ))}
                        </div>
                      )}
                    </div>
                    <label className="task-description-field">
                      <div className="task-label-row">
                        <span>Описание</span>
                        {hasThreeOrMoreWords(editorTaskForm.description) && (
                          <button
                            type="button"
                            className="ghost icon-btn"
                            title="Переформулировать описание и название задачи"
                            aria-label="Переформулировать описание и название задачи"
                            disabled={isGeneratingTaskContent}
                            onClick={() => void requestTaskContentRewrite({
                              currentTitle: editorTaskForm.title,
                              currentDescription: editorTaskForm.description,
                              isEditor: true
                            })}
                          >
                            ✨
                          </button>
                        )}
                      </div>
                      <textarea
                        value={editorTaskForm.description}
                        onChange={(event) => handleEditorTaskChange('description', event.target.value)}
                        onInput={(event) => autoResizeTextarea(event.currentTarget, 220)}
                        rows={4}
                        placeholder="Описание задачи"
                        className="task-field-textarea-desc"
                      />
                      {editorTaskSuggestion?.description && editorTaskSuggestion.description.trim() !== editorTaskForm.description.trim() && (
                        <div className="task-ai-suggestion">
                          <div className="task-ai-suggestion__body">{editorTaskSuggestion.description}</div>
                          <div className="task-ai-suggestion__actions">
                            <button type="button" className="ghost icon-btn" title="Заменить описание" aria-label="Заменить описание" onClick={() => applyTaskSuggestion('description', true)}>✓</button>
                            <button type="button" className="ghost icon-btn danger" title="Отклонить описание" aria-label="Отклонить описание" onClick={() => rejectTaskSuggestion('description', true)}>✕</button>
                          </div>
                        </div>
                      )}
                    </label>
                  </div>
                  <div className="row">
                    <button type="submit">Сохранить</button>
                    <button type="button" className="ghost" onClick={closeTaskEditor}>Закрыть</button>
                  </div>
                </form>

                <section className="task-comments-panel">
                  <div className="task-comments-header">
                    <div>
                      <p className="section-label">ПЕРЕПИСКА</p>
                      <h4>Сообщения по задаче</h4>
                    </div>
                    <span className="task-comments-count">{taskComments.length}</span>
                  </div>
                  <div className="task-comments-list">
                    {isLoadingComments ? (
                      <p className="empty-state">Загружаем сообщения...</p>
                    ) : taskComments.length === 0 ? (
                      <p className="empty-state">Пока нет сообщений</p>
                    ) : taskComments.map((comment) => (
                      <article key={comment.id} className="task-comment-item">
                        <div className="task-comment-meta">
                          <strong>{comment.authorName || comment.userId || 'Anonymous'}</strong>
                          <div className="task-comment-meta-actions">
                            <span>{new Date(comment.createdAt).toLocaleString()}</span>
                            <button type="button" className="ghost danger icon-btn" onClick={() => void handleDeleteComment(comment.id)} title="Удалить сообщение" aria-label="Удалить сообщение">✕</button>
                          </div>
                        </div>
                        <p>{comment.body}</p>
                      </article>
                    ))}
                  </div>
                  <form className="task-comment-form" onSubmit={handleCommentSubmit}>
                    <textarea value={commentDraft} onChange={(event) => setCommentDraft(event.target.value)} rows={4} placeholder="Написать сообщение" />
                    <div className="row">
                      <button type="submit" disabled={isSavingComment}>{isSavingComment ? 'Отправляем...' : 'Отправить сообщение'}</button>
                    </div>
                  </form>
                </section>

                <section className="task-comments-panel task-history-panel">
                  <div className="task-comments-header">
                    <div>
                      <p className="section-label">ИСТОРИЯ</p>
                      <h4>Изменения задачи</h4>
                    </div>
                    <span className="task-comments-count">{taskHistory.length}</span>
                  </div>
                  <div className="activity-feed task-history-list">
                    {isLoadingTaskHistory ? (
                      <p className="empty-state">Загружаем историю...</p>
                    ) : taskHistory.length === 0 ? (
                      <p className="empty-state">Истории изменений пока нет</p>
                    ) : taskHistory.map((event) => {
                      const labels = activityChangeLabels(event);
                      return (
                        <article key={event.id} className="activity-item">
                          <div className="activity-item__dot" aria-hidden="true" />
                          <div className="activity-item__body">
                            <strong>{event.summary || event.eventType}</strong>
                            <span>{actorLabel(event.actorUserId)} · {formatActivityTime(event.createdAt)}</span>
                            {labels.length > 0 && <p>Изменено: {labels.join(', ')}</p>}
                          </div>
                        </article>
                      );
                    })}
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}
      </article>
      {confirmDialog && (
        <div className="modal-backdrop" onMouseDown={() => closeConfirmDialog(false)} role="presentation">
          <div className="modal confirm-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
            <div className="confirm-modal__icon" aria-hidden="true">!</div>
            <div className="confirm-modal__content">
              <p className="section-label">ПОДТВЕРЖДЕНИЕ</p>
              <h3 id="confirm-dialog-title">{confirmDialog.title}</h3>
              <p>{confirmDialog.message}</p>
            </div>
            <div className="confirm-modal__actions">
              <button type="button" className="ghost" onClick={() => closeConfirmDialog(false)}>{confirmDialog.cancelLabel}</button>
              <button type="button" className={confirmDialog.tone === 'danger' ? 'danger' : ''} onClick={() => closeConfirmDialog(true)} autoFocus>{confirmDialog.confirmLabel}</button>
            </div>
          </div>
        </div>
      )}
      <TaskConflictDialog
        conflict={taskConflict}
        onClose={() => setTaskConflict(null)}
        onKeepServer={handleConflictKeepServer}
        onForceLocal={handleConflictForceLocal}
      />
    </section>
  );
}
