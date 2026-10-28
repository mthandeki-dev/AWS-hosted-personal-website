import { createHash } from 'node:crypto';
import { answerQuestion, ChatError } from './chat.mjs';

export const MAX_BODY_BYTES = 8192;
/** Best-effort per-instance limiter. API Gateway also supplies a shared route throttle. */
export function createLimiter({ now = Date.now, maxPerMinute = 8, maxTotalPerMinute = 30 } = {}) {
  const clients = new Map();
  let globalWindow = { start: now(), count: 0 };
  return client => {
    const time = now();
    for (const [id, item] of clients) if (time - item.start >= 60000) clients.delete(id);
    if (time - globalWindow.start >= 60000) globalWindow = { start: time, count: 0 };
    const id = createHash('sha256').update(String(client)).digest('hex');
    const item = clients.get(id) || { start: time, count: 0 };
    if (item.count >= maxPerMinute || globalWindow.count >= maxTotalPerMinute || (clients.size >= 1000 && !clients.has(id))) return false;
    item.count += 1;
    globalWindow.count += 1;
    clients.set(id, item);
    return true;
  };
}

export function createHandler({ env = process.env, fetchImpl = globalThis.fetch, limiter = createLimiter() } = {}) {
  return async event => {
    const headers = Object.fromEntries(Object.entries(event.headers || {}).map(([key, value]) => [key.toLowerCase(), String(value)]));
    const origin = headers.origin || '';
    const origins = (env.ALLOWED_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean);
    const originAllowed = Boolean(origin && origins.includes(origin));
    const responseHeaders = {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Origin',
      ...(originAllowed ? { 'Access-Control-Allow-Origin': origin } : {}),
    };
    const respond = (statusCode, payload, extra = {}) => ({ statusCode, headers: { ...responseHeaders, ...extra }, body: JSON.stringify(payload) });
    // Require an allowed browser origin as a misuse check; this is NOT authentication.
    if (!originAllowed) return respond(403, { error: 'This request is not allowed.', code: 'origin_denied' });
    const method = event.requestContext?.http?.method || event.httpMethod || '';
    if (method === 'OPTIONS') return { statusCode: 204, headers: { ...responseHeaders, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Max-Age': '600' }, body: '' };
    if (method !== 'POST') return respond(405, { error: 'Use POST for chat requests.', code: 'method_not_allowed' }, { Allow: 'POST, OPTIONS' });
    if (!/^application\/json(?:\s*;|$)/i.test(headers['content-type'] || '')) return respond(415, { error: 'Send your question as JSON.', code: 'unsupported_media_type' });
    if (Number(headers['content-length']) > MAX_BODY_BYTES) return respond(413, { error: 'That request is too long.', code: 'payload_too_large' });
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX_BODY_BYTES) return respond(413, { error: 'That request is too long.', code: 'payload_too_large' });
    const client = event.requestContext?.http?.sourceIp || event.requestContext?.identity?.sourceIp || 'unknown';
    if (!limiter(client)) return respond(429, { error: 'A few too many questions at once. Please try again in a minute.', code: 'rate_limited' }, { 'Retry-After': '60' });
    let payload;
    try { payload = JSON.parse(raw); }
    catch { return respond(400, { error: 'Please send a valid question.', code: 'invalid_json' }); }
    try {
      return respond(200, await answerQuestion(payload, { env, fetchImpl }));
    } catch (error) {
      if (error instanceof ChatError) return respond(error.status, { error: error.message, code: error.code }, error.status === 429 ? { 'Retry-After': '60' } : {});
      // No API keys, raw provider errors, visitor messages or profile prompts are logged.
      console.error('portfolio_chat_internal_error');
      return respond(500, { error: 'The assistant is temporarily unavailable.', code: 'internal_error' });
    }
  };
}
export const handler = createHandler();
