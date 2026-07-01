# AI-NOTE — fyf-nifty-ui

> **Read this before starting any AI-assisted session on this repo.**
> **Last updated: 2026-07-01 by AI audit.**

---

## What This Repo Is

`fyf-nifty-ui` is the **public frontend** for the NIFTY 50 Waterfall Calendar Chart at `index.fundyourfreedom.in`.

- It **reads** data from Cloudflare KV. It **never writes** data.
- All analytics and payload computation happens in the private engine repo: `HABSGconsulting/fyf-nifty-engine`.
- Tech stack: Vanilla HTML/CSS/JS, Cloudflare Pages, Cloudflare Pages Functions.

---

## Current State

**🟢 LIVE in production.** Phase 1 complete. Do not re-scaffold any existing files.

- Live URL: https://index.fundyourfreedom.in
- Worker endpoint: `/nifty-data` (served by `functions/nifty-data.js`)
- KV key: `nifty-chart-data`
- Schema consumed: `v1.1` (defined in `fyf-nifty-engine/docs/05-json-schema.md`)

---

## What To Work On Now

### Bug B-03 (HIGH PRIORITY — fix this first)

**File:** `public/app.js` — Divergence signal row

**Problem:** The ratio is computed as:
```js
const ratio = Math.abs(row.avg_pct_change / (row.avg_pct_change - dev)).toFixed(1);
```
This formula `avg / (avg - dev)` is not mathematically meaningful. When `avg = 0.15` and `dev = 0.20`, you get `abs(0.15 / -0.05) = 3.0` — which looks like a valid ratio but is wrong.

**Correct fix:** The 1-year average for that weekday is `(avg_pct_change - deviation_from_1y)`. The ratio should be:
```js
const yearly_avg = row.avg_pct_change - dev;  // recover the 1-year baseline
const ratio = yearly_avg !== 0
  ? Math.abs(row.avg_pct_change / yearly_avg).toFixed(1)
  : '—';
```
This expresses "current 30d avg is X× the 1-year avg" which is the intended meaning.

### Bug B-05 (MEDIUM)

**File:** `wrangler.toml`

**Problem:** `preview_id` is set to the same value as `id` (production namespace). Create a new KV namespace in the Cloudflare dashboard for preview environments and set `preview_id` to that new namespace ID.

### Bug B-07 (LOW)

**File:** `functions/nifty-data.js`

**Problem:** `Access-Control-Allow-Origin: *` allows any site to consume the endpoint. If the data should be exclusive to the FYF platform, restrict it:
```js
'Access-Control-Allow-Origin': 'https://index.fundyourfreedom.in'
```
Note: Only make this change if you are sure no other FYF pages or tools need to call this endpoint.

---

## Key Rules (Do Not Violate)

1. **Never add data computation to `app.js`.** All numbers come from the JSON payload. The JS only formats and renders.
2. **Any new field consumed from the JSON requires a schema version bump** in `fyf-nifty-engine/docs/05-json-schema.md` and a coordinated engine-side change.
3. **The Worker (`functions/nifty-data.js`) only reads KV.** It must never write to KV.
4. **No npm / bundler / framework.** This is intentionally zero-build. Keep it vanilla.
