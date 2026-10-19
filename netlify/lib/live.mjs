// Broadcast state helpers. A channel counts as live only while the studio keeps sending heartbeats.
import { live } from './store.mjs';

const STALE_MS = 75 * 1000;

export function publicLive(state) {
  const fresh = state && state.live && typeof state.lastSeen === 'number' && Date.now() - state.lastSeen < STALE_MS;
  if (!fresh) return { live: false, peerId: null, title: '', viewers: 0, startedAt: null };
  return {
    live: true,
    peerId: state.peerId,
    title: state.title || '',
    viewers: state.viewers || 0,
    startedAt: state.startedAt,
  };
}

export async function getLive(username) {
  return publicLive(await live().get(username));
}
