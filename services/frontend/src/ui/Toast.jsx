import React from 'react';

export function Toast({ notification, onClose }) {
  if (!notification) return null;
  
  return (
    <div className={`toast toast-${notification.type}`}>
      <span>{notification.message}</span>
      <button type="button" className="toast-close" onClick={onClose}>&times;</button>
    </div>
  );
}
