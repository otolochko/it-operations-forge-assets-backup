import { describe, expect, it } from 'vitest';
import { createNameAllocator, exportBaseName, sanitizeFileName } from '../src/export/filenames.js';

describe('sanitizeFileName', () => {
  it('replaces forbidden and control characters', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j\u0001k')).toBe('a_b_c_d_e_f_g_h_i_j_k');
  });

  it('trims and limits to 100 characters', () => {
    expect(sanitizeFileName('  Laptop  ')).toBe('Laptop');
    expect(sanitizeFileName('x'.repeat(150))).toHaveLength(100);
  });

  it('never returns an empty name', () => {
    expect(sanitizeFileName('   ')).toBe('_');
  });
});

describe('createNameAllocator', () => {
  it('de-duplicates case-insensitively with a counter', () => {
    const next = createNameAllocator();
    expect(next('Laptop', '.csv')).toBe('Laptop.csv');
    expect(next('laptop', '.csv')).toBe('laptop (2).csv');
    expect(next('Laptop', '.csv')).toBe('Laptop (3).csv');
  });

  it('sanitizes names that collide after sanitizing', () => {
    const next = createNameAllocator();
    expect(next('a/b', '.csv')).toBe('a_b.csv');
    expect(next('a:b', '.csv')).toBe('a_b (2).csv');
  });
});

describe('exportBaseName', () => {
  it('formats schema key and local timestamp', () => {
    expect(exportBaseName(['IT'], new Date(2026, 9, 12, 9, 5))).toBe('assets-IT-2026-10-12-0905');
  });

  it('uses a count when several schemas are exported', () => {
    expect(exportBaseName(['IT', 'HR', 'FIN'], new Date(2026, 9, 12, 9, 5))).toBe('assets-3-schemas-2026-10-12-0905');
  });
});
