import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { CallHome, CallCreated, CallJoiner, FileEnvironments } from './components';
import { request, storage } from './lib/api';
import { ChatPage } from './pages/ChatPage';
import { TasksPage } from './pages/TasksPage';
import { CabinetOverviewPage } from './pages/CabinetOverviewPage';
import { CabinetSettingsPage } from './pages/CabinetSettingsPage';
import { HomePage } from './pages/HomePage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { PasswordResetPage } from './pages/PasswordResetPage';
import { PrivacyPage, TermsPage } from './pages/LegalPages';
import { ProtectedRoute } from './routes/ProtectedRoute';
import { AgentChatDrawer } from './ui/AgentChatDrawer';
import { Toast } from './ui/Toast';

const USER_AGREEMENT_STORAGE_KEY = 'utmUserAgreementAccepted.v1';

function App() {
  const navigate = useNavigate();
  const location = useLocation();

  const [accessToken, setAccessToken] = useState(storage.accessToken);
  const apiBase = storage.apiBase;

  const [profile, setProfile] = useState(null);
  const [isProfileLoading, setIsProfileLoading] = useState(false);
  const [notification, setNotification] = useState(null);
  const [isUserAgreementVisible, setIsUserAgreementVisible] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      return localStorage.getItem(USER_AGREEMENT_STORAGE_KEY) !== 'true';
    } catch {
      return true;
    }
  });
  const [uiTheme, setUiTheme] = useState(() => {
    if (typeof window === 'undefined') return 'dark';
    try {
      const stored = localStorage.getItem('uiTheme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      // ignore
    }
    return 'dark';
  });

  const isAuthorized = Boolean(accessToken);
  const isProtectedPath = useMemo(() => {
    return (
      location.pathname.startsWith('/tasks')
      || location.pathname.startsWith('/cabinet')
      || location.pathname.startsWith('/chats')
      || location.pathname.startsWith('/calls')
      || location.pathname.startsWith('/files')
    );
  }, [location.pathname]);

  useEffect(() => {
    // Migrate stale localStorage API base values from older builds to gateway path.
    storage.apiBase = storage.apiBase;
    storage.taskApiBase = storage.taskApiBase;
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', uiTheme);
    try {
      localStorage.setItem('uiTheme', uiTheme);
    } catch {
      // ignore
    }
  }, [uiTheme]);

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

  const acceptUserAgreement = useCallback(() => {
    try {
      localStorage.setItem(USER_AGREEMENT_STORAGE_KEY, 'true');
    } catch {
      // ignore storage errors; hide for current session anyway
    }
    setIsUserAgreementVisible(false);
  }, []);

  function extractTokens(payload) {
    if (!payload || typeof payload !== 'object') return null;
    const nested = payload.tokens;
    const accessToken = nested?.accessToken || nested?.access_token || payload.accessToken || payload.access_token || '';
    const refreshToken = nested?.refreshToken || nested?.refresh_token || payload.refreshToken || payload.refresh_token || '';
    if (!accessToken) return null;
    return { accessToken, refreshToken };
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

  async function onStartRegistration(event, email) {
    event?.preventDefault?.();
    try {
      const data = await request(apiBase, '', '/v1/auth/register/start', {
        method: 'POST',
        body: {
          email
        }
      });
      showNotification('Код подтверждения отправлен на почту', 'success');
      return data;
    } catch (error) {
      showNotification(error.message || 'Не удалось отправить код', 'error');
      throw error;
    }
  }

  async function onVerifyRegistrationCode(event, email, code) {
    event.preventDefault();
    try {
      const data = await request(apiBase, '', '/v1/auth/register/verify', {
        method: 'POST',
        body: {
          email,
          code
        }
      });
      showNotification('Код подтверждён', 'success');
      return data;
    } catch (error) {
      showNotification(error.message || 'Неверный код подтверждения', 'error');
      throw error;
    }
  }

  async function onCompleteRegistration(event, name, email, code, password) {
    event.preventDefault();
    try {
      const data = await request(apiBase, '', '/v1/auth/register/complete', {
        method: 'POST',
        body: {
          name,
          email,
          code,
          password
        }
      });
      const tokens = extractTokens(data);
      if (!tokens) {
        throw new Error('Регистрация прошла, но токены не получены. Проверьте ответ API.');
      }
      storage.taskTeamId = '';
      storage.taskTeamName = '';
      storage.taskProjectId = '';
      storage.taskProjectName = '';
      setProfile(data.user || null);
      setLoggedIn(tokens);
      showNotification('Регистрация успешна', 'success');
      navigate('/cabinet', { replace: true });
    } catch (error) {
      showNotification(error.message || 'Ошибка при регистрации', 'error');
      throw error;
    }
  }

  async function onStartPasswordReset(event, email) {
    event?.preventDefault?.();
    try {
      const data = await request(apiBase, '', '/v1/auth/password-reset/start', {
        method: 'POST',
        body: { email }
      });
      showNotification('Если аккаунт существует, код восстановления отправлен на почту', 'success');
      return data;
    } catch (error) {
      showNotification(error.message || 'Не удалось отправить код восстановления', 'error');
      throw error;
    }
  }

  async function onVerifyPasswordResetCode(event, email, code) {
    event.preventDefault();
    try {
      const data = await request(apiBase, '', '/v1/auth/password-reset/verify', {
        method: 'POST',
        body: { email, code }
      });
      showNotification('Код подтверждён', 'success');
      return data;
    } catch (error) {
      showNotification(error.message || 'Неверный код восстановления', 'error');
      throw error;
    }
  }

  async function onCompletePasswordReset(event, email, code, password) {
    event.preventDefault();
    try {
      await request(apiBase, '', '/v1/auth/password-reset/complete', {
        method: 'POST',
        body: { email, code, password }
      });
      showNotification('Пароль изменён. Теперь войдите с новым паролем.', 'success');
    } catch (error) {
      showNotification(error.message || 'Не удалось изменить пароль', 'error');
      throw error;
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
      const tokens = extractTokens(data);
      if (!tokens) {
        throw new Error('Вход выполнен, но токены не получены. Проверьте ответ API.');
      }
      setProfile(data.user || null);
      setLoggedIn(tokens);
      showNotification('Вход успешен', 'success');
      navigate('/cabinet', { replace: true });
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
    { to: '/', label: 'Главная' },
    ...(isAuthorized ? [{ to: '/tasks', label: 'Задачи' }, { to: '/chats', label: 'Чаты' }, { to: '/calls', label: 'Звонки' }, { to: '/files', label: 'Файлы' }, { to: '/cabinet', label: 'Кабинет' }] : []),
    ...(!isAuthorized ? [{ to: '/register', label: 'Регистрация' }, { to: '/login', label: 'Вход' }] : [])
  ];


  return (
    <div className="app">
      <a href="#main-content" className="skip-to-main">
        К содержимому
      </a>
      <header className="header-shell">
        <div className="header-inner">
          <nav className="nav-primary" aria-label="Основная навигация">
            <Link to="/" className="nav-brand" aria-label="UnifiedTaskManager — на главную">
              <span className="logo-mark" aria-hidden="true">UTM</span>
              <span className="nav-brand-name">UnifiedTaskManager</span>
            </Link>
            <div className="nav-links-cluster">
              {navItems.map((item) => (
                <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? 'nav-link active' : 'nav-link')}>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>
        </div>
      </header>

      <main id="main-content" className="container page-shell" tabIndex={-1}>
        <div key={location.pathname} className="route-transition">
          <Routes>
            <Route path="/" element={<HomePage isAuthorized={isAuthorized} />} />
            <Route path="/terms" element={<TermsPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/register" element={isAuthorized ? <Navigate to="/cabinet" replace /> : <RegisterPage onStartRegistration={onStartRegistration} onVerifyRegistrationCode={onVerifyRegistrationCode} onCompleteRegistration={onCompleteRegistration} />} />
            <Route path="/register/code" element={isAuthorized ? <Navigate to="/cabinet" replace /> : <RegisterPage onStartRegistration={onStartRegistration} onVerifyRegistrationCode={onVerifyRegistrationCode} onCompleteRegistration={onCompleteRegistration} />} />
            <Route path="/register/password" element={isAuthorized ? <Navigate to="/cabinet" replace /> : <RegisterPage onStartRegistration={onStartRegistration} onVerifyRegistrationCode={onVerifyRegistrationCode} onCompleteRegistration={onCompleteRegistration} />} />
            <Route path="/password-reset" element={isAuthorized ? <Navigate to="/cabinet" replace /> : <PasswordResetPage onStartPasswordReset={onStartPasswordReset} onVerifyPasswordResetCode={onVerifyPasswordResetCode} onCompletePasswordReset={onCompletePasswordReset} />} />
            <Route path="/password-reset/code" element={isAuthorized ? <Navigate to="/cabinet" replace /> : <PasswordResetPage onStartPasswordReset={onStartPasswordReset} onVerifyPasswordResetCode={onVerifyPasswordResetCode} onCompletePasswordReset={onCompletePasswordReset} />} />
            <Route path="/password-reset/new" element={isAuthorized ? <Navigate to="/cabinet" replace /> : <PasswordResetPage onStartPasswordReset={onStartPasswordReset} onVerifyPasswordResetCode={onVerifyPasswordResetCode} onCompletePasswordReset={onCompletePasswordReset} />} />
            <Route path="/login" element={isAuthorized ? <Navigate to="/cabinet" replace /> : <LoginPage onLogin={onLogin} />} />
            <Route path="/tasks" element={<ProtectedRoute isAuthorized={isAuthorized}><TasksPage accessToken={accessToken} apiBase={apiBase} taskApiBase={storage.taskApiBase} profile={profile} showNotification={showNotification} onUpdateAccessToken={onUpdateAccessToken} /></ProtectedRoute>} />
            <Route path="/chats" element={<ProtectedRoute isAuthorized={isAuthorized}><ChatPage accessToken={accessToken} apiBase={apiBase} profile={profile} showNotification={showNotification} onUpdateAccessToken={onUpdateAccessToken} /></ProtectedRoute>} />
            <Route path="/calls" element={<ProtectedRoute isAuthorized={isAuthorized}><CallHome userId={profile?.id} profile={profile} token={accessToken} apiBase={apiBase} showNotification={showNotification} /></ProtectedRoute>} />
            <Route path="/calls/created/:callId" element={<ProtectedRoute isAuthorized={isAuthorized}><CallCreated userId={profile?.id} token={accessToken} apiBase={apiBase} showNotification={showNotification} /></ProtectedRoute>} />
            <Route path="/calls/join/:callId" element={<ProtectedRoute isAuthorized={isAuthorized}><CallJoiner userId={profile?.id} profile={profile} token={accessToken} apiBase={apiBase} showNotification={showNotification} /></ProtectedRoute>} />
            <Route
              path="/files"
              element={(
                <ProtectedRoute isAuthorized={isAuthorized}>
                  <FileEnvironments
                    apiBase={apiBase}
                    accessToken={accessToken}
                    onUpdateAccessToken={onUpdateAccessToken}
                    showNotification={showNotification}
                    requestFn={request}
                  />
                </ProtectedRoute>
              )}
            />
            <Route path="/cabinet" element={<ProtectedRoute isAuthorized={isAuthorized}><CabinetOverviewPage accessToken={accessToken} apiBase={apiBase} taskApiBase={storage.taskApiBase} onUpdateAccessToken={onUpdateAccessToken} profile={profile} showNotification={showNotification} onLogout={onLogout} /></ProtectedRoute>} />
            <Route path="/cabinet/settings" element={<ProtectedRoute isAuthorized={isAuthorized}><CabinetSettingsPage profile={profile} accessToken={accessToken} apiBase={apiBase} showNotification={showNotification} onProfileUpdate={setProfile} onUpdateAccessToken={onUpdateAccessToken} uiTheme={uiTheme} setUiTheme={setUiTheme} /></ProtectedRoute>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
      </main>

      <AgentChatDrawer
        apiBase={apiBase}
        accessToken={accessToken}
        isAuthorized={isAuthorized}
        showNotification={showNotification}
        onUpdateAccessToken={onUpdateAccessToken}
      />

      {isUserAgreementVisible && (
        <section className="user-agreement-banner" aria-label="Пользовательское соглашение">
          <div className="user-agreement-banner__content">
            <p className="section-label">ПОЛЬЗОВАТЕЛЬСКОЕ СОГЛАШЕНИЕ</p>
            <p>
              Продолжая пользоваться UnifiedTaskManager, вы соглашаетесь с{' '}
              <Link to="/terms">пользовательским соглашением</Link>,{' '}
              <Link to="/privacy">политикой конфиденциальности</Link> и обработкой данных, необходимых для работы сервиса.
            </p>
          </div>
          <button type="button" onClick={acceptUserAgreement}>Понятно, принимаю</button>
        </section>
      )}

      <Toast notification={notification} onClose={() => setNotification(null)} />
    </div>
  );
}

export default App;