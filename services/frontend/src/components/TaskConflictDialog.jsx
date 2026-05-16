import React from 'react';

const FIELD_LABELS = {
  title: 'Название',
  description: 'Описание',
  status: 'Колонка',
  priority: 'Приоритет',
  dueAt: 'Дедлайн',
  assigneeUserId: 'Исполнитель',
  assigneeName: 'Исполнитель',
  completed: 'Статус выполнения'
};

export function TaskConflictDialog({ conflict, onKeepServer, onForceLocal, onClose }) {
  if (!conflict) {
    return null;
  }

  const { conflicts = [], serverTask, patch } = conflict;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <div
        className="modal conflict-modal"
        role="dialog"
        aria-labelledby="conflict-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 id="conflict-title">Конфликт изменений</h3>
        <p>Коллега изменил те же поля, что и вы. Выберите, какую версию сохранить.</p>
        <ul className="conflict-list">
          {conflicts.map((item) => (
            <li key={item.field}>
              <strong>{FIELD_LABELS[item.field] || item.field}</strong>
              <div>Ваше: {String(item.local ?? '—')}</div>
              <div>На сервере: {String(item.server ?? '—')}</div>
            </li>
          ))}
        </ul>
        <div className="conflict-actions">
          <button type="button" className="ghost" onClick={onClose}>Отмена</button>
          <button type="button" className="ghost" onClick={() => onKeepServer?.(serverTask)}>Взять с сервера</button>
          <button type="button" onClick={() => onForceLocal?.(patch, serverTask)}>Сохранить моё</button>
        </div>
      </div>
    </div>
  );
}
