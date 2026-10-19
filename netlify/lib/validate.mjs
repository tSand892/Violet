// Input cleaning and limits shared by the functions.
import { HttpError } from './http.mjs';

export const LIMITS = { tipMin: 100, tipMax: 50000, menuItems: 12, links: 6 };

export const DEFAULT_TIP_MENU = [
  { label: '☕ Coffee', amount: 300 },
  { label: '🍕 Slice of pizza', amount: 500 },
  { label: '💜 Big love', amount: 1000 },
  { label: '💎 Superfan', amount: 2500 },
];

export function cleanText(value, max) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

export function cleanUsername(value) {
  const u = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(u)) {
    throw new HttpError(400, 'Username must be 3-20 letters, numbers or underscores');
  }
  return u;
}

export function cleanDisplayName(value, fallback) {
  return cleanText(value, 30) || fallback;
}

export function cleanPassword(value) {
  const p = String(value ?? '');
  if (p.length < 8 || p.length > 200) throw new HttpError(400, 'Password must be at least 8 characters');
  return p;
}

// Amount in minor units (cents). Returns null when out of range.
export function cleanAmount(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < LIMITS.tipMin || n > LIMITS.tipMax) return null;
  return n;
}

export function cleanTipMenu(items) {
  if (!Array.isArray(items)) return DEFAULT_TIP_MENU;
  const out = [];
  for (const item of items.slice(0, LIMITS.menuItems)) {
    const label = cleanText(item && item.label, 40);
    const amount = cleanAmount(item && item.amount);
    if (label && amount) out.push({ label, amount });
  }
  return out;
}

export function cleanLinks(links) {
  if (!Array.isArray(links)) return [];
  const out = [];
  for (const link of links.slice(0, LIMITS.links)) {
    const label = cleanText(link && link.label, 30);
    let url = '';
    try {
      const u = new URL(String(link && link.url));
      if (u.protocol === 'https:' || u.protocol === 'http:') url = u.href;
    } catch { /* invalid url, dropped */ }
    if (label && url) out.push({ label, url });
  }
  return out;
}

export function defaultChannel() {
  return { title: '', tipMenu: DEFAULT_TIP_MENU, allowCustom: true, links: [] };
}

// Merge a settings update into the current channel settings, cleaning each field.
export function cleanChannel(input, current = defaultChannel()) {
  const body = input || {};
  return {
    title: 'title' in body ? cleanText(body.title, 80) : current.title,
    tipMenu: 'tipMenu' in body ? cleanTipMenu(body.tipMenu) : current.tipMenu,
    allowCustom: 'allowCustom' in body ? Boolean(body.allowCustom) : current.allowCustom,
    links: 'links' in body ? cleanLinks(body.links) : current.links,
  };
}

export function publicUser(user) {
  return { username: user.username, displayName: user.displayName, role: user.role };
}
