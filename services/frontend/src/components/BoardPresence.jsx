import React from 'react';

export function BoardPresence({ connected = false }) {
  const title = connected
    ? 'Изменения на доске передаются на сервер в реальном времени.'
    : 'Связь с сервером потеряна, выполняется переподключение.';

  return (
    <div
      className="board-presence"
      title={title}
      aria-label={connected ? 'Синхронизация с сервером активна' : 'Синхронизация с сервером недоступна'}
    >
      <span
        className={`board-live-dot ${connected ? 'online' : 'offline'}`}
        aria-hidden="true"
      />
      <span
        className={`board-presence-sync-text ${connected ? '' : 'board-presence-sync-text--warn'}`}
      >
        {connected ? 'Синхронизация активна' : 'Нет связи'}
      </span>
    </div>
  );
}
