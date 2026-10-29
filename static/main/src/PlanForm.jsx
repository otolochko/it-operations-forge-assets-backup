import { useEffect, useId, useRef, useState } from 'react';
import Message from './Message.jsx';
import WeekStrip from './WeekStrip.jsx';
import { TIME_ZONE, formatHour, plural, validatePlanForm } from './schedule.js';

const HOURS = Array.from({ length: 24 }, (_, h) => h);
const ALL_DAYS = [1, 2, 3, 4, 5, 6, 7];
const WEEKDAYS = [1, 2, 3, 4, 5];
const FIELD_ORDER = ['name', 'schemas', 'days', 'retention'];

const errorText = (err) => err?.message ?? String(err);
const Required = () => <span className="req" aria-hidden="true"> *</span>;

function FieldError({ id, text }) {
  return text ? <p id={id} className="field-error">{text}</p> : null;
}

// `schemas` is [{ key, name }] readable by the app account, or null while loading or after `schemasError`.
// `onDelete` is set when editing: the plan and its `storedCount` stored backups can be deleted from here,
// except while one of its backups is `running`.
export default function PlanForm({ plan, schemas, schemasError, onRetrySchemas, storedCount = 0, running = false, onSave, onCancel, onDelete }) {
  const [name, setName] = useState(plan?.name ?? '');
  const [schemaKeys, setSchemaKeys] = useState(plan?.schemaKeys ?? []);
  const [days, setDays] = useState(plan?.days ?? ALL_DAYS);
  const [hour, setHour] = useState(plan?.hour ?? 2);
  const [retentionDays, setRetentionDays] = useState(String(plan?.retentionDays ?? 7));
  const [enabled, setEnabled] = useState(plan?.enabled ?? true);
  const [submitted, setSubmitted] = useState(false);
  const [failure, setFailure] = useState(null); // { title, text } from the server
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const id = useId();
  const ids = Object.fromEntries(['heading', 'name', 'schemasHelp', 'hour', 'hourHelp', 'retention', 'retentionHelp', 'enabled', 'enabledHelp']
    .map((k) => [k, `${id}-${k}`]));
  const errId = (field) => `${id}-${field}-error`;
  const nameRef = useRef(null);
  const schemasRef = useRef(null);
  const daysRef = useRef(null);
  const retentionRef = useRef(null);
  const failureRef = useRef(null);
  const confirmRef = useRef(null);
  const deleteRef = useRef(null);
  const wasConfirming = useRef(false);
  const values = JSON.stringify({ name, schemaKeys, days, hour, retentionDays, enabled });
  const [initialValues] = useState(values);
  const dirty = values !== initialValues;

  // Errors show after the first save attempt and then follow the user's corrections.
  const errors = submitted ? validatePlanForm({ name, schemaKeys, days, retentionDays }) : {};
  const describedBy = (field, ...help) => [...help, errors[field] && errId(field)].filter(Boolean).join(' ') || undefined;

  useEffect(() => nameRef.current?.focus(), []);
  useEffect(() => {
    if (failure) failureRef.current?.focus();
  }, [failure]);
  // The confirmation takes focus when it opens and gives it back to Delete plan when it closes.
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
    else if (wasConfirming.current) deleteRef.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);

  const toggle = (list, setList, value) => setList(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  const visible = new Set((schemas ?? []).map((s) => s.key));
  // Selected keys missing from the list: unreadable when the list loaded, unknown when it failed to load.
  const hidden = schemas || schemasError ? schemaKeys.filter((k) => !visible.has(k)) : [];

  function focusField(field) {
    if (field === 'name') nameRef.current?.focus();
    if (field === 'schemas') schemasRef.current?.querySelector('input')?.focus();
    if (field === 'days') daysRef.current?.querySelector('button')?.focus();
    if (field === 'retention') retentionRef.current?.focus();
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitted(true);
    const found = validatePlanForm({ name, schemaKeys, days, retentionDays });
    const first = FIELD_ORDER.find((f) => found[f]);
    if (first) {
      focusField(first);
      return;
    }
    setSaving(true);
    setFailure(null);
    try {
      await onSave({ name: name.trim(), schemaKeys, days, hour, retentionDays: Number(retentionDays), enabled });
    } catch (err) {
      setFailure({ title: "Couldn't save the plan", text: errorText(err) });
      setSaving(false);
    }
  }

  async function remove() {
    setDeleting(true);
    setFailure(null);
    try {
      await onDelete();
    } catch (err) {
      wasConfirming.current = false; // focus goes to the error below, not back to Delete plan
      setConfirming(false);
      setDeleting(false);
      setFailure({ title: "Couldn't delete the plan", text: errorText(err) });
    }
  }

  // Escape closes the form, but never throws away changes: then Cancel is the explicit way out.
  function onKeyDown(event) {
    if (event.key === 'Escape' && !saving && !deleting && !dirty) {
      event.preventDefault();
      onCancel();
    }
  }

  const busy = saving || deleting;

  return (
    <form className="card form" onSubmit={submit} onKeyDown={onKeyDown} noValidate aria-labelledby={ids.heading}>
      <h2 id={ids.heading}>{plan ? `Edit ${plan.name}` : 'Create a backup plan'}</h2>
      <p className="help">Required fields are marked with an asterisk <span className="req" aria-hidden="true">*</span></p>

      <div className="field">
        <label className="label" htmlFor={ids.name}>Plan name<Required /></label>
        <input
          id={ids.name}
          ref={nameRef}
          type="text"
          value={name}
          maxLength={80}
          required
          autoComplete="off"
          placeholder="For example, Nightly assets"
          aria-invalid={Boolean(errors.name) || undefined}
          aria-describedby={describedBy('name')}
          onChange={(e) => setName(e.target.value)}
        />
        <FieldError id={errId('name')} text={errors.name} />
      </div>

      <fieldset className="field" ref={schemasRef} aria-describedby={describedBy('schemas', ids.schemasHelp)}>
        <legend className="label">Schemas to back up<Required /><span className="sr"> (required)</span></legend>
        <p id={ids.schemasHelp} className="help">Only schemas the app account can read are listed. To add one, give the account a role in that schema&apos;s Roles tab.</p>
        {schemas === null && !schemasError && <p className="help">Loading schemas...</p>}
        {schemasError && (
          <Message appearance="warning" title="Couldn't load the schema list" actions={<button type="button" onClick={onRetrySchemas}>Try again</button>}>
            <p>{schemasError}. The schemas already in this plan stay selected.</p>
          </Message>
        )}
        {schemas?.length === 0 && hidden.length === 0 && <p className="help">No readable schemas found. Give the app account a role in a schema, then open this form again.</p>}
        <div className="choices">
          {(schemas ?? []).map((s) => (
            <label key={s.key} className="choice">
              <input type="checkbox" checked={schemaKeys.includes(s.key)} onChange={() => toggle(schemaKeys, setSchemaKeys, s.key)} />
              <span>{s.name} <span className="key">{s.key}</span></span>
            </label>
          ))}
          {hidden.map((k) => (
            <label key={k} className="choice" data-warn={schemas !== null}>
              <input type="checkbox" checked onChange={() => toggle(schemaKeys, setSchemaKeys, k)} />
              <span>{k} {schemas !== null && <span className="key">Can&apos;t be read. Clear to remove it.</span>}</span>
            </label>
          ))}
        </div>
        <FieldError id={errId('schemas')} text={errors.schemas} />
      </fieldset>

      <fieldset className="field">
        <legend className="label">Schedule<Required /><span className="sr"> (required)</span></legend>
        <div className="row">
          <WeekStrip ref={daysRef} days={days} onToggle={(d) => toggle(days, setDays, d)} invalid={Boolean(errors.days)} describedBy={describedBy('days')} />
          <button type="button" className="link" onClick={() => setDays(ALL_DAYS)}>Every day</button>
          <button type="button" className="link" onClick={() => setDays(WEEKDAYS)}>Weekdays</button>
        </div>
        <FieldError id={errId('days')} text={errors.days} />
        <div className="row time">
          <label htmlFor={ids.hour}>Start at</label>
          <select id={ids.hour} value={hour} aria-describedby={ids.hourHelp} onChange={(e) => setHour(Number(e.target.value))}>
            {HOURS.map((h) => <option key={h} value={h}>{formatHour(h)}</option>)}
          </select>
        </div>
        <p id={ids.hourHelp} className="help">
          {TIME_ZONE} time. The backup starts at some point within this hour. When clocks go forward, a plan set to 02:00 skips that night.
        </p>
      </fieldset>

      <div className="field">
        <label className="label" htmlFor={ids.retention}>Keep each backup for<Required /></label>
        <div className="row">
          <input
            id={ids.retention}
            ref={retentionRef}
            type="number"
            inputMode="numeric"
            min={1}
            max={30}
            step={1}
            value={retentionDays}
            required
            aria-invalid={Boolean(errors.retention) || undefined}
            aria-describedby={describedBy('retention', ids.retentionHelp)}
            onChange={(e) => setRetentionDays(e.target.value)}
          />
          <span id={ids.retentionHelp}>days, from 1 to 30</span>
        </div>
        <FieldError id={errId('retention')} text={errors.retention} />
      </div>

      <div className="switch-row">
        <input id={ids.enabled} type="checkbox" role="switch" className="switch" checked={enabled} aria-describedby={ids.enabledHelp} onChange={(e) => setEnabled(e.target.checked)} />
        <div>
          <label className="switch-title" htmlFor={ids.enabled}>Run on schedule</label>
          <p id={ids.enabledHelp} className="help">Turn off to pause the plan. You can still back up manually.</p>
        </div>
      </div>

      {failure && (
        <Message ref={failureRef} appearance="error" title={failure.title}>
          <p>{failure.text}</p>
        </Message>
      )}

      {confirming && (
        <Message
          ref={confirmRef}
          appearance="warning"
          title={`Delete ${plan.name}?`}
          actions={(
            <>
              <button type="button" className="danger" disabled={deleting} onClick={remove}>{deleting ? 'Deleting...' : 'Delete plan and backups'}</button>
              <button type="button" disabled={deleting} onClick={() => setConfirming(false)}>Keep plan</button>
            </>
          )}
        >
          <p>
            {storedCount === 0 ? 'This deletes the plan.' : `This deletes the plan and its ${plural(storedCount, 'stored backup')}.`} You can&apos;t undo this.
            {' '}To stop backups but keep the stored ones, turn off Run on schedule instead.
          </p>
        </Message>
      )}

      {onDelete && running && <p className="help delete-note">You can delete this plan when its running backup finishes.</p>}
      <div className="form-actions">
        {onDelete && !confirming && (
          <button type="button" ref={deleteRef} className="subtle danger-text" disabled={busy || running} onClick={() => setConfirming(true)}>Delete plan</button>
        )}
        <span className="spacer" />
        <button type="button" className="subtle" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={busy}>{saving ? 'Saving...' : 'Save plan'}</button>
      </div>
    </form>
  );
}
