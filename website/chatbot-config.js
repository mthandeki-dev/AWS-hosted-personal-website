/* Public configuration. NEVER put a Gemini API key in this file. */
window.PORTFOLIO_CHAT_CONFIG = Object.freeze({
  // Full ChatApiUrl from AWS, including any named stage and the /api/chat route.
  // This URL matches the supplied template's $default stage. Verify your AWS route.
  apiUrl: 'https://en5vylm3ji.execute-api.eu-north-1.amazonaws.com/api/chat',
  // npm start serves the local website AND this backend on the same port.
  // Localhost deliberately does not call AWS. Set '' for a static local preview.
  localApiUrl: '/api/chat',
  requestTimeoutMs: 25000,
});
