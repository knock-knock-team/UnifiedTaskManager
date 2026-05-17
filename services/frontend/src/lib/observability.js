const CLIENT_EVENTS_URL = '/api/v1/client-events';

function safeRoute(value) {
  try {
    const url = new URL(value, window.location.origin);
    return url.pathname;
  } catch {
    return String(value || '').split('?')[0].slice(0, 180);
  }
}

function browserInfo() {
  return navigator.userAgent.slice(0, 160);
}

export function reportClientEvent(type, details = {}) {
  try {
    const payload = {
      type,
      route: safeRoute(details.route || window.location.pathname),
      status: Number(details.status || 0),
      durationMs: Number(details.durationMs || 0),
      message: String(details.message || '').slice(0, 300),
      browser: browserInfo(),
      timestamp: new Date().toISOString(),
      meta: details.meta || {}
    };
    const body = JSON.stringify(payload);

    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon(CLIENT_EVENTS_URL, blob)) {
        return;
      }
    }

    void fetch(CLIENT_EVENTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    });
  } catch {
    // Client observability must never break the application flow.
  }
}

export function installGlobalErrorReporting() {
  window.addEventListener('error', (event) => {
    reportClientEvent('client_error', {
      message: event.message || 'Unhandled browser error',
      route: window.location.pathname,
      meta: {
        source: String(event.filename || '').slice(0, 120),
        line: String(event.lineno || 0),
        column: String(event.colno || 0)
      }
    });
  });

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    reportClientEvent('client_unhandled_rejection', {
      message: reason instanceof Error ? reason.message : String(reason || 'Unhandled promise rejection'),
      route: window.location.pathname
    });
  });
}
