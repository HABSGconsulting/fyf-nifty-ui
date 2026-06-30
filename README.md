# fyf-nifty-ui

Public frontend for the **NIFTY 50 Daily Waterfall Chart** — a static site served via Cloudflare Pages that reads chart data from Cloudflare KV and renders it entirely in the browser.

Live at **[index.fundyourfreedom.in](https://index.fundyourfreedom.in)**

---

## What This Is

A single-page, zero-framework chart dashboard that shows:

- 30-day waterfall of NIFTY 50 daily closes (green gain / red loss / grey non-trading)
- Today's close, month-to-date return, distance from ATH
- Weekday win-rate matrix (Mon–Fri, 1-month window)
- Gap analysis, volatility regime, momentum (SMA 20/50, RSI 14), and streak cards

Data is written to Cloudflare KV by the private pipeline repo [`fyf-nifty-engine`](https://github.com/HABSGconsulting/fyf-nifty-engine) every weekday at **4:05 PM IST**. This repo never touches the data — it only reads it.

---

## Repo Structure

```
fyf-nifty-ui/
├── public/                 Static site (Cloudflare Pages build output)
│   ├── index.html          Single HTML shell — all IDs wired to app.js
│   ├── style.css           Full design system — dark theme, responsive
│   └── app.js              Fetch → render → tooltip → analytics
├── worker/
│   └── index.js            Cloudflare Worker: GET /api/chart-data → KV
├── wrangler.toml           Pages + Worker + KV binding config
└── README.md
```

---

## Architecture

```
[fyf-nifty-engine]                [fyf-nifty-ui]
  GitHub Actions (4:05 PM IST)
    └── fetch_nifty.py
    └── build_chart_data.py
    └── kv_writer.py
          │
          │  writes JSON
          ▼
    Cloudflare KV
    key: "chart-data"
          │
          │  reads on every request
          ▼
    worker/index.js  ◄──── GET /api/chart-data ◄──── browser
          │
          │  returns JSON
          ▼
    app.js renders SVG chart + analytics panels
```

The static files in `public/` are deployed once and never change day-to-day. Only the KV payload changes (daily). No re-deploy needed for data updates.

---

## Deployment

### Prerequisites

- Cloudflare account with Pages and Workers enabled
- A KV namespace created: **Cloudflare Dashboard → Workers & Pages → KV → Create namespace**
- `wrangler` CLI: `npm install -g wrangler`

### Step 1 — Fill in KV IDs

Edit `wrangler.toml` and replace the placeholders:

```toml
[[kv_namespaces]]
binding    = "NIFTY_CHART_DATA"
id         = "YOUR_KV_NAMESPACE_ID"          # from Dashboard → KV → your namespace
preview_id = "YOUR_KV_PREVIEW_NAMESPACE_ID"  # can be same as id for simplicity
```

### Step 2 — Connect to Cloudflare Pages

1. Cloudflare Dashboard → Workers & Pages → Create → Pages → Connect to Git
2. Select this repo (`fyf-nifty-ui`)
3. Build settings:
   - **Framework preset:** None
   - **Build command:** *(leave blank)*
   - **Build output directory:** `public`
4. Save and deploy

Cloudflare Pages will auto-deploy on every push to `main`.

### Step 3 — Bind KV to the Pages project

1. Dashboard → your Pages project → Settings → Functions
2. Under **KV namespace bindings** → Add binding:
   - Variable name: `NIFTY_CHART_DATA`
   - KV namespace: select your namespace
3. Save

### Step 4 — Run the engine once

In `fyf-nifty-engine`, trigger the GitHub Actions workflow manually. This writes the first `chart-data` payload to KV. The chart will be blank until this runs.

### Step 5 — Set custom domain (optional)

Dashboard → your Pages project → Custom domains → Add `index.fundyourfreedom.in`

---

## Local Development

```bash
# Install wrangler
npm install -g wrangler

# Authenticate
wrangler login

# Run locally (serves public/ + worker at localhost:8788)
npx wrangler pages dev public --kv NIFTY_CHART_DATA
```

For local testing without a live KV, drop a `chart-data.json` file into `public/`. `app.js` falls back to `./chart-data.json` automatically if `/api/chart-data` fails.

---

## Data Contract

`app.js` expects the following top-level keys from the Worker:

| Key | Type | Description |
|---|---|---|
| `meta` | object | `generated_at`, `as_of_date`, `schema_version` |
| `summary` | object | `latest_close`, `day_change_pct`, `month_change_pct`, `from_ath_pct`, `all_time_high` |
| `bars` | array | One entry per calendar day (30 days). Each bar: `date`, `type` (`trading`/`non-trading`), `open`, `close`, `change_pct`, `change_abs`, `day_type` |
| `weekday_win_rates` | object | Keys `mon`–`fri`, each with `win_rate`, `wins`, `total` |
| `analytics.gap` | object | `gap_up_days`, `gap_down_days`, `avg_gap_up`, `avg_gap_down` |
| `analytics.volatility` | object | `regime`, `avg_daily_move`, `largest_gain`, `largest_loss` |
| `analytics.momentum` | object | `sma_20`, `sma_50`, `rsi_14` |
| `analytics.streaks` | object | `current_streak`, `current_type`, `longest_win_streak`, `longest_loss_streak`, `win_rate_30d` |

Full schema defined in `fyf-nifty-engine/docs/`.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Hosting | Cloudflare Pages (free tier) |
| API | Cloudflare Worker (free tier) |
| Data store | Cloudflare KV |
| Chart | Vanilla SVG + D3 scale/array (no full D3 bundle) |
| Fonts | Satoshi (Fontshare) + Instrument Serif (Google Fonts) |
| Styling | Plain CSS — no framework, no build step |
| JS | Vanilla ES2020 IIFE — no bundler, no framework |

---

## Related

- **[fyf-nifty-engine](https://github.com/HABSGconsulting/fyf-nifty-engine)** — Private pipeline repo. Fetches NSE data, computes analytics, writes to KV.
- **[fundyourfreedom.in](https://fundyourfreedom.in)** — Main blog.
