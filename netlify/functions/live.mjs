// Broadcast state for the logged-in streamer.
// GET  /api/live                       -> current state
// POST /api/live { action: 'start', peerId, title }
// POST /api/live { action: 'heartbeat', peerId, viewers, title }
// POST /api/live { action: 'stop', peerId }
import { handler, json, readJson, methods, HttpError } from '../lib/http.mjs';
import { requireUser } from '../lib/auth.mjs';
import { live } from '../lib/store.mjs';
import { publicLive } from '../lib/live.mjs';
import { cleanText } from '../lib/validate.mjs';

export default handler(async (req) => {
  methods(['GET', 'POST'], req);
  const body = req.method === 'POST' ? await readJson(req) : {};
  const session = requireUser(req, body, { role: 'streamer' });
  const db = live();
  const now = Date.now();

  const current = (await db.get(session.sub)) || {};
  if (req.method === 'GET') return json({ state: publicLive(current) });

  const title = typeof body.title === 'string' ? cleanText(body.title, 80) : current.title || '';
  const peerId = String(body.peerId || '');

  switch (body.action) {
    case 'start': {
      if (!/^[A-Za-z0-9_-]{8,64}$/.test(peerId)) throw new HttpError(400, 'Invalid peer id');
      const state = { live: true, peerId, title, startedAt: now, lastSeen: now, viewers: 0 };
      await db.set(session.sub, state);
      return json({ state: publicLive(state) });
    }
    case 'heartbeat': {
      if (!current.live || current.peerId !== peerId) {
        throw new HttpError(409, 'This broadcast is no longer the active one');
      }
      const viewers = Math.max(0, Math.min(100000, Math.round(Number(body.viewers) || 0)));
      const state = { ...current, title, lastSeen: now, viewers };
      await db.set(session.sub, state);
      return json({ state: publicLive(state) });
    }
    case 'stop': {
      // Ignore a stale "stop" from an older studio tab after a newer broadcast started.
      if (current.live && peerId && current.peerId !== peerId) return json({ state: publicLive(current) });
      await db.set(session.sub, { live: false, endedAt: now, title });
      return json({ state: publicLive(null) });
    }
    default:
      throw new HttpError(400, 'Unknown action');
  }
});

export const config = { path: '/api/live' };
