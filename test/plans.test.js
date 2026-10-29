import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeKvs, fakeConditions } from './helpers/fakeKvs.js';

const fake = createFakeKvs();
vi.mock('@forge/kvs', () => ({ kvs: fake.kvs, WhereConditions: fakeConditions }));
const plans = await import('../src/plans.js');

const input = { name: ' Nightly ', schemaKeys: ['DVC', 'DVC', 'HR'], days: [5, 1, 1], hour: 2, retentionDays: 7 };
const at = (iso) => new Date(iso);

beforeEach(() => fake.store.clear());

describe('validatePlan', () => {
  it('normalizes a valid plan', () => {
    expect(plans.validatePlan(input)).toEqual({ name: 'Nightly', schemaKeys: ['DVC', 'HR'], days: [1, 5], hour: 2, retentionDays: 7, enabled: true });
    expect(plans.validatePlan({ ...input, enabled: false }).enabled).toBe(false);
  });

  it('rejects anything out of range', () => {
    const bad = [
      { name: '' }, { name: 'x'.repeat(81) }, { schemaKeys: [] }, { schemaKeys: ['a b'] }, { schemaKeys: 'DVC' },
      { days: [] }, { days: [0] }, { days: [8] }, { hour: 24 }, { hour: 1.5 }, { hour: '2' },
      { retentionDays: 0 }, { retentionDays: 31 },
    ];
    for (const patch of bad) expect(() => plans.validatePlan({ ...input, ...patch })).toThrow('Invalid plan');
    expect(() => plans.validatePlan(null)).toThrow('Invalid plan');
  });
});

describe('localSlot', () => {
  it('uses Copenhagen time in summer and winter', () => {
    expect(plans.localSlot(at('2026-07-15T00:30:00Z'))).toEqual({ weekday: 3, hour: 2, slot: '2026-07-15T02' });
    expect(plans.localSlot(at('2026-12-15T00:30:00Z'))).toEqual({ weekday: 2, hour: 1, slot: '2026-12-15T01' });
  });

  it('repeats hour 02 when clocks go back and skips it when they go forward', () => {
    expect(plans.localSlot(at('2026-10-25T00:30:00Z')).slot).toBe('2026-10-25T02');
    expect(plans.localSlot(at('2026-10-25T01:30:00Z')).slot).toBe('2026-10-25T02');
    expect(plans.localSlot(at('2026-03-29T00:30:00Z')).hour).toBe(1);
    expect(plans.localSlot(at('2026-03-29T01:30:00Z')).hour).toBe(3);
  });
});

describe('duePlans', () => {
  const plan = (patch) => ({ id: 'p1', enabled: true, days: [1, 2, 3, 4, 5, 6, 7], hour: 2, ...patch });
  const monday2am = at('2026-10-26T01:10:00Z');

  it('matches weekday and hour of the local time', () => {
    expect(plans.duePlans([plan({})], monday2am, {})).toHaveLength(1);
    expect(plans.duePlans([plan({ days: [2] })], monday2am, {})).toHaveLength(0);
    expect(plans.duePlans([plan({ hour: 3 })], monday2am, {})).toHaveLength(0);
    expect(plans.duePlans([plan({ enabled: false })], monday2am, {})).toHaveLength(0);
  });

  it('runs once per slot, also when the hour repeats', () => {
    const { slot } = plans.localSlot(monday2am);
    expect(plans.duePlans([plan({})], monday2am, { p1: slot })).toHaveLength(0);
    const repeated = at('2026-10-25T01:10:00Z');
    expect(plans.duePlans([plan({})], repeated, { p1: plans.localSlot(at('2026-10-25T00:10:00Z')).slot })).toHaveLength(0);
  });
});

describe('plan storage', () => {
  it('creates, lists, updates and deletes plans', async () => {
    const created = await plans.savePlan(input);
    expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
    await plans.savePlan({ ...input, name: 'A first' });
    expect((await plans.listPlans()).map((p) => p.name)).toEqual(['A first', 'Nightly']);

    const updated = await plans.savePlan({ ...input, hour: 4 }, created.id);
    expect(updated).toMatchObject({ id: created.id, hour: 4 });
    await expect(plans.savePlan(input, 'missing')).rejects.toThrow('Plan not found');

    await plans.setLastSlot(created.id, '2026-10-26T02');
    await plans.deletePlan(created.id);
    expect(await plans.getPlan(created.id)).toBeUndefined();
    expect(fake.store.has(`slot:${created.id}`)).toBe(false);
  });

  it('limits the number of plans and pages through the list', async () => {
    for (let i = 0; i < plans.MAX_PLANS; i++) await plans.savePlan({ ...input, name: `Plan ${i}` });
    await expect(plans.savePlan(input)).rejects.toThrow(`At most ${plans.MAX_PLANS}`);
    expect(await plans.listPlans()).toHaveLength(plans.MAX_PLANS);
  });
});

describe('backup records', () => {
  const record = (planId, stamp, patch = {}) => ({ planId, stamp, key: `backups/${planId}/${stamp}.zip`, status: 'ok', startedAt: '2026-10-26T01:00:00.000Z', ...patch });

  it('lists by plan and keeps plans apart', async () => {
    await plans.putBackupRecord(record('a', '1'));
    await plans.putBackupRecord(record('a', '2'));
    await plans.putBackupRecord(record('b', '1'));
    expect(await plans.listBackups('a')).toHaveLength(2);
    expect(await plans.listBackups()).toHaveLength(3);
  });

  it('sweeps stale running records and returns the expired ones', async () => {
    const now = at('2026-10-26T12:00:00Z');
    await plans.putBackupRecord(record('a', 'stale', { status: 'running', startedAt: '2026-10-26T10:00:00.000Z' }));
    await plans.putBackupRecord(record('a', 'fresh', { status: 'running', startedAt: '2026-10-26T11:55:00.000Z' }));
    await plans.putBackupRecord(record('a', 'old', { expiresAt: '2026-10-25T00:00:00.000Z' }));
    await plans.putBackupRecord(record('a', 'kept', { expiresAt: '2026-11-01T00:00:00.000Z' }));

    const expired = await plans.sweepBackups(now);
    expect(expired.map((r) => r.stamp)).toEqual(['old']);
    expect(fake.store.get('backup:a:stale')).toMatchObject({ status: 'failed', error: 'Timed out' });
    expect(fake.store.get('backup:a:fresh').status).toBe('running');
  });
});
