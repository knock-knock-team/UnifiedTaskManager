import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

function normalizeApiBase(value) {
  const raw = String(value || '').trim();
  if (!raw) return '/api';
  const lower = raw.toLowerCase();
  const legacyValues = [
    '/api/user-service',
    '/api/task-service',
    'localhost:8082',
    '127.0.0.1:8082',
    'http://localhost:8082',
    'https://localhost:8082',
    'http://127.0.0.1:8082',
    'https://127.0.0.1:8082',
    'localhost:8083',
    '127.0.0.1:8083',
    'http://localhost:8083',
    'https://localhost:8083',
    'http://127.0.0.1:8083',
    'https://127.0.0.1:8083'
  ];
  if (legacyValues.some((item) => lower === item || lower.startsWith(`${item}/`))) {
    return '/api';
  }
  return raw;
}

const storage = {
  get apiBase() {
    return normalizeApiBase(localStorage.getItem('apiBase'));
  },
  set apiBase(value) {
    localStorage.setItem('apiBase', normalizeApiBase(value));
  },
  get taskApiBase() {
    return normalizeApiBase(localStorage.getItem('taskApiBase'));
  },
  set taskApiBase(value) {
    localStorage.setItem('taskApiBase', normalizeApiBase(value));
  },
  get taskTeamId() {
    return localStorage.getItem('taskTeamId') || '';
  },
  set taskTeamId(value) {
    localStorage.setItem('taskTeamId', value || '');
  },
  get taskProjectId() {
    return localStorage.getItem('taskProjectId') || '';
  },
  set taskProjectId(value) {
    localStorage.setItem('taskProjectId', value || '');
  },
  get accessToken() {
    return localStorage.getItem('accessToken') || '';
  },
  set accessToken(value) {
    localStorage.setItem('accessToken', value || '');
  },
  get refreshToken() {
    return localStorage.getItem('refreshToken') || '';
  },
  set refreshToken(value) {
    localStorage.setItem('refreshToken', value || '');
  },
  clearTokens() {
    localStorage.removeItem('accessToken');
    localStorage.removeItem('refreshToken');
  }
};

let refreshPromise = null;

async function refreshAccessToken(apiBase, refreshToken) {
  if (!refreshToken) {
    throw new Error('invalid token');
  }

  // Prevent multiple simultaneous refresh attempts
  if (refreshPromise) {
    return refreshPromise;
  }

  refreshPromise = (async () => {
    try {
      const response = await fetch(`${apiBase}/v1/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken })
      });

      let data = {};
      try {
        data = await response.json();
      } catch {
        data = {};
      }

      if (!response.ok) {
        throw new Error(data.message || 'Token refresh failed');
      }

      storage.accessToken = data.tokens.accessToken;
      storage.refreshToken = data.tokens.refreshToken;
      return data.tokens.accessToken;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

async function request(apiBase, accessToken, path, options = {}, onTokenRefresh) {
  const { method = 'GET', body, auth = false, headers: extraHeaders = {} } = options;
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };

  if (auth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  let response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

  // Handle 401 Unauthorized - try to refresh token
  if (response.status === 401 && auth && onTokenRefresh) {
    const refreshToken = storage.refreshToken;
    if (refreshToken) {
      try {
        const newAccessToken = await refreshAccessToken(apiBase, refreshToken);
        onTokenRefresh(newAccessToken);

        // Retry request with new token
        headers.Authorization = `Bearer ${newAccessToken}`;
        response = await fetch(`${apiBase}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined
        });
      } catch (err) {
        // Refresh failed - user must login again
        storage.clearTokens();
        onTokenRefresh(null);
        throw new Error('Сессия истекла. Пожалуйста, авторизируйтесь снова.');
      }
    } else {
      storage.clearTokens();
      throw new Error('Сессия истекла. Пожалуйста, авторизируйтесь снова.');
    }
  }

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.message || `HTTP ${response.status}`);
  }

  return data;
}

function formatDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (number) => String(number).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseDateTimeLocal(value) {
  if (!value) return null;
  const [datePart, timePart] = String(value).split('T');
  if (!datePart || !timePart) return null;
  const [year, month, day] = datePart.split('-').map((part) => Number(part));
  const [hours, minutes] = timePart.split(':').map((part) => Number(part));
  if ([year, month, day, hours, minutes].some((part) => Number.isNaN(part))) return null;
  const date = new Date(year, month - 1, day, hours, minutes, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function groupTasksByStatus(tasks) {
  return tasks.reduce((accumulator, task) => {
    const key = task.status || 'todo';
    if (!accumulator[key]) {
      accumulator[key] = [];
    }
    accumulator[key].push(task);
    return accumulator;
  }, { todo: [], in_progress: [], done: [] });
}

function statusLabel(status) {
  const value = String(status || '').trim();
  if (value === 'in_progress') return 'В работе';
  if (value === 'done') return 'Готово';
  if (value === 'todo') return 'Бэклог';
  return value || 'Без статуса';
}

function priorityLabel(priority) {
  switch (priority) {
    case 'high':
      return 'Высокий';
    case 'low':
      return 'Низкий';
    default:
      return 'Средний';
  }
}

const TEAM_PERMISSION_OPTIONS = [
  { key: 'projects.manage', label: 'Создавать и удалять проекты' },
  { key: 'roles.manage', label: 'Управлять ролями команды' },
  { key: 'members.manage', label: 'Приглашать и менять роли в команде' },
  { key: 'tasks.read', label: 'Чтение задач' },
  { key: 'tasks.write', label: 'Изменение задач' }
];

const BASIC_TEAM_PERMISSION_KEYS = ['tasks.read', 'tasks.write', 'members.manage'];

const PROJECT_PERMISSION_OPTIONS = [
  { key: 'tasks.read', label: 'Чтение задач проекта' },
  { key: 'tasks.write', label: 'Изменение и перенос задач' },
  { key: 'project.members.manage', label: 'Назначать людей в проект' },
  { key: 'project.roles.manage', label: 'Управлять ролями проекта' }
];

const BASIC_PROJECT_PERMISSION_KEYS = ['tasks.read', 'tasks.write'];

function normalizeURL(value) {
  const trimmed = (value || '').trim();
  if (!trimmed) {
    return '';
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }
  return `https://${trimmed}`;
}

function Toast({ notification, onClose }) {
  if (!notification) return null;
  
  return (
    <div className={`toast toast-${notification.type}`}>
      <span>{notification.message}</span>
      <button type="button" className="toast-close" onClick={onClose}>&times;</button>
    </div>
  );
}

function CabinetSettings({ profile, accessToken, apiBase, showNotification, onProfileUpdate, onUpdateAccessToken }) {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: profile?.name || '',
    tag: profile?.tag || '',
    bio: profile?.bio || '',
    githubUrl: profile?.githubUrl || '',
    linkedInUrl: profile?.linkedInUrl || '',
    telegram: profile?.telegram || '',
    websiteUrl: profile?.websiteUrl || '',
    secondaryEmail: profile?.secondaryEmail || '',
    password: ''
  });
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const handleChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  const handleDiscard = () => {
    setFormData({
      name: profile?.name || '',
      tag: profile?.tag || '',
      bio: profile?.bio || '',
      githubUrl: profile?.githubUrl || '',
      linkedInUrl: profile?.linkedInUrl || '',
      telegram: profile?.telegram || '',
      websiteUrl: profile?.websiteUrl || '',
      secondaryEmail: profile?.secondaryEmail || '',
      password: ''
    });
    setIsDirty(false);
    showNotification('Изменения отменены', 'info');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const payload = {};
    if (formData.name.trim() !== (profile?.name || '')) payload.name = formData.name.trim();
    if ((formData.tag || '').trim() !== (profile?.tag || '')) payload.tag = (formData.tag || '').trim();
    if (formData.bio.trim() !== (profile?.bio || '')) payload.bio = formData.bio.trim();
    if (normalizeURL(formData.githubUrl) !== (profile?.githubUrl || '')) payload.githubUrl = normalizeURL(formData.githubUrl);
    if (normalizeURL(formData.linkedInUrl) !== (profile?.linkedInUrl || '')) payload.linkedInUrl = normalizeURL(formData.linkedInUrl);
    if (formData.telegram.trim() !== (profile?.telegram || '')) payload.telegram = formData.telegram.trim();
    if (normalizeURL(formData.websiteUrl) !== (profile?.websiteUrl || '')) payload.websiteUrl = normalizeURL(formData.websiteUrl);
    if (formData.secondaryEmail.trim().toLowerCase() !== (profile?.secondaryEmail || '')) payload.secondaryEmail = formData.secondaryEmail.trim().toLowerCase();
    if (formData.password.trim()) payload.password = formData.password.trim();

    if (Object.keys(payload).length === 0) {
      showNotification('Нет изменений для сохранения', 'info');
      return;
    }

    setIsSaving(true);
    try {
      const data = await request(apiBase, accessToken, '/v1/users/me', {
        method: 'PATCH',
        auth: true,
        body: payload
      }, onUpdateAccessToken);
      showNotification('Профиль успешно обновлён', 'success');
      onProfileUpdate(data);
      setTimeout(() => navigate('/cabinet', { replace: true }), 1000);
    } catch (error) {
      showNotification(error.message || 'Ошибка при сохранении профиля', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="single-page wide-page">
      <article className="pane cabinet-page">
        <div className="cabinet-toolbar">
          <button type="button" className="link-chip" onClick={() => navigate('/cabinet')}>Профиль</button>
          <button type="button" className="link-chip active">Настройки профиля {isDirty && <span className="unsaved-indicator">*</span>}</button>
        </div>

        <div className="cabinet-content">
          <p className="section-label">НАСТРОЙКИ ПРОФИЛЯ</p>
          <h2>Изменить профиль</h2>
          <p className="section-text">Основную почту менять нельзя. Можно добавить тег для поиска, дополнительную почту и ссылки на публичные профили.</p>
          <form onSubmit={handleSubmit} className="settings-form profile-form">
            <div className="profile-form-grid">
              <label>
                <span>Имя</span>
                <input value={formData.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="Новое имя" />
              </label>
              <label>
                <span>Тег</span>
                <input value={formData.tag} onChange={(e) => handleChange('tag', e.target.value)} placeholder="@yourtag" />
              </label>
              <label>
                <span>Дополнительная почта</span>
                <input value={formData.secondaryEmail} onChange={(e) => handleChange('secondaryEmail', e.target.value)} type="email" placeholder="second.email@example.com" />
              </label>
              <label>
                <span>GitHub</span>
                <input value={formData.githubUrl} onChange={(e) => handleChange('githubUrl', e.target.value)} placeholder="https://github.com/username" />
              </label>
              <label>
                <span>LinkedIn</span>
                <input value={formData.linkedInUrl} onChange={(e) => handleChange('linkedInUrl', e.target.value)} placeholder="https://www.linkedin.com/in/username" />
              </label>
              <label>
                <span>Telegram</span>
                <input value={formData.telegram} onChange={(e) => handleChange('telegram', e.target.value)} placeholder="@username или https://t.me/username" />
              </label>
              <label>
                <span>Сайт или портфолио</span>
                <input value={formData.websiteUrl} onChange={(e) => handleChange('websiteUrl', e.target.value)} placeholder="https://example.com" />
              </label>
              <label className="profile-bio-field">
                <span>О себе</span>
                <textarea value={formData.bio} onChange={(e) => handleChange('bio', e.target.value)} placeholder="Коротко о себе, роли, опыте, интересах" rows={5} />
              </label>
              <label>
                <span>Новый пароль</span>
                <input value={formData.password} onChange={(e) => handleChange('password', e.target.value)} type="password" minLength={8} placeholder="Оставьте пустым, если не меняете пароль" />
              </label>
            </div>
            <div className="row">
              <button type="submit" disabled={!isDirty || isSaving}>{isSaving ? 'Сохраняется...' : `Сохранить изменения ${isDirty ? '*' : ''}`}</button>
              <button type="button" className="ghost" disabled={!isDirty} onClick={handleDiscard}>Отменить изменения</button>
              <button type="button" className="ghost" onClick={() => navigate('/cabinet')}>Назад к профилю</button>
            </div>
          </form>
        </div>
      </article>
    </section>
  );
}

function TasksPage({ accessToken, apiBase, taskApiBase, profile, showNotification, onUpdateAccessToken }) {
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

  const resetTaskForm = useCallback((nextColumnId = '') => {
    setTaskForm({
      title: '',
      description: '',
      priority: 'medium',
      dueAt: '',
      columnId: nextColumnId || boardColumns[0]?.id || '',
      assigneeUserId: ''
    });
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

  useEffect(() => {
    void loadTeams();
    void loadPendingInvites();
  }, [loadPendingInvites, loadTeams]);

  useEffect(() => {
    storage.taskTeamId = selectedTeamId;
    if (!selectedTeamId) {
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
  }, [closeTaskEditor, loadProjects, selectedTeamId, loadTeamDirectory]);

  useEffect(() => {
    storage.taskProjectId = selectedProjectId;
    if (!selectedProjectId || !selectedTeamId) {
      setTasks([]);
      setColumns([]);
      closeTaskEditor();
      return;
    }
    closeTaskEditor();
    void loadColumns(selectedTeamId, selectedProjectId);
    void loadTasks(selectedTeamId, selectedProjectId);
    void loadProjectDirectory(selectedTeamId, selectedProjectId);
  }, [closeTaskEditor, selectedProjectId, selectedTeamId, loadColumns, loadProjectDirectory, loadTasks]);

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
      storage.taskProjectId = '';
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

          <details className="sidebar-card">
            <summary>Входящие приглашения</summary>
            {pendingInvites.length === 0 ? <p className="muted-caption">Нет приглашений</p> : pendingInvites.map((invite) => (
              <div key={invite.id} className="sidebar-inline-row compact-row">
                <span className="compact-meta">{invite.teamName || invite.teamId} ({invite.roleKey})</span>
                <button type="button" className="compact-btn" onClick={() => void handleAcceptInvite(invite.id)}>Принять</button>
              </div>
            ))}
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
              <div className="task-form-grid task-form-grid-compact">
                <label>
                  <span>Название</span>
                  <input value={taskForm.title} onChange={(event) => handleTaskChange('title', event.target.value)} placeholder="Новая задача" />
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
                <label className="task-description-field">
                  <span>Описание</span>
                  <textarea value={taskForm.description} onChange={(event) => handleTaskChange('description', event.target.value)} rows={3} placeholder="Кратко и по делу" />
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
                    <article key={task.id} className={`task-card ${draggingTaskId === task.id ? 'dragging' : ''}`} draggable onDragStart={(event) => onTaskDragStart(event, task.id)} onDragEnd={onTaskDragEnd}>
                      <div className="task-card-top">
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
                            onDoubleClick={() => handleInlineEditStart(task)}
                            title="Двойной клик для редактирования"
                            aria-label="Название задачи"
                          >
                            {task.title}
                          </strong>
                        )}
                        <span>{priorityLabel(task.priority)}</span>
                      </div>
                      {task.description && <p>{task.description}</p>}
                      <div className="task-card-meta">
                        {task.dueAt ? <span>Срок: {new Date(task.dueAt).toLocaleString()}</span> : <span>Без срока</span>}
                        {task.assigneeUserId ? <span>Исполнитель: {task.assigneeName || assigneeLabelById.get(task.assigneeUserId) || task.assigneeUserId}</span> : <span>Исполнитель: не назначен</span>}
                        {task.unreadComments > 0 && <span className="task-unread-pill">Новых сообщений: {task.unreadComments}</span>}
                      </div>
                      <div className="task-card-actions">
                        <button type="button" className="ghost icon-btn" onClick={() => handleEditTask(task)} title="Изменить задачу" aria-label="Изменить">✎</button>
                        <button type="button" className="ghost icon-btn danger" onClick={() => void handleDeleteTask(task.id)} title="Удалить задачу" aria-label="Удалить">✕</button>
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            );
          })}
        </div>
        </div>

        {editorTask && (
          <div className="task-modal-backdrop" onMouseDown={closeTaskEditor} role="presentation">
            <div className="task-modal" onMouseDown={(event) => event.stopPropagation()} role="dialog" aria-modal="true" aria-label="Редактирование задачи">
              <div className="task-modal-header">
                <div>
                  <p className="section-label">РЕДАКТИРОВАНИЕ ЗАДАЧИ</p>
                  <h3>{editorTask.title}</h3>
                </div>
                <button type="button" className="ghost icon-btn" onClick={closeTaskEditor} aria-label="Закрыть">✕</button>
              </div>

              <div className="task-modal-body">
                <form className="task-modal-form" onSubmit={handleEditorTaskSubmit}>
                  <div className="task-form-grid task-form-grid-compact">
                    <label>
                      <span>Название</span>
                      <input value={editorTaskForm.title} onChange={(event) => handleEditorTaskChange('title', event.target.value)} placeholder="Название задачи" />
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
                    <label className="task-description-field">
                      <span>Описание</span>
                      <textarea value={editorTaskForm.description} onChange={(event) => handleEditorTaskChange('description', event.target.value)} rows={4} placeholder="Описание задачи" />
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

function ChatPage({ accessToken, apiBase, profile, showNotification, onUpdateAccessToken }) {
  const [rooms, setRooms] = useState([]);
  const [selectedRoomId, setSelectedRoomId] = useState('');
  const [roomDetails, setRoomDetails] = useState(null);
  const [messages, setMessages] = useState([]);
  const [userDirectory, setUserDirectory] = useState({});
  const [isLoadingRooms, setIsLoadingRooms] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);
  const [isAddingParticipant, setIsAddingParticipant] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);

  const [newRoomTitle, setNewRoomTitle] = useState('');
  const [newRoomParticipantQuery, setNewRoomParticipantQuery] = useState('');
  const [addParticipantQuery, setAddParticipantQuery] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const messagesContainerRef = useRef(null);
  const scrollModeRef = useRef('none');
  const preservedScrollTopRef = useRef(0);

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) || null,
    [rooms, selectedRoomId]
  );

  const loadRooms = useCallback(async () => {
    if (!accessToken) return;
    setIsLoadingRooms(true);
    try {
      const data = await request(apiBase, accessToken, '/v1/chats/rooms?limit=100&offset=0', { auth: true }, onUpdateAccessToken);
      const items = Array.isArray(data.items) ? data.items : [];
      setRooms(items);
      setSelectedRoomId((prev) => {
        if (prev && items.some((item) => item.id === prev)) return prev;
        return items[0]?.id || '';
      });
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить чаты', 'error');
    } finally {
      setIsLoadingRooms(false);
    }
  }, [accessToken, apiBase, onUpdateAccessToken, showNotification]);

  const lookupUser = useCallback(async (query) => {
    const raw = String(query || '').trim();
    if (!raw) {
      return null;
    }
    const isTagQuery = raw.startsWith('@');
    const isEmailQuery = !isTagQuery && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw);
    const lookupPath = isEmailQuery
      ? `/v1/users/lookup?email=${encodeURIComponent(raw.toLowerCase())}`
      : `/v1/users/lookup?tag=${encodeURIComponent(raw.replace(/^@+/, ''))}`;
    const data = await request(apiBase, accessToken, lookupPath, { auth: true }, onUpdateAccessToken);
    return data || null;
  }, [accessToken, apiBase, onUpdateAccessToken]);

  const lookupUserById = useCallback(async (userId) => {
    const normalizedId = String(userId || '').trim();
    if (!normalizedId) {
      return null;
    }
    const data = await request(apiBase, accessToken, `/v1/users/lookup?id=${encodeURIComponent(normalizedId)}`, { auth: true }, onUpdateAccessToken);
    return data || null;
  }, [accessToken, apiBase, onUpdateAccessToken]);

  const loadRoomDetails = useCallback(async (roomID) => {
    if (!accessToken || !roomID) {
      setRoomDetails(null);
      return;
    }
    try {
      const data = await request(apiBase, accessToken, `/v1/chats/rooms/${encodeURIComponent(roomID)}`, { auth: true }, onUpdateAccessToken);
      setRoomDetails(data || null);
    } catch {
      setRoomDetails(null);
    }
  }, [accessToken, apiBase, onUpdateAccessToken]);

  const loadMessages = useCallback(async (roomID) => {
    if (!accessToken || !roomID) {
      setMessages([]);
      return;
    }
    const container = messagesContainerRef.current;
    if (container) {
      const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
      if (scrollModeRef.current === 'bottom' || distanceToBottom < 72) {
        scrollModeRef.current = 'bottom';
      } else {
        scrollModeRef.current = 'keep';
        preservedScrollTopRef.current = container.scrollTop;
      }
    }
    setIsLoadingMessages(true);
    try {
      const data = await request(apiBase, accessToken, `/v1/chats/rooms/${encodeURIComponent(roomID)}/messages?limit=100&offset=0`, { auth: true }, onUpdateAccessToken);
      setMessages(Array.isArray(data.items) ? data.items : []);
    } catch (error) {
      showNotification(error.message || 'Не удалось загрузить сообщения', 'error');
    } finally {
      setIsLoadingMessages(false);
    }
  }, [accessToken, apiBase, onUpdateAccessToken, showNotification]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    if (!selectedRoomId) {
      setMessages([]);
      setRoomDetails(null);
      return;
    }
    scrollModeRef.current = 'bottom';
    void loadRoomDetails(selectedRoomId);
    void loadMessages(selectedRoomId);
  }, [selectedRoomId, loadMessages, loadRoomDetails]);

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) {
      return;
    }

    const mode = scrollModeRef.current;
    requestAnimationFrame(() => {
      if (mode === 'bottom') {
        container.scrollTop = container.scrollHeight;
      } else if (mode === 'keep') {
        const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
        container.scrollTop = Math.min(preservedScrollTopRef.current, maxScrollTop);
      }
      scrollModeRef.current = 'none';
    });
  }, [messages, selectedRoomId]);

  useEffect(() => {
    if (!accessToken) {
      setUserDirectory({});
      return;
    }
    const ids = new Set();
    (roomDetails?.participantIds || []).forEach((id) => {
      if (id && id !== profile?.id && !userDirectory[id]) {
        ids.add(id);
      }
    });
    messages.forEach((message) => {
      if (message?.senderUserId && message.senderUserId !== profile?.id && !userDirectory[message.senderUserId]) {
        ids.add(message.senderUserId);
      }
    });
    if (ids.size === 0) {
      return;
    }

    let cancelled = false;
    const fetchUsers = async () => {
      const entries = await Promise.all(Array.from(ids).map(async (id) => {
        try {
          const user = await lookupUserById(id);
          return user?.id ? [user.id, user] : null;
        } catch {
          return null;
        }
      }));
      if (cancelled) return;
      setUserDirectory((prev) => {
        const next = { ...prev };
        entries.forEach((entry) => {
          if (entry) {
            const [id, user] = entry;
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
  }, [accessToken, lookupUserById, messages, profile?.id, roomDetails]);

  const handleCreateDirectChat = async (event) => {
    event.preventDefault();
    const participantQuery = String(newRoomParticipantQuery || '').trim();
    if (!participantQuery) {
      showNotification('Введите @тег или email участника', 'error');
      return;
    }

    setIsCreatingRoom(true);
    try {
      const user = await lookupUser(participantQuery);
      if (!user?.id) {
        showNotification('Пользователь с таким тегом или email не найден', 'error');
        return;
      }
      const payload = {
        title: newRoomTitle.trim() || null,
        participantIds: [user.id]
      };
      const room = await request(apiBase, accessToken, '/v1/chats/rooms', {
        method: 'POST',
        auth: true,
        body: payload
      }, onUpdateAccessToken);

      setNewRoomTitle('');
      setNewRoomParticipantQuery('');
      showNotification('Диалог создан', 'success');
      await loadRooms();
      if (room?.id) {
        setSelectedRoomId(room.id);
      }
    } catch (error) {
      showNotification(error.message || 'Не удалось создать диалог', 'error');
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleSendMessage = async (event) => {
    event.preventDefault();
    if (!selectedRoomId) {
      showNotification('Сначала выберите чат', 'error');
      return;
    }
    const body = messageBody.trim();
    if (!body) {
      showNotification('Введите сообщение', 'error');
      return;
    }

    setIsSendingMessage(true);
    scrollModeRef.current = 'bottom';
    try {
      await request(apiBase, accessToken, `/v1/chats/rooms/${encodeURIComponent(selectedRoomId)}/messages`, {
        method: 'POST',
        auth: true,
        body: { body }
      }, onUpdateAccessToken);
      setMessageBody('');
      await loadMessages(selectedRoomId);
      await loadRooms();
    } catch (error) {
      showNotification(error.message || 'Не удалось отправить сообщение', 'error');
    } finally {
      setIsSendingMessage(false);
    }
  };

  const handleMessageKeyDown = (event) => {
    if (event.isComposing) {
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      if (!isSendingMessage && messageBody.trim() && selectedRoomId) {
        void handleSendMessage(event);
      }
    }
  };

  const handleAddParticipant = async (event) => {
    event.preventDefault();
    if (!selectedRoomId) {
      showNotification('Сначала выберите чат', 'error');
      return;
    }

    const query = String(addParticipantQuery || '').trim();
    if (!query) {
      showNotification('Введите @тег или email участника', 'error');
      return;
    }

    setIsAddingParticipant(true);
    try {
      const user = await lookupUser(query);
      if (!user?.id) {
        showNotification('Пользователь не найден', 'error');
        return;
      }
      await request(apiBase, accessToken, `/v1/chats/rooms/${encodeURIComponent(selectedRoomId)}/participants`, {
        method: 'POST',
        auth: true,
        body: { participantIds: [user.id] }
      }, onUpdateAccessToken);

      setAddParticipantQuery('');
      await loadRoomDetails(selectedRoomId);
      await loadRooms();
      showNotification('Участник добавлен в чат', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось добавить участника', 'error');
    } finally {
      setIsAddingParticipant(false);
    }
  };

  const resolveRoomTitle = (room) => {
    if (!room) return 'Без названия';
    if (room.title && String(room.title).trim()) return room.title;
    const participantNames = (roomDetails?.participantIds || [])
      .filter((id) => id && id !== profile?.id)
      .map((id) => userDirectory[id]?.name || userDirectory[id]?.tag || String(id).slice(0, 8));
    if (participantNames.length > 0) {
      return participantNames.join(', ');
    }
    return `Личный диалог ${String(room.id || '').slice(0, 8)}`;
  };

  const resolveUserLabel = (userId) => {
    if (!userId) return 'Неизвестно';
    if (userId === profile?.id) {
      if (profile?.name) {
        return profile?.tag ? `${profile.name} (@${profile.tag})` : profile.name;
      }
      return profile?.tag ? `@${profile.tag}` : 'Вы';
    }
    const user = userDirectory[userId];
    if (user?.tag) {
      return user.name ? `${user.name} (@${user.tag})` : `@${user.tag}`;
    }
    if (user?.name) {
      return user.name;
    }
    return String(userId).slice(0, 8);
  };

  const isRoomOwner = Boolean(roomDetails?.createdBy && roomDetails.createdBy === profile?.id);

  const participantItems = useMemo(() => {
    const ids = Array.isArray(roomDetails?.participantIds) ? roomDetails.participantIds : [];
    return ids.map((id) => ({
      id,
      label: resolveUserLabel(id),
      isOwner: id === roomDetails?.createdBy,
      isSelf: id === profile?.id
    }));
  }, [profile?.id, roomDetails, userDirectory]);

  const handleRemoveParticipant = async (userId) => {
    if (!selectedRoomId) {
      return;
    }
    try {
      await request(apiBase, accessToken, `/v1/chats/rooms/${encodeURIComponent(selectedRoomId)}/participants/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        auth: true
      }, onUpdateAccessToken);
      await loadRoomDetails(selectedRoomId);
      await loadMessages(selectedRoomId);
      await loadRooms();
      showNotification('Участник удален из чата', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось удалить участника', 'error');
    }
  };

  const senderAccent = (userId) => {
    const value = String(userId || 'unknown');
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash << 5) - hash + value.charCodeAt(i);
      hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 68% 62%)`;
  };

  return (
    <section className="single-page wide-page">
      <article className="pane chat-layout">
        <aside className="chat-sidebar">
          <div className="chat-sidebar-header">
            <p className="section-label">ЧАТЫ</p>
            <h3>Диалоги</h3>
          </div>

          <form className="sidebar-form compact-form" onSubmit={handleCreateDirectChat}>
            <p className="compact-subtitle">Новое личное сообщение</p>
            <label>
              <span>Собеседник (@тег или email)</span>
              <input value={newRoomParticipantQuery} onChange={(event) => setNewRoomParticipantQuery(event.target.value)} placeholder="@username или user@example.com" />
            </label>
            <label>
              <span>Название чата (необязательно)</span>
              <input value={newRoomTitle} onChange={(event) => setNewRoomTitle(event.target.value)} placeholder="Например: Дизайн" />
            </label>
            <button type="submit" className="compact-btn" disabled={isCreatingRoom || !newRoomParticipantQuery.trim()}>
              {isCreatingRoom ? 'Создаем...' : 'Создать диалог'}
            </button>
          </form>

          <div className="chat-room-list">
            {isLoadingRooms ? <p className="muted-caption">Загрузка чатов...</p> : rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                className={`chat-room-item ${selectedRoomId === room.id ? 'active' : ''}`}
                onClick={() => setSelectedRoomId(room.id)}
              >
                <strong>{resolveRoomTitle(room)}</strong>
                <span>{new Date(room.updatedAt || room.createdAt).toLocaleString()}</span>
              </button>
            ))}
            {!isLoadingRooms && rooms.length === 0 && <p className="muted-caption">Пока нет диалогов</p>}
          </div>
        </aside>

        <div className="chat-main">
          <header className="chat-main-header">
            <div>
              <p className="section-label">ЛИЧНЫЕ СООБЩЕНИЯ</p>
              <h3>{resolveRoomTitle(selectedRoom || roomDetails)}</h3>
              <p className="muted-caption">Участников: {roomDetails?.participantIds?.length || 0}</p>
              {participantItems.length > 0 && (
                <div className="chat-participants-list">
                  {participantItems.map((participant) => (
                    <div key={participant.id} className={`chat-participant-chip ${participant.isOwner ? 'owner' : ''}`}>
                      <span>{participant.label}</span>
                      {participant.isOwner && <em>owner</em>}
                      {isRoomOwner && !participant.isOwner && (
                        <button
                          type="button"
                          className="ghost compact-btn chat-remove-participant-btn"
                          onClick={() => void handleRemoveParticipant(participant.id)}
                          title="Удалить участника из чата"
                          aria-label="Удалить участника"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="chat-main-actions">
              <form className="chat-add-participant-form" onSubmit={handleAddParticipant}>
                <input
                  value={addParticipantQuery}
                  onChange={(event) => setAddParticipantQuery(event.target.value)}
                  placeholder="Добавить: @тег или email"
                  disabled={!selectedRoomId || isAddingParticipant}
                />
                <button type="submit" className="compact-btn" disabled={!selectedRoomId || isAddingParticipant || !addParticipantQuery.trim()}>
                  {isAddingParticipant ? '...' : 'Добавить'}
                </button>
              </form>
              <button type="button" className="ghost" onClick={() => void loadRooms()}>Обновить</button>
            </div>
          </header>

          <div className="chat-messages" ref={messagesContainerRef}>
            {isLoadingMessages ? (
              <p className="empty-state">Загружаем сообщения...</p>
            ) : messages.length === 0 ? (
              <p className="empty-state">Сообщений пока нет</p>
            ) : messages.map((message) => {
              const isMine = message.senderUserId === profile?.id;
              const accent = senderAccent(message.senderUserId);
              return (
              <article
                key={message.id}
                className={`chat-message-item ${isMine ? 'mine' : 'other'}`}
                style={{ '--sender-accent': accent }}
              >
                <div className="chat-message-meta">
                  <span className="chat-author-dot" aria-hidden="true" />
                  <strong>{resolveUserLabel(message.senderUserId)}</strong>
                  <span>{new Date(message.createdAt).toLocaleString()}</span>
                </div>
                <p>{message.body}</p>
              </article>
            );
            })}
          </div>

          <form className="chat-message-form" onSubmit={handleSendMessage}>
            <textarea
              value={messageBody}
              onChange={(event) => setMessageBody(event.target.value)}
              onKeyDown={handleMessageKeyDown}
              placeholder={selectedRoomId ? 'Напишите сообщение...' : 'Сначала выберите чат'}
              disabled={!selectedRoomId || isSendingMessage}
              rows={3}
            />
            <div className="row">
              <button type="submit" disabled={!selectedRoomId || isSendingMessage || !messageBody.trim()}>
                {isSendingMessage ? 'Отправляем...' : 'Отправить'}
              </button>
            </div>
          </form>
        </div>
      </article>
    </section>
  );
}

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [accessToken, setAccessToken] = useState(storage.accessToken);
  const apiBase = storage.apiBase;

  const [profile, setProfile] = useState(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  const isAuthorized = Boolean(accessToken);
  const isProtectedPath = useMemo(() => {
    return location.pathname.startsWith('/tasks') || location.pathname.startsWith('/cabinet') || location.pathname.startsWith('/chats');
  }, [location.pathname]);

  useEffect(() => {
    // Migrate stale localStorage API base values from older builds to gateway path.
    storage.apiBase = storage.apiBase;
    storage.taskApiBase = storage.taskApiBase;
  }, []);

  useEffect(() => {
    storage.accessToken = accessToken;
  }, [accessToken]);

  useEffect(() => {
    if (!isAuthorized && isProtectedPath) {
      navigate('/login', { replace: true });
    }
  }, [isAuthorized, isProtectedPath, navigate]);

  useEffect(() => {
    if (isAuthorized && (location.pathname === '/login' || location.pathname === '/register')) {
      navigate('/cabinet', { replace: true });
    }
  }, [isAuthorized, location.pathname, navigate]);

  useEffect(() => {
    if (!notification) return;
    const timer = setTimeout(() => setNotification(null), 3000);
    return () => clearTimeout(timer);
  }, [notification]);

  const showNotification = useCallback((message, type = 'success') => {
    setNotification({ message, type });
  }, []);

  function setLoggedIn(tokens) {
    if (tokens && tokens.accessToken) {
      storage.accessToken = tokens.accessToken;
      storage.refreshToken = tokens.refreshToken || '';
      setAccessToken(tokens.accessToken);
    } else {
      storage.clearTokens();
      setAccessToken('');
      setProfile(null);
    }
  }

  function onUpdateAccessToken(newToken) {
    if (newToken) {
      setAccessToken(newToken);
    } else {
      storage.clearTokens();
      setAccessToken('');
      setProfile(null);
      showNotification('Сессия истекла. Пожалуйста, авторизируйтесь снова.', 'error');
      navigate('/login', { replace: true });
    }
  }

  async function onRegister(event, name, email, password) {
    event.preventDefault();
    try {
      const data = await request(apiBase, '', '/v1/auth/register', {
        method: 'POST',
        body: {
          name,
          email,
          password
        }
      });
      setProfile(data.user || null);
      setLoggedIn(data.tokens || {});
      showNotification('Регистрация успешна', 'success');
    } catch (error) {
      showNotification(error.message || 'Ошибка при регистрации', 'error');
    }
  }

  async function onLogin(event, email, password) {
    event.preventDefault();
    try {
      const data = await request(apiBase, '', '/v1/auth/login', {
        method: 'POST',
        body: {
          email,
          password
        }
      });
      setProfile(data.user || null);
      setLoggedIn(data.tokens || {});
      showNotification('Вход успешен', 'success');
    } catch (error) {
      showNotification(error.message || 'Ошибка при входе', 'error');
    }
  }

  async function loadProfile() {
    if (!isAuthorized) return;
    setIsProfileLoading(true);
    try {
      const data = await request(apiBase, accessToken, '/v1/users/me', { auth: true }, onUpdateAccessToken);
      setProfile(data);
    } catch (error) {
      showNotification(error.message || 'Ошибка при загрузке профиля', 'error');
    } finally {
      setIsProfileLoading(false);
    }
  }

  useEffect(() => {
    if (isAuthorized && !profile) {
      void loadProfile();
    }
  }, [isAuthorized, profile]);

  function onLogout() {
    setLoggedIn(null);
    showNotification('Вы вышли', 'info');
    navigate('/', { replace: true });
  }

  const navItems = [
    { to: '/', label: 'ГЛАВНАЯ' },
    ...(isAuthorized ? [{ to: '/tasks', label: 'ЗАДАЧИ' }, { to: '/chats', label: 'ЧАТЫ' }, { to: '/cabinet', label: 'ЛИЧНЫЙ КАБИНЕТ' }] : []),
    ...(!isAuthorized ? [{ to: '/register', label: 'РЕГИСТРАЦИЯ' }, { to: '/login', label: 'ЛОГИН' }] : [])
  ];

  function ProtectedRoute({ children }) {
    if (!isAuthorized) {
      return <Navigate to="/login" replace />;
    }
    return children;
  }

  function HomePage() {
    return (
      <>
        <section className="hero hero-home">
          <p className="eyebrow">UNIFIED TASK MANAGER</p>
          <h1>УПРАВЛЕНИЕ ЗАДАЧАМИ С АВТОМАТИЗАЦИЕЙ И СИНХРОНИЗАЦИЕЙ</h1>
          <p className="hero-note">
            Мы строим веб-приложение, где задачи, пользователи и события связаны в единую рабочую систему.
            Пользователи работают в личных кабинетах, создают и обновляют задачи, а автоматизация и события
            синхронизируют изменения между сервисами и участниками процесса.
          </p>
          <div className="hero-cta-row">
            {!isAuthorized && <button type="button" onClick={() => navigate('/register')}>Начать с регистрации</button>}
            {!isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/login')}>У меня уже есть аккаунт</button>}
            {isAuthorized && <button type="button" onClick={() => navigate('/tasks')}>Перейти к задачам</button>}
            {isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/chats')}>Открыть чаты</button>}
            {isAuthorized && <button type="button" className="ghost" onClick={() => navigate('/cabinet')}>Открыть личный кабинет</button>}
          </div>
        </section>

        <section className="section-block">
          <article className="pane">
            <p className="section-label">ПРЕИМУЩЕСТВА</p>
            <h2>Почему эта система удобна</h2>
            <div className="feature-grid">
              <div>
                <strong>Единый поток задач</strong>
                <span>Все изменения по задачам фиксируются последовательно и прозрачно для команды.</span>
              </div>
              <div>
                <strong>Событийная автоматизация</strong>
                <span>Сервисные события запускают полезные действия без ручного контроля.</span>
              </div>
              <div>
                <strong>Масштабируемая архитектура</strong>
                <span>Микросервисы позволяют постепенно развивать функциональность без перегрузки системы.</span>
              </div>
            </div>
          </article>
        </section>

        <section className="section-block">
          <article className="pane">
            <p className="section-label">СЦЕНАРИИ ИСПОЛЬЗОВАНИЯ</p>
            <h2>Как это работает для пользователя</h2>
            <div className="scenario-grid">
              <div>
                <span>01</span>
                <strong>Регистрация и вход</strong>
                <p>Пользователь создаёт аккаунт, авторизуется и получает доступ к своему пространству.</p>
              </div>
              <div>
                <span>02</span>
                <strong>Работа с задачами</strong>
                <p>Создаёт задачи, отслеживает статусы, видит изменения и историю выполнения.</p>
              </div>
              <div>
                <span>03</span>
                <strong>События и уведомления</strong>
                <p>Система реагирует на события задач и запускает автоматические сценарии.</p>
              </div>
            </div>
          </article>
        </section>
      </>
    );
  }

  function RegisterPage() {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    return (
      <section className="single-page">
        <article className="pane single-card">
          <p className="section-label">РЕГИСТРАЦИЯ</p>
          <h2>Создать аккаунт</h2>
          <form onSubmit={(event) => void onRegister(event, name, email, password)} autoComplete="off">
            <input value={name} onChange={(event) => setName(event.target.value)} name="register-name" autoComplete="name" placeholder="Имя" required />
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" name="register-email" autoComplete="email" placeholder="Email" required />
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" name="register-password" autoComplete="new-password" minLength={8} placeholder="Пароль" required />
            <button type="submit">Зарегистрироваться</button>
          </form>
        </article>
      </section>
    );
  }

  function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    return (
      <section className="single-page">
        <article className="pane single-card">
          <p className="section-label">ЛОГИН</p>
          <h2>Войти в аккаунт</h2>
          <form
            onSubmit={(event) => void onLogin(event, email, password)}
            autoComplete="off"
          >
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" name="login-email" autoComplete="username" placeholder="Email" required />
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" name="login-password" autoComplete="current-password" placeholder="Пароль" required />
            <button type="submit">Войти</button>
          </form>
        </article>
      </section>
    );
  }

  function CabinetOverviewPage({ accessToken: cabinetAccessToken, apiBase: cabinetApiBase, onUpdateAccessToken: cabinetUpdateAccessToken }) {
    const [pendingInvites, setPendingInvites] = useState([]);

    const loadPendingInvites = useCallback(async () => {
      if (!cabinetAccessToken) return;
      try {
        const data = await request(cabinetApiBase, cabinetAccessToken, '/v1/teams/invites', { auth: true }, cabinetUpdateAccessToken);
        setPendingInvites(Array.isArray(data.items) ? data.items : []);
      } catch {
        setPendingInvites([]);
      }
    }, [cabinetAccessToken, cabinetApiBase, cabinetUpdateAccessToken]);

    const handleAcceptInvite = async (inviteId) => {
      try {
        await request(cabinetApiBase, cabinetAccessToken, `/v1/teams/invites/${encodeURIComponent(inviteId)}/accept`, {
          method: 'POST',
          auth: true
        }, cabinetUpdateAccessToken);
        showNotification('Приглашение принято', 'success');
        await loadPendingInvites();
      } catch (error) {
        showNotification(error.message || 'Не удалось принять приглашение', 'error');
      }
    };

    useEffect(() => {
      void loadPendingInvites();
    }, [loadPendingInvites]);

    return (
      <section className="single-page wide-page">
        <article className="pane cabinet-page">
          <div className="cabinet-toolbar">
            <button type="button" className="link-chip active">Профиль</button>
            <button type="button" className="link-chip" onClick={() => navigate('/cabinet/settings')}>Настройки профиля</button>
          </div>

          <div className="cabinet-content">
            <p className="section-label">ЛИЧНЫЙ КАБИНЕТ</p>
            <h2>Профиль пользователя</h2>
            {profile?.avatarUrl && <img className="profile-avatar" src={profile.avatarUrl} alt="avatar" />}
            <div className="profile-grid public-profile">
              <div className="profile-card"><span>Тег</span><strong>{profile?.tag ? `@${profile.tag}` : 'Не заполнено'}</strong></div>
              <div className="profile-card"><span>Имя</span><strong>{profile?.name || 'Не заполнено'}</strong></div>
              <div className="profile-card"><span>Email</span><strong>{profile?.email || 'Не заполнено'}</strong></div>
              <div className="profile-card"><span>Доп. почта</span><strong>{profile?.secondaryEmail || 'Не заполнено'}</strong></div>
              <div className="profile-card">
                <span>GitHub</span>
                {profile?.githubUrl ? <a className="profile-link" href={normalizeURL(profile.githubUrl)} target="_blank" rel="noreferrer">{profile.githubUrl}</a> : <strong>Не заполнено</strong>}
              </div>
              <div className="profile-card">
                <span>LinkedIn</span>
                {profile?.linkedInUrl ? <a className="profile-link" href={normalizeURL(profile.linkedInUrl)} target="_blank" rel="noreferrer">{profile.linkedInUrl}</a> : <strong>Не заполнено</strong>}
              </div>
              <div className="profile-card">
                <span>Telegram</span>
                <strong>{profile?.telegram || 'Не заполнено'}</strong>
              </div>
              <div className="profile-card">
                <span>Сайт</span>
                {profile?.websiteUrl ? <a className="profile-link" href={normalizeURL(profile.websiteUrl)} target="_blank" rel="noreferrer">{profile.websiteUrl}</a> : <strong>Не заполнено</strong>}
              </div>
              <div className="profile-card profile-card-wide"><span>О себе</span><strong>{profile?.bio || 'Не заполнено'}</strong></div>
            </div>

            <div className="cabinet-invites-block">
              <p className="section-label">ПРИГЛАШЕНИЯ</p>
              <h3>Входящие приглашения</h3>
              {pendingInvites.length === 0 ? <p className="muted-caption">Нет приглашений</p> : pendingInvites.map((invite) => (
                <div key={invite.id} className="sidebar-inline-row compact-row">
                  <span className="compact-meta">{invite.teamName || invite.teamId} ({invite.roleKey})</span>
                  <button type="button" className="compact-btn" onClick={() => void handleAcceptInvite(invite.id)}>Принять</button>
                </div>
              ))}
            </div>

            <div className="row">
              <button type="button" className="ghost" onClick={() => navigate('/cabinet/settings')}>Открыть настройки профиля</button>
              <button type="button" className="ghost" onClick={onLogout}>Выйти</button>
            </div>
          </div>
        </article>
      </section>
    );
  }

  function CabinetSettingsPage() {
    if (!profile) {
      return (
        <section className="single-page wide-page">
          <article className="pane cabinet-page">
            <p className="section-label">НАСТРОЙКИ ПРОФИЛЯ</p>
            <p className="section-text">Загружаем профиль...</p>
          </article>
        </section>
      );
    }

    return (
      <CabinetSettings
        profile={profile}
        accessToken={accessToken}
        apiBase={apiBase}
        showNotification={showNotification}
        onProfileUpdate={setProfile}
        onUpdateAccessToken={onUpdateAccessToken}
      />
    );
  }

  return (
    <div className="app">
      <header className="header-shell">
        <div className="nav-grid">
          <div className="logo">UNIFIED TASK MANAGER</div>
          {navItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
              {item.label}
            </NavLink>
          ))}
        </div>
      </header>

      <main className="container page-shell">
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/register" element={isAuthorized ? <Navigate to="/cabinet" replace /> : <RegisterPage />} />
          <Route path="/login" element={isAuthorized ? <Navigate to="/cabinet" replace /> : <LoginPage />} />
          <Route path="/tasks" element={<ProtectedRoute><TasksPage accessToken={accessToken} apiBase={apiBase} taskApiBase={storage.taskApiBase} profile={profile} showNotification={showNotification} onUpdateAccessToken={onUpdateAccessToken} /></ProtectedRoute>} />
          <Route path="/chats" element={<ProtectedRoute><ChatPage accessToken={accessToken} apiBase={apiBase} profile={profile} showNotification={showNotification} onUpdateAccessToken={onUpdateAccessToken} /></ProtectedRoute>} />
          <Route path="/cabinet" element={<ProtectedRoute><CabinetOverviewPage accessToken={accessToken} apiBase={apiBase} onUpdateAccessToken={onUpdateAccessToken} /></ProtectedRoute>} />
          <Route path="/cabinet/settings" element={<ProtectedRoute><CabinetSettingsPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Toast notification={notification} onClose={() => setNotification(null)} />
    </div>
  );
}

export default App;