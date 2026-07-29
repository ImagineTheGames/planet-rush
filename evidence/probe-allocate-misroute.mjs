/**
 * evidence/probe-allocate-misroute.mjs — pin the M3 live allocate-misroute defect.
 * OWNER: QA Manager (branch m10-evidence-online-live). Read-only stethoscope.
 *
 * Proves the allocator OWNS the /rooms route (GET -> 405 application/json, an
 * allocator error) yet POST /rooms is fly-replayed to a gameserver machine that
 * has NO room-minting handler and answers with its text/plain WS-root greeting,
 * byte-identical to GET on the gameserver root. So no room code is ever minted.
 *
 *   node evidence/probe-allocate-misroute.mjs
 */
const ALLOCATOR = 'https://planet-rush-allocator.fly.dev';
async function full(label, url, init) {
  try {
    const r = await fetch(url, init);
    const body = await r.text();
    const hdrs = {};
    for (const [k, v] of r.headers.entries()) hdrs[k] = v;
    console.log(`\n${label}: HTTP ${r.status}`);
    console.log('  headers:', JSON.stringify(hdrs));
    console.log('  body:', JSON.stringify(body.slice(0, 300)));
  } catch (e) { console.log(`${label}: THREW ${e?.message}`); }
}
await full('POST /rooms (json {})', `${ALLOCATOR}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
await full('POST /rooms (no body)', `${ALLOCATOR}/rooms`, { method: 'POST' });
await full('POST /rooms (region iad)', `${ALLOCATOR}/rooms`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"region":"iad"}' });
await full('GET /rooms', `${ALLOCATOR}/rooms`);
await full('GET gameserver root', 'https://planet-rush-gameserver.fly.dev/');
