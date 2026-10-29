import { WhereConditions, kvs } from '@forge/kvs';

export const TIME_ZONE = 'Europe/Copenhagen';
export const MAX_PLANS = 20;
// A consumer is killed after 15 minutes, so a longer "running" record is stale.
const STALE_RUNNING_MS = 20 * 60 * 1000;

const KEY_PATTERN = /^[A-Za-z0-9_-]{1,50}$/;
const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

const planKey = (id) => `plan:${id}`;
const slotKey = (id) => `slot:${id}`;
const backupKey = (planId, stamp) => `backup:${planId}:${stamp}`;

const isInt = (n, min, max) => Number.isInteger(n) && n >= min && n <= max;

// Returns the plan fields without the id, or throws. The caller never trusts the raw input.
export function validatePlan(input) {
  const name = typeof input?.name === 'string' ? input.name.trim() : '';
  if (name.length < 1 || name.length > 80) throw new Error('Invalid plan: name must be 1-80 characters');
  const keys = input.schemaKeys;
  if (!Array.isArray(keys) || keys.length < 1 || keys.length > 100 || !keys.every((k) => typeof k === 'string' && KEY_PATTERN.test(k))) {
    throw new Error('Invalid plan: choose 1-100 schemas');
  }
  const days = input.days;
  if (!Array.isArray(days) || days.length < 1 || !days.every((d) => isInt(d, 1, 7))) throw new Error('Invalid plan: choose at least one weekday');
  if (!isInt(input.hour, 0, 23)) throw new Error('Invalid plan: hour must be 0-23');
  if (!isInt(input.retentionDays, 1, 30)) throw new Error('Invalid plan: retention must be 1-30 days');
  return {
    name,
    schemaKeys: [...new Set(keys)],
    days: [...new Set(days)].sort((a, b) => a - b),
    hour: input.hour,
    retentionDays: input.retentionDays,
    enabled: input.enabled !== false,
  };
}

// The local hour a trigger fires in. `slot` identifies that hour (it repeats when clocks go back, see duePlans).
export function localSlot(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short',
    }).formatToParts(now).map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  return { weekday: WEEKDAYS[parts.weekday], hour, slot: `${parts.year}-${parts.month}-${parts.day}T${parts.hour}` };
}

// Enabled plans whose weekday and hour match now and that did not start in this slot yet.
// In the night clocks go back, hour 02 happens twice: `slot` makes the plan run once.
// In the night clocks go forward, hour 02 does not exist: a plan set to 02:00 skips that day.
export function duePlans(plans, now, lastSlots) {
  const { weekday, hour, slot } = localSlot(now);
  return plans.filter((p) => p.enabled && p.days.includes(weekday) && p.hour === hour && lastSlots[p.id] !== slot);
}

export const backupStamp = (now) => now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');

export const zipKey = (planId, stamp) => `backups/${planId}/${stamp}.zip`;

async function listByPrefix(prefix) {
  const out = [];
  let cursor;
  do {
    let q = kvs.query().where('key', WhereConditions.beginsWith(prefix)).limit(50);
    if (cursor) q = q.cursor(cursor);
    const page = await q.getMany();
    out.push(...page.results.map((r) => r.value));
    cursor = page.nextCursor;
  } while (cursor);
  return out;
}

export async function listPlans() {
  return (await listByPrefix('plan:')).sort((a, b) => a.name.localeCompare(b.name, 'en'));
}

export const getPlan = (id) => kvs.get(planKey(id));

// Creates a plan (no id) or replaces one (id). Returns the stored plan.
export async function savePlan(input, id) {
  const fields = validatePlan(input);
  if (id) {
    if (!(await getPlan(id))) throw new Error('Plan not found');
  } else if ((await listPlans()).length >= MAX_PLANS) {
    throw new Error(`At most ${MAX_PLANS} plans`);
  }
  const plan = { id: id ?? crypto.randomUUID(), ...fields };
  await kvs.set(planKey(plan.id), plan);
  return plan;
}

export async function deletePlan(id) {
  await kvs.delete(planKey(id));
  await kvs.delete(slotKey(id));
}

export async function getLastSlots(plans) {
  const entries = await Promise.all(plans.map(async (p) => [p.id, await kvs.get(slotKey(p.id))]));
  return Object.fromEntries(entries);
}

export const setLastSlot = (id, slot) => kvs.set(slotKey(id), slot);

export const putBackupRecord = (record) => kvs.set(backupKey(record.planId, record.stamp), record);

export const listBackups = (planId) => listByPrefix(planId ? `backup:${planId}:` : 'backup:');

export const getBackupRecord = (planId, stamp) => kvs.get(backupKey(planId, stamp));

export const deleteBackupRecord =(record) => kvs.delete(backupKey(record.planId, record.stamp));

// Marks records stuck in "running" as failed and returns the records whose retention is over (to delete with their ZIPs).
export async function sweepBackups(now) {
  const expired = [];
  for (const record of await listBackups()) {
    if (record.status === 'running' && now - new Date(record.startedAt) > STALE_RUNNING_MS) {
      await putBackupRecord({ ...record, status: 'failed', error: 'Timed out', finishedAt: now.toISOString() });
    } else if (record.expiresAt && new Date(record.expiresAt) <= now) {
      expired.push(record);
    }
  }
  return expired;
}
