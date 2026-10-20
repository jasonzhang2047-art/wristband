// Cerebral Valley: SF AI community event + hackathon listings (schema.org JSON-LD).
import { getText, jsonLd } from '../lib/http.mjs';
import { BAY_CITY_RE } from '../lib/classify.mjs';

export async function crawlCerebralValley() {
  const pages = ['https://cerebralvalley.ai/events', 'https://cerebralvalley.ai/hackathons'];
  const items = new Map();
  for (const url of pages) {
    let html;
    try {
      html = await getText(url, { retries: 0 });
    } catch {
      continue;
    }
    for (const block of jsonLd(html)) {
      if (block['@type'] !== 'ItemList') continue;
      for (const li of block.itemListElement || []) {
        const it = li.item || li;
        if (it?.url) items.set(it.url, it);
      }
    }
  }
  const events = [];
  for (const it of items.values()) {
    const loc = it.location || {};
    const locText = `${loc.name || ''} ${loc.address?.addressLocality || ''}`;
    if (!BAY_CITY_RE.test(locText)) continue;
    const types = [].concat(it['@type'] || []);
    const organizers = [].concat(it.organizer || []).map((o) => o.name).filter(Boolean);
    const isHack = types.includes('Hackathon');
    events.push({
      id: `cv:${it.url.split('/').pop()}`,
      source: 'cerebralvalley',
      title: it.name.trim(),
      url: it.url,
      start: it.startDate,
      end: it.endDate,
      city: loc.address?.addressLocality || null,
      venue: null,
      locationHidden: true,
      organizer: organizers.join(' × ') || 'Cerebral Valley',
      hosts: organizers.map((name) => ({ name })),
      image: it.image || null,
      blurb: (it.description || '').slice(0, 280),
      forceType: isHack ? 'hackathon' : undefined,
      access: isHack
        ? { kind: 'apply', labelOverride: 'Apply · approval required', price: it.offers?.price ? `$${it.offers.price}` : null }
        : { kind: 'rsvp', price: it.offers?.price ? `$${it.offers.price}` : null },
    });
  }
  return { events, stats: { scanned: items.size } };
}
