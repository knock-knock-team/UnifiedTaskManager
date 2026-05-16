/** Helpers for tasks with legacy single assignee + multi-assignee `assignees`. */

export function taskAssigneesList(task) {
  if (!task) return [];
  const raw = task.assignees;
  if (Array.isArray(raw)) {
    const out = [];
    const seen = new Set();
    for (const entry of raw) {
      const userId = String(entry?.userId || '').trim();
      if (!userId || seen.has(userId)) continue;
      seen.add(userId);
      out.push({
        userId,
        displayName: String(entry?.displayName || '').trim()
      });
    }
    if (out.length > 0) return out;
  }
  const id = String(task.assigneeUserId || '').trim();
  if (!id) return [];
  return [{ userId: id, displayName: String(task.assigneeName || '').trim() }];
}

export function hasTaskAssignees(task) {
  return taskAssigneesList(task).length > 0;
}

export function primaryAssigneeUserId(task) {
  const list = taskAssigneesList(task);
  return list[0]?.userId || '';
}

export function formatAssigneesDisplay(task, labelById) {
  const list = taskAssigneesList(task);
  if (!list.length) return '';
  return list
    .map((a) => {
      const byId = labelById?.get?.(a.userId);
      return (a.displayName || byId || a.userId).trim() || a.userId;
    })
    .join(', ');
}

export function parseTagsInput(value) {
  return String(value || '')
    .split(/[,;\n]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(0, 40);
}

export function tagsInputFromTask(tags) {
  if (!Array.isArray(tags) || !tags.length) return '';
  return tags.join(', ');
}

export function buildAssigneesPayload(userIds, labelById) {
  const seen = new Set();
  const out = [];
  for (const raw of userIds || []) {
    const userId = String(raw || '').trim();
    if (!userId || seen.has(userId)) continue;
    seen.add(userId);
    out.push({
      userId,
      displayName: String(labelById?.get?.(userId) || '').trim()
    });
  }
  return out;
}
