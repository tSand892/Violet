// Persistence on Netlify Blobs, with an in-memory fallback for plain `node` runs
// (handy for local scripts/tests; data is lost when the process exits).
import { getStore } from '@netlify/blobs';

const memory = new Map();
let warned = false;

function memoryStore(name) {
  if (!memory.has(name)) memory.set(name, new Map());
  const m = memory.get(name);
  return {
    get: async (key) => (m.has(key) ? structuredClone(m.get(key)) : null),
    set: async (key, value) => { m.set(key, structuredClone(value)); },
    delete: async (key) => { m.delete(key); },
    list: async (prefix = '') => [...m.keys()].filter((k) => k.startsWith(prefix)),
  };
}

function blobStore(name) {
  const s = getStore({ name, consistency: 'strong' });
  return {
    get: (key) => s.get(key, { type: 'json' }),
    set: (key, value) => s.setJSON(key, value),
    delete: (key) => s.delete(key),
    list: async (prefix = '') => {
      const { blobs } = await s.list({ prefix });
      return blobs.map((b) => b.key);
    },
  };
}

export function store(name) {
  try {
    return blobStore(name);
  } catch (err) {
    if (!warned) {
      warned = true;
      console.warn('Netlify Blobs is not configured here; using an in-memory store.', err.message);
    }
    return memoryStore(name);
  }
}

export const users = () => store('users'); // key: username -> account record
export const live = () => store('live');   // key: username -> current broadcast state
export const meta = () => store('meta');   // key: 'streamers' -> [{ username, displayName }]

// Keeps the list of streamer channels shown on the home page.
export async function upsertStreamer(username, displayName) {
  const index = meta();
  const list = (await index.get('streamers')) || [];
  const existing = list.find((s) => s.username === username);
  if (existing) existing.displayName = displayName;
  else list.push({ username, displayName });
  await index.set('streamers', list);
}
