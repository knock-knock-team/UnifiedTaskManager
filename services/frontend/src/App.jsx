import React, { useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';

const storage = {
  get apiBase() {
    return localStorage.getItem('apiBase') || 'http://localhost:8082';
  },
  set apiBase(value) {
    localStorage.setItem('apiBase', value || '');
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
  const { method = 'GET', body, auth = false } = options;
  const headers = { 'Content-Type': 'application/json' };

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
          <p className="section-text">Основную почту менять нельзя. Можно добавить дополнительную почту и ссылки на публичные профили.</p>
          <form onSubmit={handleSubmit} className="settings-form profile-form">
            <div className="profile-form-grid">
              <label>
                <span>Имя</span>
                <input value={formData.name} onChange={(e) => handleChange('name', e.target.value)} placeholder="Новое имя" />
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

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [accessToken, setAccessToken] = useState(storage.accessToken);
  const apiBase = storage.apiBase;

  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [profile, setProfile] = useState(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [notification, setNotification] = useState(null);

  const isAuthorized = Boolean(accessToken);
  const isProtectedPath = useMemo(() => {
    return location.pathname.startsWith('/tasks') || location.pathname.startsWith('/cabinet');
  }, [location.pathname]);

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

  function showNotification(message, type = 'success') {
    setNotification({ message, type });
  }

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

  async function onRegister(event) {
    event.preventDefault();
    try {
      const data = await request(apiBase, '', '/v1/auth/register', {
        method: 'POST',
        body: {
          name: registerName,
          email: registerEmail,
          password: registerPassword
        }
      });
      setProfile(data.user || null);
      setLoggedIn(data.tokens || {});
      setRegisterName('');
      setRegisterEmail('');
      setRegisterPassword('');
      showNotification('Регистрация успешна', 'success');
    } catch (error) {
      showNotification(error.message || 'Ошибка при регистрации', 'error');
    }
  }

  async function onLogin(event) {
    event.preventDefault();
    try {
      const data = await request(apiBase, '', '/v1/auth/login', {
        method: 'POST',
        body: {
          email: loginEmail,
          password: loginPassword
        }
      });
      setProfile(data.user || null);
      setLoggedIn(data.tokens || {});
      setLoginEmail('');
      setLoginPassword('');
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
    if (isAuthorized && location.pathname.startsWith('/cabinet') && !profile) {
      void loadProfile();
    }
  }, [isAuthorized, location.pathname, profile]);

  function onLogout() {
    setLoggedIn(null);
    setRegisterName('');
    setRegisterEmail('');
    setRegisterPassword('');
    setLoginEmail('');
    setLoginPassword('');
    showNotification('Вы вышли', 'info');
    navigate('/', { replace: true });
  }

  const navItems = [
    { to: '/', label: 'ГЛАВНАЯ' },
    ...(isAuthorized ? [{ to: '/tasks', label: 'ЗАДАЧИ' }, { to: '/cabinet', label: 'ЛИЧНЫЙ КАБИНЕТ' }] : []),
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
          <p className="eyebrow">VG TASK SYSTEM</p>
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

  function TasksPage() {
    return (
      <section className="single-page wide-page">
        <article className="pane">
          <p className="section-label">СТРАНИЦА ЗАДАЧ</p>
          <h2>Задачи команды</h2>
          <p className="section-text">Доступно только после авторизации.</p>
          <div className="task-columns">
            <div className="task-card"><h3>Backlog</h3><p>Новые задачи, ожидающие планирования.</p></div>
            <div className="task-card"><h3>In Progress</h3><p>Задачи, которые сейчас выполняются командой.</p></div>
            <div className="task-card"><h3>Review</h3><p>Проверка качества перед завершением.</p></div>
            <div className="task-card"><h3>Done</h3><p>Завершенные задачи с зафиксированным результатом.</p></div>
          </div>
        </article>
      </section>
    );
  }

  function RegisterPage() {
    return (
      <section className="single-page">
        <article className="pane single-card">
          <p className="section-label">РЕГИСТРАЦИЯ</p>
          <h2>Создать аккаунт</h2>
          <form onSubmit={onRegister}>
            <input value={registerName} onChange={(event) => setRegisterName(event.target.value)} placeholder="Имя" required />
            <input value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} type="email" placeholder="Email" required />
            <input value={registerPassword} onChange={(event) => setRegisterPassword(event.target.value)} type="password" minLength={8} placeholder="Пароль" required />
            <button type="submit">Зарегистрироваться</button>
          </form>
        </article>
      </section>
    );
  }

  function LoginPage() {
    return (
      <section className="single-page">
        <article className="pane single-card">
          <p className="section-label">ЛОГИН</p>
          <h2>Войти в аккаунт</h2>
          <form onSubmit={onLogin}>
            <input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} type="email" placeholder="Email" required />
            <input value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} type="password" placeholder="Пароль" required />
            <button type="submit">Войти</button>
          </form>
        </article>
      </section>
    );
  }

  function CabinetOverviewPage() {
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
          <div className="logo">VG TASK SYSTEM</div>
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
          <Route path="/tasks" element={<ProtectedRoute><TasksPage /></ProtectedRoute>} />
          <Route path="/cabinet" element={<ProtectedRoute><CabinetOverviewPage /></ProtectedRoute>} />
          <Route path="/cabinet/settings" element={<ProtectedRoute><CabinetSettingsPage /></ProtectedRoute>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      <Toast notification={notification} onClose={() => setNotification(null)} />
    </div>
  );
}

export default App;