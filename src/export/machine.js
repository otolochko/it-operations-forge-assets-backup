import { EXPORT_FORMAT_VERSION } from '../appInfo.js';

const DEFINITION_FIELDS = [
  'id', 'name', 'label', 'type', 'defaultType', 'position', 'description', 'editable', 'hidden', 'system',
  'minimumCardinality', 'maximumCardinality', 'uniqueAttribute', 'indexed', 'options', 'regexValidation',
  'suffix', 'qlQuery', 'includeChildObjectTypes', 'referenceObjectTypeId', 'typeValueMulti',
];

// Attribute definition without the nested objectType block and workspace/global ids.
export function slimDefinition(def) {
  const out = {};
  for (const field of DEFINITION_FIELDS) if (def[field] !== undefined) out[field] = def[field];
  if (def.referenceType) out.referenceType = { id: def.referenceType.id, name: def.referenceType.name };
  return out;
}

export function ndjsonLine(record) {
  return `${JSON.stringify(record)}\n`;
}

export function buildSchemaJson({ schema, types, definitions, statuses }) {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    schema: { id: String(schema.id), key: schema.objectSchemaKey, name: schema.name, description: schema.description ?? null },
    objectTypes: types.map((t) => ({
      id: String(t.id),
      name: t.name,
      parentId: t.parentObjectTypeId ? String(t.parentObjectTypeId) : null,
      description: t.description ?? null,
      attributes: (definitions.get(String(t.id)) ?? []).map(slimDefinition),
    })),
    statuses: [...statuses.values()],
  };
}

// Top-level manifest.json: one entry per schema folder.
export function buildRootManifest({ app, workspaceId, exportedAt, userAql, schemas, missingSchemas = [] }) {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt,
    app,
    workspaceId,
    filter: userAql || null,
    schemas,
    missingSchemas,
  };
}

export function buildManifest({ app, workspaceId, schema, exportedAt, userAql, types }) {
  return {
    formatVersion: EXPORT_FORMAT_VERSION,
    exportedAt,
    app,
    workspaceId,
    schema: { id: String(schema.id), key: schema.objectSchemaKey, name: schema.name },
    filter: userAql || null,
    types,
  };
}
