// language: JavaScript (Node.js), file: api/check-cap.js, target: Vercel Edge runtime
// Uses SUPABASE_SERVICE_KEY env var (never in gen.html) to enforce per-service daily gen caps.
// Reads caps from product_limits.json in the repo (same file LimitsManager.html edits).
// Calls the increment_service_cap() Postgres function — atomic increment + check in one round-trip.
// POST { email, product } → { allowed: bool, count: int, cap: int | null }

const SB_URL       = 'https://liaeducrofflulwkejug.supabase.co';
const LIMITS_URL   = 'https://raw.githubusercontent.com/Jamess704/Blackout-Market/main/product_limits.json';

// Fallback caps if product_limits.json can't be fetched.
// 0 = unlimited. These match the defaults LimitsManager shows on first load.
const FALLBACK_CAPS = {
  disney:    3,
  discord:   7,
  netflix:   10,
  paramount: 3,
  hbo:       3,
};

// Cache the limits for the lifetime of this edge function instance (~seconds).
let _cachedLimits = null;

async function getLimits() {
  if (_cachedLimits) return _cachedLimits;
  try {
    const res = await fetch(LIMITS_URL, { cache: 'no-store' });
    if (res.ok) {
      const json = await res.json();
      // product_limits.json format: { "disney": 3, "netflix": 10, ... }
      // 0 or missing = unlimited (cap === null)
      _cachedLimits = json;
      return _cachedLimits;
    }
  } catch (e) {
    console.error('[check-cap] failed to fetch product_limits.json:', e);
  }
  _cachedLimits = FALLBACK_CAPS;
  return _cachedLimits;
}

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

  // Load caps from product_limits.json (falls back to FALLBACK_CAPS on error)
  const limits = await getLimits();
  const capVal = limits[product];

  // 0 or undefined = unlimited — no DB call needed
  if (!capVal) {
    return new Response(JSON.stringify({ allowed: true, count: 0, cap: null }), {
      status: 200, headers: corsHeaders,
    });
  }

  const cap = capVal; // positive integer

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    console.error('[check-cap] SUPABASE_SERVICE_KEY not configured');
    return new Response(JSON.stringify({ allowed: true, count: 0, cap }), {
      status: 200, headers: corsHeaders,
    });
  }

  const today = new Date().toISOString().split('T')[0]; // UTC YYYY-MM-DD

  try {
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
