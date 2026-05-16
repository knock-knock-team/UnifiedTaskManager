import React from 'react';

export function BoardPresence({ users = [], currentUserId = '', connected = false }) {
  const visible = users.filter((user) => user.userId && user.userId !== currentUserId);
  if (visible.length === 0 && !connected) {
    return null;
  }

  return (
    <div className="board-presence" aria-label="На доске сейчас">
      <span className={`board-live-dot ${connected ? 'online' : 'offline'}`} title={connected ? 'Синхронизация активна' : 'Переподключение…'} />
      <span className="board-presence-label">На доске:</span>
      <ul className="board-presence-list">
        {visible.map((user) => (
          <li key={user.userId} className="board-presence-item" title={user.userId}>
            {user.name || user.userId}
          </li>
        ))}
      </ul>
    </div>
  );
}
