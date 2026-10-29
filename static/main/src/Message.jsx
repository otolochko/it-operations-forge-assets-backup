// Icon shapes of the Atlassian section message, drawn with design tokens (see .message-icon in styles.css).
const ICONS = {
  error: (
    <>
      <circle className="icon-bg" cx="12" cy="12" r="10" />
      <rect className="icon-fg" x="11" y="6.5" width="2" height="7.5" rx="1" />
      <circle className="icon-fg" cx="12" cy="17" r="1.25" />
    </>
  ),
  warning: (
    <>
      <path className="icon-bg" d="M10.27 3.5a2 2 0 0 1 3.46 0l8.66 15a2 2 0 0 1-1.73 3H3.34a2 2 0 0 1-1.73-3z" />
      <rect className="icon-fg" x="11" y="8" width="2" height="6.5" rx="1" />
      <circle className="icon-fg" cx="12" cy="17.5" r="1.25" />
    </>
  ),
  information: (
    <>
      <circle className="icon-bg" cx="12" cy="12" r="10" />
      <circle className="icon-fg" cx="12" cy="7.5" r="1.25" />
      <rect className="icon-fg" x="11" y="10" width="2" height="7.5" rx="1" />
    </>
  ),
};

// Atlassian-style section message. Errors are announced (role="alert"); `tabIndex={-1}` lets callers move focus to it via `ref`.
export default function Message({ appearance = 'information', title, children, actions, ref }) {
  return (
    <section ref={ref} tabIndex={-1} className="message" data-appearance={appearance} role={appearance === 'error' ? 'alert' : undefined}>
      <svg className="message-icon" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
        {ICONS[appearance]}
      </svg>
      <div className="message-body">
        {title && <p className="message-title">{title}</p>}
        {children}
        {actions && <div className="message-actions">{actions}</div>}
      </div>
    </section>
  );
}
