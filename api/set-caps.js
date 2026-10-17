// language: JavaScript, file: api/set-caps.js, target: Vercel Edge runtime
// Admin endpoint — writes product caps to Supabase product_caps table.
// Protected by ADMIN_PASSWORD env var. Never exposes service key to client.
// POST { password, caps: { disney: 3, discord: 10, ... } }

const SB_URL = 'https://liaeducrofflulwkejug.supabase.co';

export default async function handler(req) {
  const corsHeaders = {
    'Access-Control-Allow-Origin': 'https://blackout-market.vercel.app',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: corsHeaders });

  let password, caps;
  try {
    const body = await req.json();
    password = body.password || '';
    caps     = body.caps || {};
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: corsHeaders });
  }

  const adminPass = process.env.ADMIN_PASSWORD;
  if (!adminPass || password !== adminPass) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_KEY;
  if (!serviceKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500, headers: corsHeaders });
  }

  // Upsert each product cap
  const rows = Object.entries(caps).map(([product, cap]) => ({ product, cap: parseInt(cap) || 0 }));

  const r = await fetch(`${SB_URL}/rest/v1/product_caps`, {
    method: 'POST',
    headers: {
      'apikey':        serviceKey,
      'Authorization': 'Bearer ' + serviceKey,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error('[set-caps] Supabase error:', err);
    return new Response(JSON.stringify({ error: 'DB write failed' }), { status: 500, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ ok: true, updated: rows.length }), { status: 200, headers: corsHeaders });
}

export const config = { runtime: 'edge' };
