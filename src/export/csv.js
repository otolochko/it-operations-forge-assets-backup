const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value) {
  let s = value == null ? '' : String(value);
  if (FORMULA_START.test(s)) s = `'${s}`;
  if (/[",\r\n]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csvRow(cells) {
  return `${cells.map(csvCell).join(',')}\r\n`;
}

export const CSV_BOM = '﻿';
