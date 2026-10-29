import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildCsvColumns, csvCells, csvHeaders, normalizeValue, toRecord } from '../src/export/flatten.js';
import { csvRow } from '../src/export/csv.js';

const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
const defs = load('attributes.json');
const page = load('aql-page.json');
const defsById = new Map(defs.map((d) => [String(d.id), d]));
const byName = Object.fromEntries(defs.map((d) => [d.name, d]));

function record(i) {
  const sink = { statuses: new Map() };
  return { rec: toRecord(page.values[i], defsById, sink), sink };
}

describe('normalizeValue', () => {
  it('uses value for dates, not the locale displayValue', () => {
    const raw = { displayValue: '10/Jun/25', value: '2025-06-10' };
    expect(normalizeValue(byName.Due, raw)).toBe('2025-06-10');
  });

  it('reads a status from status.name and collects it', () => {
    const sink = { statuses: new Map() };
    const raw = { displayValue: 'In Stock', status: { id: 18, name: 'In Stock', category: 1, objectSchemaId: '4' } };
    expect(normalizeValue(byName.Status, raw, sink)).toEqual({ id: '18', name: 'In Stock' });
    expect(sink.statuses.get('18')).toMatchObject({ name: 'In Stock', category: 1 });
  });

  it('keeps accountId and display name for users, never the email', () => {
    const raw = { user: { key: 'acc1', displayName: 'Jane', emailAddress: 'j@example.com' } };
    expect(normalizeValue(byName.Owner, raw)).toEqual({ accountId: 'acc1', displayName: 'Jane' });
  });

  it('keeps id, key and label for references', () => {
    const raw = { referencedObject: { id: 77, objectKey: 'HR-77', label: 'X', avatar: { mediaClientConfig: {} } } };
    expect(normalizeValue(byName.Parent, raw)).toEqual({ id: '77', key: 'HR-77', label: 'X' });
  });

  it('falls back to the three text fields for unknown shapes', () => {
    expect(normalizeValue(undefined, { displayValue: 'a', value: 'b', searchValue: 'c', other: 1 })).toEqual({ displayValue: 'a', value: 'b', searchValue: 'c' });
  });
});

describe('toRecord', () => {
  it('keys attributes by id and keeps multi-values as arrays', () => {
    const { rec } = record(0);
    expect(rec).toMatchObject({ id: '1', key: 'DVC-1', typeId: '186' });
    expect(rec.attributes['8']).toEqual(['red', 'blue']);
    expect(rec.attributes['6']).toHaveLength(2);
    expect(rec.attributes['11']).toEqual([{ id: '78', key: 'HR-78', label: 'A' }, { id: '79', key: 'HR-79', label: 'B' }]);
  });

  it('never leaks tokens, avatars or emails', () => {
    const text = JSON.stringify([record(0).rec, record(1).rec]);
    for (const secret of ['SECRET-TOKEN', 'mediaJwtToken', 'avatar', 'emailAddress', 'example.com']) expect(text).not.toContain(secret);
  });

  it('keeps unknown attributes through the fallback', () => {
    expect(record(1).rec.attributes['99']).toEqual([{ displayValue: 'unknown attr', searchValue: 'u' }]);
  });
});

describe('CSV columns and cells', () => {
  const columns = buildCsvColumns(defs);

  it('skips Key, Created, Updated and the label attribute', () => {
    expect(csvHeaders(columns)).toEqual([
      'Object ID', 'Object key', 'Label', 'Created', 'Updated',
      'Status', 'Owner', 'Parent', 'Parent key', 'Tags', 'Due', 'Notes', 'Peers', 'Peers key',
    ]);
  });

  it('writes label and key columns for references and joins multi-values', () => {
    const cells = csvCells(record(0).rec, columns);
    expect(cells.slice(5)).toEqual([
      'In Stock', 'Jane Doe; Bob', 'Floor, 3', 'HR-77', 'red; blue', '2025-06-10', 'line one\nline "two"', 'A; B', 'HR-78; HR-79',
    ]);
  });

  it('protects formulas and quotes embedded commas and line breaks', () => {
    const line = csvRow(csvCells(record(0).rec, columns));
    expect(line).toContain("'=cmd|' /C calc'!A0");
    expect(line).toContain('"Floor, 3"');
    expect(line).toContain('"line one\nline ""two"""');
    expect(line.endsWith('\r\n')).toBe(true);
  });

  it('leaves empty attributes empty', () => {
    expect(csvCells(record(1).rec, columns).slice(5).every((c) => c === '')).toBe(true);
  });
});
