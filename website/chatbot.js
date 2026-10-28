/* Accessible, dependency-free chat. Only plain text is rendered; no secrets live here. */
(() => {
  'use strict';
  const root = document.querySelector('.portfolio-chat');
  if (!root) return;
  const launcher = document.getElementById('chat-launcher');
  const panel = document.getElementById('chat-panel');
  const close = document.getElementById('chat-close');
  const form = document.getElementById('chat-form');
  const input = document.getElementById('chat-input');
  const send = document.getElementById('chat-send');
  const log = document.getElementById('chat-messages');
  const status = document.getElementById('chat-status');
  const mode = document.getElementById('chat-mode');
  const privacy = document.getElementById('chat-privacy');
  const reset = document.getElementById('chat-reset');
  const suggestions = Array.from(root.querySelectorAll('[data-question]'));
  const config = window.PORTFOLIO_CHAT_CONFIG || {};
  const preview = window.PORTFOLIO_CHAT_PREVIEW || {};
  let apiUrl = '';
  let endpointError = null;
  try { apiUrl = window.PORTFOLIO_CHAT_ENDPOINT.resolveEndpoint(config, window.location); }
  catch (error) { endpointError = error; }
  const welcome = 'Hi! I\u2019m Mthandeki\u2019s portfolio assistant. Ask me about his background, skills, interests or this website.';
  let history = [];
  let busy = false;
  let activeController = null;
  let generation = 0;

  function setMode(value) {
    mode.textContent = value === 'gemini' ? 'Gemini \u00b7 approved profile answers'
      : value === 'preview' ? 'Preview \u00b7 saved answers only'
      : value === 'unavailable' ? 'Live assistant \u00b7 unavailable'
      : 'Portfolio assistant \u00b7 connecting on send';
    privacy.textContent = value === 'preview'
      ? 'Preview uses saved answers. Please don\u2019t share sensitive information.'
      : 'Questions and recent chat context are sent to Google Gemini when enabled. Don\u2019t share sensitive information.';
  }
  setMode(endpointError ? 'unavailable' : apiUrl ? 'pending' : 'preview');
  root.hidden = false;

  function setOpen(open) {
    panel.hidden = !open;
    launcher.setAttribute('aria-expanded', String(open));
    launcher.setAttribute('aria-label', open ? 'Close chatbot' : 'Open chatbot to ask about Mthandeki');
    if (open) input.focus({ preventScroll: true });
    else launcher.focus({ preventScroll: true });
  }
  launcher.addEventListener('click', () => setOpen(panel.hidden));
  close.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) { event.preventDefault(); setOpen(false); }
  });

  function addMessage(text, sender, isError = false) {
    const wrapper = document.createElement('div');
    wrapper.className = `chat-message chat-message-${sender}${isError ? ' chat-message-error' : ''}`;
    const label = document.createElement('span');
    label.className = 'sr-only';
    label.textContent = sender === 'user' ? 'You: ' : 'Assistant: ';
    const paragraph = document.createElement('p');
    paragraph.textContent = text; // Never use innerHTML for visitor or server content.
    wrapper.append(label, paragraph);
    log.append(wrapper);
    // Bound in-page memory for long sessions. Chat is never persisted in browser storage.
    while (log.children.length > 60) log.firstElementChild.remove();
    log.scrollTop = log.scrollHeight;
  }
  function setBusy(value) {
    busy = value;
    send.disabled = value;
    suggestions.forEach(button => { button.disabled = value; });
    input.readOnly = value;
    form.setAttribute('aria-busy', String(value));
    status.textContent = value ? 'Finding an approved answer\u2026' : '';
  }
  function savedReply(question) {
    const normalize = text => text.toLowerCase().replace(/[^a-z0-9+]+/g, ' ').trim();
    const query = normalize(question);
    if (['hi', 'hello', 'hey', 'good morning', 'good afternoon'].includes(query)) return preview.greeting;
    if (['thanks', 'thank you', 'thank you very much'].includes(query)) return preview.thanks;
    const entry = (preview.answers || []).find(item => item.questions.some(text => normalize(text) === query));
    return entry?.answer || preview.fallback || 'This preview is not connected yet. Please use the contact details on this page.';
  }
  async function submitQuestion(question) {
    const message = question.trim();
    if (busy || !message) return;
    if (message.length > 600) { status.textContent = 'Please keep your question to 600 characters.'; return; }
    const run = generation;
    addMessage(message, 'user');
    input.value = '';
    setBusy(true);
    let timeout;
    let timedOut = false;
    try {
      if (endpointError) throw endpointError;
      let result;
      if (!apiUrl) {
        result = { reply: savedReply(message), mode: 'preview' };
      } else {
        setMode('pending');
        const url = new URL(apiUrl);
        const controller = new AbortController();
        activeController = controller;
        timeout = window.setTimeout(() => { timedOut = true; controller.abort(); }, config.requestTimeoutMs || 25000);
        const response = await fetch(url.href, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, history: history.slice(-6) }),
          signal: controller.signal, credentials: 'omit', cache: 'no-store',
        });
        let data = null;
        try { data = await response.json(); } catch { /* Handle HTML/empty errors by status below. */ }
        if (!response.ok) {
          const fallback = response.status === 404
            ? 'The assistant endpoint was not found. Please use the contact details on this page.'
            : response.status === 403
            ? 'The assistant could not accept a request from this page. Please use the contact details on this page.'
            : response.status === 405
            ? 'This server is not accepting chat requests. Please use the contact details on this page.'
            : response.status === 429
            ? 'Too many requests. Please try again in a minute.'
            : 'The assistant is temporarily unavailable. Please try again.';
          const error = new Error(typeof data?.error === 'string' && data.error.length <= 300 ? data.error : fallback);
          error.status = response.status;
          error.code = typeof data?.code === 'string' && /^[a-z_]{1,48}$/.test(data.code) ? data.code : 'http_error';
          throw error;
        }
        if (!data || typeof data.reply !== 'string' || !data.reply.trim() || data.reply.length > 5000 || !['gemini', 'preview'].includes(data.mode)) {
          const error = new Error('The assistant sent an unreadable response. Please try again.');
          error.code = 'invalid_api_response';
          throw error;
        }
        result = data;
      }
      if (run !== generation) return;
      addMessage(result.reply, 'assistant');
      setMode(result.mode);
      history = [...history, message].slice(-6);
    } catch (error) {
      if (run !== generation) return;
      let text = error.message || 'The assistant could not connect. Please try again.';
      if (timedOut) text = 'The assistant took too long to respond. Please try again.';
      else if (error instanceof TypeError) text = 'The live assistant is unavailable. Please try again or use the contact details on this page.';
      setMode('unavailable');
      // Developer diagnostics only: never log visitor messages, keys or server bodies.
      console.warn('[portfolio-chat] Request failed.', {
        code: timedOut ? 'request_timeout' : (error.code || (error instanceof TypeError ? 'network_or_cors' : 'configuration_error')),
        status: error.status || null,
        endpoint: apiUrl ? new URL(apiUrl).origin + new URL(apiUrl).pathname : '(not configured)',
        origin: window.location.origin,
        help: 'Check the full API route/stage, API Gateway CORS, Lambda ALLOWED_ORIGINS, and browser Network/Console. See docs/TROUBLESHOOTING.md. On localhost, use npm start, not a static Live Server.',
      });
      addMessage(text, 'assistant', true);
      // Preserve the failed question for a retry. Never pretend a failed live call was AI output.
      input.value = message;
    } finally {
      window.clearTimeout(timeout);
      if (run === generation) { activeController = null; setBusy(false); }
    }
  }
  form.addEventListener('submit', event => { event.preventDefault(); void submitQuestion(input.value); });
  suggestions.forEach(button => button.addEventListener('click', () => { void submitQuestion(button.dataset.question); }));
  reset.addEventListener('click', () => {
    generation += 1;
    activeController?.abort();
    activeController = null;
    history = [];
    log.replaceChildren();
    addMessage(welcome, 'assistant');
    setMode(endpointError ? 'unavailable' : apiUrl ? 'pending' : 'preview');
    input.value = '';
    setBusy(false);
    input.focus({ preventScroll: true });
  });
})();
