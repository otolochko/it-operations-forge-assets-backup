import { forecastStored, formatSize, planHealth, plural, storedTotals } from './schedule.js';

// Overview above the plans. Stored now comes from the backup records; the forecast is an estimate,
// not usage reported by Atlassian, and says so on the page.
export default function StorageSummary({ plans, backups }) {
  const { count, bytes } = storedTotals(backups);
  const forecast = forecastStored(plans, backups);
  const paused = plans.filter((p) => !p.enabled).length;
  const attention = plans.filter((p) => ['failed', 'incomplete'].includes(planHealth(p, backups[p.id] ?? []))).length;
  const notes = [paused > 0 && `${paused} paused`, attention > 0 && `${attention} need${attention === 1 ? 's' : ''} attention`].filter(Boolean);

  return (
    <section className="card overview" aria-label="Overview">
      <dl className="facts">
        <div>
          <dt>Plans</dt>
          <dd className="metric">{plans.length}</dd>
          {notes.length > 0 && <dd className="sub">{notes.join(', ')}</dd>}
        </div>
        <div>
          <dt>Stored now</dt>
          <dd className="metric">{formatSize(bytes)}</dd>
          <dd className="sub">{count === 0 ? 'No backups yet' : plural(count, 'backup')}</dd>
        </div>
        <div>
          <dt>Forecast</dt>
          <dd className="metric">{forecast === null ? 'Not yet' : `About ${formatSize(forecast)}`}</dd>
          <dd className="sub">{forecast === null ? 'Available after the first backup' : 'Estimate, not actual usage'}</dd>
        </div>
      </dl>
      <p className="muted note">
        The forecast is an estimate, not actual usage: for each active plan, its average backup size times the number of
        backups it keeps at once. Atlassian reports actual usage and billing separately.
      </p>
    </section>
  );
}
