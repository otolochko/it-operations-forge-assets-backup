export const TIME_ZONE = 'Europe/Copenhagen';
export const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const HOUR_MS = 3600000;
const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

// Formatters are built once: creating one per call made nextRun cost about 170 ms per render with 20 plans.
const hourFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hourCycle: 'h23', hour: '2-digit', weekday: 'short' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short' });
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const stampFormat = new Intl.DateTimeFormat('en-GB', { timeZone: TIME_ZONE, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const partsOf = (format, date) => Object.fromEntries(format.formatToParts(date).map((p) => [p.type, p.value]));

export const formatHour = (hour) => `${String(hour).padStart(2, '0')}:00`;

const sameDays = (days, expected) => days.length === expected.length && expected.every((d) => days.includes(d));

// "Every day", "Weekdays", "Weekends" or "Mon, Wed, Fri".
export function describeDays(days) {
  if (days.length === 7) return 'Every day';
  if (sameDays(days, [1, 2, 3, 4, 5])) return 'Weekdays';
  if (sameDays(days, [6, 7])) return 'Weekends';
  return [...days].sort((a, b) => a - b).map((d) => DAY_NAMES[d - 1]).join(', ');
}

export const describeSchedule = (days, hour) => `${describeDays(days)} at ${formatHour(hour)}`;

function localParts(date) {
  const parts = partsOf(hourFormat, date);
  return { weekday: WEEKDAYS[parts.weekday], hour: Number(parts.hour) };
}

// The first local hour after `now` that matches the plan, or null for a paused plan.
// Copenhagen offsets are whole hours, so UTC hour boundaries are local hour boundaries.
export function nextRun(plan, now = new Date()) {
  if (!plan.enabled) return null;
  const start = Math.floor(now.getTime() / HOUR_MS) * HOUR_MS;
  for (let i = 1; i <= 24 * 8; i++) {
    const candidate = new Date(start + i * HOUR_MS);
    const { weekday, hour } = localParts(candidate);
    if (plan.days.includes(weekday) && plan.hour === hour) return candidate;
  }
  return null;
}

// "Tue 27 Oct, between 02:00 and 03:00": the backup starts somewhere within that hour.
export function formatNextRun(date, hour) {
  return `${dayFormat.format(date)}, between ${formatHour(hour)} and ${formatHour((hour + 1) % 24)}`;
}

export const formatDateTime = (iso) => (iso ? dateTimeFormat.format(new Date(iso)) : '');

export function formatDuration(startedAt, finishedAt) {
  if (!startedAt || !finishedAt) return '';
  const seconds = Math.max(1, Math.round((new Date(finishedAt) - new Date(startedAt)) / 1000));
  return seconds < 60 ? `${seconds} s` : `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function formatSize(bytes) {
  if (bytes == null) return '';
  if (bytes === 0) return '0 KB';
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// Actual storage: backups that finished OK and are still kept.
export function storedTotals(backupsByPlan) {
  const ok = Object.values(backupsByPlan).flat().filter((b) => b.status === 'ok');
  return { count: ok.length, bytes: ok.reduce((sum, b) => sum + (b.size ?? 0), 0) };
}

// Forecast of the peak storage: per active plan, its average backup size times the backups it keeps at once.
// Returns null until a plan has a finished backup to take the average from.
export function forecastStored(plans, backupsByPlan) {
  let bytes = 0;
  let counted = false;
  for (const plan of plans.filter((p) => p.enabled)) {
    const sizes = (backupsByPlan[plan.id] ?? []).filter((b) => b.status === 'ok' && b.size != null).map((b) => b.size);
    if (sizes.length === 0) continue;
    const average = sizes.reduce((a, b) => a + b, 0) / sizes.length;
    bytes += average * Math.max(1, Math.ceil((plan.retentionDays * plan.days.length) / 7));
    counted = true;
  }
  return counted ? bytes : null;
}

// What a plan card flags next to the plan name: 'paused', 'failed', 'incomplete', 'healthy' or 'new' (never ran).
export function planHealth(plan, backups) {
  if (!plan.enabled) return 'paused';
  const last = backups.find((b) => b.status !== 'running');
  if (!last) return 'new';
  if (last.status === 'failed') return 'failed';
  if (last.missingSchemas?.length > 0 || last.failedTypes > 0) return 'incomplete';
  return 'healthy';
}

const RUN_WORDS = { ok: 'completed', failed: 'failed', running: 'running' };

// The newest `slots` runs, oldest first, and a text summary such as "12 completed, 2 failed".
export function historySummary(backups, slots = 14) {
  const recent = backups.slice(0, slots).reverse();
  const parts = ['ok', 'failed', 'running']
    .map((status) => [status, recent.filter((b) => b.status === status).length])
    .filter(([, n]) => n > 0)
    .map(([status, n]) => `${n} ${RUN_WORDS[status]}`);
  return { recent, text: parts.length === 0 ? 'No runs yet' : parts.join(', ') };
}

// "assets-backup-nightly-services-2026-10-26-1824.zip", with the start time in Copenhagen time.
export function backupFileName(planName, startedAt) {
  const slug = String(planName).toLowerCase().replace(/æ/g, 'ae').replace(/ø/g, 'oe').normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'plan';
  const p = partsOf(stampFormat, new Date(startedAt));
  return `assets-backup-${slug}-${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}.zip`;
}

// Field errors of the plan form, keyed by field. An empty object means the plan can be saved.
export function validatePlanForm({ name, schemaKeys, days, retentionDays }) {
  const errors = {};
  if (!String(name ?? '').trim()) errors.name = 'Enter a plan name.';
  if (schemaKeys.length === 0) errors.schemas = 'Choose at least one schema.';
  if (days.length === 0) errors.days = 'Choose at least one day.';
  const retention = Number(retentionDays);
  if (!Number.isInteger(retention) || retention < 1 || retention > 30) errors.retention = 'Enter a whole number of days from 1 to 30.';
  return errors;
}

export const plural = (n, one, many = `${one}s`) => `${n.toLocaleString('en')} ${n === 1 ? one : many}`;

export function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
