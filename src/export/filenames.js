// eslint-disable-next-line no-control-regex
const FORBIDDEN = /[/\\:*?"<>|\u0000-\u001f]/g;
const MAX_LENGTH = 100;

export function sanitizeFileName(name) {
  const cleaned = String(name ?? '').replace(FORBIDDEN, '_').trim().slice(0, MAX_LENGTH).trim();
  return cleaned || '_';
}

// Returns a function that hands out unique names: "Laptop", "Laptop (2)", "Laptop (3)".
export function createNameAllocator() {
  const used = new Set();
  return (name, extension) => {
    const base = sanitizeFileName(name);
    let candidate = base;
    for (let n = 2; used.has(`${candidate}${extension}`.toLowerCase()); n++) candidate = `${base} (${n})`;
    used.add(`${candidate}${extension}`.toLowerCase());
    return `${candidate}${extension}`;
  };
}

const pad = (n) => String(n).padStart(2, '0');

export function exportBaseName(schemaKeys, date = new Date()) {
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}`;
  const label = schemaKeys.length === 1 ? sanitizeFileName(schemaKeys[0]) : `${schemaKeys.length}-schemas`;
  return `assets-${label}-${stamp}`;
}
