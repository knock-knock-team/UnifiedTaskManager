import {
  buildAssigneesPayload,
  parseTagsInput,
  taskAssigneesList
} from './taskAssignees.js';

const TASK_FIELDS = [
  'title',
  'description',
  'status',
  'priority',
  'dueAt',
  'assigneeUserId',
  'assigneeName',
  'assignees',
  'tags',
  'completed'
];

function normalizeDueAt(value) {
  if (!value) return '';
  return String(value);
}

function tagsSignatureFromTask(task) {
  const raw = task?.tags;
  const list = Array.isArray(raw)
    ? raw.map((t) => String(t).trim()).filter(Boolean)
    : [];
  list.sort((a, b) => a.localeCompare(b, 'ru'));
  return JSON.stringify(list);
}

function tagsSignatureFromPatchValue(value) {
  const list = Array.isArray(value) ? value.map((t) => String(t).trim()).filter(Boolean) : parseTagsInput(value);
  list.sort((a, b) => a.localeCompare(b, 'ru'));
  return JSON.stringify(list);
}

function assigneesSignatureFromTask(task) {
  const list = taskAssigneesList(task);
  const normalized = buildAssigneesPayload(
    list.map((a) => a.userId),
    new Map(list.map((a) => [a.userId, a.displayName]))
  );
  normalized.sort((a, b) => a.userId.localeCompare(b.userId));
  return JSON.stringify(normalized);
}

function assigneesSignatureFromPatchValue(value) {
  if (!Array.isArray(value)) return '[]';
  const normalized = value
    .map((a) => ({
      userId: String(a?.userId || '').trim(),
      displayName: String(a?.displayName || '').trim()
    }))
    .filter((a) => a.userId);
  const payload = buildAssigneesPayload(
    normalized.map((a) => a.userId),
    new Map(normalized.map((a) => [a.userId, a.displayName]))
  );
  payload.sort((a, b) => a.userId.localeCompare(b.userId));
  return JSON.stringify(payload);
}

function fieldValue(task, field) {
  if (field === 'dueAt') return normalizeDueAt(task?.dueAt);
  if (field === 'completed') return Boolean(task?.completedAt);
  if (field === 'status') return String(task?.status || '');
  if (field === 'assignees') return assigneesSignatureFromTask(task);
  if (field === 'tags') return tagsSignatureFromTask(task);
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
  if (input.assignees !== undefined) patch.assignees = input.assignees;
  if (input.tags !== undefined) patch.tags = input.tags;
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

    let desiredComparable = desired;
    if (field === 'assignees') {
      desiredComparable = assigneesSignatureFromPatchValue(desired);
    }
    if (field === 'tags') {
      desiredComparable = tagsSignatureFromPatchValue(desired);
    }

    const changedLocally = desiredComparable !== baseValue;
    const changedOnServer = serverValue !== baseValue;

    if (!changedLocally) {
      continue;
    }

    let serverMatchesDesired = false;
    if (field === 'assignees') {
      serverMatchesDesired = assigneesSignatureFromTask(serverTask) === assigneesSignatureFromPatchValue(desired);
    } else if (field === 'tags') {
      serverMatchesDesired = tagsSignatureFromTask(serverTask) === tagsSignatureFromPatchValue(desired);
    } else {
      serverMatchesDesired = serverValue === fieldValue({ ...baseTask, [field]: desired }, field);
    }

    if (!changedOnServer || serverMatchesDesired) {
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
