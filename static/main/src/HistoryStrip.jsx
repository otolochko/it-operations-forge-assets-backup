import { formatDateTime, historySummary } from './schedule.js';

const SLOTS = 14;
const WORDS = { ok: 'Completed', failed: 'Failed', running: 'Running' };

// The last 14 runs as ticks, oldest on the left. Visual only: the summary text next to it and the history
// table carry the same facts, and a failed run is a taller tick, so the strip does not rely on color alone.
// The tick tooltips are a mouse-only extra.
export default function HistoryStrip({ backups }) {
  const { recent, text } = historySummary(backups, SLOTS);
  return (
    <span className="history-strip">
      <span className="history" aria-hidden="true">
        {Array.from({ length: SLOTS - recent.length }, (_, i) => <span key={`empty-${i}`} className="tick" data-status="none" />)}
        {recent.map((b) => <span key={b.key} className="tick" data-status={b.status} title={`${formatDateTime(b.startedAt)}: ${WORDS[b.status] ?? b.status}`} />)}
      </span>
      <span className="history-text">{text}</span>
    </span>
  );
}
