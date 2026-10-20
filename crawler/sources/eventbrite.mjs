// Eventbrite: public search pages (schema.org ItemList) for hackathons and startup events.
import { getText, jsonLd, sleep } from '../lib/http.mjs';
import { BAY_CITY_RE } from '../lib/classify.mjs';

const SEARCHES = [
  'ca--san-francisco/hackathon',
  'ca--palo-alto/hackathon',
  'ca--san-jose/hackathon',
  'ca--berkeley/hackathon',
  'ca--san-francisco/demo-day',
  'ca--san-francisco/startup-pitch',
  'ca--palo-alto/startup',
  'ca--san-francisco/ai-hackathon',
];

export async function crawlEventbrite() {
  const items = new Map();
  for (const s of SEARCHES) {
    try {
      const html = await getText(`https://www.eventbrite.com/d/${s}/`, { retries: 0 });
      for (const b of jsonLd(html)) {
        for (const li of b.itemListElement || []) {
          const it = li.item || li;
          if (it?.url) items.set(it.url.split('?')[0], it);
        }
      }
    } catch {}
    await sleep(500);
  }
  const events = [];
  for (const [url, it] of items) {
    const loc = it.location || {};
    const addr = loc.address || {};
    const locText = `${loc.name || ''} ${addr.addressLocality || ''} ${addr.addressRegion || ''}`;
    if (!BAY_CITY_RE.test(locText)) continue;
    const idm = url.match(/-(\d{9,})$/);
    events.push({
      id: `eventbrite:${idm ? idm[1] : url}`,
      source: 'eventbrite',
      title: (it.name || '').trim(),
      url,
      start: it.startDate,
      end: it.endDate,
      dateOnly: !/T/.test(it.startDate || ''),
      city: addr.addressLocality || null,
      venue: loc.name || null,
      organizer: it.organizer?.name || null,
      hosts: it.organizer?.name ? [{ name: it.organizer.name }] : [],
      image: it.image || null,
      blurb: (it.description || '').slice(0, 240),
      access: { kind: 'rsvp', labelOverride: 'Get tickets / RSVP on Eventbrite' },
    });
  }
  return { events, stats: { scanned: items.size } };
}
