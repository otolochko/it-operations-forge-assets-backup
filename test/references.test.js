import { describe, expect, it } from 'vitest';
import { createReferenceTracker, missingRows } from '../src/export/references.js';

const defs = new Map([
  ['7', { id: 7, name: 'Parent', type: 1 }],
  ['8', { id: 8, name: 'Tags', type: 0 }],
]);
const record = (id, attributes = {}) => ({ id, attributes });
const ref = (id, key) => ({ id, key, label: `Label ${key}` });

describe('createReferenceTracker', () => {
  it('reports references to objects that were not exported', () => {
    const t = createReferenceTracker();
    t.add(record('1', { 7: [ref('99', 'X-99')], 8: ['tag'] }), defs, 'Devices');
    t.add(record('2', { 7: [ref('1', 'D-1'), ref('99', 'X-99')] }), defs, 'Devices');
    const missing = t.missing();
    expect(missing).toHaveLength(1);
    expect(missingRows(missing)).toEqual([['X-99', 'Label X-99', '99', 2, 'Devices / Parent']]);
  });

  it('does not report a target exported later, even from another type', () => {
    const t = createReferenceTracker();
    t.add(record('1', { 7: [ref('50', 'P-50')] }), defs, 'Devices');
    t.add(record('50'), defs, 'Parents');
    expect(t.missing()).toEqual([]);
  });

  it('ignores non-reference attributes and unknown attribute ids', () => {
    const t = createReferenceTracker();
    t.add(record('1', { 8: [{ id: '5' }], 123: [{ id: '6' }] }), defs, 'Devices');
    expect(t.missing()).toEqual([]);
  });

  it('orders the report by key', () => {
    const t = createReferenceTracker();
    t.add(record('1', { 7: [ref('3', 'K-10'), ref('2', 'K-2')] }), defs, 'Devices');
    expect(t.missing().map((m) => m.key)).toEqual(['K-2', 'K-10']);
  });
});
