const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DIGITS = /^\d+$/;

export function assertWorkspaceId(id) {
  if (!UUID.test(String(id))) throw new Error('Invalid workspace id');
  return String(id);
}

export function assertNumericId(id, label) {
  if (!DIGITS.test(String(id))) throw new Error(`Invalid ${label}`);
  return String(id);
}

export function assertUserAql(aql) {
  const s = String(aql ?? '').trim();
  if (s.length > 1000 || /[\r\n]/.test(s)) throw new Error('AQL filter is too long or contains line breaks');
  return s;
}

export function assertDate(date) {
  const s = String(date ?? '').trim();
  if (s && !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new Error('Invalid date');
  return s;
}

// Joins the optional "changed since" date and the user condition into one AQL condition.
export function combineFilter(date, aql) {
  const since = assertDate(date);
  const extra = assertUserAql(aql);
  if (!since) return extra;
  return assertUserAql(extra ? `Updated >= "${since}" AND (${extra})` : `Updated >= "${since}"`);
}
