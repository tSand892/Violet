// POST /api/whois { token }  (streamer only)
// Lets the studio verify a viewer's login token so chat names cannot be faked.
import { handler, json, readJson, methods } from '../lib/http.mjs';
import { requireUser, verifyToken } from '../lib/auth.mjs';

export default handler(async (req) => {
  methods(['POST'], req);
  const body = await readJson(req);
  requireUser(req, null, { role: 'streamer' }); // host identity from the Authorization header

  const viewer = verifyToken(body.token);
  if (!viewer) return json({ ok: false });
  return json({ ok: true, username: viewer.sub, name: viewer.name, role: viewer.role });
});

export const config = { path: '/api/whois' };
