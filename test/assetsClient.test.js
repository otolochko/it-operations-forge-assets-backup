import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api/requestQueue.js', () => ({ jiraJson: vi.fn() }));
const { jiraJson } = await import('../src/api/requestQueue.js');
const { buildQuery, countObjects, iterateObjects, listSchemas } = await import('../src/api/assetsClient.js');

const WID = '11111111-2222-4333-8444-555555555555';
const objects = (from, n) => Array.from({ length: n }, (_, i) => ({ id: String(from + i) }));

async function collect(gen) {
  const pages = [];
  for await (const p of gen) pages.push(p);
  return pages;
}

beforeEach(() => jiraJson.mockReset());

describe('iterateObjects', () => {
  const args = { workspaceId: WID, typeId: '183' };

  it('stops on isLast and sends startAt and maxResults in the query string', async () => {
    jiraJson.mockResolvedValueOnce({ values: objects(1, 500), isLast: false }).mockResolvedValueOnce({ values: objects(501, 20), isLast: true });
    const pages = await collect(iterateObjects(args));
    expect(pages.map((p) => p.length)).toEqual([500, 20]);
    expect(jiraJson.mock.calls[0][0]).toContain('startAt=0&maxResults=500&includeAttributes=true');
    expect(jiraJson.mock.calls[1][0]).toContain('startAt=500&maxResults=500');
    expect(JSON.parse(jiraJson.mock.calls[0][1].body)).toEqual({ qlQuery: 'objectTypeId = 183' });
    expect(jiraJson.mock.calls[0][0]).not.toContain('includeAttributesDeep');
  });

  it('advances by the real page length and ignores a short page without isLast', async () => {
    jiraJson.mockResolvedValueOnce({ values: objects(1, 300), isLast: false }).mockResolvedValueOnce({ values: [], isLast: true });
    await collect(iterateObjects(args));
    expect(jiraJson.mock.calls[1][0]).toContain('startAt=300');
  });

  it('stops on an empty page even when isLast is wrong', async () => {
    jiraJson.mockResolvedValueOnce({ values: [], isLast: false });
    expect(await collect(iterateObjects(args))).toEqual([]);
  });

  it('stops when the fetched count reaches the expected total', async () => {
    jiraJson.mockResolvedValueOnce({ values: objects(1, 10), isLast: false });
    await collect(iterateObjects({ ...args, expectedTotal: 10 }));
    expect(jiraJson).toHaveBeenCalledTimes(1);
  });

  it('throws on repeated object ids', async () => {
    jiraJson.mockResolvedValueOnce({ values: objects(1, 3), isLast: false }).mockResolvedValueOnce({ values: objects(2, 3), isLast: false });
    await expect(collect(iterateObjects(args))).rejects.toThrow('duplicate');
  });

  it('stops before the first request when cancelled', async () => {
    expect(await collect(iterateObjects({ ...args, shouldCancel: () => true }))).toEqual([]);
    expect(jiraJson).not.toHaveBeenCalled();
  });

  it('rejects invalid ids and bad AQL before any request', async () => {
    await expect(collect(iterateObjects({ ...args, typeId: '1 OR 1=1' }))).rejects.toThrow('Invalid');
    await expect(collect(iterateObjects({ ...args, userAql: 'a\nb' }))).rejects.toThrow('AQL');
    expect(jiraJson).not.toHaveBeenCalled();
  });
});

describe('buildQuery', () => {
  it('wraps the user filter in parentheses', () => {
    expect(buildQuery('5', 'Status = "In use"')).toBe('objectTypeId = 5 AND (Status = "In use")');
    expect(buildQuery('5', '')).toBe('objectTypeId = 5');
  });
});

describe('countObjects', () => {
  it('reads totalCount from the totalcount endpoint', async () => {
    jiraJson.mockResolvedValueOnce({ totalCount: 2372 });
    await expect(countObjects(WID, '183')).resolves.toBe(2372);
    expect(jiraJson.mock.calls[0][0]).toMatch(/object\/aql\/totalcount$/);
  });
});

describe('listSchemas', () => {
  it('pages only while isLast is false', async () => {
    jiraJson.mockResolvedValueOnce({ values: [{ id: '1' }], isLast: false }).mockResolvedValueOnce({ values: [{ id: '2' }], isLast: true });
    expect((await listSchemas(WID)).map((s) => s.id)).toEqual(['1', '2']);
  });
});
