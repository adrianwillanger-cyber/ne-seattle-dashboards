# NE Seattle Dashboards (Lean)

Two leaned-down hyperlocal market dashboards for **NE Seattle**, powered by [NW Pulse](https://github.com/adrianwillanger-cyber/adrian-willanger-positioning) — the engine that ingests four NWMLS-fed markets daily.

## Dashboards

### Featured Zip Codes — 98115 · 98125 · 98155
Cross-zip snapshot with insight KPIs (market temperature, price stickiness, share sold above list, days-on-market median), a Broker's Read annotation, per-zip cards, and a methodology footer that credits the engine.

`featured/index.html`

### 98125 Market Pulse
Single-zip seasonal view of 98125 — home buyer trends, list-to-sale ratios, and seasonality.

`98125/index.html`

## Landing

`index.html` — entry point with both dashboard links.

## What's "lean" about this

- Property Detail table stripped from Featured (focus on insights, not listings)
- Perplexity inline-edit artifacts removed
- Broker's Read sidebar + methodology footer added on Featured so the human judgment and engineering provenance sit next to the data

## Engine

All numbers come from **NW Pulse**:
- 4 NWMLS-fed markets: 98115, 98125, 98155, 83864
- 4 listing types ingested daily: new, sold, price-changed, pending
- `X-Api-Key` authenticated `/api/*` endpoints
- `/api/health` public; `/api/social-export` returns NWMLS-compliant aggregate-only payloads

## Live

- Preview: see Adrian for the current `/computer/a` URL.

---

Adrian Willanger · Kelly Right Real Estate · Seattle · Adrian@adrianwillanger.com · 206 909-7536 · NWMLS-compliant by default
