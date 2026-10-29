import api, { assumeTrustedRoute } from '@forge/api';
import { Queue } from '@forge/events';
import { objectStore } from '@forge/object-store';
import { makeResolver } from '@forge/resolver';
import { getWorkspaceId, listSchemas } from './api/assetsClient.js';
import { configureRequest } from './api/requestQueue.js';
import { deleteStoredBackup, deleteStoredPlan, runPlan, runTick } from './jobs.js';
import { getPlan, listBackups, listPlans, savePlan } from './plans.js';

// Paths passed to requestJira are built by assetsClient.js from validated ids (UUID and digits only).
configureRequest((path, init) => api.asApp().requestJira(assumeTrustedRoute(path), init));

// The queue key must match `queue` of the consumer module in manifest.yml.
const queue = new Queue({ key: 'backup' });

// Hourly trigger, see runTick. The long work runs in the consumer (timeoutSeconds 900).
export async function tick() {
  await runTick({ enqueue: (bodies) => queue.push(bodies.map((body) => ({ body }))) });
}

export async function consumeBackup(event) {
  await runPlan({ planId: event?.body?.planId, source: event?.body?.source });
}

// Resolver functions called from the admin page with invoke(name, payload).
export const resolverHandler = makeResolver({
  // Plans with their backups, newest first.
  async plans() {
    const [plans, records] = await Promise.all([listPlans(), listBackups()]);
    const backups = {};
    for (const r of records.sort((a, b) => b.startedAt.localeCompare(a.startedAt))) (backups[r.planId] ??= []).push(r);
    return { plans, backups };
  },

  // Schemas the app account can see.
  async schemas() {
    const workspaceId = await getWorkspaceId();
    const visible = workspaceId ? await listSchemas(workspaceId) : [];
    return { schemas: visible.map((s) => ({ key: s.objectSchemaKey, name: s.name })) };
  },

  async savePlan({ payload }) {
    return { plan: await savePlan(payload?.plan, payload?.id) };
  },

  // Deletes the plan, its backup records and their ZIPs.
  async deletePlan({ payload }) {
    await deleteStoredPlan(payload?.id);
    return { deleted: true };
  },

  // Deletes one backup (record and ZIP), for example after downloading it.
  async deleteBackup({ payload }) {
    await deleteStoredBackup({ planId: payload?.planId, stamp: payload?.stamp });
    return { deleted: true };
  },

  async runNow({ payload }) {
    if (!(await getPlan(payload?.planId))) throw new Error('Plan not found');
    await queue.push({ body: { planId: payload.planId, source: 'manual' } });
    return { queued: true };
  },

  // Contract of objectStore.download in @forge/bridge: { keys } in, { [downloadUrl]: key } out.
  async downloadUrls({ payload }) {
    const allowed = new Set((await listBackups()).filter((r) => r.status === 'ok').map((r) => r.key));
    const keys = (payload?.keys ?? []).filter((k) => allowed.has(k));
    if (keys.length === 0) throw new Error('No valid backup keys');
    const out = {};
    for (const key of keys) {
      const target = await objectStore.createDownloadUrl(key);
      if (target) out[target.url] = key;
    }
    return out;
  },
});
