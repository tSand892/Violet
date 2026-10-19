// Helpers shared by every function: JSON responses, body parsing, error handling.

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...headers,
    },
  });
}

// Parses a JSON body. Also accepts text/plain bodies (navigator.sendBeacon sends those).
export async function readJson(req) {
  let text = '';
  try {
    text = await req.text();
  } catch {
    return {};
  }
  if (!text) return {};
  try {
    const data = JSON.parse(text);
    return data && typeof data === 'object' ? data : {};
  } catch {
    throw new HttpError(400, 'Body must be valid JSON');
  }
}

export function methods(allowed, req) {
  if (!allowed.includes(req.method)) throw new HttpError(405, `Use ${allowed.join(' or ')}`);
}

// Wraps a handler so thrown HttpErrors become JSON responses and anything else is logged.
export function handler(fn) {
  return async (req, context) => {
    try {
      return await fn(req, context);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Something went wrong on the server' }, 500);
    }
  };
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
