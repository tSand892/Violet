// POST /api/signup  { username, displayName, password, streamer, inviteCode }
import { handler, json, readJson, methods, HttpError } from '../lib/http.mjs';
import { hashPassword, issueToken, safeEqual } from '../lib/auth.mjs';
import { users, upsertStreamer } from '../lib/store.mjs';
import { cleanUsername, cleanDisplayName, cleanPassword, defaultChannel, publicUser } from '../lib/validate.mjs';

export default handler(async (req) => {
  methods(['POST'], req);
  const body = await readJson(req);

  const username = cleanUsername(body.username);
  const displayName = cleanDisplayName(body.displayName, username);
  const password = cleanPassword(body.password);

  let role = 'viewer';
  if (body.streamer) {
    const required = process.env.STREAMER_INVITE_CODE;
    if (required && !safeEqual(body.inviteCode || '', required)) {
      throw new HttpError(403, 'That streamer invite code is not valid');
    }
    role = 'streamer';
  }

  const db = users();
  if (await db.get(username)) throw new HttpError(409, 'That username is taken');

  const user = {
    username,
    displayName,
    role,
    passwordHash: await hashPassword(password),
    createdAt: Date.now(),
    channel: defaultChannel(),
  };
  await db.set(username, user);
  if (role === 'streamer') await upsertStreamer(username, displayName);

  return json({ token: issueToken(user), user: publicUser(user) }, 201);
});

export const config = { path: '/api/signup' };
