/** Start the real local backend in saved-answer mode, regardless of any API key.
 * This command deliberately does not load .env or contact Gemini.
 */
await import('./sync-preview.mjs');
process.env.GEMINI_API_KEY = '';
// Never reuse a production-only origin allowlist for this loopback server.
delete process.env.ALLOWED_ORIGINS;
await import('./dev-server.mjs');
