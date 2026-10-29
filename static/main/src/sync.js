// Keeps the page consistent with an eventually consistent backend list.

export const RECENT_WRITES_MS = 60000;

const byName = (a, b) => a.name.localeCompare(b.name, 'en');

// Saves and deletes made on this page win over list responses for a while: right after a write, the
// list query can still return the old plan or a deleted one. `recent` maps a plan id to
// { plan, at }, where `plan` is null for a delete; expired entries are removed from it.
export function applyRecentWrites(response, recent, now = Date.now()) {
  let plans = response.plans;
  const backups = { ...response.backups };
  for (const [id, { plan, at }] of recent) {
    if (now - at > RECENT_WRITES_MS) {
      recent.delete(id);
      continue;
    }
    plans = plans.filter((p) => p.id !== id);
    if (plan) plans = [...plans, plan];
    else delete backups[id];
  }
  return { plans: [...plans].sort(byName), backups };
}

// Same idea for single deleted backups: `deleted` maps a backup key to the time it was deleted, and the
// list can still return the record for a while. Returns `backups` without those; expired entries are removed.
export function hideDeletedBackups(backups, deleted, now = Date.now()) {
  for (const [key, at] of deleted) if (now - at > RECENT_WRITES_MS) deleted.delete(key);
  if (deleted.size === 0) return backups;
  return Object.fromEntries(Object.entries(backups).map(([planId, list]) => [planId, list.filter((b) => !deleted.has(b.key))]));
}

// Runs that finished between two loads: they were running before, or they are new and started after
// `since` (the page was open). Returns [{ plan, backup }] for the flags that tell the user.
export function finishedRuns(before, after, since) {
  if (!before) return [];
  const out = [];
  for (const plan of after.plans) {
    const previous = new Map((before.backups[plan.id] ?? []).map((b) => [b.key, b]));
    for (const backup of after.backups[plan.id] ?? []) {
      if (backup.status === 'running') continue;
      const old = previous.get(backup.key);
      if (old?.status === 'running' || (!old && new Date(backup.startedAt).getTime() >= since)) out.push({ plan, backup });
    }
  }
  return out;
}

// After Back up now, keep refreshing this long for the run to show up (the queue can take a moment).
export const QUEUE_WINDOW_MS = 3 * 60000;

// `queued` maps a plan id to the time Back up now was accepted. Forgets the plans whose run now shows up
// in `data` (it started at or after that time, minus a minute of clock skew) or whose window has passed.
export function pruneQueued(queued, data, now = Date.now()) {
  const next = Object.fromEntries(Object.entries(queued).filter(([planId, at]) => {
    const newest = data?.backups[planId]?.[0];
    const appeared = newest && new Date(newest.startedAt).getTime() >= at - 60000;
    return !appeared && now - at < QUEUE_WINDOW_MS;
  }));
  return Object.keys(next).length === Object.keys(queued).length ? queued : next;
}
