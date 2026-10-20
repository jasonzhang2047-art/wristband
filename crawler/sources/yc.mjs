// Y Combinator: public events list + each event's application / registration deadlines.
import { getText, pool, decodeEntities } from '../lib/http.mjs';
import { BAY_CITY_RE } from '../lib/classify.mjs';

function pageProps(html) {
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) return null;
  return JSON.parse(decodeEntities(m[1])).props;
}

export async function crawlYC({ now }) {
  const props = pageProps(await getText('https://www.ycombinator.com/events'));
  if (!props) throw new Error('YC events page format changed');
  const list = (props.events || []).filter((e) => BAY_CITY_RE.test(`${e.city || ''} ${e.public_location || ''}`));

  const events = await pool(list, 3, async (e) => {
    let detail = {};
    try {
      detail = pageProps(await getText(`https://events.ycombinator.com/${e.slug}`, { retries: 0 }))?.meetup || {};
    } catch {}
    const appClose = detail.application_closes_at;
    const regClose = detail.registration_closes_at;
    const deadline = appClose || regClose || null;
    const closed = deadline && new Date(deadline) < new Date(now);
    const blurb = (detail.description || '').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').slice(0, 280);
    return {
      id: `yc:${e.slug}`,
      source: 'yc',
      title: (e.title || '').trim(),
      url: `https://events.ycombinator.com/${e.slug}`,
      start: e.starts_at,
      end: e.ends_at,
      city: (e.city || '').split(',')[0] || null,
      venue: detail.public_location || e.public_location || null,
      organizer: 'Y Combinator',
      hosts: [{ name: 'Y Combinator', x: 'ycombinator' }],
      image: e.cover_img_url || null,
      capacity: detail.capacity || null,
      forceType: detail.event_type === 'hackathon' ? 'hackathon' : undefined,
      blurb,
      access: closed
        ? { kind: 'closed', labelOverride: appClose ? 'Applications closed' : 'Registration closed', deadline }
        : appClose
          ? { kind: 'apply', labelOverride: 'Application required', deadline: appClose }
          : { kind: 'rsvp', labelOverride: 'Register with YC', deadline: regClose || null },
    };
  });
  return { events: events.filter((e) => e && !e.error), stats: { scanned: (props.events || []).length } };
}
