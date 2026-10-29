import { describe, expect, it } from 'vitest';
import { CSV_BOM, csvCell, csvRow } from '../src/export/csv.js';

describe('csvCell', () => {
  it('quotes commas, quotes and line breaks', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('x\ny')).toBe('"x\ny"');
  });

  it('prefixes formula starters with a single quote', () => {
    for (const s of ['=1+1', '+1', '-1', '@sum', '\tx', '\rx']) expect(csvCell(s).startsWith("'") || csvCell(s).startsWith('"\'')).toBe(true);
    expect(csvCell('=1+1')).toBe("'=1+1");
  });

  it('turns null and undefined into empty cells', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('csvRow', () => {
  it('joins with commas and ends with CRLF', () => {
    expect(csvRow(['a', 'b,c', 1])).toBe('a,"b,c",1\r\n');
  });

  it('exposes the BOM', () => {
    expect(CSV_BOM).toBe('﻿');
  });
});
