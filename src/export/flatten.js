// Attribute type ids used by Assets (see docs/spike-results.md).
export const TYPE_REFERENCE = 1;
const TYPE_USER = 2;
const TYPE_STATUS = 7;

const SYSTEM_COLUMNS = new Set(['Key', 'Created', 'Updated']);
export const FIXED_HEADERS = ['Object ID', 'Object key', 'Label', 'Created', 'Updated'];

const isEmpty = (v) => v == null || v === '' || (typeof v === 'object' && Object.keys(v).length === 0);

function compact(obj) {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}

// Fallback for attribute types without a verified shape: keep only the three safe text fields.
function fallback(raw) {
  return compact({ displayValue: raw.displayValue, value: raw.value, searchValue: raw.searchValue });
}

// One raw objectAttributeValue to its lossless entry. Never copies avatars, tokens or emails.
export function normalizeValue(def, raw, sink) {
  switch (def?.type) {
    case 0:
      return String(raw.value ?? raw.displayValue ?? '');
    case TYPE_REFERENCE: {
      const o = raw.referencedObject;
      return o ? compact({ id: String(o.id), key: o.objectKey, label: o.label }) : fallback(raw);
    }
    case TYPE_USER: {
      const u = raw.user;
      return u ? compact({ accountId: u.key, displayName: u.displayName }) : fallback(raw);
    }
    case TYPE_STATUS: {
      const s = raw.status;
      if (!s) return fallback(raw);
      sink?.statuses?.set(String(s.id), compact({
        id: String(s.id),
        name: s.name,
        description: s.description,
        category: s.category,
        objectSchemaId: s.objectSchemaId,
      }));
      return { id: String(s.id), name: s.name };
    }
    default:
      return fallback(raw);
  }
}

// Raw AQL object to the lossless record written to data/objects-{typeId}.ndjson.
export function toRecord(obj, defsById, sink) {
  const attributes = {};
  for (const attr of obj.attributes ?? []) {
    const id = String(attr.objectTypeAttributeId);
    const def = defsById.get(id);
    const entries = (attr.objectAttributeValues ?? []).map((v) => normalizeValue(def, v, sink)).filter((e) => !isEmpty(e));
    if (entries.length > 0) attributes[id] = entries;
  }
  return {
    id: String(obj.id),
    key: obj.objectKey,
    label: obj.label,
    created: obj.created,
    updated: obj.updated,
    typeId: String(obj.objectType?.id),
    attributes,
  };
}

// CSV columns in Assets order. Key, Created, Updated and the label attribute are the fixed columns.
export function buildCsvColumns(defs) {
  const columns = [];
  for (const def of defs) {
    if ((def.system && SYSTEM_COLUMNS.has(def.name)) || def.label) continue;
    if (def.type === TYPE_REFERENCE) {
      columns.push({ header: def.name, def, part: 'label' }, { header: `${def.name} key`, def, part: 'key' });
    } else {
      columns.push({ header: def.name, def, part: 'main' });
    }
  }
  return columns;
}

function entryText(def, entry, part) {
  if (typeof entry === 'string') return entry;
  switch (def.type) {
    case TYPE_REFERENCE:
      return (part === 'key' ? entry.key : entry.label) ?? '';
    case TYPE_USER:
      return entry.displayName ?? '';
    case TYPE_STATUS:
      return entry.name ?? '';
    default:
      return entry.displayValue ?? entry.value ?? '';
  }
}

export function csvHeaders(columns) {
  return [...FIXED_HEADERS, ...columns.map((c) => c.header)];
}

export function csvCells(record, columns) {
  return [
    record.id,
    record.key,
    record.label,
    record.created,
    record.updated,
    ...columns.map((c) => (record.attributes[String(c.def.id)] ?? []).map((e) => entryText(c.def, e, c.part)).join('; ')),
  ];
}
