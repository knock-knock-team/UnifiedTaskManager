const taskVersions = new Map();
const columnVersions = new Map();

export function rememberTask(task) {
  if (!task?.id) return;
  taskVersions.set(task.id, Number(task.version || 0));
}

export function rememberTasks(tasks) {
  (tasks || []).forEach(rememberTask);
}

export function rememberColumn(column) {
  if (!column?.id) return;
  columnVersions.set(column.id, Number(column.version || 0));
}

export function rememberColumns(columns) {
  (columns || []).forEach(rememberColumn);
}

export function etagForTaskId(taskId) {
  const version = taskVersions.get(taskId);
  if (!version) return null;
  return `"${version}"`;
}

export function etagForColumnId(columnId) {
  const version = columnVersions.get(columnId);
  if (!version) return null;
  return `"${version}"`;
}

export function updateTaskVersion(task) {
  rememberTask(task);
}

export function updateColumnVersion(column) {
  rememberColumn(column);
}

export function removeTask(taskId) {
  taskVersions.delete(taskId);
}
