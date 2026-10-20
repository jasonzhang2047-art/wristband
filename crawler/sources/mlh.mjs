// MLH: official student hackathon season listings.
import { getText } from '../lib/http.mjs';
import { BAY_CITY_RE } from '../lib/classify.mjs';

export async function crawlMLH({ now }) {
  const d = new Date(now);
  const season = d.getUTCMonth() >= 6 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();
  const html = await getText(`https://www.mlh.com/seasons/${season}/events`);
  const m = html.match(/<script data-page="app" type="application\/json">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('MLH page format changed');
  const props = JSON.parse(m[1]).props;
  const all = [...(props.upcomingEvents || []), ...(props.pastEvents || [])];
  const events = all
    .filter((e) => e.formatType !== 'digital')
    .filter((e) => {
      const v = e.venueAddress || {};
      return /^(ca|california)$/i.test(v.state || '') && BAY_CITY_RE.test(`${v.city || ''} ${e.location || ''}`);
    })
    .map((e) => ({
      id: `mlh:${e.slug}`,
      source: 'mlh',
      title: e.name.trim(),
      url: e.websiteUrl || `https://www.mlh.com${e.url}`,
      start: e.startsAt,
      end: e.endsAt,
      city: e.venueAddress?.city || null,
      venue: e.location || null,
      organizer: 'MLH member event',
      hosts: [],
      image: e.backgroundUrl || e.logoUrl || null,
      forceType: 'hackathon',
      themes: e.customFields?.hackathon_focus || [],
      access: { kind: 'apply', labelOverride: 'Apply on hackathon site' },
    }));
  return { events, stats: { season, scanned: all.length } };
}
