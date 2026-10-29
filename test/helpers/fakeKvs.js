// In-memory stand-in for @forge/kvs: get, set, delete and query by key prefix with cursor paging.
export function createFakeKvs() {
  const store = new Map();
  const kvs = {
    get: async (key) => store.get(key),
    set: async (key, value) => void store.set(key, structuredClone(value)),
    delete: async (key) => void store.delete(key),
    query() {
      const state = { prefix: '', limit: 50, cursor: 0 };
      const builder = {
        where: (_, clause) => ((state.prefix = clause.value), builder),
        limit: (n) => ((state.limit = n), builder),
        cursor: (c) => ((state.cursor = Number(c)), builder),
        async getMany() {
          const all = [...store.keys()].filter((k) => k.startsWith(state.prefix)).sort();
          const page = all.slice(state.cursor, state.cursor + state.limit);
          const next = state.cursor + state.limit;
          return {
            results: page.map((key) => ({ key, value: structuredClone(store.get(key)) })),
            nextCursor: next < all.length ? String(next) : undefined,
          };
        },
      };
      return builder;
    },
  };
  return { kvs, store };
}

export const fakeConditions = { beginsWith: (value) => ({ condition: 'BEGINS_WITH', value }) };
