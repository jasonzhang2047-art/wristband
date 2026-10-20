# Wristband

Bay Area hackathons, demo days, VC and campus events — and what it takes to get in.

Public site: https://jasonzhang2047-art.github.io/wristband/

Private copy on claude.ai: https://claude.ai/artifact/K1UfkKARRu7rdTjzAeNYdo

## How it works

```
crawler/crawl.mjs        every 6h  → site/events.json
  ├─ sources/luma.mjs        Luma map discovery + ~190 followed organizer calendars + ~160 followed hosts
  ├─ sources/yc.mjs          ycombinator.com/events + each event's application deadline
  ├─ sources/cerebral.mjs    Cerebral Valley events & hackathons (schema.org data)
  ├─ sources/mlh.mjs         MLH season list (Bay Area, in person)
  ├─ sources/devpost.mjs     Devpost hackathons, address-checked on each hackathon page
  ├─ sources/stanford.mjs    events.stanford.edu API (entrepreneurship, startups, hackathons…)
  ├─ sources/meetup.mjs      Meetup keyword searches
  ├─ sources/eventbrite.mjs  Eventbrite search pages (pay-to-pitch networking mills filtered out)
  └─ sources/crosscheck.mjs  compares against a public hackathon listing; anything missing is
                             re-fetched from its Luma page
data/curated.json        web & social sweep (people's posts, deadlines, recaps) — see crawler/SWEEP.md
data/learned.json        calendars and hosts the crawler discovered and will follow next run
crawler/watchlist.json   VCs, schools, labs, community hubs and people to flag (edit freely)
site/index.html          the page (Artifact format); site/events.json is its data
```

Each run classifies events (hackathon, pitch/demo day, VC-hosted, campus, founder, AI builder meetup, conference),
drops off-topic and spam listings, merges the same event listed on several sites, keeps `firstSeen` history so
new listings get a NEW tag, and learns new calendars/hosts from relevant events so coverage grows over time.

## Run it yourself

```bash
node crawler/crawl.mjs
```

```bash
node crawler/build-static.mjs && python3 -m http.server 8787 --directory dist
```

Node 18+ with no dependencies.

## Schedules

- **GitHub Actions** (`.github/workflows/crawl.yml`) runs the crawler every 6 hours and on every push to `main`,
  then deploys `dist/` to GitHub Pages. It never commits: the previous crawl's `events.json` and `learned.json`
  are read back from the live site, so first-seen history and followed calendars carry over between runs.
- **Claude desktop scheduled task `wristband-crawl`** (every 6 hours, while the Claude app is open) runs the web &
  social sweep at most every 12 hours, commits `data/curated.json` and pushes, which starts a crawl on GitHub.
  It then copies the fresh `events.json` from the live site into the claude.ai page.
