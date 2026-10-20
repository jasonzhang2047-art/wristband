// Small fetch helpers: browser-like UA, timeout, one retry, polite pacing.
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, { timeout = 20000, retries = 1, headers = {} } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(url, {
        headers: { 'user-agent': UA, accept: '*/*', 'accept-language': 'en-US,en;q=0.9', ...headers },
        redirect: 'follow',
        signal: ctrl.signal,
      });
      if (res.status === 429 || res.status >= 500) throw new Error(`HTTP ${res.status}`);
      if (!res.ok) {
        const e = new Error(`HTTP ${res.status}`);
        e.fatal = true;
        throw e;
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e.fatal) break;
      await sleep(1200 * (attempt + 1));
    } finally {
      clearTimeout(t);
    }
  }
  throw new Error(`${lastErr?.message || 'fetch failed'} — ${url}`);
}

export async function getJSON(url, opts) {
  const res = await get(url, { ...opts, headers: { accept: 'application/json', ...(opts?.headers || {}) } });
  return res.json();
}

export async function getText(url, opts) {
  const res = await get(url, opts);
  return res.text();
}

// Run async fn over items with limited concurrency.
export async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      try {
        out[idx] = await fn(items[idx], idx);
      } catch (e) {
        out[idx] = { error: e };
      }
    }
  });
  await Promise.all(workers);
  return out;
}

export function decodeEntities(s = '') {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .replace(/&amp;/g, '&');
}

export const stripTags = (s = '') => decodeEntities(String(s).replace(/<[^>]+>/g, '')).trim();

// Pull every <script type="application/ld+json"> block out of a page.
export function jsonLd(html) {
  const out = [];
  const re = /<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {}
  }
  return out;
}
