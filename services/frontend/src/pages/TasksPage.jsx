import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { request, storage } from '../lib/api';
import { formatDateTimeLocal, parseDateTimeLocal } from '../lib/date';
import {
  BASIC_PROJECT_PERMISSION_KEYS,
  BASIC_TEAM_PERMISSION_KEYS,
  PROJECT_PERMISSION_OPTIONS,
  TEAM_PERMISSION_OPTIONS,
  groupTasksByStatus,
  priorityLabel,
  statusLabel
} from '../lib/tasks';

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
    assigneeUserId: ''
  });
  const [editorTask, setEditorTask] = useState(null);
  const [editorTaskForm, setEditorTaskForm] = useState({
    title: '',
    description: '',
    priority: 'medium',
    dueAt: '',
    columnId: '',
    assigneeUserId: ''
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
  const [commentDraft, setCommentDraft] = useState('');
  const [isLoadingComments, setIsLoadingComments] = useState(false);
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
  const [searchQuery, setSearchQuery] = useState('');
  const [filterColumnIds, setFilterColumnIds] = useState(new Set());
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [lastReorderNotificationTime, setLastReorderNotificationTime] = useState(0);
  const [memberDirectory, setMemberDirectory] = useState({});
  const [selectedMemberStatsUserId, setSelectedMemberStatsUserId] = useState('');
  const [openTaskMenuTaskId, setOpenTaskMenuTaskId] = useState('');

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
    if (lower.includes('smtp host is not configured') || lower.includes('smtp')) {
      return 'Почтовый сервис уведомлений не настроен.';
    }
    if (lower.includes('task is already done')) {
      return 'Для выполненной задачи уведомление не отправляется.';
    }
    return message || fallbackMessage;
  }, []);

  // Загрузить поиск из localStorage (был сохранён ранее)
  useEffect(() => {
    const saved = localStorage.getItem('taskBoardSearchQuery');
    if (saved) {
      setSearchQuery(saved);
    }
  }, []);

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
        return titleMatch || descriptionMatch;
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
  }, [tasks, searchQuery, filterColumnIds]);

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
    return map;
  }, [boardColumns, filteredTasks]);

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
      const assigneeUserId = String(task?.assigneeUserId || '').trim();
      if (!assigneeUserId) return;
      const member = ensureMember(
        assigneeUserId,
        task.assigneeName || assigneeLabelById.get(assigneeUserId) || assigneeUserId
      );
      if (!member) return;
      member.assignedCount += 1;
      if (isTaskDone(task)) {
        member.completedCount += 1;
        member.completedTasks.push(task);
        return;
      }
      if (isTaskOverdue(task)) {
        member.overdueCount += 1;
        member.overdueTasks.push(task);
        return;
      }
      member.activeCount += 1;
      member.activeTasks.push(task);
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
      assigneeUserId: ''
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
      assigneeUserId: ''
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
      setTasks(Array.isArray(data.items) ? data.items : []);
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
      setColumns(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить колонки', 'error');
      setColumns([]);
    }
  }, [accessToken, onUpdateAccessToken, showNotification, taskApiBase]);

  const loadTaskComments = useCallback(async (taskId) => {
    if (!accessToken || !taskId || !selectedTeamId || !selectedProjectId) return;
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
      await loadTasks(selectedTeamId, selectedProjectId);
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить переписку', 'error');
    } finally {
      setIsLoadingComments(false);
    }
  }, [accessToken, loadTasks, onUpdateAccessToken, selectedProjectId, selectedTeamId, showNotification, taskApiBase]);

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
      closeTaskEditor();
      return;
    }
    closeTaskEditor();
    void loadColumns(selectedTeamId, selectedProjectId);
    void loadTasks(selectedTeamId, selectedProjectId);
    void loadProjectDirectory(selectedTeamId, selectedProjectId);
    void loadDeadlineSettings(selectedTeamId, selectedProjectId);
  }, [activeProject, closeTaskEditor, selectedProjectId, selectedTeamId, loadColumns, loadDeadlineSettings, loadProjectDirectory, loadTasks]);

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
  }, [editorTask, loadTaskComments]);

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
    if (!window.confirm(`Удалить проект «${projectTitle}»?`)) {
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
    if (!window.confirm(`Вы точно уверены, что хотите удалить команду «${teamTitle}»? Это действие нельзя отменить.`)) {
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
      await request(taskApiBase, accessToken, `/v1/task-columns?projectId=${encodeURIComponent(selectedProjectId)}`, {
        method: 'POST',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId },
        body: { title }
      }, onUpdateAccessToken);
      setColumnTitle('');
      await loadColumns(selectedTeamId, selectedProjectId);
    } catch (error) {
      showNotification(error.message || 'Не удалось создать колонку', 'error');
    }
  };

  const handleDeleteColumn = async (columnId) => {
    if (!selectedTeamId || !selectedProjectId) return;
    const column = boardColumns.find((item) => item.id === columnId);
    const columnTitle = column?.title || 'эту колонку';
    if (!window.confirm(`Удалить колонку «${columnTitle}»?`)) {
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
    setEditorTask(task);
    setEditorTaskForm({
      title: task.title || '',
      description: task.description || '',
      priority: task.priority || 'medium',
      dueAt: formatDateTimeLocal(task.dueAt),
      columnId: String(task.status || '').trim(),
      assigneeUserId: task.assigneeUserId || ''
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
      await request(taskApiBase, accessToken, `/v1/tasks/${taskId}`, {
        method: 'PATCH',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId },
        body: { title: newTitle }
      }, onUpdateAccessToken);
      showNotification('Задача обновлена', 'success');
      handleInlineEditCancel();
      await loadTasks(selectedTeamId, selectedProjectId);
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

    const payload = {
      title,
      description: taskForm.description.trim(),
      status: taskForm.columnId,
      priority: taskForm.priority,
      assigneeUserId: taskForm.assigneeUserId || '',
      assigneeName: assigneeLabelById.get(taskForm.assigneeUserId || '') || ''
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
    } catch (error) {
      showNotification(error.message || 'Не удалось сохранить задачу', 'error');
    } finally {
      setIsSavingTask(false);
    }
  };

  const handleEditorTaskChange = (field, value) => {
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
    const payload = {
      title,
      description: editorTaskForm.description.trim(),
      status: editorTaskForm.columnId,
      priority: editorTaskForm.priority,
      assigneeUserId: editorTaskForm.assigneeUserId || '',
      assigneeName: assigneeLabelById.get(editorTaskForm.assigneeUserId || '') || ''
    };
    const dueAt = parseDateTimeLocal(editorTaskForm.dueAt);
    if (dueAt) payload.dueAt = dueAt;
    try {
      await request(taskApiBase, accessToken, `/v1/tasks/${editorTask.id}`, {
        method: 'PATCH',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId },
        body: payload
      }, onUpdateAccessToken);
      showNotification('Задача обновлена', 'success');
      setEditorTaskSuggestion(null);
      if (editorTask) {
        await loadTaskComments(editorTask.id);
      }
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
    if (!window.confirm('Удалить сообщение?')) {
      return;
    }
    try {
      await request(taskApiBase, accessToken, `/v1/tasks/${editorTask.id}/comments/${encodeURIComponent(commentId)}`, {
        method: 'DELETE',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId }
      }, onUpdateAccessToken);
      await loadTaskComments(editorTask.id);
      showNotification('Сообщение удалено', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось удалить сообщение', 'error');
    }
  };

  const handleDeleteTask = async (taskId) => {
    if (!selectedTeamId || !selectedProjectId) return;
    if (!window.confirm('Удалить задачу?')) return;
    try {
      await request(taskApiBase, accessToken, `/v1/tasks/${taskId}`, {
        method: 'DELETE',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId }
      }, onUpdateAccessToken);
      showNotification('Задача удалена', 'success');
      await loadTasks(selectedTeamId, selectedProjectId);
    } catch (error) {
      showNotification(error.message || 'Не удалось удалить задачу', 'error');
    }
  };

  const handleToggleTaskDone = async (task) => {
    const taskId = String(task?.id || '').trim();
    if (!taskId || !selectedTeamId || !selectedProjectId) return;
    const nextCompleted = !isTaskDone(task);
    try {
      const updated = await request(taskApiBase, accessToken, `/v1/tasks/${taskId}`, {
        method: 'PATCH',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId },
        body: { completed: nextCompleted }
      }, onUpdateAccessToken);
      if (editorTask?.id === taskId) {
        setEditorTask(updated);
      }
      showNotification(nextCompleted ? 'Задача отмечена выполненной' : 'Отметка выполнения снята', 'success');
      await loadTasks(selectedTeamId, selectedProjectId);
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
    if (!task.assigneeUserId) {
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

  const handleMoveTask = async (task, targetColumnId) => {
    if (!selectedTeamId || !selectedProjectId || !targetColumnId) return;
    try {
      await request(taskApiBase, accessToken, `/v1/tasks/${task.id}`, {
        method: 'PATCH',
        auth: true,
        headers: { 'X-Team-Id': selectedTeamId },
        body: { status: targetColumnId }
      }, onUpdateAccessToken);
      await loadTasks(selectedTeamId, selectedProjectId);
    } catch (error) {
      showNotification(error.message || 'Не удалось переместить задачу', 'error');
    }
  };

  const handleReorderColumns = async (nextColumns, options = {}) => {
    if (!selectedTeamId || !selectedProjectId) return;
    const { showSuccess = false } = options;
    const ids = nextColumns.map((item) => item.id);
    try {
      const data = await request(
        taskApiBase,
        accessToken,
        `/v1/task-columns?action=reorder&projectId=${encodeURIComponent(selectedProjectId)}`,
        {
          method: 'POST',
          auth: true,
          headers: { 'X-Team-Id': selectedTeamId },
          body: { ids }
        },
        onUpdateAccessToken
      );
      setColumns(Array.isArray(data.items) ? data.items : nextColumns);
      if (showSuccess && shouldShowReorderNotification()) {
        showNotification('Порядок колонок сохранен', 'success');
      }
      return true;
    } catch (error) {
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
  };

  const onTaskColumnDragOver = (event, targetColumnId) => {
    if (!draggingTaskId) return;
    event.preventDefault();
    setDragOverTaskColumnId(targetColumnId);
  };

  const onTaskColumnDragLeave = (targetColumnId) => {
    if (dragOverTaskColumnId === targetColumnId) {
      setDragOverTaskColumnId('');
    }
  };

  const onColumnDrop = async (event, targetColumnId) => {
    event.preventDefault();
    setDragOverTaskColumnId('');
    const taskID = event.dataTransfer.getData('text/task-id');
    if (!taskID) return;
    const task = tasks.find((item) => item.id === taskID);
    if (!task || task.status === targetColumnId) return;
    await handleMoveTask(task, targetColumnId);
    setDraggingTaskId('');
  };

  return (
    <section className="single-page wide-page tasks-page">
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
            <details className="sidebar-card" open={canManageDeadlineSettings}>
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
                <label className="task-name-block" style={{ gridColumn: '1 / -1' }}>
                  <span>Название</span>
                  <textarea
                    value={taskForm.title}
                    onChange={(event) => handleTaskChange('title', event.target.value)}
                    onInput={(event) => autoResizeTextarea(event.currentTarget, 200)}
                    placeholder="Новая задача"
                    rows={1}
                    style={{ minHeight: '48px', maxHeight: '200px', resize: 'none', overflowY: 'auto' }}
                  />
                  {taskSuggestion?.title && taskSuggestion.title.trim() !== taskForm.title.trim() && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch', marginTop: '10px', padding: '12px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.14)', border: '1px solid rgba(34, 197, 94, 0.35)' }}>
                      <div style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{taskSuggestion.title}</div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                  <span>Исполнитель</span>
                  <select className="assignee-select" value={taskForm.assigneeUserId} onChange={(event) => handleTaskChange('assigneeUserId', event.target.value)}>
                    <option value="">Не назначен</option>
                    {assigneeOptions.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
                  </select>
                </label>
                <label className="task-description-field" style={{ gridColumn: '1 / -1' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
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
                    style={{ minHeight: '96px', maxHeight: '220px', resize: 'none', overflowY: 'auto' }}
                  />
                  {taskSuggestion?.description && taskSuggestion.description.trim() !== taskForm.description.trim() && (
                    <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch', marginTop: '10px', padding: '12px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.14)', border: '1px solid rgba(34, 197, 94, 0.35)' }}>
                      <div style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{taskSuggestion.description}</div>
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
          <div className="tasks-header compact-header board-topbar">
            <div>
              <p className="section-label">ЗАДАЧИ</p>
              <h2>{activeProject?.name || 'Доска проекта'}</h2>
            </div>
            <div className="tasks-header-actions">
              <button type="button" className="ghost" onClick={() => setIsSidebarOpen((prev) => !prev)}>{isSidebarOpen ? 'Скрыть панель' : 'Показать панель'}</button>
              <button type="button" className="ghost" onClick={() => navigate('/cabinet')}>Профиль</button>
              <button type="button" className="ghost" onClick={() => void loadTasks(selectedTeamId, selectedProjectId)} disabled={!selectedTeamId || !selectedProjectId}>Обновить</button>
            </div>
          </div>

          <div className="search-filter-bar">
            <input
              type="search"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Поиск по названию или описанию задачи"
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

          <div className="task-board">
          {boardColumns.length === 0 ? (
            <p className="empty-state">Создайте первую колонку, чтобы начать работу с задачами.</p>
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
                    <article key={task.id} className={`task-card ${draggingTaskId === task.id ? 'dragging' : ''} ${isUrgentDeadline(task) ? 'urgent-deadline' : ''} ${isTaskDone(task) ? 'completed' : ''}`} draggable onDragStart={(event) => onTaskDragStart(event, task.id)} onDragEnd={onTaskDragEnd}>
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
                              onDoubleClick={() => handleInlineEditStart(task)}
                              title="Двойной клик для редактирования"
                              aria-label="Название задачи"
                            >
                              {task.title}
                            </strong>
                          )}
                        </div>
                        <div className="task-card-top-meta">
                          <span className="task-priority-badge">{priorityLabel(task.priority)}</span>
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
                                  disabled={!task.dueAt || !task.assigneeUserId || pendingNotificationTaskId === task.id || isTaskDone(task)}
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
                      {task.description && <p>{task.description}</p>}
                      <div className="task-card-meta">
                        {task.dueAt ? <span>Срок: {new Date(task.dueAt).toLocaleString()}</span> : <span>Без срока</span>}
                        {task.assigneeUserId ? <span>Исполнитель: {task.assigneeName || assigneeLabelById.get(task.assigneeUserId) || task.assigneeUserId}</span> : <span>Исполнитель: не назначен</span>}
                        {task.unreadComments > 0 && <span className="task-unread-pill">Новых сообщений: {task.unreadComments}</span>}
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            );
          })}
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
                    <label className="task-name-block" style={{ gridColumn: '1 / -1' }}>
                      <span>Название</span>
                      <textarea
                        value={editorTaskForm.title}
                        onChange={(event) => handleEditorTaskChange('title', event.target.value)}
                        onInput={(event) => autoResizeTextarea(event.currentTarget, 200)}
                        placeholder="Название задачи"
                        rows={1}
                        style={{ minHeight: '48px', maxHeight: '200px', resize: 'none', overflowY: 'auto' }}
                      />
                      {editorTaskSuggestion?.title && editorTaskSuggestion.title.trim() !== editorTaskForm.title.trim() && (
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch', marginTop: '10px', padding: '12px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.14)', border: '1px solid rgba(34, 197, 94, 0.35)' }}>
                          <div style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{editorTaskSuggestion.title}</div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
                      <span>Исполнитель</span>
                      <select className="assignee-select" value={editorTaskForm.assigneeUserId} onChange={(event) => handleEditorTaskChange('assigneeUserId', event.target.value)}>
                        <option value="">Не назначен</option>
                        {assigneeOptions.map((member) => <option key={member.userId} value={member.userId}>{member.displayName}</option>)}
                      </select>
                    </label>
                    <label className="task-description-field" style={{ gridColumn: '1 / -1' }}>
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
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
                        style={{ minHeight: '96px', maxHeight: '220px', resize: 'none', overflowY: 'auto' }}
                      />
                      {editorTaskSuggestion?.description && editorTaskSuggestion.description.trim() !== editorTaskForm.description.trim() && (
                        <div style={{ display: 'flex', gap: '10px', alignItems: 'stretch', marginTop: '10px', padding: '12px', borderRadius: '12px', background: 'rgba(34, 197, 94, 0.14)', border: '1px solid rgba(34, 197, 94, 0.35)' }}>
                          <div style={{ flex: 1, whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{editorTaskSuggestion.description}</div>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
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
              </div>
            </div>
          </div>
        )}
      </article>
    </section>
  );
}
