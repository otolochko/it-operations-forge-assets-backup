import { Fragment, useEffect, useRef, useState } from 'react';
import HistoryStrip from './HistoryStrip.jsx';
import Message from './Message.jsx';
import WeekStrip from './WeekStrip.jsx';
import { describeSchedule, formatDateTime, formatDuration, formatNextRun, formatSize, nextRun, planHealth, plural } from './schedule.js';

const STATUS = { ok: ['Completed', 'success'], failed: ['Failed', 'removed'], running: ['In progress', 'inprogress'] };
const HEALTH = { paused: ['Paused', 'default'], failed: ['Failed', 'removed'], incomplete: ['Incomplete', 'moved'] };

function Lozenge({ text, appearance }) {
  return <span className="lozenge" data-appearance={appearance}>{text}</span>;
}

const Status = ({ status }) => <Lozenge text={STATUS[status]?.[0] ?? status} appearance={STATUS[status]?.[1] ?? 'default'} />;

// "Mon 26 Oct, 18:24 · 220 objects · 35 KB": each part stays on one line, the line breaks between parts.
function Parts({ parts }) {
  return parts.map((part, i) => (
    <Fragment key={i}>
      {i > 0 && ' · '}
      <span className="part">{part}</span>
    </Fragment>
  ));
}

function BackupTable({ id, planName, backups, pending, onDownload, onDelete }) {
  const [confirmKey, setConfirmKey] = useState(null); // key of the row asking "Delete?"
  const confirmRef = useRef(null);
  const deleteRefs = useRef(new Map());
  const wasConfirming = useRef(null);

  // The confirmation takes focus when it opens and gives it back to that row's Delete when it closes.
  useEffect(() => {
    if (confirmKey) confirmRef.current?.focus();
    else if (wasConfirming.current) deleteRefs.current.get(wasConfirming.current)?.focus();
    wasConfirming.current = confirmKey;
  }, [confirmKey]);

  async function confirm(backup) {
    try {
      await onDelete(backup);
    } finally {
      wasConfirming.current = null; // the row is gone or the error flag shows: no focus to give back
      setConfirmKey(null);
    }
  }

  return (
    <div className="table-wrap" id={id}>
      <table>
        <caption className="sr">Backup history of {planName}, newest first</caption>
        <thead>
          <tr>
            <th scope="col">Started</th>
            <th scope="col" className="optional">Trigger</th>
            <th scope="col">Result</th>
            <th scope="col" className="num">Objects</th>
            <th scope="col" className="num">Size</th>
            <th scope="col" className="num optional">Duration</th>
            <th scope="col"><span className="sr">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          {backups.map((b) => (
            <tr key={b.key}>
              <td>{formatDateTime(b.startedAt)}</td>
              <td className="optional">{b.source === 'manual' ? 'Manual' : 'Schedule'}</td>
              <td>
                <Status status={b.status} />
                {b.status === 'failed' && <div className="note error">{b.error}</div>}
              </td>
              <td className="num">{b.objects?.toLocaleString('en') ?? ''}</td>
              <td className="num">{formatSize(b.size)}</td>
              <td className="num optional">{formatDuration(b.startedAt, b.finishedAt)}</td>
              <td className="end">
                {confirmKey === b.key ? (
                  <span className="row-confirm">
                    <span>Delete this backup?</span>
                    <button type="button" ref={confirmRef} className="danger" disabled={pending[`delete:${b.key}`]} onClick={() => confirm(b)}>
                      {pending[`delete:${b.key}`] ? 'Deleting...' : 'Delete'}
                    </button>
                    <button type="button" disabled={pending[`delete:${b.key}`]} onClick={() => setConfirmKey(null)}>Cancel</button>
                  </span>
                ) : (
                  <>
                    {b.status === 'ok' && (
                      <button type="button" className="link" disabled={pending[`download:${b.key}`]} aria-label={`Download backup of ${formatDateTime(b.startedAt)}`} onClick={() => onDownload(b)}>
                        {pending[`download:${b.key}`] ? 'Downloading...' : 'Download'}
                      </button>
                    )}
                    {b.status !== 'running' && (
                      <button
                        type="button"
                        className="link danger-text"
                        ref={(el) => (el ? deleteRefs.current.set(b.key, el) : deleteRefs.current.delete(b.key))}
                        aria-label={`Delete backup of ${formatDateTime(b.startedAt)}`}
                        onClick={() => setConfirmKey(b.key)}
                      >
                        Delete
                      </button>
                    )}
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// What deserves attention in the latest finished backup.
function problems(last) {
  if (!last || last.status !== 'ok') return [];
  const out = [];
  const missing = last.missingSchemas ?? [];
  if (missing.length > 0) {
    out.push(`The app account can't read ${missing.join(', ')}, so ${missing.length === 1 ? 'it was' : 'they were'} left out. Give the account a role in ${missing.length === 1 ? 'that schema' : 'those schemas'}.`);
  }
  if (last.failedTypes > 0) out.push(`${plural(last.failedTypes, 'object type')} failed and can't be restored from this backup.`);
  return out;
}

export default function PlanCard({ plan, backups, schemaNames, queued, pending, formOpen, focus, onFocused, onEdit, onRun, onDownload, onDeleteBackup }) {
  const [showAll, setShowAll] = useState(false);
  const headingRef = useRef(null);
  useEffect(() => {
    if (!focus) return;
    headingRef.current?.focus();
    onFocused();
  }, [focus, onFocused]);

  const health = HEALTH[planHealth(plan, backups)];
  const next = nextRun(plan);
  const running = backups.find((b) => b.status === 'running');
  const last = backups.find((b) => b.status !== 'running');
  const stored = backups.filter((b) => b.status === 'ok');
  const storedSize = stored.reduce((sum, b) => sum + (b.size ?? 0), 0);
  const warnings = problems(last);
  const starting = pending[`run:${plan.id}`] || queued;
  const tableId = `history-${plan.id}`;

  let runLabel = 'Back up now';
  if (running) runLabel = 'Backing up...';
  else if (starting) runLabel = 'Starting...';

  return (
    <article className="card plan" data-paused={!plan.enabled} aria-labelledby={`plan-${plan.id}`}>
      <header className="plan-head">
        <div className="plan-title">
          <div className="title-row">
            <h2 id={`plan-${plan.id}`} ref={headingRef} tabIndex={-1}>{plan.name}</h2>
            {health && <Lozenge text={health[0]} appearance={health[1]} />}
          </div>
          <p className="when">
            {plan.enabled
              ? (next ? `Next backup ${formatNextRun(next, plan.hour)}` : 'No upcoming backup')
              : 'Paused. It backs up only when you select Back up now.'}
          </p>
        </div>
        <div className="actions">
          <button type="button" disabled={Boolean(running || starting)} onClick={() => onRun(plan)}>{runLabel}</button>
          {/* One form at a time: another Edit would silently drop unsaved changes. */}
          <button type="button" aria-label={`Edit ${plan.name}`} disabled={formOpen} onClick={() => onEdit(plan)}>Edit</button>
        </div>
      </header>

      <dl className="facts">
        <div className="wide">
          <dt>Schedule</dt>
          <dd>
            <WeekStrip days={plan.days} paused={!plan.enabled} />
            <span className="schedule-text">{describeSchedule(plan.days, plan.hour)}</span>
          </dd>
        </div>
        <div className="wide">
          <dt>Schemas</dt>
          <dd className="chips">{plan.schemaKeys.map((k) => <span key={k} className="chip" title={k}>{schemaNames[k] ?? k}</span>)}</dd>
        </div>
        <div>
          <dt>Kept for</dt>
          <dd className="value">{plural(plan.retentionDays, 'day')}</dd>
        </div>
        <div>
          <dt>Stored now</dt>
          <dd className="value">{stored.length === 0 ? 'Nothing yet' : `${plural(stored.length, 'backup')}, ${formatSize(storedSize)}`}</dd>
        </div>
      </dl>

      {warnings.length > 0 && (
        <Message appearance="warning" title="The last backup is incomplete">
          <ul className="message-list">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        </Message>
      )}

      {running && (
        <p className="run-line">
          <Status status="running" />
          <span className="detail">Started {formatDateTime(running.startedAt)}{running.source === 'manual' ? ', manually' : ''}. This page updates when it finishes.</span>
        </p>
      )}

      <div className="last">
        <div>
          <span className="label">Last backup</span>
          {last ? (
            <p>
              <Status status={last.status} />
              <span className="detail">
                <Parts
                  parts={last.status === 'ok'
                    ? [formatDateTime(last.startedAt), plural(last.objects ?? 0, 'object'), formatSize(last.size), `took ${formatDuration(last.startedAt, last.finishedAt)}`]
                    : [formatDateTime(last.startedAt)]}
                />
              </span>
              {last.status === 'failed' && <span className="note error">{last.error}</span>}
            </p>
          ) : (
            <p className="muted">No backup has finished yet. Select Back up now to run one, or wait for the schedule.</p>
          )}
        </div>
        {last?.status === 'ok' && (
          <button type="button" disabled={pending[`download:${last.key}`]} onClick={() => onDownload(last)}>
            {pending[`download:${last.key}`] ? 'Downloading...' : 'Download'}
          </button>
        )}
      </div>

      <div className="history-row">
        <span className="label">Last 14 runs</span>
        <HistoryStrip backups={backups} />
        {backups.length > 0 && (
          <button type="button" className="link" aria-expanded={showAll} aria-controls={showAll ? tableId : undefined} onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Hide history' : `Show history (${backups.length})`}
          </button>
        )}
      </div>

      {showAll && <BackupTable id={tableId} planName={plan.name} backups={backups} pending={pending} onDownload={onDownload} onDelete={onDeleteBackup} />}
    </article>
  );
}
