// POST /api/tip { channel, item | amount, name, message }  -> { url } (Stripe Checkout)
import Stripe from 'stripe';
import { handler, json, readJson, methods, HttpError } from '../lib/http.mjs';
import { users } from '../lib/store.mjs';
import { siteOrigin } from '../lib/config.mjs';
import { cleanUsername, cleanText, cleanAmount, defaultChannel, LIMITS } from '../lib/validate.mjs';

export default handler(async (req) => {
  methods(['POST'], req);
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new HttpError(503, 'Tips are not set up yet');

  const body = await readJson(req);

  let username;
  try {
    username = cleanUsername(body.channel);
  } catch {
    throw new HttpError(404, 'Channel not found');
  }
  const user = await users().get(username);
  if (!user || user.role !== 'streamer') throw new HttpError(404, 'Channel not found');
  const channel = { ...defaultChannel(), ...user.channel };

  // Prices always come from the streamer's saved menu, never from the client.
  let amount;
  let item = '';
  if (Number.isInteger(body.item) && channel.tipMenu[body.item]) {
    amount = channel.tipMenu[body.item].amount;
    item = channel.tipMenu[body.item].label;
  } else {
    if (!channel.allowCustom) throw new HttpError(400, 'Please pick an item from the tip menu');
    amount = cleanAmount(body.amount);
    if (!amount) throw new HttpError(400, `Tips must be between ${LIMITS.tipMin / 100} and ${LIMITS.tipMax / 100}`);
  }

  const name = cleanText(body.name, 40) || 'Anonymous';
  const message = cleanText(body.message, 140);
  const currency = (process.env.TIP_CURRENCY || 'usd').toLowerCase();
  const origin = siteOrigin(req);

  const stripe = new Stripe(key);
  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    submit_type: 'donate',
    line_items: [{
      quantity: 1,
      price_data: {
        currency,
        unit_amount: amount,
        product_data: { name: item ? `${item} for ${user.displayName}` : `Tip for ${user.displayName}` },
      },
    }],
    metadata: { source: 'violet-tip', channel: username, name, message, item },
    success_url: `${origin}/thanks.html?c=${encodeURIComponent(username)}`,
    cancel_url: `${origin}/c/${encodeURIComponent(username)}`,
  });

  return json({ url: session.url });
});

export const config = { path: '/api/tip' };
