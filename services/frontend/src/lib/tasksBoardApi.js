import { requestWithMeta, VersionConflictError } from './api';
import { ColumnETag, etagFromVersion, mergeTaskPatch } from './boardMerge';
import {
  etagForColumnId,
  etagForTaskId,
  rememberColumn,
  rememberColumns,
  rememberTask,
  rememberTasks,
  updateColumnVersion,
  updateTaskVersion
} from './taskVersions';

export async function patchTask({
  taskApiBase,
  accessToken,
  teamId,
  taskId,
  baseTask,
  patch,
  onTokenRefresh,
  onConflict
}) {
  const ifMatch = etagForTaskId(taskId) || etagFromVersion(baseTask?.version);

  try {
    const { data } = await requestWithMeta(
      taskApiBase,
      accessToken,
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'PATCH',
        auth: true,
        headers: { 'X-Team-Id': teamId },
        body: patch,
        ifMatch
      },
      onTokenRefresh
    );
    updateTaskVersion(data);
    return { task: data, merged: false };
  } catch (error) {
    if (!(error instanceof VersionConflictError)) {
      throw error;
    }
    const serverTask = error.current;
    if (!serverTask) {
      throw error;
    }
    const mergeResult = mergeTaskPatch(baseTask, patch, serverTask);
    if (!mergeResult.canAutoMerge) {
      onConflict?.({
        baseTask,
        patch,
        serverTask,
        conflicts: mergeResult.conflicts
      });
      return { conflict: true, serverTask, conflicts: mergeResult.conflicts };
    }
    const { data } = await requestWithMeta(
      taskApiBase,
      accessToken,
      `/v1/tasks/${encodeURIComponent(taskId)}`,
      {
        method: 'PATCH',
        auth: true,
        headers: { 'X-Team-Id': teamId },
        body: mergeResult.mergedBody,
        ifMatch: etagFromVersion(serverTask.version)
      },
      onTokenRefresh
    );
    updateTaskVersion(data);
    return { task: data, merged: true };
  }
}

export async function patchColumn({
  taskApiBase,
  accessToken,
  teamId,
  columnId,
  baseColumn,
  patch,
  onTokenRefresh,
  onConflict
}) {
  const ifMatch = etagForColumnId(columnId) || (baseColumn?.version ? ColumnETag(baseColumn.version) : null);
  try {
    const { data } = await requestWithMeta(
      taskApiBase,
      accessToken,
      `/v1/task-columns/${encodeURIComponent(columnId)}`,
      {
        method: 'PATCH',
        auth: true,
        headers: { 'X-Team-Id': teamId },
        body: patch,
        ifMatch
      },
      onTokenRefresh
    );
    updateColumnVersion(data);
    return { column: data };
  } catch (error) {
    if (!(error instanceof VersionConflictError) || !error.current) {
      throw error;
    }
    onConflict?.({ entityType: 'column', server: error.current, patch, baseColumn });
    return { conflict: true, column: error.current };
  }
}

export async function reorderColumns({
  taskApiBase,
  accessToken,
  teamId,
  projectId,
  columns,
  onTokenRefresh
}) {
  const versions = {};
  columns.forEach((col) => {
    if (col?.id && col.version) {
      versions[col.id] = col.version;
    }
  });
  const { data } = await requestWithMeta(
    taskApiBase,
    accessToken,
    `/v1/task-columns?action=reorder&projectId=${encodeURIComponent(projectId)}`,
    {
      method: 'POST',
      auth: true,
      headers: { 'X-Team-Id': teamId },
      body: { ids: columns.map((c) => c.id), versions }
    },
    onTokenRefresh
  );
  const items = Array.isArray(data.items) ? data.items : columns;
  rememberColumns(items);
  return items;
}

export function applyBoardSnapshot(setTasks, setColumns, setPresenceUsers, event) {
  if (event.type !== 'board.snapshot') {
    return;
  }
  if (Array.isArray(event.tasks)) {
    setTasks(event.tasks);
    rememberTasks(event.tasks);
  }
  if (Array.isArray(event.columns)) {
    setColumns(event.columns);
    rememberColumns(event.columns);
  }
  if (Array.isArray(event.users)) {
    setPresenceUsers(event.users);
  }
}

export function applyBoardEventToTasks(setTasks, event, options = {}) {
  const { onRemoteTaskUpdate, currentUserId } = options;
  if (!event?.type) return;

  if (event.type === 'board.snapshot' && Array.isArray(event.tasks)) {
    setTasks(event.tasks);
    rememberTasks(event.tasks);
    return;
  }

  if (event.type === 'task.created' || event.type === 'task.updated') {
    if (!event.task?.id) return;
    rememberTask(event.task);
    if (event.actorId && event.actorId === currentUserId) {
      return;
    }
    setTasks((prev) => {
      const index = prev.findIndex((item) => item.id === event.task.id);
      if (index < 0) {
        return [...prev, event.task];
      }
      const next = [...prev];
      next[index] = { ...next[index], ...event.task };
      return next;
    });
    onRemoteTaskUpdate?.(event.task);
    return;
  }

  if (event.type === 'task.deleted' && event.taskId) {
    if (event.actorId && event.actorId === currentUserId) {
      return;
    }
    setTasks((prev) => prev.filter((item) => item.id !== event.taskId));
    return;
  }

  if (event.type === 'task.comment.added' && event.taskId) {
    setTasks((prev) => prev.map((item) => {
      if (item.id !== event.taskId) {
        return item;
      }
      if (event.actorId && event.actorId === currentUserId) {
        return item;
      }
      const unread = Number(item.unreadComments || 0) + 1;
      return { ...item, unreadComments: unread };
    }));
  }
}

export function applyBoardEventToColumns(setColumns, event, currentUserId) {
  if (!event?.type) return;

  if (event.type === 'board.snapshot' && Array.isArray(event.columns)) {
    setColumns(event.columns);
    rememberColumns(event.columns);
    return;
  }

  if (event.actorId && event.actorId === currentUserId) {
    return;
  }

  if (event.type === 'column.created' || event.type === 'column.updated') {
    if (!event.column?.id) return;
    rememberColumn(event.column);
    setColumns((prev) => {
      const index = prev.findIndex((item) => item.id === event.column.id);
      if (index < 0) {
        return [...prev, event.column].sort((a, b) => a.position - b.position);
      }
      const next = [...prev];
      next[index] = { ...next[index], ...event.column };
      return next.sort((a, b) => a.position - b.position);
    });
    return;
  }
  if (event.type === 'column.deleted' && event.columnId) {
    setColumns((prev) => prev.filter((item) => item.id !== event.columnId));
    return;
  }
  if (event.type === 'columns.reordered' && Array.isArray(event.columns)) {
    event.columns.forEach(rememberColumn);
    setColumns(event.columns);
  }
}
