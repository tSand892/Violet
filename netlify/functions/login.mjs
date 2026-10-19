// POST /api/login  { username, password }
import { handler, json, readJson, methods, HttpError, sleep } from '../lib/http.mjs';
import { verifyPassword, issueToken } from '../lib/auth.mjs';
import { users } from '../lib/store.mjs';
import { cleanUsername, publicUser } from '../lib/validate.mjs';

export default handler(async (req) => {
  methods(['POST'], req);
  const body = await readJson(req);

  let username = null;
  try {
    username = cleanUsername(body.username);
  } catch {
    username = null;
  }

  const user = username ? await users().get(username) : null;
  const ok = user && (await verifyPassword(String(body.password || ''), user.passwordHash));
  if (!ok) {
    await sleep(600); // slow down guessing
    throw new HttpError(401, 'Wrong username or password');
  }

  return json({ token: issueToken(user), user: publicUser(user) });
});

export const config = { path: '/api/login' };
