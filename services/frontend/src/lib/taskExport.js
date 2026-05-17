function escapeCsvCell(value) {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function buildTasksCsv(tasks, columnTitleById) {
  const headers = [
    'title',
    'column',
    'priority',
    'dueAt',
    'tags',
    'assignees',
    'assigneeUserId',
    'assigneeName',
    'completed',
    'description',
    'id'
  ];
  const rows = tasks.map((task) => {
    const status = String(task.status || '').trim();
    const column = columnTitleById.get(status) || status || '';
    const completed = task.completedAt ? 'yes' : 'no';
    const tagStr = Array.isArray(task.tags) ? task.tags.join('; ') : '';
    let assigneesStr = '';
    if (Array.isArray(task.assignees) && task.assignees.length) {
      assigneesStr = task.assignees
        .map((a) => {
          const id = String(a?.userId || '').trim();
          const n = String(a?.displayName || '').trim();
          return n ? `${n} (${id})` : id;
        })
        .filter(Boolean)
        .join('; ');
    }
    return [
      escapeCsvCell(task.title),
      escapeCsvCell(column),
      escapeCsvCell(task.priority),
      escapeCsvCell(task.dueAt || ''),
      escapeCsvCell(tagStr),
      escapeCsvCell(assigneesStr),
      escapeCsvCell(task.assigneeUserId || ''),
      escapeCsvCell(task.assigneeName || ''),
      escapeCsvCell(completed),
      escapeCsvCell(task.description || ''),
      escapeCsvCell(task.id)
    ].join(',');
  });
  return [headers.join(','), ...rows].join('\r\n');
}

export function buildTasksJson(tasks, meta) {
  return JSON.stringify(
    {
      exportedAt: new Date().toISOString(),
      ...meta,
      tasks
    },
    null,
    2
  );
}

export function downloadBlob(filename, text, mime = 'text/plain;charset=utf-8', useBom = false) {
  const body = useBom ? `\ufeff${text}` : text;
  const blob = new Blob([body], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
