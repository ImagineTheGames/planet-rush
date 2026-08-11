/**
 * allocator/edge-region.ts — where the creator actually is. OWNER: Netcode
 * Engineer (GDD §4.2; the developer's ratified region-placement ask).
 *
 * `Allocator.pickMachine` has always preferred a requested region. The gap this
 * module closes is that **nothing requested one**: the client sent a hard-coded
 * `iad`, so a creator in Brazil was placed in Virginia on purpose, by a constant
 * nobody had revisited. Deleting that constant leaves the allocator with no
 * region at all — and an unstated region is the *other* half of the same bug, a
 * whole-fleet spread that lands the same creator in Virginia by tie-break.
 *
 * So the allocator infers it. Fly's edge already knows: the anycast POP that
 * accepted the request is, by construction, the one nearest the client, and it
 * stamps that on every request it forwards. Two headers carry it, and this module
 * reads both — the second is not paranoia, it is the one that was *observed*:
 *
 *   • `Fly-Region: gru` — the documented header, verified live against Fly's own
 *     header echo (`https://debug.fly.dev`) from the developer's own network:
 *     `Fly-Region: gru`, `Fly-Client-Ip: 201.77.129.150`.
 *   • `Fly-Request-Id: 01KYTQQP5MJVBN077Q5CZ611Z4-gru` — the request id's trailing
 *     `-<region>` suffix, the same edge by another name. Kept as a fallback because
 *     it is present on every Fly response this repo has ever logged, so a future
 *     rename of the first header degrades to a slightly odd parse rather than to
 *     silently placing every creator in Virginia again.
 *
 * **A missing header is not an error.** Off Fly — a laptop, the €4 VPS, a test —
 * there is no edge and no header, and the honest answer is `undefined`: no
 * preference, whole-fleet placement, exactly the behaviour that shipped before
 * this file existed. Nothing here can *refuse* an allocation.
 *
 * **This file reads the POP; it does not decide what the POP means.** The two are
 * separate on purpose, because the answer to "which of our regions is that?"
 * depends on the fleet and this file does not know the fleet. A POP we run
 * nothing in used to fall out of placement entirely — `dfw`, the anycast POP a
 * Florida creator arrives on, read as *no opinion at all* and let the room go
 * anywhere the load happened to point. It now resolves to its nearest fleet
 * region (`./region-geo`, applied in `Allocator.pickMachine`), so the region code
 * this function returns is used even when the fleet has no Machine wearing it.
 *
 * **A forged header buys nothing.** The region is a *preference*: it can only ask
 * for a region the fleet already has, and a full one falls back anyway. It has
 * precisely the power the request body's `region` field has had since Task 5, and
 * that field is client-supplied too. The shape check below exists to keep junk out
 * of the placement log, not to keep an attacker out of a region.
 *
 * Pure and dependency-free: a header bag in, a region code or `undefined` out. No
 * clock, no network, no `IncomingMessage` — so the allocator's HTTP layer can hand
 * it Node's `headers` object and a test can hand it an object literal.
 */

/** The edge header Fly stamps with the POP that accepted the request. */
export const FLY_REGION_HEADER = 'fly-region';

/** The request id, whose trailing `-<region>` names that same POP. */
export const FLY_REQUEST_ID_HEADER = 'fly-request-id';

/**
 * A Fly region code: exactly three lowercase letters (`iad`, `gru`, `lhr`, `syd`
 * …). Every region Fly has ever shipped fits this, and holding the shape tight is
 * what keeps a hostile header out of `/machines` output and the session log —
 * a region that does not look like a region is treated as no region at all.
 */
const REGION_CODE = /^[a-z]{3}$/;

/** The header bag as Node hands it over: values may be arrays, or absent. */
export type HeaderBag = Readonly<Record<string, string | string[] | undefined>>;

/**
 * The region the creator's request came in through, or `undefined` when nothing
 * says. Documented header first, request-id suffix second, neither → no
 * preference (and whole-fleet placement, as before).
 */
export function edgeRegion(headers: HeaderBag): string | undefined {
  const direct = regionCode(firstValue(headers[FLY_REGION_HEADER]));
  if (direct !== undefined) return direct;
  return regionFromRequestId(firstValue(headers[FLY_REQUEST_ID_HEADER]));
}

/**
 * The `-<region>` suffix of a Fly request id (`01KYTQ…Z4-gru` → `gru`). The id
 * itself is Crockford base32 and never contains a hyphen, so the *last* hyphen is
 * unambiguously the separator. Anything that does not end in a region-shaped
 * suffix yields `undefined` rather than a guess.
 */
export function regionFromRequestId(requestId: string | undefined): string | undefined {
  if (requestId === undefined) return undefined;
  const cut = requestId.lastIndexOf('-');
  if (cut < 0) return undefined;
  return regionCode(requestId.slice(cut + 1));
}

/** A header value normalised to a region code, or `undefined` if it isn't one. */
function regionCode(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim().toLowerCase();
  return REGION_CODE.test(trimmed) ? trimmed : undefined;
}

/** The first value of a header Node may hand back as an array. */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
