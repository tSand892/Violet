// GET /api/channels  -> every streamer channel with its live status (home page).
import { handler, json, methods } from '../lib/http.mjs';
import { meta } from '../lib/store.mjs';
import { getLive } from '../lib/live.mjs';
import { siteConfig } from '../lib/config.mjs';
import { ensureSeedAccount } from '../lib/seed.mjs';

export default handler(async (req) => {
  methods(['GET'], req);
  await ensureSeedAccount();

  const streamers = (await meta().get('streamers')) || [];
  const states = await Promise.all(streamers.map((s) => getLive(s.username)));

  const channels = streamers.map((s, i) => ({
    username: s.username,
    displayName: s.displayName,
    ...states[i],
  }));

  channels.sort((a, b) =>
    Number(b.live) - Number(a.live) ||
    b.viewers - a.viewers ||
    a.displayName.localeCompare(b.displayName));

  return json({ site: siteConfig(), channels });
});

export const config = { path: '/api/channels' };
