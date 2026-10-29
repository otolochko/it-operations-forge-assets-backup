import { TYPE_REFERENCE } from './flatten.js';

export const MISSING_HEADERS = ['Referenced object key', 'Referenced label', 'Referenced object ID', 'Times referenced', 'Referenced from'];

// Collects object references while an export runs, to find the ones that point outside the export.
export function createReferenceTracker() {
  const exported = new Set();
  const targets = new Map();

  return {
    // `source` names where the record lives, for example "Devices".
    add(record, defsById, source) {
      exported.add(record.id);
      for (const [attrId, entries] of Object.entries(record.attributes)) {
        const def = defsById.get(attrId);
        if (def?.type !== TYPE_REFERENCE) continue;
        for (const entry of entries) {
          if (entry?.id == null) continue;
          let target = targets.get(entry.id);
          if (!target) {
            target = { id: entry.id, key: entry.key ?? '', label: entry.label ?? '', count: 0, from: new Set() };
            targets.set(entry.id, target);
          }
          target.count += 1;
          target.from.add(`${source} / ${def.name}`);
        }
      }
    },

    // Referenced objects that were not written to the export, ordered by key.
    missing() {
      return [...targets.values()]
        .filter((t) => !exported.has(t.id))
        .sort((a, b) => a.key.localeCompare(b.key, 'en', { numeric: true }));
    },
  };
}

export function missingRows(missing) {
  return missing.map((t) => [t.key, t.label, t.id, t.count, [...t.from].join('; ')]);
}
