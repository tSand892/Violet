// GET /api/tips?since=<unix seconds>  -> paid tips for the logged-in streamer's channel.
// The studio polls this while live and announces new tips to viewers.
import Stripe from 'stripe';
import { handler, json, methods } from '../lib/http.mjs';
import { requireUser } from '../lib/auth.mjs';

const MAX_SESSIONS = 500;

export default handler(async (req) => {
  methods(['GET'], req);
  const session = requireUser(req, null, { role: 'streamer' });

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return json({ tips: [] });

  const url = new URL(req.url);
  const since = Math.floor(Number(url.searchParams.get('since'))) || Math.floor(Date.now() / 1000) - 6 * 3600;

  const stripe = new Stripe(key);
  const tips = [];
  let seen = 0;
  for await (const s of stripe.checkout.sessions.list({ status: 'complete', created: { gte: since }, limit: 100 })) {
    if (++seen > MAX_SESSIONS) break;
    const m = s.metadata || {};
    if (s.payment_status !== 'paid' || m.source !== 'violet-tip' || m.channel !== session.sub) continue;
    tips.push({
      id: s.id,
      amount: s.amount_total,
      currency: s.currency,
      name: m.name || 'Anonymous',
      message: m.message || '',
      item: m.item || '',
      created: s.created,
    });
  }
  tips.sort((a, b) => a.created - b.created);

  return json({ tips });
});

export const config = { path: '/api/tips' };
