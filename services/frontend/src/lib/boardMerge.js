const TASK_FIELDS = ['title', 'description', 'status', 'priority', 'dueAt', 'assigneeUserId', 'assigneeName', 'completed'];

function normalizeDueAt(value) {
  if (!value) return '';
  return String(value);
}

function fieldValue(task, field) {
  if (field === 'dueAt') return normalizeDueAt(task?.dueAt);
  if (field === 'completed') return Boolean(task?.completedAt);
  if (field === 'status') return String(task?.status || '');
  return String(task?.[field] ?? '');
}

function buildPatchFromInput(input) {
  const patch = {};
  if (input.title !== undefined) patch.title = input.title;
  if (input.description !== undefined) patch.description = input.description;
  if (input.status !== undefined) patch.status = input.status;
  if (input.priority !== undefined) patch.priority = input.priority;
  if (input.dueAt !== undefined) patch.dueAt = input.dueAt;
  if (input.assigneeUserId !== undefined) patch.assigneeUserId = input.assigneeUserId;
  if (input.assigneeName !== undefined) patch.assigneeName = input.assigneeName;
  if (input.completed !== undefined) patch.completed = input.completed;
  return patch;
}

export function etagFromVersion(version) {
  if (version == null || version <= 0) return null;
  return `"${version}"`;
}

export function ColumnETag(version) {
  return etagFromVersion(version);
}

export function versionFromTask(task) {
  return Number(task?.version || 0);
}

export function mergeTaskPatch(baseTask, patch, serverTask) {
  const conflicts = [];
  const merged = { ...serverTask };
  const fields = Object.keys(patch);

  for (const field of fields) {
    const desired = patch[field];
    const baseValue = fieldValue(baseTask, field);
    const serverValue = fieldValue(serverTask, field);
    const changedLocally = fieldValue({ ...baseTask, [field]: desired }, field) !== baseValue;
    const changedOnServer = serverValue !== baseValue;

    if (!changedLocally) {
      continue;
    }
    if (!changedOnServer || serverValue === fieldValue({ ...baseTask, [field]: desired }, field)) {
      if (field === 'completed') {
        merged.completed = desired;
      } else {
        merged[field] = desired;
      }
      continue;
    }
    conflicts.push({ field, local: desired, server: serverValue });
  }

  return {
    canAutoMerge: conflicts.length === 0,
    conflicts,
    mergedBody: conflicts.length === 0 ? patch : null,
    serverTask
  };
}

export function buildTaskPatchBody(formFields) {
  return buildPatchFromInput(formFields);
}

export { TASK_FIELDS };
