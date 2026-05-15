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
  }
};

async function request(apiBase, accessToken, path, options = {}) {
  const { method = 'GET', body, auth = false } = options;
  const headers = { 'Content-Type': 'application/json' };

  if (auth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  const response = await fetch(`${apiBase}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined
  });

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

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [apiBase, setApiBase] = useState(storage.apiBase);
  const [accessToken, setAccessToken] = useState(storage.accessToken);

  const [registerName, setRegisterName] = useState('');
  const [registerEmail, setRegisterEmail] = useState('');
  const [registerPassword, setRegisterPassword] = useState('');

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [profile, setProfile] = useState(null);
  const [profileName, setProfileName] = useState('');
  const [profilePassword, setProfilePassword] = useState('');

  const [status, setStatus] = useState({ ok: Boolean(accessToken), text: accessToken ? 'Личный кабинет готов' : 'Не авторизован' });

  const isAuthorized = Boolean(accessToken);
  const isProtectedPath = useMemo(() => {
    return location.pathname.startsWith('/tasks') || location.pathname.startsWith('/cabinet');
  }, [location.pathname]);

  useEffect(() => {
    storage.apiBase = apiBase.trim();
  }, [apiBase]);

  useEffect(() => {
    storage.accessToken = accessToken;
  }, [accessToken]);

  useEffect(() => {
    if (!isAuthorized && isProtectedPath) {
      setStatus({ ok: false, text: 'Для доступа к задачам и личному кабинету нужно войти' });
      navigate('/login', { replace: true });
    }
  }, [isAuthorized, isProtectedPath, navigate]);

  useEffect(() => {
    if (isAuthorized && (location.pathname === '/login' || location.pathname === '/register')) {
      navigate('/cabinet', { replace: true });
    }
  }, [isAuthorized, location.pathname, navigate]);

  function setLoggedIn(token) {
    setAccessToken(token);
    if (!token) {
      navigate('/', { replace: true });
    }
  }

  async function onRegister(event) {
    event.preventDefault();
    try {
      const data = await request(apiBase, accessToken, '/v1/auth/register', {
        method: 'POST',
        body: {
          name: registerName,
          email: registerEmail,
          password: registerPassword
        }
      });
      setProfile(data.user || null);
      setProfileName(data.user?.name || '');
      setLoggedIn(data.tokens?.accessToken || '');
      setStatus({ ok: true, text: 'Регистрация успешна' });
    } catch (error) {
      setStatus({ ok: false, text: `Ошибка регистрации: ${error.message}` });
    }
  }

  async function onLogin(event) {
    event.preventDefault();
    try {
      const data = await request(apiBase, accessToken, '/v1/auth/login', {
        method: 'POST',
        body: {
          email: loginEmail,
          password: loginPassword
        }
      });
      setProfile(data.user || null);
      setProfileName(data.user?.name || '');
      setLoggedIn(data.tokens?.accessToken || '');
      setStatus({ ok: true, text: 'Логин успешен' });
    } catch (error) {
      setStatus({ ok: false, text: `Ошибка входа: ${error.message}` });
    }
  }

  async function loadProfile() {
    try {
      const data = await request(apiBase, accessToken, '/v1/users/me', { auth: true });
      setProfile(data);
      setProfileName(data.name || '');
      setStatus({ ok: true, text: 'Личный кабинет загружен' });
    } catch (error) {
      setStatus({ ok: false, text: `Ошибка личного кабинета: ${error.message}` });
    }
  }

  async function onUpdateProfile(event) {
    event.preventDefault();

    const payload = {};
    if (profileName.trim()) payload.name = profileName.trim();
    if (profilePassword.trim()) payload.password = profilePassword.trim();

    try {
      const data = await request(apiBase, accessToken, '/v1/users/me', {
        method: 'PATCH',
        auth: true,
        body: payload
      });
      setProfile(data);
      setProfileName(data.name || '');
      setProfilePassword('');
      setStatus({ ok: true, text: 'Настройки профиля сохранены' });
      navigate('/cabinet', { replace: true });
    } catch (error) {
      setStatus({ ok: false, text: `Ошибка обновления: ${error.message}` });
    }
  }

  function onLogout() {
    setLoggedIn('');
    setProfile(null);
    setProfileName('');
    setProfilePassword('');
    navigate('/', { replace: true });
    setStatus({ ok: false, text: 'Вы вышли из личного кабинета' });
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
            <div className="profile-grid public-profile">
              <div className="profile-card"><span>Имя</span><strong>{profile?.name || 'Не заполнено'}</strong></div>
              <div className="profile-card"><span>Email</span><strong>{profile?.email || 'Не заполнено'}</strong></div>
            </div>
            <div className="row">
              <button type="button" onClick={loadProfile}>Обновить профиль</button>
              <button type="button" className="ghost" onClick={() => navigate('/cabinet/settings')}>Открыть настройки профиля</button>
              <button type="button" className="ghost" onClick={onLogout}>Выйти</button>
            </div>
          </div>
        </article>
      </section>
    );
  }

  function CabinetSettingsPage() {
    return (
      <section className="single-page wide-page">
        <article className="pane cabinet-page">
          <div className="cabinet-toolbar">
            <button type="button" className="link-chip" onClick={() => navigate('/cabinet')}>Профиль</button>
            <button type="button" className="link-chip active">Настройки профиля</button>
          </div>

          <div className="cabinet-content">
            <p className="section-label">НАСТРОЙКИ ПРОФИЛЯ</p>
            <h2>Изменить имя и пароль</h2>
            <form onSubmit={onUpdateProfile} className="settings-form">
              <input value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="Новое имя" />
              <input value={profilePassword} onChange={(event) => setProfilePassword(event.target.value)} type="password" minLength={8} placeholder="Новый пароль" />
              <div className="row">
                <button type="submit">Сохранить изменения</button>
                <button type="button" className="ghost" onClick={() => navigate('/cabinet')}>Назад к профилю</button>
              </div>
            </form>
          </div>
        </article>
      </section>
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

      <footer className="footer-note">
        <div className="container footer-inner">
          <span>{status.text}</span>
          <div className="footer-tools">
            <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} placeholder="API base URL" />
            <button type="button" className="link-chip" onClick={() => navigate('/')}>На главную</button>
          </div>
        </div>
      </footer>
    </div>
  );
}

export default App;