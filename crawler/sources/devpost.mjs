// Devpost: in-person hackathons located in the Bay Area.
import { getJSON, getText, pool, sleep, stripTags } from '../lib/http.mjs';
import { BAY_CITY_RE } from '../lib/classify.mjs';

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// "Oct 23 - 25, 2026" | "Sep 20 - Oct 23, 2026" | "Nov 21, 2026" | "Jul 18, 2026 - Jan 14, 2027"
export function parseDevpostRange(s) {
  const parts = s.split(/\s+-\s+/);
  const parse = (p) => {
    const m = p.match(/([A-Za-z]{3})?\s*(\d{1,2})(?:,\s*(\d{4}))?/);
    if (!m) return null;
    return { mon: m[1] ? MONTHS[m[1].toLowerCase()] : undefined, day: +m[2], year: m[3] ? +m[3] : undefined };
  };
  const a = parse(parts[0]);
  const b = parts.length > 1 ? parse(parts[parts.length - 1]) : { ...a };
  if (!a || !b) return null;
  if (b.mon == null) b.mon = a.mon;
  if (a.mon == null || b.year == null) return null;
  if (a.year == null) a.year = a.mon > b.mon ? b.year - 1 : b.year;
  // Pacific noon keeps the date stable across time zones.
  const iso = (d) => new Date(Date.UTC(d.year, d.mon, d.day, 19)).toISOString();
  return { start: iso(a), end: iso(b) };
}

export async function crawlDevpost() {
  const queries = ['San Francisco', 'Bay Area', 'Silicon Valley', 'Stanford', 'Berkeley', 'Palo Alto', 'San Jose', 'Santa Clara', 'Mountain View', 'Oakland', 'California'];
  const found = new Map();
  for (const q of queries) {
    for (let page = 1; page <= 3; page++) {
      const d = await getJSON(
        `https://devpost.com/api/hackathons?search=${encodeURIComponent(q)}&status[]=upcoming&status[]=open&per_page=50&page=${page}`
      );
      for (const h of d.hackathons || []) found.set(h.id, h);
      if ((d.hackathons || []).length < 50) break;
      await sleep(300);
    }
  }

  const candidates = [...found.values()].filter((h) => !/online/i.test(h.displayed_location?.location || '') || /\+/.test(h.displayed_location?.location || ''));
  // Location strings are often just a venue name, so confirm on the hackathon page when needed.
  const checked = await pool(candidates, 4, async (h) => {
    const loc = h.displayed_location?.location || '';
    if (BAY_CITY_RE.test(loc) || /palace of fine arts|moscone|fort mason|pier \d+/i.test(loc)) return { h, ok: true };
    try {
      // The venue link on the hackathon page carries the full street address.
      const html = await getText(h.url, { timeout: 15000, retries: 0 });
      const q = html.match(/maps\.google\.com\/\?q=([^"&]+)/);
      const address = q ? decodeURIComponent(q[1].replace(/\+/g, ' ')) : '';
      return { h, ok: BAY_CITY_RE.test(address), address };
    } catch {
      return { h, ok: false };
    }
  });

  const events = [];
  for (const r of checked) {
    if (!r?.ok) continue;
    const h = r.h;
    let dates = null;
    try {
      dates = parseDevpostRange(h.submission_period_dates || '');
    } catch {}
    if (!dates) continue;
    const prize = stripTags(h.prize_amount || '').replace(/\s+/g, ' ');
    events.push({
      id: `devpost:${h.id}`,
      source: 'devpost',
      title: h.title.trim(),
      url: h.url,
      start: dates.start,
      end: dates.end,
      dateOnly: true,
      city: null,
      venue: [h.displayed_location?.location, r.address].filter(Boolean).join(' · ') || null,
      organizer: h.organization_name || null,
      hosts: [],
      image: h.thumbnail_url ? (h.thumbnail_url.startsWith('//') ? 'https:' + h.thumbnail_url : h.thumbnail_url) : null,
      guests: h.registrations_count || 0,
      prize: prize && prize !== '0' ? prize : null,
      themes: (h.themes || []).map((t) => t.name),
      forceType: 'hackathon',
      access: h.invite_only
        ? { kind: 'apply', labelOverride: 'Invite only' }
        : { kind: 'rsvp', labelOverride: 'Register on Devpost' },
      blurb: h.time_left_to_submission || '',
    });
  }
  return { events, stats: { scanned: found.size } };
}
