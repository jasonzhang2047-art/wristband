// Coverage cross-check: read public hackathon aggregator listings, find events we have not seen,
// and re-fetch each one from its primary platform (Luma) so every detail comes from the organizer's page.
import { getText, pool } from '../lib/http.mjs';
import { lumaEventBySlug } from './luma.mjs';

const LISTINGS = ['san-francisco', 'san-jose', 'palo-alto', 'berkeley', 'oakland', 'mountain-view', 'santa-clara', 'stanford'].map(
  (c) => `https://ushackathons.com/hackathons/${c}`
);
const MAX_DETAIL = 60;

const norm = (t) =>
  [...new Set(t.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'hackathon', 'san', 'francisco'].includes(w) && !/^20\d\d$/.test(w)))];

function looksKnown(title, knownTokenSets) {
  const t = norm(title);
  if (!t.length) return true;
  return knownTokenSets.some((k) => t.filter((w) => k.has(w)).length >= Math.max(2, Math.ceil(0.7 * t.length)));
}

export async function crawlCrossCheck({ knownTitles, knownLumaSlugs }) {
  const known = knownTitles.map((t) => new Set(norm(t)));
  const cards = new Map();
  for (const url of LISTINGS) {
    let html;
    try {
      html = await getText(url, { retries: 0 });
    } catch {
      continue;
    }
    for (const m of html.matchAll(/<a class="card-link" href="([^"]+)"([\s\S]*?)<\/a>/g)) {
      const body = m[2];
      if (/class="status ended"/.test(body)) continue;
      const title = body.match(/<h3[^>]*>([\s\S]*?)<\/h3>/)?.[1]?.replace(/<[^>]+>/g, '').trim();
      if (!title || looksKnown(title, known)) continue;
      cards.set(m[1], title);
    }
  }
  const todo = [...cards.entries()].slice(0, MAX_DETAIL);
  const found = await pool(todo, 4, async ([href]) => {
    const html = await getText(`https://ushackathons.com${href}`, { retries: 0 });
    const slug = html.match(/(?:lu\.ma|luma\.com)\/([A-Za-z0-9_-]{4,})/)?.[1];
    if (!slug || knownLumaSlugs.has(slug)) return null;
    const ev = await lumaEventBySlug(slug, 'crosscheck');
    if (ev) ev.foundVia = 'Hackathon listing cross-check';
    return ev;
  });
  const events = found.filter((e) => e && !e.error && !e.online);
  return { events, stats: { unmatchedCards: cards.size, checked: todo.length, recovered: events.length } };
}
