// Stanford: official university calendar (Localist API), entrepreneurship-related keywords.
import { getJSON } from '../lib/http.mjs';

const KEYWORDS = ['entrepreneurship', 'startup', 'startups', 'hackathon', 'venture capital', 'pitch', 'demo day', 'founders', 'innovation', 'StartX', 'BASES', 'STVP', 'artificial intelligence'];

export async function crawlStanford() {
  const seen = new Map();
  for (const k of KEYWORDS) {
    const d = await getJSON(`https://events.stanford.edu/api/2/events?days=120&pp=100&keyword=${encodeURIComponent(k)}`);
    for (const w of d.events || []) seen.set(w.event.id, w.event);
  }
  const events = [];
  for (const e of seen.values()) {
    if (e.experience === 'virtual') continue;
    const inst = e.event_instances?.[0]?.event_instance;
    if (!inst) continue;
    const dept = (e.departments || []).map((d) => d.name).join(', ');
    const ticket = e.ticket_url;
    const isLuma = /lu\.ma|luma\.com/.test(ticket || '');
    events.push({
      id: `stanford:${e.id}`,
      source: 'stanford',
      title: e.title.trim(),
      url: e.localist_url,
      registerUrl: ticket || null,
      start: inst.start,
      end: inst.end || null,
      dateOnly: !!inst.all_day,
      city: 'Stanford',
      venue: [e.location_name, e.room_number].filter(Boolean).join(', ') || null,
      organizer: dept || 'Stanford University',
      hosts: (e.departments || []).map((d) => ({ name: d.name })),
      image: e.photo_url || null,
      blurb: `${(e.description_text || '').slice(0, 240)} ${dept} Stanford`,
      lumaUrl: isLuma ? ticket : null,
      access: ticket
        ? { kind: e.free === false ? 'ticket' : 'rsvp', labelOverride: e.ticket_cost && e.ticket_cost.length < 40 ? e.ticket_cost : 'Register' }
        : { kind: 'open', labelOverride: 'Open · check event page' },
    });
  }
  return { events, stats: { scanned: seen.size } };
}
