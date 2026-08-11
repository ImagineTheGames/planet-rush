/**
 * allocator/region-geo.ts — how far apart two datacentres are. OWNER: Netcode
 * Engineer (GDD §4.2; docs/hosting-plan.md Task 16).
 *
 * `edge-region.ts` reads the POP a request arrived on. That POP is the one fact
 * the edge gives us for free about where the creator is — and until this file
 * existed, the allocator threw it away whenever the fleet did not happen to run a
 * Machine there. From Florida the anycast POP is `dfw`; the fleet is `iad ×2 +
 * gru ×1`; so `dfw` meant *no opinion*, the whole fleet went into one pool, and a
 * US creator could be handed São Paulo (**observed live, 2026-08-11: three
 * consecutive `POST /rooms` from a `dfw` POP returned `iad`, `iad`, `gru`, with
 * twelve free slots still sitting in `iad`**).
 *
 * An unserved POP is not an absent preference. It is a **location** — Dallas is
 * 1,882 km from Ashburn and 8,244 km from São Paulo, and no amount of load
 * imbalance makes that a close call. This module is the one place that knows it.
 *
 * **Why coordinates and a great circle, and not a POP→region table.** A static
 * `dfw → iad` table is smaller and it is auditable, and it was the obvious first
 * answer. It was rejected because every one of its rows silently encodes *the
 * fleet we happen to run today*: the day someone adds `cdg`, every European row
 * is wrong and nothing in the table says which. It also cannot answer the second
 * question placement actually asks — *`iad` is full, so which region is
 * **next**-nearest?* — because a table has one answer per POP, not a ranking.
 * Coordinates encode only facts about the world, which do not change when the
 * fleet does; the nearest region is then **derived** against whichever regions
 * are live and have capacity at the instant of the request. One table to maintain
 * (where places are), not one per fleet shape.
 *
 * **What the table covers.** All 35 regions Fly publishes as of 2026-08, keyed by
 * the IATA code of the airport each is named for and carrying that airport's
 * coordinates — so every row is checkable against a public source rather than
 * against someone's memory of a map. Fly's POP codes and its region codes are the
 * same namespace, which is why one table serves both sides of the question: the
 * `from` is an edge POP (possibly one we run nothing in), the candidates are the
 * regions our fleet is actually in.
 *
 * **What an unknown code does: nothing.** A POP that is not in the table yields
 * `undefined` — no guess, no nearest-by-alphabet, no silent default. The
 * allocator then does exactly what it did before this file existed (whole-fleet
 * spread), which is the honest answer when we do not know where the creator is.
 * Likewise a fleet region missing from the table is simply not a candidate for
 * *nearest*; it can still take a room, just never on the grounds of being close.
 * **Adding a region to the fleet therefore means adding its row here**, and the
 * cost of forgetting is a fallback to the old behaviour, not a wrong continent.
 *
 * Pure and dependency-free: codes in, a code or a number out. No clock, no
 * network, no fleet — the allocator supplies the candidates.
 */

/** One datacentre's position on the planet, in degrees. */
interface RegionSite {
  readonly lat: number;
  readonly lon: number;
  /** The city the code names — carried so a row can be read without a lookup. */
  readonly city: string;
}

/**
 * Fly's published regions as of 2026-08, each at the coordinates of the airport
 * whose IATA code names it. Rounded to two decimals (~1 km), which is four orders
 * of magnitude finer than any distance this file is asked to compare.
 *
 * These are POP codes as much as region codes — `dfw` and `atl` are in here
 * because a request can *arrive* on them, not because we run anything there.
 */
const REGION_SITES: Readonly<Record<string, RegionSite>> = {
  ams: { lat: 52.37, lon: 4.89, city: 'Amsterdam' },
  arn: { lat: 59.65, lon: 17.92, city: 'Stockholm' },
  atl: { lat: 33.64, lon: -84.43, city: 'Atlanta' },
  bog: { lat: 4.7, lon: -74.15, city: 'Bogotá' },
  bom: { lat: 19.09, lon: 72.87, city: 'Mumbai' },
  bos: { lat: 42.37, lon: -71.02, city: 'Boston' },
  cdg: { lat: 49.01, lon: 2.55, city: 'Paris' },
  den: { lat: 39.86, lon: -104.67, city: 'Denver' },
  dfw: { lat: 32.9, lon: -97.04, city: 'Dallas' },
  ewr: { lat: 40.69, lon: -74.17, city: 'Secaucus' },
  eze: { lat: -34.82, lon: -58.54, city: 'Buenos Aires' },
  fra: { lat: 50.03, lon: 8.56, city: 'Frankfurt' },
  gdl: { lat: 20.52, lon: -103.31, city: 'Guadalajara' },
  gig: { lat: -22.81, lon: -43.25, city: 'Rio de Janeiro' },
  gru: { lat: -23.43, lon: -46.47, city: 'São Paulo' },
  hkg: { lat: 22.31, lon: 113.91, city: 'Hong Kong' },
  iad: { lat: 38.94, lon: -77.46, city: 'Ashburn' },
  jnb: { lat: -26.13, lon: 28.24, city: 'Johannesburg' },
  lax: { lat: 33.94, lon: -118.41, city: 'Los Angeles' },
  lhr: { lat: 51.47, lon: -0.45, city: 'London' },
  mad: { lat: 40.47, lon: -3.56, city: 'Madrid' },
  mia: { lat: 25.79, lon: -80.29, city: 'Miami' },
  nrt: { lat: 35.55, lon: 140.39, city: 'Tokyo' },
  ord: { lat: 41.98, lon: -87.9, city: 'Chicago' },
  otp: { lat: 44.57, lon: 26.1, city: 'Bucharest' },
  phx: { lat: 33.44, lon: -112.01, city: 'Phoenix' },
  qro: { lat: 20.62, lon: -100.19, city: 'Querétaro' },
  scl: { lat: -33.39, lon: -70.79, city: 'Santiago' },
  sea: { lat: 47.45, lon: -122.31, city: 'Seattle' },
  sin: { lat: 1.36, lon: 103.99, city: 'Singapore' },
  sjc: { lat: 37.36, lon: -121.93, city: 'San Jose' },
  syd: { lat: -33.94, lon: 151.18, city: 'Sydney' },
  waw: { lat: 52.17, lon: 20.97, city: 'Warsaw' },
  yul: { lat: 45.47, lon: -73.74, city: 'Montreal' },
  yyz: { lat: 43.68, lon: -79.63, city: 'Toronto' },
};

/** Mean Earth radius (km) — the sphere a great-circle distance is measured on. */
const EARTH_RADIUS_KM = 6371;

/**
 * The great-circle distance between two region/POP codes in kilometres, or
 * `undefined` when either code is not in {@link REGION_SITES}. Distance on a
 * sphere, not routed network distance: it is a *proxy* for latency, and a
 * deliberately coarse one — the fleet has no measurement of its own POPs, and a
 * proxy that is right about continents beats a preference that is right about
 * nothing. Where a real measurement exists it outranks this (the client's region
 * picker sends a region, and a stated region wins before this file is consulted).
 */
export function regionDistanceKm(a: string, b: string): number | undefined {
  const from = REGION_SITES[a];
  const to = REGION_SITES[b];
  if (from === undefined || to === undefined) return undefined;
  return haversineKm(from, to);
}

/**
 * The candidate closest to `from`, or `undefined` when nothing can be ranked —
 * `from` is not a code this file knows, or no candidate is. Candidates this file
 * does not know are skipped rather than guessed at, so an unmapped fleet region
 * never wins on distance grounds.
 *
 * `from` being one of the candidates is not special-cased: its own distance is
 * zero, so it wins on the same rule as everything else.
 *
 * Ties are impossible in practice (two datacentres at an identical distance to
 * two decimals) and are broken by candidate order rather than by name — the whole
 * point of this module is that no placement decision is ever a string comparison.
 */
export function nearestRegion(from: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestKm = Infinity;
  for (const candidate of candidates) {
    const km = regionDistanceKm(from, candidate);
    if (km === undefined || km >= bestKm) continue;
    best = candidate;
    bestKm = km;
  }
  return best;
}

/** Haversine — the standard great-circle formula, stable at small angles. */
function haversineKm(a: RegionSite, b: RegionSite): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLon = toRadians(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRadians(a.lat)) * Math.cos(toRadians(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
