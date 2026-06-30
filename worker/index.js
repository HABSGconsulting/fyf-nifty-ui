/**
 * Cloudflare Worker — /api/chart-data
 *
 * Reads the "chart-data" key from KV (NIFTY_CHART_DATA binding)
 * and returns it as JSON with correct CORS + cache headers.
 *
 * Deployed as a Cloudflare Pages Function via wrangler.toml.
 * KV binding name: NIFTY_CHART_DATA
 * KV key:         chart-data
 */

export default {
  async fetch(request, env) {
    // ── CORS pre-flight ──────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204);
    }

    // ── Only GET allowed ─────────────────────────────────────────
    if (request.method !== 'GET') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // ── KV read ──────────────────────────────────────────────────
    let raw;
    try {
      raw = await env.NIFTY_CHART_DATA.get('chart-data');
    } catch (err) {
      console.error('[worker] KV read error:', err);
      return jsonResponse(
        { error: 'KV read failed', detail: err.message },
        502
      );
    }

    // ── KV miss (pipeline hasn't run yet) ────────────────────────
    if (raw === null) {
      return jsonResponse(
        {
          error: 'Data not yet available',
          detail: 'The pipeline has not run yet. Data is published daily at 4:05 PM IST on trading days.',
        },
        503
      );
    }

    // ── Parse check (guard against corrupt KV write) ─────────────
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      console.error('[worker] JSON parse error:', err);
      return jsonResponse(
        { error: 'Corrupt data in KV', detail: 'The stored payload is not valid JSON.' },
        502
      );
    }

    // ── Success ──────────────────────────────────────────────────
    // Cache-Control: public, max-age=300 (5 min)
    // The pipeline writes fresh data once per day; 5-min CDN cache
    // prevents hammering KV while keeping data fresh enough.
    return new Response(raw, {
      status: 200,
      headers: {
        'Content-Type':  'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        'X-Data-Date':   parsed?.meta?.as_of_date || '',
        ...corsHeaders(),
      },
    });
  },
};

/* ── Helpers ─────────────────────────────────────────────────── */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...corsHeaders(),
    },
  });
}

function corsResponse(body, status = 204) {
  return new Response(body, {
    status,
    headers: corsHeaders(),
  });
}
