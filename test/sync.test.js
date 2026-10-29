import { describe, expect, it } from 'vitest';
import { RECENT_WRITES_MS, applyRecentWrites, QUEUE_WINDOW_MS, finishedRuns, hideDeletedBackups, pruneQueued } from '../static/main/src/sync.js';

const plan = (id, name, patch = {}) => ({ id, name, ...patch });

describe('applyRecentWrites', () => {
  const now = 1_000_000;

  it('keeps a saved plan even when the list still has the old version or misses it', () => {
    const recent = new Map([['a', { plan: plan('a', 'Renamed'), at: now - 1000 }], ['n', { plan: plan('n', 'New'), at: now }]]);
    const result = applyRecentWrites({ plans: [plan('a', 'Old name'), plan('b', 'Beta')], backups: {} }, recent, now);
    expect(result.plans.map((p) => p.name)).toEqual(['Beta', 'New', 'Renamed']);
  });

  it('hides a deleted plan and its backups that the list still returns', () => {
    const recent = new Map([['a', { plan: null, at: now }]]);
    const result = applyRecentWrites({ plans: [plan('a', 'Gone'), plan('b', 'Beta')], backups: { a: [{}], b: [{}] } }, recent, now);
    expect(result.plans.map((p) => p.id)).toEqual(['b']);
    expect(result.backups).toEqual({ b: [{}] });
  });

  it('forgets writes after the window and trusts the list again', () => {
    const recent = new Map([['a', { plan: null, at: now - RECENT_WRITES_MS - 1 }]]);
    const result = applyRecentWrites({ plans: [plan('a', 'Back')], backups: {} }, recent, now);
    expect(result.plans).toHaveLength(1);
    expect(recent.size).toBe(0);
  });
});

describe('hideDeletedBackups', () => {
  const now = 1_000_000;
  const backups = { a: [{ key: 'k1' }, { key: 'k2' }], b: [{ key: 'k3' }] };

  it('hides a deleted backup that the list still returns', () => {
    const result = hideDeletedBackups(backups, new Map([['k1', now]]), now);
    expect(result).toEqual({ a: [{ key: 'k2' }], b: [{ key: 'k3' }] });
  });

  it('forgets deletes after the window and trusts the list again', () => {
    const deleted = new Map([['k1', now - RECENT_WRITES_MS - 1]]);
    expect(hideDeletedBackups(backups, deleted, now)).toBe(backups);
    expect(deleted.size).toBe(0);
  });
});

describe('finishedRuns', () => {
  const p = plan('a', 'Nightly');
  const since = Date.parse('2026-10-26T18:00:00Z');
  const run = (key, status, startedAt = '2026-10-26T18:30:00Z') => ({ key, status, startedAt });

  it('reports runs that were running and are now done', () => {
    const before = { plans: [p], backups: { a: [run('k1', 'running')] } };
    const after = { plans: [p], backups: { a: [run('k1', 'failed')] } };
    expect(finishedRuns(before, after, since)).toEqual([{ plan: p, backup: run('k1', 'failed') }]);
  });

  it('reports new runs that started and finished between two loads, but not older ones', () => {
    const before = { plans: [p], backups: { a: [] } };
    const after = { plans: [p], backups: { a: [run('k2', 'ok'), run('old', 'ok', '2026-10-25T02:00:00Z'), run('k3', 'running')] } };
    expect(finishedRuns(before, after, since).map((r) => r.backup.key)).toEqual(['k2']);
  });

  it('reports nothing on the first load or when nothing changed', () => {
    const data = { plans: [p], backups: { a: [run('k1', 'ok')] } };
    expect(finishedRuns(null, data, since)).toEqual([]);
    expect(finishedRuns(data, data, since)).toEqual([]);
  });
});

describe('pruneQueued', () => {
  const at = Date.parse('2026-10-26T18:30:00Z');
  const data = (startedAt) => ({ plans: [], backups: { a: startedAt ? [{ startedAt }] : [] } });

  it('keeps a plan whose run has not shown up yet', () => {
    const queued = { a: at };
    expect(pruneQueued(queued, data(), at + 1000)).toBe(queued);
    expect(pruneQueued(queued, data('2026-10-26T18:00:00Z'), at + 1000)).toBe(queued);
  });

  it('forgets a plan once a run that started after the click shows up', () => {
    expect(pruneQueued({ a: at }, data('2026-10-26T18:30:05Z'), at + 10000)).toEqual({});
  });

  it('forgets a plan after the window and does nothing without data', () => {
    expect(pruneQueued({ a: at }, data(), at + QUEUE_WINDOW_MS)).toEqual({});
    expect(pruneQueued({ a: at }, null, at + 1000)).toEqual({ a: at });
  });
});
