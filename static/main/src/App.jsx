import { invoke, objectStore, showFlag } from '@forge/bridge';
import { useCallback, useEffect, useRef, useState } from 'react';
import Message from './Message.jsx';
import PlanCard from './PlanCard.jsx';
import PlanForm from './PlanForm.jsx';
import StorageSummary from './StorageSummary.jsx';
import { backupFileName, downloadBlob, formatDateTime, formatSize, plural } from './schedule.js';
import { applyRecentWrites, finishedRuns, hideDeletedBackups, pruneQueued } from './sync.js';

const POLL_MS = 10000;
const MAX_PLANS = 20; // same limit as the backend (src/plans.js)
const byName = (a, b) => a.name.localeCompare(b.name, 'en');
// Bridge errors start with a technical prefix that means nothing to the user.
const errorText = (err) => String(err?.message ?? err).replace(/^There was an error invoking the function\s*-\s*/i, '');

let flagCount = 0;

function Skeleton() {
  return (
    <div className="skeleton" aria-hidden="true">
      {[0, 1].map((i) => (
        <div key={i} className="card">
          <span className="bone" style={{ width: '40%' }} />
          <span className="bone" style={{ width: '65%' }} />
          <span className="bone" style={{ width: '90%', height: 48 }} />
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [data, setData] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [schemas, setSchemas] = useState(null);
  const [schemasError, setSchemasError] = useState(null);
  const [editing, setEditing] = useState(null); // null, 'new' or a plan id
  const [pending, setPending] = useState({}); // { 'run:<planId>' | 'download:<key>': true } while a request runs
  const [queuedAt, setQueuedAt] = useState({}); // { planId: time Back up now was accepted }
  const [refreshing, setRefreshing] = useState(false);
  const [pollTick, setPollTick] = useState(0);
  const [focusTarget, setFocusTarget] = useState(null); // { id: 'plan:<id>' | 'create' | 'heading' }, applied after render; a new object each time, so the same target can be asked again
  const [fallback, setFallback] = useState('');
  const [openedAt] = useState(() => Date.now());
  const headingRef = useRef(null);
  const createRef = useRef(null);
  const emptyCreateRef = useRef(null);
  const loadSeq = useRef(0);
  const recentWrites = useRef(new Map());
  const deletedBackups = useRef(new Map()); // { backup key: time it was deleted here }
  const dataRef = useRef(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  // Jira's own flags (toasts). showFlag only throws here for an unusable bridge (then the text goes to the
  // status region); a flag that fails to show later is not reported back to the app.
  const flag = useCallback((type, title, description, actions) => {
    try {
      showFlag({ id: `assets-backup-${++flagCount}`, type, title, description, actions, isAutoDismiss: type === 'success' });
    } catch {
      setFallback([title, description].filter(Boolean).join('. '));
    }
  }, []);

  const load = useCallback(async ({ quiet = false } = {}) => {
    const seq = ++loadSeq.current;
    try {
      const response = await invoke('plans');
      if (seq !== loadSeq.current) return; // a newer request is on its way; its answer wins
      const written = applyRecentWrites(response, recentWrites.current);
      const next = { ...written, backups: hideDeletedBackups(written.backups, deletedBackups.current) };
      for (const { plan, backup } of finishedRuns(dataRef.current, next, openedAt)) {
        if (backup.status === 'ok') flag('success', `Backup of ${plan.name} completed`, `${plural(backup.objects ?? 0, 'object')}, ${formatSize(backup.size)}.`);
        else flag('error', `Backup of ${plan.name} failed`, backup.error);
      }
      setData(next);
      setQueuedAt((q) => pruneQueued(q, next, Date.now()));
      setLoadError(null);
      // A plan missing from a full load was deleted elsewhere: close its form. Background loads don't do
      // this, so a lagging list never closes a form the user is working in.
      if (!quiet) setEditing((e) => (e && e !== 'new' && !next.plans.some((p) => p.id === e) ? null : e));
    } catch (err) {
      if (seq === loadSeq.current && !quiet) setLoadError(errorText(err));
    }
  }, [flag, openedAt]);

  const fetchSchemas = useCallback(() => invoke('schemas').then(
    (response) => {
      setSchemas(response.schemas);
      setSchemasError(null);
    },
    (err) => setSchemasError(errorText(err)),
  ), []);

  // Retry: drop the old error at once, so the form shows the loading state again.
  const loadSchemas = useCallback(() => {
    setSchemasError(null);
    return fetchSchemas();
  }, [fetchSchemas]);

  useEffect(() => {
    load();
    fetchSchemas();
  }, [load, fetchSchemas]);

  // Refresh by itself while a backup runs or was just queued, so its result appears without Refresh.
  // Each poll schedules the next one, also after a failed request; a hidden tab skips the request.
  const running = Boolean(data && Object.values(data.backups).some((list) => list.some((b) => b.status === 'running')));
  const waiting = Object.keys(queuedAt).length > 0;
  useEffect(() => {
    if (!running && !waiting) return undefined;
    const timer = setTimeout(async () => {
      if (!document.hidden) await load({ quiet: true });
      setQueuedAt((q) => pruneQueued(q, dataRef.current, Date.now())); // a run shows up once the queue starts it, or the window ends
      setPollTick((t) => t + 1);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [pollTick, running, waiting, load]);

  // Move focus once the element exists and is enabled (after the form closes).
  useEffect(() => {
    if (focusTarget?.id === 'create') (createRef.current ?? emptyCreateRef.current ?? headingRef.current)?.focus();
    if (focusTarget?.id === 'heading') headingRef.current?.focus();
  }, [focusTarget]);

  async function act(key, fn, failTitle, retry) {
    setPending((p) => ({ ...p, [key]: true }));
    try {
      await fn();
    } catch (err) {
      flag('error', failTitle, errorText(err), retry && [{ text: 'Try again', onClick: retry }]);
    } finally {
      setPending((p) => {
        const rest = { ...p };
        delete rest[key];
        return rest;
      });
    }
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  function openForm(id) {
    setEditing(id);
    if (schemasError) loadSchemas();
  }

  const run = (plan) => act(`run:${plan.id}`, async () => {
    await invoke('runNow', { planId: plan.id });
    setQueuedAt((q) => ({ ...q, [plan.id]: Date.now() }));
    flag('success', `Backup of ${plan.name} started`, 'It usually finishes within a few minutes. This page updates by itself.');
  }, `Couldn't start a backup of ${plan.name}`, () => run(plan));

  const download = (backup) => act(`download:${backup.key}`, async () => {
    const [result] = await objectStore.download({ functionKey: 'downloadUrls', keys: [backup.key] });
    if (!result?.success) throw new Error(result?.error ?? 'The file could not be fetched.');
    const plan = data.plans.find((p) => p.id === backup.planId);
    downloadBlob(result.blob, backupFileName(plan?.name ?? 'plan', backup.startedAt));
  }, "Couldn't download the backup", () => download(backup));

  const removeBackup = (backup) => act(`delete:${backup.key}`, async () => {
    await invoke('deleteBackup', { planId: backup.planId, stamp: backup.stamp });
    deletedBackups.current.set(backup.key, Date.now());
    setData((d) => ({ ...d, backups: { ...d.backups, [backup.planId]: (d.backups[backup.planId] ?? []).filter((b) => b.key !== backup.key) } }));
    flag('success', `Deleted the backup of ${formatDateTime(backup.startedAt)}`);
  }, "Couldn't delete the backup");

  async function savePlan(fields) {
    const id = editing === 'new' ? undefined : editing;
    const { plan } = await invoke('savePlan', { id, plan: fields });
    recentWrites.current.set(plan.id, { plan, at: Date.now() });
    setData((d) => ({ ...d, plans: [...d.plans.filter((p) => p.id !== plan.id), plan].sort(byName) }));
    setEditing(null);
    setFocusTarget({ id: `plan:${plan.id}` });
    flag('success', `Saved ${plan.name}`);
  }

  // Deletes the plan whose form is open.
  async function deletePlan() {
    const plan = data.plans.find((p) => p.id === editing);
    try {
      await invoke('deletePlan', { id: plan.id });
    } catch (err) {
      load(); // the delete can stop halfway: show what is left
      throw err;
    }
    recentWrites.current.set(plan.id, { plan: null, at: Date.now() });
    setData((d) => {
      const backups = { ...d.backups };
      delete backups[plan.id];
      return { plans: d.plans.filter((p) => p.id !== plan.id), backups };
    });
    setEditing(null);
    setFocusTarget({ id: 'heading' });
    flag('success', `Deleted ${plan.name} and its backups`);
  }

  function cancelEdit() {
    setFocusTarget({ id: editing === 'new' ? 'create' : `plan:${editing}` });
    setEditing(null);
  }

  const clearFocus = useCallback(() => setFocusTarget(null), []);
  const schemaNames = Object.fromEntries((schemas ?? []).map((s) => [s.key, s.name]));
  const plans = data?.plans ?? [];
  const hasPlans = plans.length > 0;
  const atLimit = plans.length >= MAX_PLANS;
  const empty = data !== null && !hasPlans && editing === null;

  const form = (plan) => {
    const backups = plan ? data.backups[plan.id] ?? [] : [];
    return (
      <PlanForm
        key={plan ? `edit-${plan.id}` : 'new'}
        plan={plan}
        schemas={schemas}
        schemasError={schemasError}
        onRetrySchemas={loadSchemas}
        storedCount={backups.filter((b) => b.status === 'ok').length}
        running={backups.some((b) => b.status === 'running')}
        onSave={savePlan}
        onCancel={cancelEdit}
        onDelete={plan ? deletePlan : undefined}
      />
    );
  };

  return (
    <main aria-busy={data === null && !loadError}>
      <header className="page-head">
        <div>
          <h1 ref={headingRef} tabIndex={-1}>Assets backups</h1>
          <p className="intro">Back up Assets schemas on a schedule. Each plan has its own schemas, days, start time and retention.</p>
        </div>
        {hasPlans && (
          <div className="head-actions">
            <div className="actions">
              <button type="button" disabled={refreshing} onClick={refresh}>{refreshing ? 'Refreshing...' : 'Refresh'}</button>
              <button type="button" className="primary" ref={createRef} disabled={editing !== null || atLimit} onClick={() => openForm('new')}>Create plan</button>
            </div>
            {atLimit && <p className="help">{MAX_PLANS} plans is the maximum. Delete one to create another.</p>}
          </div>
        )}
      </header>

      <p className="sr" role="status">{data === null && !loadError ? 'Loading backup plans' : fallback}</p>

      {loadError && (
        <Message
          appearance="error"
          title={data === null ? "Couldn't load your backup plans" : "Couldn't refresh your backup plans"}
          actions={<button type="button" disabled={refreshing} onClick={refresh}>{refreshing ? 'Trying again...' : 'Try again'}</button>}
        >
          <p>{loadError}</p>
        </Message>
      )}

      {data === null && !loadError && <Skeleton />}

      {hasPlans && <StorageSummary plans={plans} backups={data.backups} />}

      {editing === 'new' && form(null)}

      {empty && (
        <section className="card empty">
          <h2>No backup plans yet</h2>
          <p>A plan backs up the schemas you choose on the days and hour you set, and keeps each backup for as many days as you choose.</p>
          <p className="help">First give the app account a role in each schema to back up (Object schema, Roles), so the plan can read it.</p>
          <button type="button" className="primary" ref={emptyCreateRef} onClick={() => openForm('new')}>Create plan</button>
        </section>
      )}

      {plans.map((plan) => (editing === plan.id ? form(plan) : (
        <PlanCard
          key={plan.id}
          plan={plan}
          backups={data.backups[plan.id] ?? []}
          schemaNames={schemaNames}
          queued={Boolean(queuedAt[plan.id])}
          pending={pending}
          formOpen={editing !== null}
          focus={focusTarget?.id === `plan:${plan.id}`}
          onFocused={clearFocus}
          onEdit={(p) => openForm(p.id)}
          onRun={run}
          onDownload={download}
          onDeleteBackup={removeBackup}
        />
      )))}
    </main>
  );
}
