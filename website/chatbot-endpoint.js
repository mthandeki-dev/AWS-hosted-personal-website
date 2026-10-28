/* Shared endpoint selection; classic script also works with file:// previews. */
(() => {
  'use strict';
  const isLoopback = hostname => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(hostname);
  function resolveEndpoint(config = {}, location = window.location) {
    // Files have an opaque Origin. Never send a live API request from file://.
    if (location.protocol === 'file:') return '';
    const local = isLoopback(location.hostname);
    const value = local ? (config.localApiUrl ?? '/api/chat') : (config.apiUrl ?? '');
    if (typeof value !== 'string') throw new Error('The assistant endpoint must be a URL string.');
    if (!value.trim()) return '';
    let url;
    try { url = new URL(value.trim(), location.href); }
    catch { throw new Error('The assistant endpoint is not a valid URL.'); }
    if (url.username || url.password) throw new Error('Do not put credentials in the assistant URL.');
    if (url.protocol !== 'https:' && !(local && isLoopback(url.hostname) && url.protocol === 'http:')) {
      throw new Error('The assistant endpoint must use HTTPS, except for local development.');
    }
    return url.href;
  }
  window.PORTFOLIO_CHAT_ENDPOINT = Object.freeze({ resolveEndpoint });
})();
