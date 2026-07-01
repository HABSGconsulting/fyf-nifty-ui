/**
 * Cloudflare Pages Function — /api/nifty-data
 *
 * Reads the latest chart-data.json payload from KV and returns it
 * as a JSON response with appropriate CORS and cache headers.
 *
 * KV binding: NIFTY_CHART_DATA  (configured in Cloudflare Pages dashboard)
 * KV key:     chart-data        (written by kv_writer.py)
 */

const KV_KEY = 'chart-data';

// Cache for 5 minutes on the CDN edge — balances freshness vs. load
const CACHE_MAX_AGE = 300;

export async function onRequest(context) {
  const { request, env } = context;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  // Only GET allowed
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders() },
    });
  }

  // KV binding must exist
  if (!env.NIFTY_CHART_DATA) {
    console.error('KV binding NIFTY_CHART_DATA is not configured');
    return new Response(
      JSON.stringify({ error: 'Data source not configured', code: 'KV_MISSING' }),
      { status: 503, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  }

  // Read from KV
  let raw;
  try {
    raw = await env.NIFTY_CHART_DATA.get(KV_KEY, { type: 'text' });
  } catch (err) {
    console.error('KV read error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to read data', code: 'KV_READ_ERROR' }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  }

  // Key not found — pipeline hasn't run yet
  if (raw === null) {
    return new Response(
      JSON.stringify({ error: 'Data not yet available', code: 'KV_EMPTY' }),
      { status: 404, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  }

  // Validate it's parseable JSON before returning
  try {
    JSON.parse(raw);
  } catch (err) {
    console.error('KV payload is not valid JSON:', err);
    return new Response(
      JSON.stringify({ error: 'Corrupt data payload', code: 'KV_INVALID_JSON' }),
      { status: 502, headers: { 'Content-Type': 'application/json', ...corsHeaders() } }
    );
  }

  return new Response(raw, {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `public, max-age=${CACHE_MAX_AGE}, stale-while-revalidate=60`,
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}
