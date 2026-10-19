// GET  /api/channel?c=<username>  -> public channel info + live status (watch page)
// POST /api/channel { title, tipMenu, allowCustom, links, displayName }  (streamer only)
import { handler, json, readJson, methods, HttpError } from '../lib/http.mjs';
import { requireUser } from '../lib/auth.mjs';
import { users, upsertStreamer } from '../lib/store.mjs';
import { getLive } from '../lib/live.mjs';
import { siteConfig } from '../lib/config.mjs';
import { cleanUsername, cleanDisplayName, cleanChannel, defaultChannel } from '../lib/validate.mjs';

function channelView(user) {
  return { username: user.username, displayName: user.displayName, ...defaultChannel(), ...user.channel };
}

export default handler(async (req) => {
  methods(['GET', 'POST'], req);
  const db = users();

  if (req.method === 'GET') {
    let username;
    try {
      username = cleanUsername(new URL(req.url).searchParams.get('c'));
    } catch {
      throw new HttpError(404, 'Channel not found');
    }
    const user = await db.get(username);
    if (!user || user.role !== 'streamer') throw new HttpError(404, 'Channel not found');
    return json({ site: siteConfig(), channel: channelView(user), live: await getLive(username) });
  }

  const body = await readJson(req);
  const session = requireUser(req, body, { role: 'streamer' });
  const user = await db.get(session.sub);
  if (!user) throw new HttpError(401, 'Account not found, please log in again');

  user.channel = cleanChannel(body, { ...defaultChannel(), ...user.channel });
  if (typeof body.displayName === 'string') {
    user.displayName = cleanDisplayName(body.displayName, user.username);
    await upsertStreamer(user.username, user.displayName);
  }
  await db.set(user.username, user);

  return json({ channel: channelView(user) });
});

export const config = { path: '/api/channel' };
