// Meetup: keyword searches around SF and the South Bay (Next.js Apollo state).
import { getText, sleep } from '../lib/http.mjs';

const SEARCHES = [
  ['hackathon', 'us--ca--San Francisco'],
  ['hackathon', 'us--ca--San Jose'],
  ['startup founders', 'us--ca--San Francisco'],
  ['startup', 'us--ca--Palo Alto'],
  ['AI builders', 'us--ca--San Francisco'],
];

export async function crawlMeetup() {
  const found = new Map();
  const errors = [];
  for (const [kw, loc] of SEARCHES) {
    try {
      const html = await getText(
        `https://www.meetup.com/find/?keywords=${encodeURIComponent(kw)}&location=${encodeURIComponent(loc)}&source=EVENTS&eventType=inPerson`,
        { retries: 0 }
      );
      const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
      if (!m) continue;
      const ap = JSON.parse(m[1]).props?.pageProps?.__APOLLO_STATE__ || {};
      for (const [k, v] of Object.entries(ap)) {
        if (!k.startsWith('Event:') || !v.title || !v.eventUrl) continue;
        const venue = v.venue?.__ref ? ap[v.venue.__ref] : v.venue;
        const group = v.group?.__ref ? ap[v.group.__ref] : v.group;
        found.set(v.id, { v, venue, group });
      }
    } catch (e) {
      errors.push(e.message);
    }
    await sleep(600);
  }
  if (!found.size) throw new Error(errors[0] || 'no results on any search page (likely blocked)');
  const events = [];
  for (const { v, venue, group } of found.values()) {
    if (v.isOnline || v.eventType === 'ONLINE') continue;
    const city = venue?.city || null;
    events.push({
      id: `meetup:${v.id}`,
      source: 'meetup',
      title: v.title.trim(),
      url: v.eventUrl,
      start: v.dateTime,
      end: v.endTime || null,
      city,
      venue: venue?.name || null,
      lat: venue?.lat ?? null,
      lon: venue?.lon ?? venue?.lng ?? null,
      organizer: group?.name || null,
      hosts: group?.name ? [{ name: group.name }] : [],
      image: v.featuredEventPhoto?.highResUrl || null,
      guests: v.going?.totalCount || v.rsvps?.totalCount || 0,
      blurb: (v.description || '').slice(0, 240),
      access: { kind: 'rsvp', labelOverride: 'RSVP on Meetup' },
    });
  }
  return { events, stats: { scanned: found.size } };
}
