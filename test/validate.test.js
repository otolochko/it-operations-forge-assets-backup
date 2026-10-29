import { describe, expect, it } from 'vitest';
import { assertDate, assertNumericId, assertUserAql, assertWorkspaceId, combineFilter } from '../src/api/validate.js';

describe('validators', () => {
  it('accepts a UUID workspace id and rejects others', () => {
    expect(assertWorkspaceId('11111111-2222-4333-8444-555555555555')).toBe('11111111-2222-4333-8444-555555555555');
    expect(() => assertWorkspaceId('../etc')).toThrow('Invalid workspace id');
  });

  it('accepts digits only for ids', () => {
    expect(assertNumericId(183, 'type id')).toBe('183');
    expect(() => assertNumericId('1 OR 1=1', 'type id')).toThrow('Invalid type id');
    expect(() => assertNumericId('', 'type id')).toThrow();
  });

  it('limits user AQL length and rejects line breaks', () => {
    expect(assertUserAql('  Status = "In use" ')).toBe('Status = "In use"');
    expect(assertUserAql(undefined)).toBe('');
    expect(() => assertUserAql('a'.repeat(1001))).toThrow();
    expect(() => assertUserAql('a\nb')).toThrow();
  });

  it('accepts an empty or YYYY-MM-DD date only', () => {
    expect(assertDate('')).toBe('');
    expect(assertDate('2026-10-01')).toBe('2026-10-01');
    expect(() => assertDate('01.10.2026')).toThrow('Invalid date');
    expect(() => assertDate('2026-10-01" OR 1=1')).toThrow('Invalid date');
  });

  it('combines the changed since date with the user AQL', () => {
    expect(combineFilter('', '')).toBe('');
    expect(combineFilter('', 'Status = "In use"')).toBe('Status = "In use"');
    expect(combineFilter('2026-10-01', '')).toBe('Updated >= "2026-10-01"');
    expect(combineFilter('2026-10-01', 'Status = "In use"')).toBe('Updated >= "2026-10-01" AND (Status = "In use")');
    expect(() => combineFilter('bad', '')).toThrow('Invalid date');
    expect(() => combineFilter('2026-10-01', 'a'.repeat(1000))).toThrow();
  });
});
