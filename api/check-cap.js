// language: JavaScript (Node.js), file: api/check-cap.js, target: Vercel Edge runtime
// Uses SUPABASE_SERVICE_KEY env var (never in gen.html) to enforce per-service daily gen caps.
// Calls the increment_service_cap() Postgres function — atomic increment + check in one round-trip.
// POST { email, product } → { allowed: bool, count: int, cap: int | null }

const SB_URL = 'https://liaeducrofflulwkejug.supabase.co';

// Server-side caps. Unlisted products = uncapped (Rockstar, Steam).
const SERVER_CAPS = {
  disney:    3,
  discord:   7,
  netflix:   10,
  paramount: 3,
  hbo:       3,
};

export default async function handler(req) {
  const origin = req.headers.get('origin') || '';
  const ALLOWED = [
    'https://blackout-market.vercel.app',
    'http://localhost:3000',
  ];
  const corsHeaders = {
    'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : ALLOWED[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405, headers: corsHeaders,
    });
  }

  let email, product;
  try {
    const body = await req.json();
    email   = (body.email   || '').toLowerCase().trim();
    product = (body.product || '').toLowerCase().trim();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400, headers: corsHeaders,
    });
  }

  if (!email || !product) {
    return new Response(JSON.stringify({ error: 'email and product required' }), {
      status: 400, headers: corsHeaders,
    });
  }

  // Unlisted = uncapped (Rockstar, Steam). No DB call needed.
  const cap = SERVER_CAPS[product];
  if (cap === undefined) {
    return new Response(JSON.stringify({ allowed: true, count: 0, cap: null }), {
      status: 200, headers: corsHeaders,
    });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    console.error('[check-cap] SUPABASE_SERVICE_KEY not configured');
    // Fail open — don't lock users out if env var is accidentally missing
    return new Response(JSON.stringify({ allowed: true, count: 0, cap }), {
      status: 200, headers: corsHeaders,
    });
  }

  const today = new Date().toISOString().split('T')[0]; // UTC YYYY-MM-DD

  try {
    // Single atomic RPC: increments count and returns the new value.
    // If new count > cap, it means this generation should be denied AND the increment
    // should not have happened — but we let it stay (cap+1 max) since it auto-resets at midnight.
    const rpcRes = await fetch(
      `${SB_URL}/rest/v1/rpc/increment_service_cap`,
      {
        method:  'POST',
        headers: {
          'apikey':        serviceKey,
          'Authorization': 'Bearer ' + serviceKey,
          'Content-Type':  'application/json',
          'Prefer':        'return=representation',
        },
        body: JSON.stringify({
          p_email:   email,
          p_product: product,
          p_date:    today,
        }),
      }
    );

    if (!rpcRes.ok) {
      const errText = await rpcRes.text();
      console.error('[check-cap] RPC error:', rpcRes.status, errText);
      // Fail open on server error
      return new Response(JSON.stringify({ allowed: true, count: 0, cap }), {
        status: 200, headers: corsHeaders,
      });
    }

    const newCount = await rpcRes.json(); // function returns INTEGER

    if (newCount > cap) {
      return new Response(JSON.stringify({ allowed: false, count: newCount, cap }), {
        status: 200, headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify({ allowed: true, count: newCount, cap }), {
      status: 200, headers: corsHeaders,
    });

  } catch (err) {
    console.error('[check-cap] unexpected error:', err);
    return new Response(JSON.stringify({ allowed: true, count: 0, cap }), {
      status: 200, headers: corsHeaders,
    });
  }
}

export const config = { runtime: 'edge' };
