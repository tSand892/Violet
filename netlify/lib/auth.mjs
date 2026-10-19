// Passwords (scrypt) and stateless signed session tokens (HMAC-SHA256).
import { scrypt, randomBytes, timingSafeEqual, createHmac, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './http.mjs';

const scryptAsync = promisify(scrypt);
const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password, stored) {
  const [salt, hex] = String(stored || '').split(':');
  if (!salt || !hex) return false;
  const hash = await scryptAsync(password, salt, 64);
  const expected = Buffer.from(hex, 'hex');
  return hash.length === expected.length && timingSafeEqual(hash, expected);
}

export function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function secret() {
  const configured = process.env.SESSION_SECRET;
  if (configured) return createHash('sha256').update(configured).digest();
  // Only fall back to a fixed dev secret outside real Netlify deploys.
  const isDeploy = process.env.NETLIFY === 'true' && process.env.NETLIFY_DEV !== 'true';
  if (isDeploy) throw new HttpError(500, 'SESSION_SECRET is not configured on this site');
  return createHash('sha256').update('violet-dev-only-secret').digest();
}

const sign = (payload) => createHmac('sha256', secret()).update(payload).digest('base64url');

export function issueToken(user) {
  const payload = Buffer.from(JSON.stringify({
    sub: user.username,
    name: user.displayName,
    role: user.role,
    exp: Date.now() + TOKEN_TTL_MS,
  })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token) {
  if (typeof token !== 'string') return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  if (!safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof data.exp !== 'number' || data.exp < Date.now()) return null;
    if (typeof data.sub !== 'string' || typeof data.role !== 'string') return null;
    return data;
  } catch {
    return null;
  }
}

export function tokenFrom(req, body) {
  const header = req.headers.get('authorization') || '';
  if (header.startsWith('Bearer ')) return header.slice(7).trim();
  if (body && typeof body.token === 'string') return body.token;
  return null;
}

// Returns the session payload { sub, name, role, exp } or throws 401/403.
export function requireUser(req, body, { role } = {}) {
  const session = verifyToken(tokenFrom(req, body));
  if (!session) throw new HttpError(401, 'Please log in');
  if (role && session.role !== role) throw new HttpError(403, `This needs a ${role} account`);
  return session;
}
