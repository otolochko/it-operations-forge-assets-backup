import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/assetsClient.js', () => ({ getAttributeDefinitions: vi.fn(), iterateObjects: vi.fn() }));
const client = await import('../src/api/assetsClient.js');
const { runExport } = await import('../src/export/runExport.js');

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const defs = load('attributes.json');
const objects = load('aql-page.json').values;

const schema = { id: '4', objectSchemaKey: 'DVC', name: 'Devices' };
const types = [
  { id: '186', name: 'Devices', parentObjectTypeId: '8' },
  { id: '187', name: 'Broken/Type' },
];
const allTypes = [...types, { id: '8', name: 'Parent' }];
const base = { workspaceId: '11111111-2222-4333-8444-555555555555', schemas: [{ schema, types, allTypes }], counts: { 186: 2, 187: 5 }, now: new Date(2026, 9, 12, 9, 5) };
const only = (...list) => [{ schema, types: list, allTypes }];

async function* pages(...list) {
  for (const p of list) yield p;
}

async function unpack(result) {
  const files = unzipSync(result.bytes);
  return Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strFromU8(v)]));
}

beforeEach(() => {
  client.getAttributeDefinitions.mockReset().mockResolvedValue(defs);
  client.iterateObjects.mockReset();
});

describe('runExport', () => {
  it('writes csv, overview, schema, manifest and ndjson with matching counts', async () => {
    client.iterateObjects.mockImplementation(({ typeId }) => {
      if (typeId === '186') return pages(objects);
      throw new Error('Assets said no');
    });
    const result = await runExport(base);
    expect(result.fileName).toBe('assets-DVC-2026-10-12-0905.zip');
    const files = await unpack(result);

    expect(Object.keys(files).sort()).toEqual(['DVC/Devices.csv', 'DVC/data/manifest.json', 'DVC/data/objects-186.ndjson', 'DVC/data/objects-187.ndjson', 'DVC/data/schema.json', 'DVC/overview.csv', 'manifest.json', 'references-missing.csv']);

    const lines = files['DVC/data/objects-186.ndjson'].trim().split('\n').map((l) => JSON.parse(l));
    const manifest = JSON.parse(files['DVC/data/manifest.json']);
    const entry = manifest.types.find((t) => t.id === '186');
    expect(lines).toHaveLength(2);
    expect(entry).toMatchObject({ status: 'complete', exported: 2, totalCount: 2, csvFile: 'Devices.csv' });
    expect(files['DVC/Devices.csv'].trim().split('\r\n')).toHaveLength(1 + 2);
    expect(manifest.formatVersion).toBe(2);
    expect(JSON.parse(files['manifest.json']).schemas).toEqual([{ id: '4', key: 'DVC', name: 'Devices', folder: 'DVC/', status: 'partial' }]);

    const failed = manifest.types.find((t) => t.id === '187');
    expect(failed.status).toBe('failed: Assets said no');
    expect(failed.csvFile).toBeNull();
    expect(files['DVC/overview.csv']).toContain('Broken/Type,,0,5,failed: Assets said no,');
    expect(files['DVC/overview.csv']).toContain('Devices,Parent,2,2,complete,Devices.csv');
  });

  it('describes the schema with slim definitions and the statuses seen', async () => {
    client.iterateObjects.mockImplementation(() => pages(objects));
    const files = await unpack(await runExport({ ...base, schemas: only(types[0]) }));
    const schemaJson = JSON.parse(files['DVC/data/schema.json']);
    expect(schemaJson.schema).toEqual({ id: '4', key: 'DVC', name: 'Devices', description: null });
    expect(schemaJson.objectTypes[0].parentId).toBe('8');
    expect(schemaJson.objectTypes[0].attributes).toHaveLength(11);
    expect(schemaJson.objectTypes[0].attributes[0]).not.toHaveProperty('objectType');
    expect(schemaJson.statuses).toEqual([expect.objectContaining({ id: '18', name: 'In Stock' })]);
  });

  it('lists referenced objects that are not in the export', async () => {
    client.iterateObjects.mockImplementation(() => pages(objects));
    const result = await runExport({ ...base, schemas: only(types[0]) });
    const files = await unpack(result);
    expect(result).toMatchObject({ missingReferences: 3, missingReferencesFile: true });
    const rows = files['references-missing.csv'].trim().split('\r\n');
    expect(rows).toHaveLength(1 + 3);
    expect(rows[0]).toContain('Referenced object ID');
    expect(rows.join('\n')).toContain('Devices / Parent');
  });

  it('writes no missing references file without CSV', async () => {
    client.iterateObjects.mockImplementation(() => pages(objects));
    const result = await runExport({ ...base, schemas: only(types[0]), includeCsv: false });
    expect(result).toMatchObject({ missingReferences: 3, missingReferencesFile: false });
    expect(await unpack(result)).not.toHaveProperty('references-missing.csv');
  });

  it('keeps tokens, avatars and emails out of every file', async () => {
    client.iterateObjects.mockImplementation(() => pages(objects));
    const files = await unpack(await runExport({ ...base, schemas: only(types[0]) }));
    const all = Object.values(files).join('\n');
    for (const secret of ['SECRET-TOKEN', 'mediaJwtToken', 'avatar', 'emailAddress', 'example.com']) expect(all).not.toContain(secret);
  });

  it('can skip the CSV files', async () => {
    client.iterateObjects.mockImplementation(() => pages(objects));
    const files = await unpack(await runExport({ ...base, schemas: only(types[0]), includeCsv: false }));
    expect(Object.keys(files).sort()).toEqual(['DVC/data/manifest.json', 'DVC/data/objects-186.ndjson', 'DVC/data/schema.json', 'manifest.json']);
  });

  it('returns null when cancelled and produces nothing', async () => {
    client.iterateObjects.mockImplementation(() => pages(objects));
    expect(await runExport({ ...base, shouldCancel: () => true })).toBeNull();
  });

  it('throws when every type failed', async () => {
    client.iterateObjects.mockImplementation(() => {
      throw new Error('nope');
    });
    await expect(runExport(base)).rejects.toThrow('Every selected object type failed');
  });

  it('reports progress per page', async () => {
    client.iterateObjects.mockImplementation(() => pages(objects));
    const seen = [];
    await runExport({ ...base, schemas: only(types[0]), onProgress: (p) => seen.push(p) });
    expect(seen.at(-1)).toMatchObject({ typeName: 'Devices', typeFetched: 2, fetched: 2, total: 2 });
  });

  describe('several schemas', () => {
    const schemaB = { id: '5', objectSchemaKey: 'HR', name: 'People' };
    const typeB = { id: '300', name: 'Devices' };
    const two = [{ schema, types: [types[0]], allTypes }, { schema: schemaB, types: [typeB], allTypes: [typeB] }];
    const multi = { ...base, schemas: two, counts: { 186: 2, 300: 2 } };

    it('writes one folder per schema and a root manifest', async () => {
      client.iterateObjects.mockImplementation(() => pages(objects));
      const seen = [];
      const result = await runExport({ ...multi, onProgress: (p) => seen.push(p) });
      expect(result.fileName).toBe('assets-2-schemas-2026-10-12-0905.zip');
      const files = await unpack(result);
      expect(Object.keys(files).sort()).toEqual([
        'DVC/Devices.csv', 'DVC/data/manifest.json', 'DVC/data/objects-186.ndjson', 'DVC/data/schema.json', 'DVC/overview.csv',
        'HR/Devices.csv', 'HR/data/manifest.json', 'HR/data/objects-300.ndjson', 'HR/data/schema.json', 'HR/overview.csv',
        'manifest.json', 'references-missing.csv',
      ]);
      const root = JSON.parse(files['manifest.json']);
      expect(root).toMatchObject({ formatVersion: 2, workspaceId: base.workspaceId, filter: null });
      expect(root.schemas.map((s) => [s.key, s.folder, s.status])).toEqual([['DVC', 'DVC/', 'complete'], ['HR', 'HR/', 'complete']]);
      expect(JSON.parse(files['HR/data/schema.json']).schema.key).toBe('HR');
      expect(seen.at(-1)).toMatchObject({ schemaName: 'People', typeIndex: 1, typeCount: 2, fetched: 4, total: 4 });
    });

    it('marks a failed schema and still downloads the others', async () => {
      client.iterateObjects.mockImplementation(({ typeId }) => {
        if (typeId === '300') throw new Error('nope');
        return pages(objects);
      });
      const result = await runExport(multi);
      const root = JSON.parse((await unpack(result))['manifest.json']);
      expect(root.schemas.map((s) => s.status)).toEqual(['complete', 'failed']);
      expect(result.entries.find((e) => e.id === '300')).toMatchObject({ schemaName: 'People', status: 'failed: nope' });
    });

    it('throws when every type of every schema failed', async () => {
      client.iterateObjects.mockImplementation(() => {
        throw new Error('nope');
      });
      await expect(runExport(multi)).rejects.toThrow('Every selected object type failed');
    });
  });
});
