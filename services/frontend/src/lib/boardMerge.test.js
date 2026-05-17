import { describe, expect, it } from 'vitest';
import {
  ColumnETag,
  TASK_FIELDS,
  buildTaskPatchBody,
  etagFromVersion,
  mergeTaskPatch,
  versionFromTask
} from './boardMerge.js';

function task(overrides = {}) {
  return {
    id: 't1',
    title: 'Title',
    description: '',
    status: 'todo',
    priority: 'medium',
    dueAt: null,
    completedAt: null,
    assigneeUserId: '',
    assigneeName: '',
    assignees: [],
    tags: [],
    version: 1,
    ...overrides
  };
}

describe('etagFromVersion', () => {
  it('returns quoted version for positive numbers', () => {
    expect(etagFromVersion(42)).toBe('"42"');
    expect(ColumnETag(3)).toBe('"3"');
  });

  it('returns null for missing or non-positive version', () => {
    expect(etagFromVersion(null)).toBeNull();
    expect(etagFromVersion(undefined)).toBeNull();
    expect(etagFromVersion(0)).toBeNull();
    expect(etagFromVersion(-1)).toBeNull();
  });
});

describe('versionFromTask', () => {
  it('reads version from task', () => {
    expect(versionFromTask({ version: 5 })).toBe(5);
    expect(versionFromTask({})).toBe(0);
  });
});

describe('buildTaskPatchBody', () => {
  it('includes only defined fields', () => {
    expect(buildTaskPatchBody({ title: 'New' })).toEqual({ title: 'New' });
    expect(buildTaskPatchBody({ completed: true, status: 'done' })).toEqual({
      completed: true,
      status: 'done'
    });
  });
});

describe('mergeTaskPatch', () => {
  it('auto-merges when only local field changed and server unchanged', () => {
    const base = task({ title: 'A', description: 'old' });
    const server = task({ title: 'A', description: 'old', version: 2 });
    const result = mergeTaskPatch(base, { title: 'B' }, server);

    expect(result.canAutoMerge).toBe(true);
    expect(result.conflicts).toEqual([]);
    expect(result.mergedBody).toEqual({ title: 'B' });
  });

  it('skips fields not changed locally', () => {
    const base = task({ title: 'A' });
    const server = task({ title: 'B', version: 2 });
    const result = mergeTaskPatch(base, { description: 'local only' }, server);

    expect(result.canAutoMerge).toBe(true);
    expect(result.mergedBody).toEqual({ description: 'local only' });
  });

  it('reports conflict when both changed the same field differently', () => {
    const base = task({ title: 'A' });
    const server = task({ title: 'B', version: 3 });
    const result = mergeTaskPatch(base, { title: 'C' }, server);

    expect(result.canAutoMerge).toBe(false);
    expect(result.mergedBody).toBeNull();
    expect(result.conflicts).toEqual([
      { field: 'title', local: 'C', server: 'B' }
    ]);
  });

  it('auto-merges when server matches desired end state', () => {
    const base = task({ title: 'A', status: 'todo' });
    const server = task({ title: 'B', status: 'todo', version: 4 });
    const result = mergeTaskPatch(base, { title: 'B' }, server);

    expect(result.canAutoMerge).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it('handles completed via completedAt on server task', () => {
    const base = task({ completedAt: null });
    const server = task({ completedAt: null, version: 1 });
    const result = mergeTaskPatch(base, { completed: true }, server);

    expect(result.canAutoMerge).toBe(true);
    expect(result.mergedBody).toEqual({ completed: true });
  });

  it('conflicts on assignee when both sides changed differently', () => {
    const base = task({ assigneeUserId: 'u1', assignees: [{ userId: 'u1', displayName: '' }] });
    const server = task({ assigneeUserId: 'u2', assignees: [{ userId: 'u2', displayName: '' }], version: 2 });
    const result = mergeTaskPatch(base, { assigneeUserId: 'u3' }, server);

    expect(result.canAutoMerge).toBe(false);
    expect(result.conflicts[0].field).toBe('assigneeUserId');
  });

  it('auto-merges assignees array when server unchanged', () => {
    const base = task({ assignees: [{ userId: 'u1', displayName: '' }] });
    const server = task({
      assignees: [{ userId: 'u1', displayName: '' }],
      version: 2
    });
    const result = mergeTaskPatch(
      base,
      { assignees: [{ userId: 'u2', displayName: '' }] },
      server
    );
    expect(result.canAutoMerge).toBe(true);
    expect(result.mergedBody?.assignees).toEqual([{ userId: 'u2', displayName: '' }]);
  });

  it('conflicts assignees when both changed', () => {
    const base = task({ assignees: [{ userId: 'u1', displayName: '' }] });
    const server = task({ assignees: [{ userId: 'u2', displayName: '' }], version: 2 });
    const result = mergeTaskPatch(
      base,
      { assignees: [{ userId: 'u3', displayName: '' }] },
      server
    );
    expect(result.canAutoMerge).toBe(false);
    expect(result.conflicts[0].field).toBe('assignees');
  });

  it('auto-merges tags when server already matches desired', () => {
    const base = task({ tags: ['a'] });
    const server = task({ tags: ['b'], version: 2 });
    const result = mergeTaskPatch(base, { tags: ['b'] }, server);
    expect(result.canAutoMerge).toBe(true);
    expect(result.mergedBody).toEqual({ tags: ['b'] });
  });

  it('completed:false is ignored when base still has completedAt (uses completedAt only)', () => {
    const base = task({ completedAt: '2026-01-01T00:00:00Z' });
    const server = task({ completedAt: '2026-01-01T00:00:00Z', version: 2 });
    const result = mergeTaskPatch(base, { completed: false }, server);

    expect(result.canAutoMerge).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it('normalizes dueAt for comparison', () => {
    const iso = '2026-06-01T12:00:00.000Z';
    const base = task({ dueAt: null });
    const server = task({ dueAt: iso, version: 2 });
    const result = mergeTaskPatch(base, { dueAt: iso }, server);

    expect(result.canAutoMerge).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it('conflicts when dueAt changed differently', () => {
    const base = task({ dueAt: '2026-06-01T00:00:00.000Z' });
    const server = task({ dueAt: '2026-06-02T00:00:00.000Z', version: 2 });
    const result = mergeTaskPatch(
      base,
      { dueAt: '2026-06-03T00:00:00.000Z' },
      server
    );

    expect(result.canAutoMerge).toBe(false);
    expect(result.conflicts[0].field).toBe('dueAt');
  });

  it('merges multiple non-conflicting fields', () => {
    const base = task({ title: 'A', priority: 'low', status: 'todo' });
    const server = task({
      title: 'A',
      priority: 'high',
      status: 'todo',
      version: 5
    });
    const result = mergeTaskPatch(
      base,
      { title: 'B', priority: 'low' },
      server
    );

    expect(result.canAutoMerge).toBe(true);
    expect(result.mergedBody).toEqual({ title: 'B', priority: 'low' });
  });

  it('returns serverTask reference in result', () => {
    const server = task({ title: 'X', version: 9 });
    const result = mergeTaskPatch(task(), { title: 'Y' }, server);
    expect(result.serverTask).toBe(server);
  });
});

describe('TASK_FIELDS export', () => {
  it('lists mergeable task fields', () => {
    expect(TASK_FIELDS).toContain('title');
    expect(TASK_FIELDS).toContain('assignees');
    expect(TASK_FIELDS).toContain('tags');
    expect(TASK_FIELDS).toContain('completed');
    expect(TASK_FIELDS).toHaveLength(10);
  });
});
