import { getAttributeDefinitions, iterateObjects } from '../api/assetsClient.js';
import { APP_NAME, APP_VERSION } from '../appInfo.js';
import { CSV_BOM, csvRow } from './csv.js';
import { buildCsvColumns, csvCells, csvHeaders, toRecord } from './flatten.js';
import { createNameAllocator, exportBaseName } from './filenames.js';
import { buildManifest, buildRootManifest, buildSchemaJson, ndjsonLine } from './machine.js';
import { MISSING_HEADERS, createReferenceTracker, missingRows } from './references.js';
import { createZipWriter } from './zip.js';

export const WARN_OBJECTS = 50000;
export const MAX_OBJECTS = 100000;

const OVERVIEW_HEADERS = ['Object type', 'Parent type', 'Exported objects', 'Total count', 'Status', 'File name'];

function schemaStatus(entries) {
  if (entries.every((e) => e.status === 'complete')) return 'complete';
  return entries.every((e) => e.status !== 'complete') ? 'failed' : 'partial';
}

// Exports the selected object types of one or more schemas into one ZIP (bytes), one folder per schema.
// `schemas` is [{ schema, types, allTypes }]. Returns null when cancelled.
// Throws when every selected type of every schema failed.
export async function runExport({
  workspaceId,
  schemas,
  userAql = '',
  missingSchemas = [],
  includeCsv = true,
  counts = {},
  shouldCancel = () => false,
  onProgress = () => {},
  onRetry,
  now = new Date(),
}) {
  const writer = createZipWriter();
  const exportedAt = now.toISOString();
  const folderName = createNameAllocator();
  const references = createReferenceTracker();
  const typeCount = schemas.reduce((sum, s) => sum + s.types.length, 0);
  const overallTotal = schemas.reduce((sum, s) => sum + s.types.reduce((n, t) => n + (counts[t.id] ?? 0), 0), 0);
  let overallFetched = 0;
  let typeIndex = 0;

  // Writes one schema package under `folder`. Resolves to its entries, or null when cancelled.
  async function exportSchema({ schema, types, allTypes = types }, folder) {
    const csvName = createNameAllocator();
    const statuses = new Map();
    const definitions = new Map();
    const entries = [];
    const typeNames = new Map(allTypes.map((t) => [String(t.id), t.name]));

    for (const type of types) {
      if (shouldCancel()) return null;
      const id = String(type.id);
      const entry = {
        id,
        name: type.name,
        parentId: type.parentObjectTypeId ? String(type.parentObjectTypeId) : null,
        status: 'complete',
        exported: 0,
        totalCount: counts[id] ?? null,
        dataFile: `data/objects-${id}.ndjson`,
        csvFile: null,
      };
      entries.push(entry);
      const index = typeIndex++;
      const progress = () => onProgress({
        schemaName: schema.name, typeName: type.name, typeIndex: index, typeCount,
        typeFetched: entry.exported, typeTotal: entry.totalCount, fetched: overallFetched, total: overallTotal,
      });
      progress();

      let file = null;
      try {
        const defs = await getAttributeDefinitions(workspaceId, id, onRetry);
        definitions.set(id, defs);
        const defsById = new Map(defs.map((d) => [String(d.id), d]));
        const columns = buildCsvColumns(defs);
        const csvParts = includeCsv ? [CSV_BOM + csvRow(csvHeaders(columns))] : null;
        file = writer.openFile(`${folder}${entry.dataFile}`);

        for await (const page of iterateObjects({ workspaceId, typeId: id, userAql, expectedTotal: entry.totalCount, shouldCancel, onRetry })) {
          const lines = [];
          const rows = [];
          for (const obj of page) {
            const record = toRecord(obj, defsById, { statuses });
            lines.push(ndjsonLine(record));
            references.add(record, defsById, type.name);
            if (csvParts) rows.push(csvRow(csvCells(record, columns)));
          }
          file.write(lines.join(''));
          csvParts?.push(rows.join(''));
          entry.exported += page.length;
          overallFetched += page.length;
          progress();
        }
        if (shouldCancel()) return null;
        file.end();
        if (csvParts) {
          entry.csvFile = csvName(type.name, '.csv');
          writer.addText(`${folder}${entry.csvFile}`, csvParts.join(''));
        }
      } catch (err) {
        entry.status = `failed: ${err?.message ?? err}`;
        file?.end();
      }
    }

    if (includeCsv) {
      const rows = entries.map((e) => [e.name, typeNames.get(e.parentId) ?? '', e.exported, e.totalCount ?? '', e.status, e.csvFile ?? '']);
      writer.addText(`${folder}overview.csv`, CSV_BOM + csvRow(OVERVIEW_HEADERS) + rows.map(csvRow).join(''));
    }
    const schemaTypes = types.filter((t) => definitions.has(String(t.id)));
    writer.addText(`${folder}data/schema.json`, JSON.stringify(buildSchemaJson({ schema, types: schemaTypes, definitions, statuses }), null, 2));
    const manifest = buildManifest({
      app: { name: APP_NAME, version: APP_VERSION }, workspaceId, schema, exportedAt, userAql, types: entries,
    });
    writer.addText(`${folder}data/manifest.json`, JSON.stringify(manifest, null, 2));
    return entries;
  }

  const rootSchemas = [];
  const allEntries = [];

  for (const item of schemas) {
    const folder = `${folderName(item.schema.objectSchemaKey, '')}/`;
    const entries = await exportSchema(item, folder);
    if (!entries) {
      writer.abort();
      return null;
    }
    rootSchemas.push({
      id: String(item.schema.id), key: item.schema.objectSchemaKey, name: item.schema.name, folder, status: schemaStatus(entries),
    });
    allEntries.push(...entries.map((e) => ({ ...e, schemaName: item.schema.name })));
  }

  if (allEntries.every((e) => e.status !== 'complete')) {
    writer.abort();
    const error = new Error('Every selected object type failed to export');
    error.entries = allEntries;
    throw error;
  }

  const missing = references.missing();
  const missingReferencesFile = includeCsv && missing.length > 0;
  if (missingReferencesFile) {
    writer.addText('references-missing.csv', CSV_BOM + csvRow(MISSING_HEADERS) + missingRows(missing).map(csvRow).join(''));
  }

  writer.addText('manifest.json', JSON.stringify(buildRootManifest({
    app: { name: APP_NAME, version: APP_VERSION }, workspaceId, exportedAt, userAql, schemas: rootSchemas, missingSchemas,
  }), null, 2));

  return {
    bytes: await writer.finish(),
    fileName: `${exportBaseName(schemas.map((s) => s.schema.objectSchemaKey), now)}.zip`,
    entries: allEntries,
    exportedObjects: allEntries.reduce((sum, e) => sum + e.exported, 0),
    missingReferences: missing.length,
    missingReferencesFile,
  };
}
