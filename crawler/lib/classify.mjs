// Relevance, event type, Bay Area placement, access (RSVP / application) and watchlist matching.

const AREAS = {
  'San Francisco': ['san francisco', 'sf', 'presidio', 'treasure island'],
  Peninsula: [
    'daly city', 'south san francisco', 'brisbane', 'san bruno', 'millbrae', 'burlingame', 'san mateo',
    'foster city', 'belmont', 'san carlos', 'redwood city', 'menlo park', 'atherton', 'palo alto', 'stanford',
    'east palo alto', 'los altos', 'los altos hills', 'half moon bay', 'woodside', 'portola valley', 'pacifica',
  ],
  'South Bay': [
    'mountain view', 'sunnyvale', 'santa clara', 'san jose', 'san josé', 'cupertino', 'campbell', 'saratoga',
    'los gatos', 'milpitas', 'morgan hill',
  ],
  'East Bay': [
    'oakland', 'berkeley', 'emeryville', 'albany', 'alameda', 'richmond', 'el cerrito', 'san leandro', 'hayward',
    'fremont', 'union city', 'newark', 'pleasanton', 'dublin', 'livermore', 'san ramon', 'walnut creek',
    'lafayette', 'orinda', 'danville', 'concord', 'moraga', 'piedmont',
  ],
  'North Bay': ['sausalito', 'mill valley', 'san rafael', 'novato', 'tiburon', 'larkspur', 'corte madera', 'napa', 'petaluma', 'sonoma', 'santa rosa'],
};
const CITY_TO_AREA = new Map();
for (const [area, cities] of Object.entries(AREAS)) for (const c of cities) CITY_TO_AREA.set(c, area);

export const BAY_CITY_RE = new RegExp(
  `\\b(${[...CITY_TO_AREA.keys()].filter((c) => c.length > 2).map((c) => c.replace(/ /g, '\\s')).join('|')}|bay area|silicon valley)\\b`,
  'i'
);

export function inBayBox(lat, lon) {
  return lat > 36.95 && lat < 38.55 && lon > -123.1 && lon < -121.55;
}

export function areaFor({ city, lat, lon, text }) {
  const c = (city || '').toLowerCase().trim();
  if (CITY_TO_AREA.has(c)) return CITY_TO_AREA.get(c);
  if (text) {
    const m = String(text).match(BAY_CITY_RE);
    if (m) {
      const k = m[1].toLowerCase().replace(/\s+/g, ' ');
      if (CITY_TO_AREA.has(k)) return CITY_TO_AREA.get(k);
      return 'Bay Area';
    }
  }
  if (lat != null && lon != null && inBayBox(lat, lon)) {
    if (lat > 37.7 && lon < -122.35) return 'San Francisco';
    if (lat > 37.75 && lon > -122.35) return lat > 38.0 ? 'North Bay' : 'East Bay';
    if (lat > 37.9 && lon < -122.4) return 'North Bay';
    if (lon > -122.1 && lat < 37.45) return 'South Bay';
    if (lon > -122.15 && lat > 37.45) return 'East Bay';
    return 'Peninsula';
  }
  return null;
}

// --- event type --------------------------------------------------------------------------

const TYPE_RULES = [
  ['hackathon', /hack(athon|athons|s\b|-?day|-?night|-?fest|-?week|\s?weekend)|\bhack\b|buildathon|build-?a-?thon|build (day|night|weekend|sprint|session)|(game|code|hack|ai|build|agent|robot)s? ?jam\b|codefest|code fest|\bshipathon|ship (it|week)|hacker house|makeathon|ideathon|datathon|prompt-?a-?thon/i],
  ['demo', /demo (day|night|evening|show)|demo ?day|\bdemos\b|pitch(es|ing)?\b|showcase|shark tank|startup (competition|contest|battle)|founders? on stage|unicorn battle/i],
  ['program', /\b(accelerator|fellowship|fellows|residency|cohort|batch|incubator|venture studio|startx|skydeck|pearx|founder program)\b[^|]*\b(applications?|apply|applicant|info session|open house|deadline)\b|\b(applications?|apply)\b[^|]*\b(accelerator|fellowship|residency|cohort|batch)\b/i],
  ['founder', /founder|startup|start-up|entrepreneur|\bceos?\b|startup fundrais|fundraising (strategy|for|101)|investor|\bvcs?\b|venture|\bangels?\b|\blps?\b|\bgps?\b|\bseed\b|series [ab]\b|y ?combinator|\byc\b|bootstrap|cofounder|co-founder|solo gp|operator/i],
  ['conference', /summit|conference|\bconf\b|expo\b|world'?s fair|\bforum\b|devday|dev day|\bsymposium\b|\bweek 20\d\d|tech week/i],
  ['builder', /\bai\b|\bagents?\b|agentic|\bllms?\b|\bgpt|claude|gemini|\bmodels?\b|\bml\b|machine learning|inference|\bgpus?\b|open[- ]source|developer|\bdevs?\b|devtools|engineer|robotics|physical ai|\bmcp\b|\brag\b|infra|\bcode\b|coding|vibe ?cod|\bdata\b|\bapi\b|sdk|compute|\bchips?\b|semiconductor|crypto|web3|ethereum|solana|biotech|deep ?tech|hardware|product (managers?|builders?)|\bdesign engineers?\b/i],
];

// Clearly off-topic formats. Dropped unless the event is a hackathon/demo or hosted by a watched org.
const OFFTOPIC_RE =
  /live music|concert|\bdj\b|yoga|meditat|sound bath|book (fair|club)|reading|mahjong|dumpling|run(ning)? club|\b5k\b|\b10k\b|pickleball|\bgolf\b|topgolf|wine tasting|matcha|tarot|astrolog|psychedel|speed dating|dating|halloween party|costume|art (show|walk|opening)|exhibition|poetry|comedy|improv|karaoke|salsa|bachata|dance party|brunch club|supper club|potluck|church|worship|bible|prayer|real estate investing|forex|day trading|crypto trading signals|mlm|bitcoin price|interview skills bootcamp|resume workshop|job fair|career fair/i;

// Pay-to-pitch / networking mills that flood Eventbrite and Luma.
const SPAM_RE =
  /networking (bay area|san jose|san francisco|sf|palo alto)|founders, investors (&|and) talent|professionals,? investors|investors,? (&|and)? ?professionals|networking (&|and) pitch|pitch (&|and) networking|investor connect|elevator pitch(es)? event|tech startups,? investors,? (experts|professionals)|startups,? investors,? professionals|wellness,? health,? beauty|b2b networking|speed networking|pitch & run|founder speed dating|startup fundraising strategy session/i;

export function detectTypes(text) {
  const types = [];
  for (const [t, re] of TYPE_RULES) if (re.test(text)) types.push(t);
  return types;
}

// --- watchlist ---------------------------------------------------------------------------

export function compileWatchlist(wl) {
  const orgs = wl.orgs.map((o) => ({ ...o, res: o.match.map((m) => new RegExp(m, 'i')) }));
  const people = wl.people.map((p) => ({
    ...p,
    handle: p.x ? p.x.toLowerCase() : null,
    nameRe: new RegExp(`\\b${p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'),
  }));
  return { orgs, people };
}

export function matchWatch(cw, { title = '', organizer = '', hosts = [], extra = '' }) {
  const hay = [title, organizer, extra, ...hosts.map((h) => h.name || '')].join(' • ');
  const hits = [];
  for (const o of cw.orgs) {
    if (o.res.some((re) => re.test(hay))) hits.push({ name: o.name, kind: o.kind });
  }
  for (const p of cw.people) {
    const byHandle = p.handle && hosts.some((h) => (h.x || '').toLowerCase() === p.handle);
    const byName = hosts.some((h) => p.nameRe.test(h.name || '')) || p.nameRe.test(title);
    if (byHandle || byName) hits.push({ name: p.name, kind: 'person', org: p.org });
  }
  // de-dupe
  const seen = new Set();
  return hits.filter((h) => (seen.has(h.name) ? false : seen.add(h.name)));
}

// --- access ------------------------------------------------------------------------------
// kind: apply | rsvp | ticket | waitlist | closed | open

export function accessLabel(a) {
  const money = a.price ? ` · ${a.price}` : '';
  switch (a.kind) {
    case 'apply':
      return (a.labelOverride || 'Application required') + money;
    case 'rsvp':
      return (a.labelOverride || 'RSVP required') + money;
    case 'ticket':
      return `Ticketed${money}`;
    case 'waitlist':
      return 'Waitlist only';
    case 'closed':
      return a.labelOverride || 'Registration closed';
    default:
      return a.labelOverride || 'Open — no signup listed';
  }
}

// --- scoring -----------------------------------------------------------------------------

const TYPE_WEIGHT = { hackathon: 60, demo: 40, program: 40, founder: 30, conference: 22, builder: 18 };
const KIND_BONUS = { vc: 22, school: 16, accelerator: 18, community: 14, lab: 14, devtool: 8, person: 20 };

export function classify(ev, cw) {
  const text = `${ev.title} ${ev.organizer || ''} ${ev.blurb || ''}`;
  let types = detectTypes(ev.title);
  for (const t of detectTypes(ev.blurb || '')) if (!['hackathon', 'demo'].includes(t) && !types.includes(t)) types.push(t);
  if (/after ?party|happy hour|watch party/i.test(ev.title)) types = types.filter((t) => t !== 'hackathon');
  if (ev.forceType && !types.includes(ev.forceType)) types.unshift(ev.forceType);
  if (ev.forceType) types = [ev.forceType, ...types.filter((t) => t !== ev.forceType)];

  const watched = matchWatch(cw, { title: ev.title, organizer: ev.organizer, hosts: ev.hosts || [], extra: ev.calendar || '' });
  const isSchool = watched.some((w) => w.kind === 'school') || /^stanford$/i.test(ev.city || '');
  const isVC = watched.some((w) => w.kind === 'vc');

  const tags = new Set(types);
  if (isSchool) tags.add('school');
  if (isVC) tags.add('vc');

  const offtopic = OFFTOPIC_RE.test(ev.title);
  const spam = SPAM_RE.test(ev.title);
  const strongType = types.includes('hackathon') || types.includes('demo');

  let score = Math.max(0, ...types.map((t) => TYPE_WEIGHT[t] || 0));
  score += Math.min(40, watched.reduce((s, w) => s + (KIND_BONUS[w.kind] || 6), 0));
  if (ev.access?.kind === 'apply') score += 6;
  if (ev.guests && ev.guests > 150) score += 6;
  if (ev.prize) score += 8;
  if (spam) score -= 45;
  if (offtopic && !strongType) score -= 60;

  // Primary category shown on the card.
  let primary = types[0] || null;
  if (!strongType && isVC) primary = 'vc';
  else if (!strongType && isSchool && (!primary || primary === 'builder' || primary === 'conference')) primary = 'school';
  if (!primary && watched.length) primary = watched.some((w) => w.kind === 'vc') ? 'vc' : 'founder';

  const relevant = !!primary && score >= 18 && !(offtopic && !strongType && !watched.length);
  return { relevant, primary, tags: [...tags], watched, score: Math.round(score), spam };
}
