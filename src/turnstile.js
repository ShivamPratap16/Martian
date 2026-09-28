// Cloudflare Turnstile: an invisible bot check before a free claim. Does nothing until
// VITE_TURNSTILE_SITE_KEY is set (and the claim function only verifies when its
// TURNSTILE_SECRET is set), so the two can be switched on together.

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;
let ready = null;

function load() {
  ready ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve(window.turnstile);
    s.onerror = () => reject(new Error('Could not load the bot check. Check your connection.'));
    document.head.appendChild(s);
  });
  return ready;
}

export async function getTurnstileToken() {
  if (!SITE_KEY) return null;
  const turnstile = await load();
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;bottom:12px;right:12px;z-index:50';
  document.body.appendChild(host);
  try {
    return await new Promise((resolve, reject) => {
      turnstile.render(host, {
        sitekey: SITE_KEY,
        appearance: 'interaction-only', // only visible if Cloudflare needs the visitor to click
        callback: resolve,
        'error-callback': () => reject(new Error('Bot check failed. Please try again.')),
      });
    });
  } finally {
    setTimeout(() => host.remove(), 500);
  }
}
