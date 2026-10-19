// Public, non-secret site configuration that is sent to the browser.

export function siteConfig() {
  const env = process.env;
  return {
    // BRAND_NAME, not SITE_NAME: Netlify injects its own read-only SITE_NAME (the subdomain).
    name: env.BRAND_NAME || 'Violet',
    currency: (env.TIP_CURRENCY || 'usd').toLowerCase(),
    stripeEnabled: Boolean(env.STRIPE_SECRET_KEY),
    inviteRequired: Boolean(env.STREAMER_INVITE_CODE),
    peer: peerServer(),
    iceServers: iceServers(),
  };
}

function peerServer() {
  const env = process.env;
  if (!env.PEER_HOST) return null; // null = PeerJS default public cloud server
  return {
    host: env.PEER_HOST,
    port: Number(env.PEER_PORT || 443),
    path: env.PEER_PATH || '/',
    key: env.PEER_KEY || 'peerjs',
    secure: env.PEER_SECURE !== 'false',
  };
}

function iceServers() {
  const env = process.env;
  const servers = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
  if (env.TURN_URLS) {
    servers.push({
      urls: env.TURN_URLS.split(',').map((s) => s.trim()).filter(Boolean),
      username: env.TURN_USERNAME || '',
      credential: env.TURN_CREDENTIAL || '',
    });
  }
  return servers;
}

export function siteOrigin(req) {
  try {
    return new URL(req.url).origin;
  } catch {
    return process.env.URL || 'http://localhost:8888';
  }
}
