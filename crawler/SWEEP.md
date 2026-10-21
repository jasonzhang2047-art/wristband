# Web & social sweep

The crawler (`crawler/crawl.mjs`) reads structured event feeds. This sweep covers what never reaches a feed:
posts by people and orgs on X/LinkedIn/blogs, accelerator deadlines, Partiful/Google-Form events, and recaps.
Results go into `data/curated.json`, which the crawler merges on its next run.

Run it at most every 12 hours (check `sweptAt` in `data/curated.json`). Budget: about 12–18 searches per sweep.

First download the live feed: `curl -fsSL https://jasonzhang2047-art.github.io/wristband/events.json -o dist/events.json`
(`dist/` is git-ignored). "The live feed" below means that file. Never commit `site/events.json` or `data/learned.json`;
GitHub Actions carries them between runs through the deployed site.

## 1. What to search

Rotate through the watchlist so every person and org is covered every few sweeps. `curated.json` keeps
`sweepCursor` (an integer); take the next 8 people from `crawler/watchlist.json` → `people`, starting at
`sweepCursor`, then advance it by 8 (wrap around).

- **People (8 per sweep, grouped 2–3 per query):** `"<name>" OR "@<x handle>" hackathon OR "apply" OR RSVP San Francisco <Month YYYY>`
  plus one `site:x.com` query for the group. Look for posts announcing events, application windows, or invite-only builder days.
- **Programs and deadlines (2–3 per sweep, rotate):** YC (ycombinator.com/apply), a16z speedrun, South Park Commons
  Founder Fellowship, Neo Scholars / Neo Residency, Z Fellows, HF0, Pear VC PearX, StartX, Berkeley SkyDeck,
  Entrepreneur First SF, Contrary Talent, Conviction Embed, AI Grant, Founders Inc, The Residency.
- **New hackathons and builder days (3–4 per sweep):** `hackathon San Francisco <next month YYYY>`,
  `site:partiful.com hackathon San Francisco`, `site:lu.ma OR site:luma.com hackathon "San Francisco" <Month>`,
  `AGI House hackathon <Month YYYY>`, `Anthropic OR OpenAI OR "Google DeepMind" hackathon San Francisco <Month YYYY>`.
- **Eventbrite (1 per sweep, when the live feed's `sources` shows eventbrite with ok: false):**
  `site:eventbrite.com hackathon (San Francisco OR "Palo Alto" OR "San Jose" OR Berkeley)`. Add only hackathons,
  demo days and founder events, never pay-to-pitch networking mixers.
- **Campus (1 per sweep, rotate):** Stanford GSB / StartX / BASES / TreeHacks; Berkeley SkyDeck / Cal Hacks /
  Berkeley Launch / SCET; Santa Clara, SJSU, UCSF.
- **News (1–2 per sweep):** winners or recaps of hackathons and demo days that ended in the last 7 days
  (use the live feed → events whose `end` is in the past week with `type` hackathon or demo).

## 2. Verify before writing anything

Every item must be confirmed on its **primary page** (the organizer's event page, application page or the
original post), opened with WebFetch or curl. Search snippets and aggregator summaries are not enough.

Keep an item only if all of these hold:
- It is in the SF Bay Area (SF, Peninsula, South Bay, East Bay, North Bay) or is a program based there.
- For events: the date is today or later (news may be up to 14 days old).
- Dates, deadlines and how to get in are stated on the primary page. If a date is unclear, leave it out.
- It is not already in the live feed (compare titles and URLs) — for Luma events, compare the slug.

## 3. How to write it to `data/curated.json`

Edit the JSON in place; keep existing items. Set `"sweptAt"` to the current ISO time with offset.

- **Luma event:** just the link — the crawler fetches every detail from Luma itself:
  `{ "kind": "event", "url": "https://luma.com/<slug>", "foundVia": "Post by <name> on X", "sourceUrl": "<post url>" }`
- **Other event (Partiful, own site, Google Form):**
  `{ "kind": "event", "title", "url", "start" (ISO with -07:00/-08:00), "end", "city", "venue", "organizer", "type": "hackathon|demo|founder|vc|school|conference|builder", "note", "access": { "kind": "rsvp|apply|ticket|waitlist|closed", "labelOverride": "Apply by Nov 3", "deadline": "<ISO>" }, "foundVia", "sourceUrl" }`
- **Program / application window:**
  `{ "kind": "program", "name", "org", "url", "status": "open|rolling|soon|closed", "deadline": "<ISO or null>", "opens": "YYYY-MM or null", "note", "sourceUrl" }`
  Update an existing program in place when its status or deadline changes.
- **Correction to a crawled event** (e.g. applications closed but the feed still says open):
  `{ "kind": "override", "id": "<event id from the live feed>", "access": { ... }, "note", "sourceUrl" }`
- **News:** `{ "kind": "news", "date": "YYYY-MM-DD", "title", "body" (1–2 sentences), "url", "org" }`

Housekeeping each sweep: delete news older than 30 days, events and overrides whose date has passed by more
than 21 days, and programs whose deadline passed more than 14 days ago.

## 4. Ship it

If `data/curated.json` changed: `git add data/curated.json`, commit as "Sweep <YYYY-MM-DD HH:mm> PT", and `git push`
(on a rejected push, `git pull --rebase` and push again). The push starts a crawl on GitHub that merges the new items.

Write plainly. No hype words, no emoji. Never invent a deadline, prize, capacity or host.
