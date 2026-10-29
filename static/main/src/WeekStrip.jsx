import { DAY_INITIALS, DAY_NAMES } from './schedule.js';

// Seven day cells. Read-only on a plan card (neutral when the plan is paused); with `onToggle` it is the
// day picker of the form, and `invalid` / `describedBy` connect it to the field error.
export default function WeekStrip({ days, onToggle, paused = false, invalid = false, describedBy, ref }) {
  if (!onToggle) {
    return (
      <div className="week" data-paused={paused} aria-hidden="true">
        {DAY_INITIALS.map((initial, i) => (
          <span key={DAY_NAMES[i]} className="day" data-on={days.includes(i + 1)}>{initial}</span>
        ))}
      </div>
    );
  }
  return (
    <div ref={ref} className="week" role="group" aria-label="Days to run on" aria-invalid={invalid || undefined} aria-describedby={describedBy}>
      {DAY_INITIALS.map((initial, i) => (
        <button key={DAY_NAMES[i]} type="button" className="day" aria-pressed={days.includes(i + 1)} aria-label={DAY_NAMES[i]} onClick={() => onToggle(i + 1)}>
          {initial}
        </button>
      ))}
    </div>
  );
}
