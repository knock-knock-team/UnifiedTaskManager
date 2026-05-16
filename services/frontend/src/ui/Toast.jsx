import React from 'react';

export function Toast({ notification, onClose }) {
  if (!notification) return null;

  const politeTypes = ['success', 'info'];
  const ariaLive = politeTypes.includes(notification.type) ? 'polite' : 'assertive';

  return (
    <div
      role="status"
      aria-live={ariaLive}
      aria-atomic="true"
      className={`toast toast-${notification.type}`}
    >
      <span>{notification.message}</span>
      <button type="button" className="toast-close" onClick={onClose} aria-label="Закрыть уведомление">&times;</button>
    </div>
  );
}
