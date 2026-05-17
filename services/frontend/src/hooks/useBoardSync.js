import { useCallback, useEffect, useRef } from 'react';
import { normalizeApiBase } from '../lib/api';
import { reportClientEvent } from '../lib/observability';

const MAX_RECONNECT_DELAY_MS = 30000;
const BASE_RECONNECT_DELAY_MS = 1000;

function buildBoardWsUrl(apiBase, teamId, projectId, displayName, accessToken) {
  const base = normalizeApiBase(apiBase);
  const url = new URL(base, window.location.origin);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.pathname = `${url.pathname.replace(/\/$/, '')}/v1/boards/stream`;
  url.searchParams.set('projectId', projectId);
  url.searchParams.set('teamId', teamId);
  url.searchParams.set('token', accessToken);
  if (displayName) {
    url.searchParams.set('displayName', displayName);
  }
  return url.toString();
}

export function useBoardSync({
  apiBase,
  accessToken,
  teamId,
  projectId,
  displayName,
  enabled,
  onEvent,
  onResync,
  onConnectionChange
}) {
  const onEventRef = useRef(onEvent);
  const onResyncRef = useRef(onResync);
  const onConnectionChangeRef = useRef(onConnectionChange);
  const reconnectAttemptRef = useRef(0);
  const wsRef = useRef(null);
  const shouldRunRef = useRef(false);
  const heartbeatRef = useRef(null);

  onEventRef.current = onEvent;
  onResyncRef.current = onResync;
  onConnectionChangeRef.current = onConnectionChange;

  const requestResync = useCallback((ws) => {
    if (ws?.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'resync' }));
    }
    onResyncRef.current?.();
  }, []);

  useEffect(() => {
    shouldRunRef.current = Boolean(enabled && accessToken && teamId && projectId);
    if (!shouldRunRef.current) {
      wsRef.current?.close();
      wsRef.current = null;
      return undefined;
    }

    let reconnectTimer;
    let disposed = false;

    const clearHeartbeat = () => {
      if (heartbeatRef.current) {
        clearInterval(heartbeatRef.current);
        heartbeatRef.current = null;
      }
    };

    const scheduleReconnect = () => {
      if (disposed || !shouldRunRef.current) {
        return;
      }
      const attempt = reconnectAttemptRef.current;
      const delay = Math.min(MAX_RECONNECT_DELAY_MS, BASE_RECONNECT_DELAY_MS * (2 ** attempt));
      reconnectAttemptRef.current = attempt + 1;
      reconnectTimer = setTimeout(connect, delay);
    };

    const connect = () => {
      if (disposed || !shouldRunRef.current) {
        return;
      }
      clearHeartbeat();
      const ws = new WebSocket(buildBoardWsUrl(apiBase, teamId, projectId, displayName, accessToken));
      wsRef.current = ws;

      ws.onopen = () => {
        reconnectAttemptRef.current = 0;
        reportClientEvent('client_ws_open', {
          route: '/v1/boards/stream',
          meta: { scope: 'board' }
        });
        onConnectionChangeRef.current?.(true);
        ws.send(JSON.stringify({ type: 'presence.ping' }));
      };

      ws.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          onEventRef.current?.(payload);
        } catch {
          // ignore malformed payloads
        }
      };

      ws.onerror = (event) => {
        reportClientEvent('client_ws_error', {
          route: '/v1/boards/stream',
          message: event?.message || 'Board WebSocket error',
          meta: { scope: 'board' }
        });
      };

      ws.onclose = (event) => {
        clearHeartbeat();
        reportClientEvent('client_ws_close', {
          route: '/v1/boards/stream',
          status: event.code,
          message: event.reason || '',
          meta: { clean: String(event.wasClean), scope: 'board' }
        });
        onConnectionChangeRef.current?.(false);
        if (disposed || !shouldRunRef.current) {
          return;
        }
        scheduleReconnect();
      };

      heartbeatRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        }
      }, 25000);
    };

    connect();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestResync(wsRef.current);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      shouldRunRef.current = false;
      document.removeEventListener('visibilitychange', onVisibility);
      clearTimeout(reconnectTimer);
      clearHeartbeat();
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [accessToken, apiBase, displayName, enabled, projectId, requestResync, teamId]);

  return { requestResync: () => requestResync(wsRef.current) };
}
