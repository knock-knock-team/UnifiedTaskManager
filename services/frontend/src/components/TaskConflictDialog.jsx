import React, { useEffect, useRef } from 'react';

function formatConflictFieldValue(field, raw) {
  if (raw === null || raw === undefined) return '\u041f\u0443\u0441\u0442\u043e';
  if (field === 'assignees' && Array.isArray(raw)) {
    return raw.length
      ? raw.map((a) => `${a.displayName || a.userId || '?'} (${a.userId || '-'})`).join(', ')
      : '\u041d\u0435\u0442 \u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u0435\u0439';
  }
  if (field === 'tags' && Array.isArray(raw)) {
    return raw.length ? raw.join(', ') : '\u041d\u0435\u0442 \u0442\u0435\u0433\u043e\u0432';
  }
  if ((field === 'assignees' || field === 'tags') && typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (field === 'tags' && Array.isArray(parsed)) {
        return parsed.length ? parsed.join(', ') : '\u041d\u0435\u0442 \u0442\u0435\u0433\u043e\u0432';
      }
      if (field === 'assignees' && Array.isArray(parsed)) {
        return parsed.length
          ? parsed.map((a) => `${a.displayName || a.userId || '?'} (${a.userId || '-'})`).join(', ')
          : '\u041d\u0435\u0442 \u0438\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u0435\u0439';
      }
    } catch {
      return raw;
    }
  }
  if (typeof raw === 'boolean') return raw ? '\u0434\u0430' : '\u043d\u0435\u0442';
  if (typeof raw === 'object') return JSON.stringify(raw);
  return String(raw);
}

const FIELD_LABELS = {
  title: '\u041d\u0430\u0437\u0432\u0430\u043d\u0438\u0435',
  description: '\u041e\u043f\u0438\u0441\u0430\u043d\u0438\u0435',
  status: '\u041a\u043e\u043b\u043e\u043d\u043a\u0430',
  priority: '\u041f\u0440\u0438\u043e\u0440\u0438\u0442\u0435\u0442',
  dueAt: '\u0421\u0440\u043e\u043a',
  assigneeUserId: '\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c (id)',
  assigneeName: '\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u044c (\u0438\u043c\u044f)',
  assignees: '\u0418\u0441\u043f\u043e\u043b\u043d\u0438\u0442\u0435\u043b\u0438',
  tags: '\u0422\u0435\u0433\u0438',
  completed: '\u0412\u044b\u043f\u043e\u043b\u043d\u0435\u043d\u0438\u0435'
};

export function TaskConflictDialog({ conflict, onKeepServer, onForceLocal, onClose }) {
  const modalRef = useRef(null);

  useEffect(() => {
    if (!conflict) return undefined;
    const previous = typeof document !== 'undefined' ? document.activeElement : null;
    const node = modalRef.current;
    requestAnimationFrame(() => {
      const first = node?.querySelector?.('button:not(:disabled)');
      if (first && typeof first.focus === 'function') {
        first.focus();
      }
    });
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose?.();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previous && typeof previous.focus === 'function') {
        previous.focus();
      }
    };
  }, [conflict, onClose]);

  if (!conflict) {
    return null;
  }

  const { conflicts = [], serverTask, patch } = conflict;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal conflict-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="conflict-title"
        aria-describedby="conflict-desc"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="conflict-title">Конфликт версий</h3>
        <p id="conflict-desc">
          Задача изменена на сервере и у вас. Выберите, какую версию оставить по спорным полям.
        </p>
        <ul className="conflict-list">
          {conflicts.map((item) => (
            <li key={item.field}>
              <strong>{FIELD_LABELS[item.field] || item.field}</strong>
              <div className="conflict-value">У вас: {formatConflictFieldValue(item.field, item.local ?? '')}</div>
              <div className="conflict-value">На сервере: {formatConflictFieldValue(item.field, item.server ?? '')}</div>
            </li>
          ))}
        </ul>
        <div className="conflict-actions">
          <button type="button" className="ghost" onClick={onClose}>
            Отмена
          </button>
          <button type="button" className="ghost" onClick={() => onKeepServer?.(serverTask)}>
            Взять с сервера
          </button>
          <button type="button" onClick={() => onForceLocal?.(patch, serverTask)}>
            Перезаписать мои
          </button>
        </div>
      </div>
    </div>
  );
}

