import { objectStore } from '@forge/object-store';
import { runBackup } from './backup.js';
import {
  backupStamp, deleteBackupRecord, deletePlan, duePlans, getBackupRecord, getLastSlots, getPlan, listBackups, listPlans, localSlot, putBackupRecord, setLastSlot, sweepBackups, zipKey,
} from './plans.js';

const DAY_MS = 86400000;
const log = (entry) => console.log(JSON.stringify(entry));

// Deletes a backup record and its ZIP. A ZIP that is already gone (TTL) is not an error.
export async function removeBackup(record) {
  await objectStore.delete(record.key).catch(() => undefined);
  await deleteBackupRecord(record);
}

// Deletes one backup chosen by the user. A running backup is refused: its consumer would write the record again.
export async function deleteStoredBackup({ planId, stamp }) {
  if (typeof planId !== 'string' || !/^\d{8}T\d{6}Z$/.test(stamp ?? '')) throw new Error('Invalid backup');
  const record = await getBackupRecord(planId, stamp);
  if (!record) throw new Error('Backup not found');
  if (record.status === 'running') throw new Error("A running backup can't be deleted");
  await removeBackup(record);
}

// Check all visible records before deleting anything, so a running backup blocks plan deletion.
export async function deleteStoredPlan(id) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error('Invalid plan ID');
  }
  if (!(await getPlan(id))) throw new Error('Plan not found');
  const records = await listBackups(id);
  if (records.some((record) => record.status === 'running')) throw new Error("A plan with a running backup can't be deleted");
  for (const record of records) await removeBackup(record);
  await deletePlan(id);
}

// Hourly trigger: cleans up expired backups, then queues the plans that are due in this local hour.
// `enqueue(bodies)` pushes events to the backup queue.
export async function runTick({ now = new Date(), enqueue }) {
  for (const record of await sweepBackups(now)) await removeBackup(record);

  const plans = await listPlans();
  const due = duePlans(plans, now, await getLastSlots(plans));
  if (due.length > 0) {
    await enqueue(due.map((p) => ({ planId: p.id, source: 'schedule' })));
    const { slot } = localSlot(now);
    for (const p of due) await setLastSlot(p.id, slot);
  }
  log({ event: 'tick', plans: plans.length, due: due.length });
  return due.length;
}

// Queue consumer: runs one plan and records the outcome. Errors are recorded, never thrown:
// a thrown error makes Forge retry the event for up to 24 hours.
export async function runPlan({ planId, source = 'unknown', now = new Date() }) {
  const plan = await getPlan(planId);
  if (!plan) {
    log({ event: 'backup', planId, source, ok: false, error: 'Plan not found' });
    return;
  }
  const stamp = backupStamp(now);
  const record = {
    planId,
    stamp,
    key: zipKey(planId, stamp),
    source,
    status: 'running',
    startedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + plan.retentionDays * DAY_MS).toISOString(),
  };
  await putBackupRecord(record);
  try {
    const summary = await runBackup({ schemaKeys: plan.schemaKeys, key: record.key, ttlSeconds: plan.retentionDays * 86400, now });
    await putBackupRecord({
      ...record,
      status: 'ok',
      finishedAt: new Date().toISOString(),
      size: summary.bytes,
      objects: summary.objects,
      schemas: summary.schemas,
      failedTypes: summary.failedTypes,
      missingSchemas: summary.missingSchemas,
    });
    log({ event: 'backup', planId, source, ok: true, ...summary });
  } catch (err) {
    const error = String(err?.message ?? err).slice(0, 200);
    await putBackupRecord({ ...record, status: 'failed', finishedAt: new Date().toISOString(), error });
    log({ event: 'backup', planId, source, ok: false, error });
  }
}
