import { createHash } from 'node:crypto';
import { objectStore } from '@forge/object-store';
import { countObjects, getWorkspaceId, listObjectTypes, listSchemas } from './api/assetsClient.js';
import { runExport } from './export/runExport.js';

async function upload(key, bytes, ttlSeconds) {
  const checksum = createHash('sha256').update(bytes).digest('base64');
  const target = await objectStore.createUploadUrl({
    key, length: bytes.length, checksum, checksumType: 'SHA256', ttlSeconds,
  });
  if (!target) throw new Error('Object Store returned no upload URL');
  const res = await fetch(target.url, { method: 'PUT', body: bytes });
  if (!res.ok) throw new Error(`Upload failed with HTTP ${res.status}`);
}

// Backs up the schemas listed in `schemaKeys` (objectSchemaKey values) into one ZIP stored under `key` for `ttlSeconds`.
// Schemas that the app account cannot see are listed in `missingSchemas`, never silently skipped.
export async function runBackup({ schemaKeys, key, ttlSeconds, now = new Date() }) {
  if (schemaKeys.length === 0) throw new Error('No schemas selected for backup');
  const started = Date.now();

  const workspaceId = await getWorkspaceId();
  if (!workspaceId) throw new Error('No Assets workspace found');

  const visible = await listSchemas(workspaceId);
  const found = visible.filter((s) => schemaKeys.includes(s.objectSchemaKey));
  const missingSchemas = schemaKeys.filter((k) => !found.some((s) => s.objectSchemaKey === k));
  if (found.length === 0) throw new Error('None of the configured schemas is visible to the app account');

  const counts = {};
  const schemas = [];
  for (const schema of found) {
    const types = await listObjectTypes(workspaceId, schema.id);
    for (const type of types) counts[String(type.id)] = await countObjects(workspaceId, type.id);
    schemas.push({ schema, types, allTypes: types });
  }

  const result = await runExport({ workspaceId, schemas, counts, missingSchemas, includeCsv: true, now });
  await upload(key, result.bytes, ttlSeconds);

  return {
    key,
    bytes: result.bytes.length,
    schemas: found.length,
    types: result.entries.length,
    failedTypes: result.entries.filter((e) => e.status !== 'complete').length,
    objects: result.exportedObjects,
    missingSchemas,
    ms: Date.now() - started,
  };
}
