/** Read-only deployment diagnostic. No API keys or .env are read. */
import { pathToFileURL } from 'node:url';

const loopback = hostname => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname);
function requireHttpUrl(value, label) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} must be a complete URL.`); }
  if (url.username || url.password) throw new Error(`${label} must not include credentials.`);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback(url.hostname))) {
    throw new Error(`${label} must use HTTPS (HTTP is allowed only for localhost).`);
  }
  return url;
}
const tokens = value => (value || '').split(',').map(item => item.trim().toLowerCase());

export async function checkApi({ endpoint, origin, post = false, fetchImpl = globalThis.fetch, log = console.log }) {
  const url = requireHttpUrl(endpoint, 'API URL');
  const page = requireHttpUrl(origin, 'Website origin');
  if (page.pathname !== '/' || page.search || page.hash || origin !== page.origin) {
    throw new Error('Website origin must be scheme + hostname + optional port, with no trailing slash or path.');
  }
  if (url.search || url.hash) throw new Error('Use the API route URL without query parameters or a fragment.');
  const response = await fetchImpl(url.href, {
    method: 'OPTIONS', redirect: 'error', credentials: 'omit',
    headers: { Origin: origin, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
    signal: AbortSignal.timeout(10000),
  });
  const allowedOrigin = response.headers.get('access-control-allow-origin');
  const methods = response.headers.get('access-control-allow-methods');
  const headers = response.headers.get('access-control-allow-headers');
  log(`OPTIONS status: ${response.status}`);
  log(`Access-Control-Allow-Origin: ${allowedOrigin || '(missing)'}`);
  log(`Access-Control-Allow-Methods: ${methods || '(missing)'}`);
  log(`Access-Control-Allow-Headers: ${headers || '(missing)'}`);
  const allows = (list, name) => tokens(list).includes(name) || tokens(list).includes('*');
  const corsOk = response.ok && [origin, '*'].includes(allowedOrigin) && allows(methods, 'post') && allows(headers, 'content-type');
  if (!corsOk) {
    log('FAIL: The preflight would not allow this cross-origin JSON POST. Check the URL/stage and API Gateway CORS.');
    return false;
  }
  log('PASS: Preflight headers allow this origin and JSON POST. This does NOT prove the POST route or Gemini works.');
  if (allowedOrigin === '*') log('NOTE: Prefer your exact website origin instead of a wildcard.');
  if (!post) {
    log('No chat message sent. Add --post to check the route; that can invoke Gemini and consume provider usage.');
    return true;
  }
  const result = await fetchImpl(url.href, {
    method: 'POST', redirect: 'error', credentials: 'omit',
    headers: { Origin: origin, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: 'Tell me about Mthandeki.', history: [] }),
    signal: AbortSignal.timeout(25000),
  });
  let data = null;
  try { data = await result.json(); } catch { /* Never print an untrusted raw body. */ }
  const actualOrigin = result.headers.get('access-control-allow-origin');
  const valid = result.ok && [origin, '*'].includes(actualOrigin) &&
    typeof data?.reply === 'string' && Boolean(data.reply.trim()) && data.reply.length <= 5000 &&
    ['gemini', 'preview'].includes(data.mode);
  log(`POST status: ${result.status}`);
  log(`POST Access-Control-Allow-Origin: ${actualOrigin || '(missing)'}`);
  if (typeof data?.code === 'string' && /^[a-z_]{1,48}$/.test(data.code)) log(`Backend error code: ${data.code}`);
  if (valid) log(`PASS: Valid chat response; mode=${data.mode}. Preview is saved answers, not live Gemini.`);
  else log('FAIL: Check the POST route, Lambda handler, allowed origin and server-side Gemini configuration. No response body was printed.');
  return valid;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.length === 0) {
    console.log('Usage: npm run check-api -- <full-api-url> <exact-website-origin> [--post]');
    console.log('Default: OPTIONS preflight only. --post sends one test message and may consume Gemini usage.');
    console.log('Never put an API key in either argument. This check does not test browser CSP.');
  } else if (args.length < 2 || args.length > 3 || (args.length === 3 && args[2] !== '--post')) {
    console.error('Expected API URL, website origin and optionally --post. Run with --help.');
    process.exitCode = 1;
  } else {
    try { if (!await checkApi({ endpoint: args[0], origin: args[1], post: args[2] === '--post' })) process.exitCode = 1; }
    catch (error) {
      console.error(`Check failed: ${error.message}`);
      console.error('Check the URL, DNS/network access, TLS and configuration. A network failure here is not proof of a CORS error.');
      process.exitCode = 1;
    }
  }
}
