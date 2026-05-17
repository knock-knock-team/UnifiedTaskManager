import { useEffect, useRef, useCallback } from 'react';
import { reportClientEvent } from '../lib/observability';

/**
 * Custom hook for WebSocket signaling
 */
export function useWebSocket(url, handlers = {}) {
  const wsRef = useRef(null);
  const messageQueueRef = useRef([]);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const reconnectDelay = useRef(1000);
  const handlersRef = useRef(handlers);
  const reconnectTimerRef = useRef(null);
  const shouldRunRef = useRef(true);
  const messageProcessingRef = useRef(Promise.resolve());

  // Update handlers ref without triggering reconnection
  useEffect(() => {
    handlersRef.current = handlers;
  }, [handlers]);

  const connect = useCallback(() => {
    if (!url || !shouldRunRef.current) return;

    try {
      wsRef.current = new WebSocket(url);

      wsRef.current.onopen = () => {
        console.log('[WebSocket] Connected');
        reportClientEvent('client_ws_open', { route: url });
        reconnectAttempts.current = 0;
        reconnectDelay.current = 1000;

        // Flush queued messages
        while (messageQueueRef.current.length > 0) {
          const msg = messageQueueRef.current.shift();
          wsRef.current.send(JSON.stringify(msg));
        }

        handlersRef.current.onOpen?.();
      };

      wsRef.current.onmessage = (event) => {
        try {
          const message = JSON.parse(event.data);
          console.log('[WebSocket] Received:', message.type);
          messageProcessingRef.current = messageProcessingRef.current
            .catch(() => {})
            .then(() => handlersRef.current.onMessage?.(message))
            .catch((error) => {
              console.error('[WebSocket] Message handler error:', error);
            });
        } catch (error) {
          console.error('[WebSocket] Parse error:', error);
        }
      };

      wsRef.current.onerror = (error) => {
        console.error('[WebSocket] Error:', error);
        reportClientEvent('client_ws_error', {
          route: url,
          message: error?.message || 'WebSocket error'
        });
        handlersRef.current.onError?.(error);
      };

      wsRef.current.onclose = (event) => {
        console.log('[WebSocket] Disconnected');
        reportClientEvent('client_ws_close', {
          route: url,
          status: event.code,
          message: event.reason || '',
          meta: { clean: String(event.wasClean) }
        });
        handlersRef.current.onClose?.(event);

        if (!shouldRunRef.current) {
          return;
        }

        const shouldReconnect = handlersRef.current.shouldReconnect?.(event) ?? true;
        if (!shouldReconnect) {
          console.log('[WebSocket] Reconnect disabled by handler');
          return;
        }

        // Attempt reconnect
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++;
          console.log(
            `[WebSocket] Reconnecting (attempt ${reconnectAttempts.current}/${maxReconnectAttempts})...`
          );
          reportClientEvent('client_ws_reconnect', {
            route: url,
            meta: { attempt: String(reconnectAttempts.current) }
          });
          reconnectTimerRef.current = setTimeout(connect, reconnectDelay.current);
          reconnectDelay.current = Math.min(reconnectDelay.current * 2, 10000);
        }
      };
    } catch (error) {
      console.error('[WebSocket] Connection error:', error);
      handlersRef.current.onError?.(error);
    }
  }, [url]);

  const send = useCallback((message) => {
    try {
      console.log('[WebSocket] Send:', message);
    } catch (e) {}
    if (!wsRef.current) {
      console.warn('[WebSocket] Not connected, queueing message');
      messageQueueRef.current.push(message);
      return;
    }

    if (wsRef.current.readyState !== WebSocket.OPEN) {
      console.warn('[WebSocket] Connection not ready, queueing message');
      messageQueueRef.current.push(message);
      return;
    }

    wsRef.current.send(JSON.stringify(message));
  }, []);

  const close = useCallback(() => {
    shouldRunRef.current = false;
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    shouldRunRef.current = true;
    connect();

    return () => {
      close();
    };
  }, [url, connect, close]);

  return { send, close, isConnected: wsRef.current?.readyState === WebSocket.OPEN };
}
