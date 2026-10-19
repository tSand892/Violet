// GET /api/me  -> the logged-in account, its channel settings (streamers) and site config.
import { handler, json, methods, HttpError } from '../lib/http.mjs';
import { requireUser, issueToken } from '../lib/auth.mjs';
import { users } from '../lib/store.mjs';
import { defaultChannel, publicUser } from '../lib/validate.mjs';
import { siteConfig } from '../lib/config.mjs';

export default handler(async (req) => {
  methods(['GET'], req);
  const session = requireUser(req);

  const user = await users().get(session.sub);
  if (!user) throw new HttpError(401, 'Account not found, please log in again');

  return json({
    user: publicUser(user),
    channel: user.role === 'streamer' ? { ...defaultChannel(), ...user.channel } : null,
    site: siteConfig(),
    token: issueToken(user), // refreshed token (picks up role/name changes)
  });
});

export const config = { path: '/api/me' };
