import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/assetsClient.js', () => ({
  getWorkspaceId: vi.fn(),
  listSchemas: vi.fn(),
  listObjectTypes: vi.fn(),
  countObjects: vi.fn(),
  getAttributeDefinitions: vi.fn(),
  iterateObjects: vi.fn(),
}));
vi.mock('@forge/object-store', () => ({ objectStore: { createUploadUrl: vi.fn() } }));
const client = await import('../src/api/assetsClient.js');
const { objectStore } = await import('@forge/object-store');
const { runBackup } = await import('../src/backup.js');

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const objects = load('aql-page.json').values;

async function* pages(...list) {
  for (const p of list) yield p;
}

const now = new Date('2026-10-26T03:00:00Z');
const target = { key: 'backups/p1/20261026T030000Z.zip', ttlSeconds: 3 * 86400 };
let uploaded;

beforeEach(() => {
  uploaded = null;
  client.getWorkspaceId.mockReset().mockResolvedValue('11111111-2222-4333-8444-555555555555');
  client.listSchemas.mockReset().mockResolvedValue([
    { id: '4', objectSchemaKey: 'DVC', name: 'Devices' },
    { id: '9', objectSchemaKey: 'OTHER', name: 'Other' },
  ]);
  client.listObjectTypes.mockReset().mockResolvedValue([{ id: '186', name: 'Devices' }]);
  client.countObjects.mockReset().mockResolvedValue(2);
  client.getAttributeDefinitions.mockReset().mockResolvedValue(load('attributes.json'));
  client.iterateObjects.mockReset().mockImplementation(() => pages(objects));
  objectStore.createUploadUrl.mockReset().mockResolvedValue({ url: 'https://store.example/put' });
  vi.stubGlobal('fetch', vi.fn(async (url, init) => {
    uploaded = { url, body: init.body };
    return { ok: true, status: 201 };
  }));
});

describe('runBackup', () => {
  it('backs up only the allowlisted schemas and stores the ZIP with a TTL', async () => {
    const summary = await runBackup({ schemaKeys: ['DVC'], ...target, now });
    expect(summary).toMatchObject({ key: 'backups/p1/20261026T030000Z.zip', schemas: 1, types: 1, failedTypes: 0, objects: 2, missingSchemas: [] });
    expect(client.listObjectTypes).toHaveBeenCalledTimes(1);
    expect(objectStore.createUploadUrl).toHaveBeenCalledWith(expect.objectContaining({
      key: 'backups/p1/20261026T030000Z.zip', length: uploaded.body.length, checksumType: 'SHA256', ttlSeconds: 3 * 86400,
    }));
    const files = Object.fromEntries(Object.entries(unzipSync(uploaded.body)).map(([k, v]) => [k, strFromU8(v)]));
    expect(Object.keys(files)).toContain('DVC/data/objects-186.ndjson');
    expect(Object.keys(files).some((k) => k.startsWith('OTHER/'))).toBe(false);
  });

  it('reports allowlisted schemas the app account cannot see', async () => {
    const summary = await runBackup({ schemaKeys: ['DVC', 'HIDDEN'], ...target, now });
    expect(summary.missingSchemas).toEqual(['HIDDEN']);
    const root = JSON.parse(strFromU8(unzipSync(uploaded.body)['manifest.json']));
    expect(root.missingSchemas).toEqual(['HIDDEN']);
  });

  it('fails when nothing is configured or visible', async () => {
    await expect(runBackup({ schemaKeys: [], ...target, now })).rejects.toThrow('No schemas selected');
    await expect(runBackup({ schemaKeys: ['HIDDEN'], ...target, now })).rejects.toThrow('None of the configured schemas');
    expect(objectStore.createUploadUrl).not.toHaveBeenCalled();
  });

  it('fails when the upload is rejected', async () => {
    fetch.mockResolvedValue({ ok: false, status: 403 });
    await expect(runBackup({ schemaKeys: ['DVC'], now })).rejects.toThrow('HTTP 403');
  });
});
