// Bootstrap account from SEED_* environment variables.
// Created automatically the first time the site is used, so you can log in on a fresh deploy
// without signing up. Set SEED_USERNAME / SEED_PASSWORD (and optionally SEED_DISPLAY_NAME,
// SEED_ROLE=streamer|viewer). Changing SEED_PASSWORD later resets that account's password.
import { users, upsertStreamer } from './store.mjs';
import { hashPassword, verifyPassword } from './auth.mjs';
import { defaultChannel, cleanText } from './validate.mjs';

let pending = null;

export function ensureSeedAccount() {
  if (!pending) {
    pending = seed().catch((err) => {
      console.error('Seed account failed:', err);
      pending = null; // try again on the next request
    });
  }
  return pending;
}

async function seed() {
  const env = process.env;
  const username = String(env.SEED_USERNAME || '').trim().toLowerCase();
  const password = String(env.SEED_PASSWORD || '');
  if (!/^[a-z0-9_]{3,20}$/.test(username) || password.length < 6) return;

  const role = env.SEED_ROLE === 'viewer' ? 'viewer' : 'streamer';
  const displayName = cleanText(env.SEED_DISPLAY_NAME, 30) || username;
  const db = users();
  const existing = await db.get(username);

  if (!existing) {
    await db.set(username, {
      username,
      displayName,
      role,
      passwordHash: await hashPassword(password),
      createdAt: Date.now(),
      channel: defaultChannel(),
      seeded: true,
    });
    if (role === 'streamer') await upsertStreamer(username, displayName);
    console.log(`Seed account "${username}" created as ${role}`);
    return;
  }

  if (existing.seeded && !(await verifyPassword(password, existing.passwordHash))) {
    existing.passwordHash = await hashPassword(password);
    await db.set(username, existing);
    console.log(`Seed account "${username}" password updated from SEED_PASSWORD`);
  }
}
