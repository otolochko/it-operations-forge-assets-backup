import { jiraJson } from './requestQueue.js';
import { assertNumericId, assertUserAql, assertWorkspaceId } from './validate.js';

export const PAGE_SIZE = 500; // keep below 1000, see the isLast bug in docs/spike-results.md

const base = (workspaceId) => `/jsm/assets/workspace/${assertWorkspaceId(workspaceId)}/v1`;

function post(body) {
  return { method: 'POST', body: JSON.stringify(body) };
}

export function buildQuery(typeId, userAql) {
  const tid = assertNumericId(typeId, 'object type id');
  const extra = assertUserAql(userAql);
  return extra ? `objectTypeId = ${tid} AND (${extra})` : `objectTypeId = ${tid}`;
}

export async function getWorkspaceId(onRetry) {
  const res = await jiraJson('/rest/servicedeskapi/assets/workspace', {}, onRetry);
  return res?.values?.[0]?.workspaceId ?? null;
}

export async function listSchemas(workspaceId, onRetry) {
  const out = [];
  for (;;) {
    const res = await jiraJson(`${base(workspaceId)}/objectschema/list?startAt=${out.length}`, {}, onRetry);
    const values = res?.values ?? [];
    out.push(...values);
    if (res?.isLast !== false || values.length === 0) return out;
  }
}

export async function listObjectTypes(workspaceId, schemaId, onRetry) {
  const sid = assertNumericId(schemaId, 'schema id');
  const res = await jiraJson(`${base(workspaceId)}/objectschema/${sid}/objecttypes/flat`, {}, onRetry);
  return Array.isArray(res) ? res : (res?.values ?? []);
}

export async function getAttributeDefinitions(workspaceId, typeId, onRetry) {
  const tid = assertNumericId(typeId, 'object type id');
  const res = await jiraJson(`${base(workspaceId)}/objecttype/${tid}/attributes`, {}, onRetry);
  return Array.isArray(res) ? res : (res?.values ?? []);
}

// The only reliable size source: "total" in AQL pages is capped at 1000, flat objectCount is 0.
export async function countObjects(workspaceId, typeId, userAql, onRetry) {
  const qlQuery = buildQuery(typeId, userAql);
  const res = await jiraJson(`${base(workspaceId)}/object/aql/totalcount`, post({ qlQuery }), onRetry);
  return Number(res?.totalCount ?? 0);
}

// Yields one page of raw objects at a time. Never reads "total" or "hasMoreResults".
export async function* iterateObjects({ workspaceId, typeId, userAql, expectedTotal, shouldCancel = () => false, onRetry }) {
  const qlQuery = buildQuery(typeId, userAql);
  const url = base(workspaceId);
  const seen = new Set();
  let startAt = 0;

  for (;;) {
    if (shouldCancel()) return;
    const page = await jiraJson(
      `${url}/object/aql?startAt=${startAt}&maxResults=${PAGE_SIZE}&includeAttributes=true`,
      post({ qlQuery }),
      onRetry,
    );
    const values = page?.values ?? [];
    for (const obj of values) {
      if (seen.has(obj.id)) throw new Error('Pagination returned duplicate objects, export stopped');
      seen.add(obj.id);
    }
    if (values.length > 0) yield values;
    if (page?.isLast === true || values.length === 0) return;
    if (expectedTotal != null && seen.size >= expectedTotal) return;
    startAt += values.length;
  }
}
