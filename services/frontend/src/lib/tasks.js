export function groupTasksByStatus(tasks) {
  return tasks.reduce((accumulator, task) => {
    const key = task.status || 'todo';
    if (!accumulator[key]) {
      accumulator[key] = [];
    }
    accumulator[key].push(task);
    return accumulator;
  }, { todo: [], in_progress: [], done: [] });
}

export function statusLabel(status) {
  const value = String(status || '').trim();
  if (value === 'in_progress') return 'В работе';
  if (value === 'done') return 'Готово';
  if (value === 'todo') return 'Бэклог';
  return value || 'Без статуса';
}

export function priorityLabel(priority) {
  switch (priority) {
    case 'high':
      return 'Высокий';
    case 'low':
      return 'Низкий';
    default:
      return 'Средний';
  }
}

export const TEAM_PERMISSION_OPTIONS = [
  { key: 'projects.manage', label: 'Создавать и удалять проекты' },
  { key: 'roles.manage', label: 'Управлять ролями команды' },
  { key: 'members.manage', label: 'Приглашать и менять роли в команде' },
  { key: 'tasks.read', label: 'Чтение задач' },
  { key: 'tasks.write', label: 'Изменение задач' }
];

export const BASIC_TEAM_PERMISSION_KEYS = ['tasks.read', 'tasks.write', 'members.manage'];

export const PROJECT_PERMISSION_OPTIONS = [
  { key: 'tasks.read', label: 'Чтение задач проекта' },
  { key: 'tasks.write', label: 'Изменение и перенос задач' },
  { key: 'project.members.manage', label: 'Назначать людей в проект' },
  { key: 'project.roles.manage', label: 'Управлять ролями проекта' }
];

export const BASIC_PROJECT_PERMISSION_KEYS = ['tasks.read', 'tasks.write'];
