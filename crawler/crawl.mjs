#!/usr/bin/env node
// Crawl every source, classify, de-duplicate, merge with the previous run and write site/events.json.
// Usage: node crawler/crawl.mjs [--only luma,yc] [--interval 6]
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classify, compileWatchlist, areaFor, accessLabel } from './lib/classify.mjs';
import { crawlLuma, lumaEventBySlug } from './sources/luma.mjs';
import { crawlCrossCheck } from './sources/crosscheck.mjs';
import { crawlDevpost } from './sources/devpost.mjs';
import { crawlMLH } from './sources/mlh.mjs';
import { crawlYC } from './sources/yc.mjs';
import { crawlCerebralValley } from './sources/cerebral.mjs';
import { crawlStanford } from './sources/stanford.mjs';
import { crawlEventbrite } from './sources/eventbrite.mjs';
import { crawlMeetup } from './sources/meetup.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'events.json');
const LEARNED = join(ROOT, 'data', 'learned.json');
const CURATED = join(ROOT, 'data', 'curated.json');
const KEEP_PAST_DAYS = 21;
const DROP_AFTER_MISSES = 3;

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const intervalHours = args.includes('--interval') ? +args[args.indexOf('--interval') + 1] : 6;

const SOURCES = [
  { id: 'luma', name: 'Luma', home: 'https://luma.com/sf', run: crawlLuma, rank: 2 },
  { id: 'yc', name: 'Y Combinator', home: 'https://www.ycombinator.com/events', run: crawlYC, rank: 1 },
  { id: 'cerebralvalley', name: 'Cerebral Valley', home: 'https://cerebralvalley.ai/events', run: crawlCerebralValley, rank: 3 },
  { id: 'mlh', name: 'MLH', home: 'https://www.mlh.com/seasons', run: crawlMLH, rank: 4 },
  { id: 'devpost', name: 'Devpost', home: 'https://devpost.com/hackathons', run: crawlDevpost, rank: 5 },
  { id: 'stanford', name: 'Stanford Events', home: 'https://events.stanford.edu', run: crawlStanford, rank: 6 },
  { id: 'meetup', name: 'Meetup', home: 'https://www.meetup.com', run: crawlMeetup, rank: 8 },
  { id: 'eventbrite', name: 'Eventbrite', home: 'https://www.eventbrite.com', run: crawlEventbrite, rank: 9 },
];
const RANK = Object.fromEntries([...SOURCES.map((s) => [s.id, s.rank]), ['curated', 7], ['crosscheck', 2]]);

const readJSON = async (p, fallback) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return fallback;
  }
};

const dayKey = (iso) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date(iso));
const normTitle = (t) =>
  t
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\b(the|a|an|20\d\d|sf|san francisco)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

async function curatedEvents(curated) {
  const out = [];
  for (const c of curated.items || []) {
    if ((c.kind && c.kind !== 'event') || !c.url) continue;
    // A bare Luma link is enough: details are fetched from Luma itself.
    const slug = c.url.match(/(?:lu\.ma|luma\.com)\/([A-Za-z0-9_-]{4,})$/)?.[1];
    if (slug && !c.title) {
      try {
        const ev = await lumaEventBySlug(slug, 'sweep');
        if (ev) out.push({ ...ev, foundVia: c.foundVia || 'Web & social sweep', evidence: c.sourceUrl || null });
      } catch {}
      continue;
    }
    if (!c.title || !c.start) continue;
    out.push({
      id: c.id || `curated:${normTitle(c.title).replace(/ /g, '-').slice(0, 60)}-${dayKey(c.start)}`,
      source: 'curated',
      title: c.title,
      url: c.url,
      start: c.start,
      end: c.end || null,
      dateOnly: !!c.dateOnly,
      city: c.city || null,
      venue: c.venue || null,
      organizer: c.organizer || null,
      hosts: (c.hosts || []).map((name) => (typeof name === 'string' ? { name } : name)),
      image: c.image || null,
      blurb: c.note || '',
      forceType: c.type,
      foundVia: c.foundVia || 'Web & social sweep',
      evidence: c.sourceUrl || null,
      access: c.access || { kind: 'rsvp' },
    });
  }
  return out;
}

async function main() {
  const now = Date.now();
  const watchlist = JSON.parse(await readFile(join(ROOT, 'crawler', 'watchlist.json'), 'utf8'));
  const cw = compileWatchlist(watchlist);
  const learned = await readJSON(LEARNED, { lumaCalendars: [], lumaUsers: [] });
  const curated = await readJSON(CURATED, { items: [] });
  const prev = await readJSON(OUT, { events: [], sources: [] });

  // 1. Run sources concurrently, isolating failures.
  const ctx = { now, watchlist, learned };
  const results = await Promise.all(
    SOURCES.filter((s) => !only || only.includes(s.id)).map(async (s) => {
      const t0 = Date.now();
      try {
        const r = await s.run(ctx);
        return { ...s, ok: true, ms: Date.now() - t0, raw: r.events, stats: r.stats };
      } catch (e) {
        return { ...s, ok: false, ms: Date.now() - t0, raw: [], error: String(e.message || e).slice(0, 200) };
      }
    })
  );
  // Phase 2: cross-check public hackathon listings for anything the platform feeds missed.
  if (!only || only.includes('crosscheck')) {
    const seenRaw = results.flatMap((r) => r.raw);
    const t0 = Date.now();
    try {
      const r = await crawlCrossCheck({
        knownTitles: seenRaw.map((e) => e.title),
        knownLumaSlugs: new Set(seenRaw.filter((e) => e.source === 'luma').map((e) => e.url.split('/').pop())),
      });
      results.push({ id: 'crosscheck', name: 'Listing cross-check', home: 'https://ushackathons.com/hackathons/san-francisco', ok: true, ms: Date.now() - t0, raw: r.events, stats: r.stats });
    } catch (e) {
      results.push({ id: 'crosscheck', name: 'Listing cross-check', ok: false, ms: Date.now() - t0, raw: [], error: String(e.message || e).slice(0, 200) });
    }
  }
  const okSources = new Set(results.filter((r) => r.ok).map((r) => r.id));
  okSources.add('curated');

  // 2. Classify + place.
  const raw = [...results.flatMap((r) => r.raw), ...(await curatedEvents(curated))];
  const kept = [];
  const perSource = {};
  for (const ev of raw) {
    // Date-only strings parse as UTC midnight (the previous day in California); pin them to Pacific noon.
    for (const k of ['start', 'end']) if (/^\d{4}-\d{2}-\d{2}$/.test(ev[k] || '')) (ev[k] = `${ev[k]}T12:00:00-08:00`), (ev.dateOnly = true);
    if (!ev.title || !ev.start || isNaN(new Date(ev.start))) continue;
    if (new Date(ev.end || ev.start).getTime() < now - KEEP_PAST_DAYS * 864e5) continue;
    const area = areaFor({ city: ev.city, lat: ev.lat, lon: ev.lon, text: `${ev.venue || ''} ${ev.title}` });
    if (!area) continue;
    const c = classify(ev, cw);
    if (!c.relevant && ev.source !== 'curated') continue;
    ev.area = area;
    Object.assign(ev, { type: c.primary || ev.forceType || 'founder', tags: c.tags, watched: c.watched, score: c.score });
    const bucket = ev.via === 'crosscheck' ? 'crosscheck' : ev.source;
    perSource[bucket] = (perSource[bucket] || 0) + 1;
    kept.push(ev);
  }

  // 3. De-duplicate across sources (same normalized title on the same Pacific day, or same Luma link).
  const groups = new Map();
  const byDay = new Map(); // day → groups, for fuzzy title matching
  const tokens = (t) => new Set(normTitle(t).split(' ').filter((w) => w.length > 1));
  const similar = (a, b) => {
    const A = tokens(a), B = tokens(b);
    const inter = [...A].filter((w) => B.has(w)).length;
    return inter / Math.min(A.size, B.size) >= 0.8 && inter >= 3;
  };
  for (const ev of kept) {
    const day = dayKey(ev.start);
    const keys = [`${normTitle(ev.title)}|${day}`];
    if (ev.lumaUrl) keys.push(ev.lumaUrl.replace('lu.ma', 'luma.com').split('?')[0]);
    if (ev.source === 'luma') keys.push(ev.url);
    const hit =
      keys.map((k) => groups.get(k)).find(Boolean) ||
      (byDay.get(day) || []).find((g) => g.base.source !== ev.source && similar(g.base.title, ev.title));
    if (!hit) {
      const g = { base: ev, also: [] };
      keys.forEach((k) => groups.set(k, g));
      byDay.set(day, [...(byDay.get(day) || []), g]);
      continue;
    }
    keys.forEach((k) => groups.set(k, hit));
    const [winner, loser] = RANK[ev.source] < RANK[hit.base.source] ? [ev, hit.base] : [hit.base, ev];
    hit.also.push({ source: loser.source, url: loser.url });
    winner.watched = [...new Map([...(winner.watched || []), ...(loser.watched || [])].map((w) => [w.name, w])).values()];
    winner.tags = [...new Set([...(winner.tags || []), ...(loser.tags || [])])];
    winner.guests = Math.max(winner.guests || 0, loser.guests || 0);
    winner.prize = winner.prize || loser.prize;
    winner.score = Math.max(winner.score, loser.score);
    if (!winner.access?.deadline && loser.access?.deadline) winner.access.deadline = loser.access.deadline;
    hit.base = winner;
  }
  const fresh = new Map();
  for (const g of new Set(groups.values())) {
    const e = g.base;
    e.alsoOn = g.also.filter((a) => a.url !== e.url);
    fresh.set(e.id, e);
  }

  // 4. Merge with history: first-seen timestamps, keep events a failed source could not refresh.
  const prevById = new Map((prev.events || []).map((e) => [e.id, e]));
  const out = [];
  for (const e of fresh.values()) {
    const p = prevById.get(e.id);
    out.push(shape(e, { firstSeen: p?.firstSeen || new Date(now).toISOString(), lastSeen: new Date(now).toISOString(), misses: 0 }));
    prevById.delete(e.id);
  }
  const rawIds = new Set(raw.map((e) => e.id));
  for (const p of prevById.values()) {
    if (rawIds.has(p.id)) continue; // fetched again but no longer passes the filters
    const endT = new Date(p.end || p.start).getTime();
    if (endT < now - KEEP_PAST_DAYS * 864e5) continue;
    const past = endT < now;
    if (past) {
      out.push(p); // finished events stay for the "just happened" view
      continue;
    }
    if (!okSources.has(p.source)) {
      out.push(p);
      continue;
    }
    const misses = (p.misses || 0) + 1;
    if (misses < DROP_AFTER_MISSES) out.push({ ...p, misses });
  }
  out.sort((a, b) => new Date(a.start) - new Date(b.start));

  // Corrections from the sweep (e.g. an application window the platform feed doesn't show).
  for (const o of (curated.items || []).filter((c) => c.kind === 'override')) {
    const e = out.find((x) => x.id === o.id);
    if (!e) continue;
    if (o.access) {
      e.access = { ...e.access, ...o.access, label: accessLabel(o.access) };
      delete e.access.labelOverride;
    }
    if (o.note) e.note = o.note;
    if (o.sourceUrl) e.evidence = o.sourceUrl;
  }

  // 5. Learn: follow the Luma calendars and hosts behind relevant events. Luma's map omits many public
  //    events, so these feeds are what keep coverage complete on the next run.
  const iso = new Date(now).toISOString();
  const calMap = new Map((learned.lumaCalendars || []).map((c) => [c.id, c]));
  const userMap = new Map((learned.lumaUsers || []).map((u) => [u.id, u]));
  const hostTally = new Map();
  const configured = new Set(watchlist.orgs.flatMap((o) => o.luma || []));
  const strong = (e) => ['hackathon', 'demo', 'program', 'vc', 'school', 'founder'].includes(e.type) || e.watched?.length;
  for (const e of kept) {
    if (e.source !== 'luma') continue;
    if (e.calendarId && e.calendar && !configured.has(e.calendarId) && strong(e)) {
      const org = cw.orgs.find((o) => o.res.some((re) => re.test(e.calendar)));
      const c = calMap.get(e.calendarId) || { id: e.calendarId, name: e.calendar, learnedAt: iso, hits: 0 };
      c.hits = (c.hits || 0) + (e.type === 'hackathon' ? 3 : 1);
      c.lastRelevantAt = iso;
      if (org) c.org = org.name;
      calMap.set(e.calendarId, c);
    }
    for (const h of e.hosts || []) {
      if (!h.id) continue;
      const t = hostTally.get(h.id) || { id: h.id, name: h.name, x: h.x, events: 0, hack: 0 };
      t.events++;
      if (e.type === 'hackathon' || e.type === 'demo') t.hack++;
      hostTally.set(h.id, t);
      const person = cw.people.find((p) => (p.handle && (h.x || '').toLowerCase() === p.handle) || p.nameRe.test(h.name || ''));
      if (person) userMap.set(h.id, { id: h.id, name: h.name, x: h.x, watched: person.name, lastRelevantAt: iso });
    }
  }
  const activeHosts = [...hostTally.values()]
    .filter((h) => h.events >= 2 && h.name && !/^(luma|admin|ops|team)$/i.test(h.name))
    .sort((a, b) => b.hack * 3 + b.events - (a.hack * 3 + a.events))
    .slice(0, 40);
  for (const h of hostTally.values()) {
    if (h.hack >= 1 || h.events >= 2) userMap.set(h.id, { ...(userMap.get(h.id) || {}), id: h.id, name: h.name, x: h.x, lastRelevantAt: iso });
  }
  const fresh60 = (x) => !x.lastRelevantAt || now - new Date(x.lastRelevantAt).getTime() < 60 * 864e5 || x.org || x.watched;
  const rankCal = (c) => (c.org ? 1000 : 0) + (c.hits || 0);
  const rankUser = (u) => (u.watched ? 1000 : 0) + (hostTally.get(u.id)?.hack || 0) * 3 + (hostTally.get(u.id)?.events || 0);
  await mkdir(join(ROOT, 'data'), { recursive: true });
  await writeFile(
    LEARNED,
    JSON.stringify(
      {
        updatedAt: iso,
        lumaCalendars: [...calMap.values()].filter(fresh60).sort((a, b) => rankCal(b) - rankCal(a)).slice(0, 260),
        lumaUsers: [...userMap.values()].filter(fresh60).sort((a, b) => rankUser(b) - rankUser(a)).slice(0, 160),
      },
      null,
      2
    )
  );

  // 6. Write the public feed.
  const statusRank = { open: 0, rolling: 1, soon: 2, closed: 3 };
  const programs = (curated.items || [])
    .filter((c) => c.kind === 'program')
    .map(({ kind, ...p }) => ({ ...p, status: p.deadline && new Date(p.deadline) < now ? 'closed' : p.status }))
    .sort((a, b) => statusRank[a.status] - statusRank[b.status] || new Date(a.deadline || '2100-01-01') - new Date(b.deadline || '2100-01-01'));
  const news = (curated.items || []).filter((c) => c.kind === 'news').sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 30);
  const sources = results.map((r) => ({
    id: r.id,
    name: r.name,
    home: r.home,
    ok: r.ok,
    ms: r.ms,
    fetched: r.raw.length,
    kept: perSource[r.id] || 0,
    error: r.error || null,
    stats: r.stats || null,
  }));
  sources.push({ id: 'curated', name: 'Web & social sweep', home: null, ok: true, fetched: (curated.items || []).length, kept: perSource.curated || 0, sweptAt: curated.sweptAt || null });

  const feed = {
    generatedAt: new Date(now).toISOString(),
    intervalHours,
    nextCrawlAt: new Date(now + intervalHours * 36e5).toISOString(),
    sweptAt: curated.sweptAt || null,
    counts: { events: out.length, upcoming: out.filter((e) => new Date(e.end || e.start) >= now).length },
    sources,
    watchlist: {
      orgs: watchlist.orgs.map((o) => ({ name: o.name, kind: o.kind })),
      people: watchlist.people.map((p) => ({ name: p.name, x: p.x, org: p.org })),
      learnedCalendars: calMap.size,
    },
    activeHosts: activeHosts.map(({ name, x, events, hack }) => ({ name, x, events, hack })),
    programs,
    news,
    events: out,
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(feed));

  const summary = sources.map((s) => `${s.ok ? '✓' : '✗'} ${s.name.padEnd(18)} fetched ${String(s.fetched).padStart(4)}  kept ${String(s.kept).padStart(4)}  ${s.ms ? s.ms + 'ms' : ''} ${s.error || ''}`);
  console.log(summary.join('\n'));
  console.log(`→ ${out.length} events (${feed.counts.upcoming} upcoming) · ${activeHosts.length} active hosts · ${calMap.size} learned calendars`);
}

function shape(e, hist) {
  const access = { ...(e.access || { kind: 'rsvp' }) };
  access.label = accessLabel(access);
  delete access.labelOverride;
  return {
    id: e.id,
    title: e.title,
    url: e.url,
    source: e.source,
    alsoOn: e.alsoOn?.length ? e.alsoOn : undefined,
    registerUrl: e.registerUrl || undefined,
    start: e.start,
    end: e.end || null,
    dateOnly: e.dateOnly || undefined,
    area: e.area,
    city: e.city || null,
    venue: e.venue || null,
    locationHidden: e.locationHidden || undefined,
    neighborhood: e.neighborhood || undefined,
    type: e.type,
    tags: e.tags,
    organizer: e.organizer || null,
    hosts: (e.hosts || []).slice(0, 6).map((h) => ({ name: h.name, x: h.x || undefined })),
    watched: e.watched?.length ? e.watched : undefined,
    access,
    guests: e.guests || undefined,
    capacity: e.capacity || undefined,
    prize: e.prize || undefined,
    themes: e.themes?.length ? e.themes.slice(0, 4) : undefined,
    blurb: e.blurb ? e.blurb.replace(/\s+/g, ' ').trim().slice(0, 240) : undefined,
    image: e.image || undefined,
    foundVia: e.foundVia || undefined,
    evidence: e.evidence || undefined,
    score: e.score,
    ...hist,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
