# fyf-nifty-ui

Public frontend for the **NIFTY 50 Daily Waterfall Chart** — a static site served via Cloudflare Pages that reads chart data from Cloudflare KV and renders it entirely in the browser.

Live at **[index.fundyourfreedom.in](https://index.fundyourfreedom.in)**

> ⚠️ **Status: LIVE in production.** Phase 1 complete. See `STATUS.md` for open bugs.

---

## What This Is

A single-page, zero-framework chart dashboard that shows:

- 30-day waterfall of NIFTY 50 daily closes (green gain / red loss / grey non-trading)
- Today's close, month-to-date return, distance from ATH
- Weekday win-rate matrix (Mon–Fri, 1-year window)
- Gap analysis, volatility regime, momentum (SMA 20/50, RSI 14), and streak cards

Data is written to Cloudflare KV by the private pipeline repo [`fyf-nifty-engine`](https://github.com/HABSGconsulting/fyf-nifty-engine) every weekday at **4:05 PM IST**. This repo never touches the data — it only reads it.

`index.fundyourfreedom.in` is the live home for the NIFTY 50 waterfall chart. Sensex, Bank Nifty, Gold, and FD rate trackers may follow in future phases.

---

## Repo Structure

```
fyf-nifty-ui/
├── public/                 Static site (Cloudflare Pages build output)
│   ├── index.html          Single HTML shell — all IDs wired to app.js
│   ├── style.css           Full design system — dark theme, responsive
│   └── app.js              Fetch → render → tooltip → analytics
├── functions/
│   └── nifty-data.js       Cloudflare Pages Function: GET /nifty-data → KV read
├── wrangler.toml           Pages + KV binding config
├── STATUS.md               Health dashboard + open bugs
├── AI-NOTE.md              AI session context + current bug list
└── README.md
```

> Note: The `worker/` path shown in older docs is outdated. The actual endpoint is `functions/nifty-data.js` (Cloudflare Pages Functions).

---

## Architecture

```
[fyf-nifty-engine]                [fyf-nifty-ui]
  GitHub Actions (4:05 PM IST)
    └── fetch_nifty.py
    └── build_chart_data.py
    └── kv_writer.py
          │
          │  writes JSON payload
          ▼
    Cloudflare KV
    key: "nifty-chart-data"
          │
          │  reads on every browser request
          ▼
    functions/nifty-data.js  ◄──── GET /nifty-data ◄──── browser
          │
          │  returns JSON
          ▼
    app.js renders SVG chart + 5 analytics panels
```

The static files in `public/` are deployed once and never change day-to-day. Only the KV payload changes (daily). No re-deploy needed for data updates.

---

## Open Bugs

See `STATUS.md` for full bug table. Summary:

| # | Severity | Issue |
|:---|:---|:---|
| B-03 | 🔴 High | Divergence ratio formula wrong in `app.js` |
| B-05 | 🟡 Medium | `preview_id` shares production KV in `wrangler.toml` |
| B-07 | 🟢 Low | CORS wildcard in `functions/nifty-data.js` |

---

## Deployment

Cloudflare Pages auto-deploys on every push to `master`. The KV namespace is pre-bound.

For local development:
```bash
npm install -g wrangler
wrangler login
npx wrangler pages dev public --kv NIFTY_CHART_DATA
```

For local testing without live KV, drop a `chart-data.json` file into `public/`. `app.js` falls back to `./chart-data.json` automatically if `/nifty-data` fails.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Cloudflare Pages (free tier) |
| API | Cloudflare Pages Functions (`functions/nifty-data.js`) |
| Data store | Cloudflare KV |
| Chart | Vanilla SVG |
| Styling | Plain CSS — no framework, no build step |
| JS | Vanilla ES2020 — no bundler, no framework |

---

## Roadmap

| Instrument | Status |
|---|---|
| NIFTY 50 waterfall chart | ✅ Live |
| Sensex waterfall chart | Planned |
| Bank Nifty waterfall chart | Planned |
| Gold price tracker | Planned |
| FD rate tracker | Planned |

---

## Related

- **[fyf-nifty-engine](https://github.com/HABSGconsulting/fyf-nifty-engine)** — Private pipeline repo. Fetches NSE data, computes analytics, writes to KV.
- **[fundyourfreedom.in](https://fundyourfreedom.in)** — Main blog.
