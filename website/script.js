/* Progressive enhancements only: the content and navigation work without JS. */
(() => {
  'use strict';
  const year = document.getElementById('current-year');
  if (year) year.textContent = String(new Date().getFullYear());

  // Clipboard access requires a supported secure context. Leave mailto and
  // selectable contact text as an accessible fallback when copying is blocked.
  const copyButton = document.getElementById('copy-email');
  const status = document.getElementById('copy-status');
  const email = 'mthandekidevi@gmail.com';
  if (copyButton && status && navigator.clipboard && window.isSecureContext) {
    copyButton.hidden = false;
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(email);
        status.textContent = 'Email copied. Ready when you are.';
        copyButton.querySelector('span').textContent = 'Copied!';
        window.setTimeout(() => {
          copyButton.querySelector('span').textContent = 'Copy email';
        }, 2500);
      } catch (error) {
        status.textContent = 'Copy is unavailable here. Select the email address, or use the email link.';
      }
    });
  }

  // Keep the navigation in step with the section currently being viewed.
  const links = Array.from(document.querySelectorAll('.nav-links a'));
  const sections = links.map(link => document.querySelector(link.getAttribute('href'))).filter(Boolean);
  if ('IntersectionObserver' in window && sections.length) {
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const link of links) {
          if (link.getAttribute('href') === '#' + entry.target.id) {
            link.setAttribute('aria-current', 'location');
          } else {
            link.removeAttribute('aria-current');
          }
        }
      }
    }, { rootMargin: '-15% 0px -45% 0px', threshold: 0 });
    sections.forEach(section => observer.observe(section));
    const hero = document.querySelector('.hero');
    if (hero) {
      const heroObserver = new IntersectionObserver(entries => {
        if (entries.some(entry => entry.isIntersecting)) {
          links.forEach(link => link.removeAttribute('aria-current'));
        }
      }, { threshold: 0.6 });
      heroObserver.observe(hero);
    }
  }
})();
