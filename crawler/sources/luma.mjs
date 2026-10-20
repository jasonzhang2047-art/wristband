// Luma: map discovery around the Bay Area + watched calendars + watched hosts.
import { getJSON, pool, sleep } from '../lib/http.mjs';
import { inBayBox } from '../lib/classify.mjs';

const API = 'https://api.lu.ma';
const CENTERS = [
  { lat: 37.55, lon: -122.2 }, // mid-Peninsula; Luma's radius covers SF → San Jose → Oakland
];

function money(ti) {
  if (!ti || ti.is_free) return null;
  const p = ti.price || ti.max_price;
  if (!p) return 'Paid';
  const cents = p.cents ?? p.amount;
  const cur = (p.currency || 'usd').toUpperCase();
  if (cents == null) return 'Paid';
  const v = cents / 100;
  return `${cur === 'USD' ? '$' : cur + ' '}${Number.isInteger(v) ? v : v.toFixed(2)}`;
}

export function normalizeLuma(entry, via) {
  const ev = entry.event || entry;
  const geo = ev.geo_address_info || {};
  const coord = ev.coordinate || geo.place_coordinate || {};
  const ti = entry.ticket_info || {};
  const avail = entry.registration_availability;
  let kind = 'rsvp';
  let labelOverride;
  if (avail === 'sold-out' || ti.is_sold_out) kind = entry.waitlist_active || ev.waitlist_status === 'active' ? 'waitlist' : 'closed';
  else if (avail === 'waitlist') kind = 'waitlist';
  else if (ti.require_approval) {
    kind = 'apply';
    labelOverride = 'Request to join · host approves';
  } else if (!ti.is_free && (ti.price || ti.max_price)) kind = 'ticket';
  if (kind === 'closed') labelOverride = 'Sold out';

  const hosts = (entry.hosts || []).map((h) => ({ name: h.name || [h.first_name, h.last_name].filter(Boolean).join(' '), x: h.twitter_handle || null, id: h.api_id }));
  const cal = entry.calendar || {};
  const calName = cal.name && cal.name !== 'Personal' ? cal.name : null;
  return {
    id: `luma:${ev.api_id}`,
    source: 'luma',
    via,
    title: (ev.name || '').trim(),
    url: `https://luma.com/${ev.url}`,
    start: ev.start_at,
    end: ev.end_at,
    tz: ev.timezone,
    city: geo.city || null,
    venue: ev.geo_address_visibility === 'public' ? geo.address || geo.short_address || null : null,
    locationHidden: ev.geo_address_visibility !== 'public',
    neighborhood: geo.sublocality || null,
    lat: coord.latitude ?? null,
    lon: coord.longitude ?? null,
    online: ev.location_type === 'online',
    organizer: calName || hosts.slice(0, 2).map((h) => h.name).join(', '),
    calendar: calName,
    calendarId: cal.api_id || ev.calendar_api_id,
    hosts,
    image: ev.cover_url || null,
    guests: entry.guest_count || 0,
    access: {
      kind,
      labelOverride,
      price: money(ti),
      spots: ti.spots_remaining ?? null,
      nearCapacity: !!ti.is_near_capacity,
    },
  };
}

async function paginate(urlFor, maxPages = 40) {
  const out = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const d = await getJSON(urlFor(cursor));
    out.push(...(d.entries || []));
    if (!d.has_more || !d.next_cursor) break;
    cursor = d.next_cursor;
    await sleep(250);
  }
  return out;
}

export async function crawlLuma({ watchlist, learned }) {
  const byId = new Map();
  const add = (entries, via) => {
    for (const e of entries) {
      const n = normalizeLuma(e, via);
      if (n.online) continue;
      const inBay = n.lat != null ? inBayBox(n.lat, n.lon) : /CA|California/.test(e.event?.geo_address_info?.region || '');
      if (!inBay) continue;
      if (!byId.has(n.id)) byId.set(n.id, n);
    }
  };

  // 1. Map discovery (every public in-person event Luma lists for the region)
  for (const c of CENTERS) {
    const entries = await paginate((cur) => `${API}/discover/get-paginated-events?latitude=${c.lat}&longitude=${c.lon}&pagination_limit=100${cur ? `&pagination_cursor=${cur}` : ''}`);
    add(entries, 'luma-map');
  }
  const mapCount = byId.size;

  // 2. Featured SF city page
  const featured = await paginate((cur) => `${API}/discover/get-paginated-events?slug=sf&pagination_limit=100${cur ? `&pagination_cursor=${cur}` : ''}`, 5);
  add(featured, 'luma-featured');

  // 3. Calendars: configured + learned. Luma's map leaves out many public events, so following the
  //    calendars behind relevant events is what closes the gap. Watched-org calendars also give recent past.
  const watchedCals = new Set([...watchlist.orgs.flatMap((o) => o.luma || []), ...(learned.lumaCalendars || []).filter((c) => c.org).map((c) => c.id)]);
  const calIds = new Set([...watchedCals, ...(learned.lumaCalendars || []).map((c) => c.id)]);
  const past = [];
  await pool([...calIds], 6, async (id) => {
    const fut = await paginate((cur) => `${API}/calendar/get-items?calendar_api_id=${id}&period=future&pagination_limit=50${cur ? `&pagination_cursor=${cur}` : ''}`, 3);
    add(fut, 'luma-calendar');
    if (watchedCals.has(id)) {
      const p = await getJSON(`${API}/calendar/get-items?calendar_api_id=${id}&period=past&pagination_limit=15`);
      past.push(...(p.entries || []));
    }
  });
  add(past, 'luma-calendar-past');

  // 4. Watched people and frequent hosts with known Luma profiles: events they host
  const people = (learned.lumaUsers || []).slice(0, 160);
  await pool(people, 6, async (u) => {
    const d = await getJSON(`${API}/user/profile/events-hosting?user_api_id=${u.id}&pagination_limit=30`);
    add(d.entries || [], 'luma-host');
  });

  return { events: [...byId.values()], stats: { map: mapCount, calendars: calIds.size, people: people.length } };
}

// Resolve a Luma short link (e.g. "beta-79jb") to a normalized event, or null.
export async function lumaEventBySlug(slug, via = 'luma-link') {
  const d = await getJSON(`${API}/url?url=${encodeURIComponent(slug)}`);
  if (d.kind !== 'event' || !d.data?.event) return null;
  const n = normalizeLuma(d.data, via);
  if (d.data.registration_questions?.length && n.access.kind === 'apply') n.access.labelOverride = 'Application form · host approves';
  return n;
}
