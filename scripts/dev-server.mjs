import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHandler, MAX_BODY_BYTES } from '../backend/handler.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../website');
const port = Number(process.env.PORT || 3000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
const env = { ...process.env, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || `http://localhost:${port},http://127.0.0.1:${port}` };
const chatHandler = createHandler({ env });
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.vcf': 'text/vcard; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const baseHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${port}`);
    if (url.pathname === '/api/chat') {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) { 
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          res.writeHead(413, { ...baseHeaders, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'That request is too long.', code: 'payload_too_large' }));
          return;
        }
        chunks.push(chunk);
      }
      const response = await chatHandler({
        headers: req.headers, body: Buffer.concat(chunks).toString('utf8'),
        requestContext: { http: { method: req.method, sourceIp: req.socket.remoteAddress } },
      });
      res.writeHead(response.statusCode, { ...baseHeaders, ...response.headers });
      res.end(response.body); return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) {
      res.writeHead(405, { ...baseHeaders, Allow: 'GET, HEAD' }); res.end('Method not allowed.'); return;
    }
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { res.writeHead(400, baseHeaders); res.end('Bad request.'); return; }
    // Only website/ is served. Secrets, backend code and deployment config stay private.
    if (pathname.split('/').some(segment => segment.startsWith('.')) || pathname.includes('\0')) {
      res.writeHead(404, baseHeaders); res.end('Not found.'); return;
    }
    const file = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    if (!file.startsWith(root + sep) || !(await stat(file)).isFile()) {
      res.writeHead(404, baseHeaders); res.end('Not found.'); return;
    }
    const bytes = await readFile(file);
    res.writeHead(200, { ...baseHeaders, 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Content-Length': bytes.length });
    res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    const missing = ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code);
    res.writeHead(missing ? 404 : 500, { ...baseHeaders, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(missing ? 'Not found.' : 'Request failed.');
  }
});
server.requestTimeout = 30000;
server.headersTimeout = 10000;
// Loopback only: this is a developer preview, not a production web server.
server.listen(port, '127.0.0.1', () => {
  console.log(`Portfolio: http://localhost:${port}`);
  console.log(env.GEMINI_API_KEY ? 'Chat: server-side Gemini enabled.' : 'Chat: saved-answer preview (no Gemini API key).');
});
