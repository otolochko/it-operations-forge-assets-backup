import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeKvs, fakeConditions } from './helpers/fakeKvs.js';

const fake = createFakeKvs();
vi.mock('@forge/kvs', () => ({ kvs: fake.kvs, WhereConditions: fakeConditions }));
vi.mock('@forge/object-store', () => ({ objectStore: { delete: vi.fn() } }));
vi.mock('../src/backup.js', () => ({ runBackup: vi.fn() }));
const { objectStore } = await import('@forge/object-store');
const { runBackup } = await import('../src/backup.js');
const plans = await import('../src/plans.js');
const { deleteStoredBackup, deleteStoredPlan, removeBackup, runPlan, runTick } = await import('../src/jobs.js');

const input = { name: 'Nightly', schemaKeys: ['DVC'], days: [1, 2, 3, 4, 5, 6, 7], hour: 2, retentionDays: 3 };
const monday2am = new Date('2026-10-26T01:10:00Z');

beforeEach(() => {
  fake.store.clear();
  objectStore.delete.mockReset().mockResolvedValue(undefined);
  runBackup.mockReset();
});

describe('runTick', () => {
  it('queues due plans once per slot', async () => {
    const due = await plans.savePlan(input);
    await plans.savePlan({ ...input, name: 'Other hour', hour: 5 });
    await plans.savePlan({ ...input, name: 'Paused', enabled: false });
    const enqueue = vi.fn();

    expect(await runTick({ now: monday2am, enqueue })).toBe(1);
    expect(enqueue).toHaveBeenCalledWith([{ planId: due.id, source: 'schedule' }]);

    expect(await runTick({ now: new Date('2026-10-26T01:40:00Z'), enqueue })).toBe(0);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('does not mark the slot when queueing fails', async () => {
    const plan = await plans.savePlan(input);
    await expect(runTick({ now: monday2am, enqueue: vi.fn().mockRejectedValue(new Error('queue down')) })).rejects.toThrow('queue down');
    expect(fake.store.has(`slot:${plan.id}`)).toBe(false);
  });

  it('deletes expired backups with their ZIPs', async () => {
    await plans.putBackupRecord({ planId: 'p', stamp: 's', key: 'backups/p/s.zip', status: 'ok', startedAt: '2026-10-20T00:00:00.000Z', expiresAt: '2026-10-25T00:00:00.000Z' });
    await runTick({ now: monday2am, enqueue: vi.fn() });
    expect(objectStore.delete).toHaveBeenCalledWith('backups/p/s.zip');
    expect(fake.store.has('backup:p:s')).toBe(false);
  });
});

describe('runPlan', () => {
  it('records a successful backup with the plan retention', async () => {
    const plan = await plans.savePlan(input);
    runBackup.mockResolvedValue({ bytes: 100, objects: 7, schemas: 1, failedTypes: 0, missingSchemas: ['X'] });
    await runPlan({ planId: plan.id, source: 'manual', now: monday2am });

    expect(runBackup).toHaveBeenCalledWith({
      schemaKeys: ['DVC'], key: `backups/${plan.id}/20261026T011000Z.zip`, ttlSeconds: 3 * 86400, now: monday2am,
    });
    expect(fake.store.get(`backup:${plan.id}:20261026T011000Z`)).toMatchObject({
      status: 'ok', source: 'manual', size: 100, objects: 7, missingSchemas: ['X'], expiresAt: '2026-10-29T01:10:00.000Z',
    });
  });

  it('records a failure instead of throwing', async () => {
    const plan = await plans.savePlan(input);
    runBackup.mockRejectedValue(new Error('Assets said no'));
    await expect(runPlan({ planId: plan.id, now: monday2am })).resolves.toBeUndefined();
    expect(fake.store.get(`backup:${plan.id}:20261026T011000Z`)).toMatchObject({ status: 'failed', error: 'Assets said no' });
  });

  it('ignores a plan that was deleted', async () => {
    await runPlan({ planId: 'gone', now: monday2am });
    expect(runBackup).not.toHaveBeenCalled();
    expect(fake.store.size).toBe(0);
  });
});

describe('deleteStoredBackup', () => {
  const stamp = '20261026T011000Z';
  const base = { planId: 'p', stamp, key: `backups/p/${stamp}.zip`, startedAt: '2026-10-26T01:10:00.000Z' };

  it('deletes the ZIP and the record', async () => {
    await plans.putBackupRecord({ ...base, status: 'ok' });
    await deleteStoredBackup({ planId: 'p', stamp });
    expect(objectStore.delete).toHaveBeenCalledWith(base.key);
    expect(fake.store.has(`backup:p:${stamp}`)).toBe(false);
  });

  it('refuses a running backup', async () => {
    await plans.putBackupRecord({ ...base, status: 'running' });
    await expect(deleteStoredBackup({ planId: 'p', stamp })).rejects.toThrow("can't be deleted");
    expect(objectStore.delete).not.toHaveBeenCalled();
    expect(fake.store.has(`backup:p:${stamp}`)).toBe(true);
  });

  it('rejects a missing backup and a malformed stamp', async () => {
    await expect(deleteStoredBackup({ planId: 'p', stamp })).rejects.toThrow('Backup not found');
    await expect(deleteStoredBackup({ planId: 'p', stamp: '../x' })).rejects.toThrow('Invalid backup');
    await expect(deleteStoredBackup({ planId: undefined, stamp })).rejects.toThrow('Invalid backup');
  });
});

describe('deleteStoredPlan', () => {
  it('rejects invalid and nonexistent IDs without deleting anything', async () => {
    const plan = await plans.savePlan(input);
    await plans.setLastSlot(plan.id, 'slot');
    await plans.putBackupRecord({ planId: plan.id, stamp: 's', key: 'zip', status: 'ok' });
    const before = new Map(fake.store);
    for (const id of [undefined, null, '', 42, {}, 'bad', `${plan.id}:other`, '00000000-0000-4000-8000-000000000000']) {
      await expect(deleteStoredPlan(id)).rejects.toThrow();
      expect(fake.store).toEqual(before);
      expect(objectStore.delete).not.toHaveBeenCalled();
    }
  });

  it('refuses all deletion when a later backup is running', async () => {
    const plan = await plans.savePlan(input);
    await plans.setLastSlot(plan.id, 'slot');
    await plans.putBackupRecord({ planId: plan.id, stamp: 'a', key: 'finished.zip', status: 'ok' });
    await plans.putBackupRecord({ planId: plan.id, stamp: 'b', key: 'running.zip', status: 'running' });
    const before = new Map(fake.store);
    await expect(deleteStoredPlan(plan.id)).rejects.toThrow("can't be deleted");
    expect(fake.store).toEqual(before);
    expect(objectStore.delete).not.toHaveBeenCalled();
  });

  it('deletes only the selected plan, its slot, and its backups', async () => {
    const plan = await plans.savePlan(input);
    const other = await plans.savePlan({ ...input, name: 'Other' });
    await plans.setLastSlot(plan.id, 'slot');
    await plans.putBackupRecord({ planId: plan.id, stamp: 'a', key: 'selected.zip', status: 'ok' });
    await plans.putBackupRecord({ planId: other.id, stamp: 'b', key: 'other.zip', status: 'running' });
    await deleteStoredPlan(plan.id);
    expect(objectStore.delete).toHaveBeenCalledExactlyOnceWith('selected.zip');
    expect(fake.store.has(`plan:${plan.id}`)).toBe(false);
    expect(fake.store.has(`slot:${plan.id}`)).toBe(false);
    expect(fake.store.has(`backup:${plan.id}:a`)).toBe(false);
    expect(fake.store.has(`plan:${other.id}`)).toBe(true);
    expect(fake.store.has(`backup:${other.id}:b`)).toBe(true);
  });
});

describe('removeBackup', () => {
  it('ignores a ZIP that is already gone', async () => {
    objectStore.delete.mockRejectedValue(new Error('not found'));
    await plans.putBackupRecord({ planId: 'p', stamp: 's', key: 'k' });
    await removeBackup({ planId: 'p', stamp: 's', key: 'k' });
    expect(fake.store.size).toBe(0);
  });
});
