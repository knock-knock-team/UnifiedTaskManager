import { reportClientEvent } from './observability';

export function normalizeApiBase(value) {
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

export const storage = {
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
  get taskTeamName() {
    return localStorage.getItem('taskTeamName') || '';
  },
  set taskTeamName(value) {
    localStorage.setItem('taskTeamName', value || '');
  },
  get taskProjectId() {
    return localStorage.getItem('taskProjectId') || '';
  },
  set taskProjectId(value) {
    localStorage.setItem('taskProjectId', value || '');
  },
  get taskProjectName() {
    return localStorage.getItem('taskProjectName') || '';
  },
  set taskProjectName(value) {
    localStorage.setItem('taskProjectName', value || '');
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

export class VersionConflictError extends Error {
  constructor(message, current, code = 'VERSION_CONFLICT') {
    super(message || 'version conflict');
    this.name = 'VersionConflictError';
    this.status = 412;
    this.current = current;
    this.code = code;
  }
}

export async function requestWithMeta(apiBase, accessToken, path, options = {}, onTokenRefresh) {
  const { method = 'GET', body, auth = false, headers: extraHeaders = {}, ifMatch } = options;
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  const started = performance.now();
  let didRetry = false;

  if (auth && accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }
  if (ifMatch) {
    headers['If-Match'] = ifMatch;
  }

  let response;
  try {
    response = await fetch(`${apiBase}${path}`, {
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
          didRetry = true;
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
  } catch (error) {
    reportClientEvent('client_api_error', {
      route: path,
      message: error instanceof Error ? error.message : String(error),
      durationMs: performance.now() - started,
      meta: { method }
    });
    throw error;
  }

  reportClientEvent('client_api_request', {
    route: path,
    status: response.status,
    durationMs: performance.now() - started,
    meta: { method, retried: String(didRetry) }
  });

  let data = {};
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (response.status === 412) {
    throw new VersionConflictError(data.message, data.current, data.code);
  }

  if (!response.ok) {
    throw new Error(data.message || `HTTP ${response.status}`);
  }

  return {
    data,
    etag: response.headers.get('etag') || response.headers.get('ETag') || null,
    status: response.status
  };
}

export async function request(apiBase, accessToken, path, options = {}, onTokenRefresh) {
  const result = await requestWithMeta(apiBase, accessToken, path, options, onTokenRefresh);
  return result.data;
}
