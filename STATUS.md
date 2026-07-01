# STATUS — fyf-nifty-ui

> Frontend health dashboard. Updated after each significant change.
> **Last updated: 2026-07-01 by AI audit.**

---

## System Health

| Component | Status |
|:---|:---|
| Cloudflare Pages deployment | ✅ Live at `index.fundyourfreedom.in` |
| `functions/nifty-data.js` Worker | ✅ Live, serving from Cloudflare KV |
| `public/index.html` | ✅ Deployed |
| `public/app.js` | ✅ Deployed (has B-03 bug — see below) |
| `public/style.css` | ✅ Deployed |
| KV binding (`NIFTY_CHART_DATA`) | ✅ Bound to production namespace |
| Stale badge (>26h threshold) | ✅ Working correctly |
| Waterfall SVG renderer | ✅ Working |
| Analytics cards (5 rows) | ✅ Rendering |
| Tooltips | ✅ Working |

---

## Open Bugs (from 2026-07-01 Audit)

| # | Severity | Issue | File | Line / Area |
|:---|:---|:---|:---|:---|
| B-03 | 🔴 High | Divergence ratio formula is wrong: `avg / (avg - dev)` should be `current / yearly_avg` | `public/app.js` | Divergence signal row |
| B-05 | 🟡 Medium | `preview_id` = `id` in `wrangler.toml` — preview deploys share production KV namespace | `wrangler.toml` | `[[kv_namespaces]]` block |
| B-07 | 🟢 Low | CORS wildcard `Access-Control-Allow-Origin: *` — consider restricting to `https://index.fundyourfreedom.in` | `functions/nifty-data.js` | Response headers |

---

## Last Deploy

```
Branch:   master
Trigger:  git push (auto-deploy on Cloudflare Pages)
URL:      https://index.fundyourfreedom.in
KV key:   nifty-chart-data
```

---

## Notes

- The UI does **zero** data computation. All analytics come pre-built from `fyf-nifty-engine`.
- The `worker/` directory in README is outdated — the actual Worker is at `functions/nifty-data.js` (Cloudflare Pages Functions, not standalone Worker).
- `wrangler.toml` currently has `preview_id` pointing to the production KV namespace (B-05). Until this is fixed, do not use preview deployments for testing data changes.
