/**
 * src/platform/build-identity.ts — WHICH BUILD, ON WHICH SERVER, IN WHICH REGION.
 *
 * The developer's ask (ratified, M10 online scope): *"We have the build number in
 * bottom left but it only shows in matches. I want it shown on every single page —
 * and once you connect to a server, append the server you connected to and its
 * region."* The purpose is named in the same breath: **verifying region selection
 * is working optimally, at a glance, from any screenshot.**
 *
 * `build-info.ts` already owns the build half of that sentence (the stamped sha,
 * the build time, the dirty flag). This module owns the *second* half — the server
 * a live session is actually talking to — and the one string that joins them:
 *
 *   offline    `3d7cc6a`
 *   connected  `3d7cc6a · d891dd0a (gru) · 62ms`
 *
 * There is exactly ONE of that string in the process ({@link buildIdentity}), and
 * three consumers read it: the persistent corner badge (`@render/build-badge`),
 * the session log's env (`@net/playtest-log`), and the live-stage seam. That
 * singleton is the point — a screenshot and a pasted log must never disagree about
 * which Machine a session was on, which they would the moment two places each
 * formatted their own version of it.
 *
 * **The third field: the connection (ratified M10 — "badge grows connection
 * stats").** A screenshot that names the build and the Machine still could not
 * answer the next question anyone asks about a report — *how was the connection?*
 * So a connected tag carries the round trip too, and the developer named which
 * one: **the decomposed NETWORK number, never the composite.** The composite RTT
 * contains this client's own prediction lead and the server's broadcast cadence,
 * so it reads 215 ms on a wire a speedtest calls 24 (`@net/telemetry`
 * `TelemetryReadout.networkRttMs` says exactly this) — a badge showing that
 * number would put a libel about the host into every screenshot. The caller picks
 * the number; {@link BuildIdentity.sampleRtt} enforces the *cadence*
 * ({@link BADGE_RTT_INTERVAL_MS}, ~2 s), because a corner stamp that renumbers
 * every frame is unreadable and rebuilds Pixi text 60 times a second.
 *
 * The rtt rides with the server, not beside it: no session, no number. A tag can
 * never read `3d7cc6a · 62ms`, because a round trip with nothing at the far end
 * of it is not a measurement of anything.
 *
 * **No time in the tag.** `formatBuildBadge` (build-info.ts) appends `HH:MMZ` and
 * still does, for the boot line and the boot-error screen; the on-screen tag is
 * the developer's exact spec above, and the room it saves is the room the machine
 * id and region now occupy. The build time stays one line away in every log export.
 *
 * Pure functions plus a tiny observable holder. No DOM, no Pixi, no clock — so the
 * whole thing unit-tests as strings.
 */

import { BUILD_INFO, displaySha } from './build-info';
import type { BuildInfo } from './build-info';

/** The server half of the tag: which Machine, and where it is. */
export interface ServerIdentity {
  /** Fly Machine id as the allocator reported it (`ResolvedConnection.machine`). */
  readonly machine: string;
  /** That Machine's region code — `'gru'`, `'iad'`… May be `''` (unreported). */
  readonly region: string;
}

/** Machine ids are 14 hex chars; the leading 8 are what a human compares, and
 *  what `connect-trace` already puts on screen ("DIALING MACHINE 0800d5b6…"). */
export const MACHINE_SHORT_LENGTH = 8;

/** Region codes are three letters today; the clamp is a guard against a server
 *  that one day answers with a sentence, not a prediction that it will. */
export const REGION_MAX_LENGTH = 8;

/** What a connected-but-unidentified Machine reads as. A session that got a
 *  welcome and no machine id is still a *connected* session, and the badge says
 *  so — silence there would read as "offline", which is a different bug. */
export const UNKNOWN_MACHINE = '?';

/** The separator between the build and the server, and between nothing else. */
export const TAG_SEPARATOR = ' · ';

/** Short form of a Machine id: lower-case, first {@link MACHINE_SHORT_LENGTH}
 *  chars, `''` for an absent one. */
export function shortMachine(machine: string): string {
  return machine.trim().toLowerCase().slice(0, MACHINE_SHORT_LENGTH);
}

/** Normalize a region code for display: lower-case, clamped, `''` when absent. */
export function normalizeRegion(region: string): string {
  return region.trim().toLowerCase().slice(0, REGION_MAX_LENGTH);
}

/**
 * The server suffix on its own — `"d891dd0a (gru)"`, `"d891dd0a"` when the region
 * went unreported, `"? (gru)"` when the Machine did. `''` for a disconnected
 * session, which is the whole reason the badge collapses back to the bare sha.
 */
export function formatServerSuffix(server: ServerIdentity | null): string {
  if (server === null) return '';
  const machine = shortMachine(server.machine);
  const region = normalizeRegion(server.region);
  if (machine === '' && region === '') return UNKNOWN_MACHINE;
  const id = machine === '' ? UNKNOWN_MACHINE : machine;
  return region === '' ? id : `${id} (${region})`;
}

/**
 * How often the badge's rtt field is allowed to change, ms (ratified: "updated
 * ~2s"). Two seconds is slow enough to read off a phone held across the room and
 * slow enough that the stamp's Pixi text is rebuilt roughly once per 120 frames
 * instead of every one of them (GDD §4.3: nothing allocates per frame).
 */
export const BADGE_RTT_INTERVAL_MS = 2000;

/**
 * The rtt field on its own — `"62ms"`, or `''` for anything that is not a
 * measurement.
 *
 * Same rule as `@net/ping` rule 1, restated here rather than imported because
 * `src/platform` may not depend on `src/net`: null, negative, NaN and infinity are
 * all "not measured yet" and draw *nothing*, never a `0ms` that would claim a
 * perfect connection where there is simply no sample. Rounded once, so the number
 * on the badge is the number the log's `net` column prints.
 */
export function formatRttSuffix(rttMs: number | null): string {
  if (rttMs === null || !Number.isFinite(rttMs) || rttMs < 0) return '';
  return `${Math.round(rttMs)}ms`;
}

/**
 * The one string: `"3d7cc6a"` offline, `"3d7cc6a · d891dd0a (gru)"` connected,
 * `"3d7cc6a · d891dd0a (gru) · 62ms"` once the wire has been timed.
 *
 * A dirty working tree still carries its `*` (`displaySha`), so "my fix isn't in
 * the build" and "my fix isn't committed" stay distinguishable on the phone. The
 * rtt is gated on the *server*, not merely on its own validity: a number with no
 * session behind it is not a round trip to anywhere, so an offline tag is the bare
 * sha however many milliseconds a caller passes.
 */
export function formatBuildTag(
  info: BuildInfo,
  server: ServerIdentity | null,
  rttMs: number | null = null,
): string {
  const suffix = formatServerSuffix(server);
  const sha = displaySha(info);
  if (suffix === '') return sha;
  const rtt = formatRttSuffix(rttMs);
  const stats = rtt === '' ? suffix : `${suffix}${TAG_SEPARATOR}${rtt}`;
  return `${sha}${TAG_SEPARATOR}${stats}`;
}

/** Notified with the new tag whenever it changes (and once on subscribe). */
export type BuildTagListener = (tag: string) => void;

/**
 * The live build identity: an immutable {@link BuildInfo} plus the mutable server
 * a session is currently on, and the tag the two make together.
 *
 * Observable rather than polled, because the two places that must agree with the
 * screen — the badge and the session log — learn about a connect at moments
 * neither of them controls (a `welcome` frame, a socket close). Listeners fire
 * only when the *tag* actually changes, so a re-welcome inside the reconnect grace
 * window (which replays the same Machine) costs nothing.
 */
export class BuildIdentity {
  readonly info: BuildInfo;
  private srv: ServerIdentity | null = null;
  private rtt: number | null = null;
  /** When the rtt field last changed, on the caller's clock — the throttle's
   *  only state. Null until a first sample is taken. */
  private rttAtMs: number | null = null;
  private cached: string;
  private readonly listeners = new Set<BuildTagListener>();

  constructor(info: BuildInfo = BUILD_INFO) {
    this.info = info;
    this.cached = formatBuildTag(info, null, null);
  }

  /** The server this session is on, or `null` when offline / disconnected. */
  get server(): ServerIdentity | null {
    return this.srv;
  }

  /** The round trip in the tag right now, ms, or null when none is shown. The
   *  NETWORK figure the caller sampled — never the composite (see the header). */
  get rttMs(): number | null {
    return this.rtt;
  }

  /** The string the badge draws — build, server, and the round trip. */
  get tag(): string {
    return this.cached;
  }

  /**
   * The **stable** half of the tag: build and server, with no rtt —
   * `"3d7cc6a · d891dd0a (gru)"`. What the session log's env carries.
   *
   * The two are separate for one concrete reason. `@net/playtest-log`'s env is
   * *session-static* and its `setBuild` records an event whenever it changes; a
   * badge string that renumbers every two seconds would push a `build tag` line
   * into the ring roughly 360 times in a twelve-minute match and evict the whole
   * 600-slot log with a number that already has its own per-second column in the
   * telemetry samples. The env answers "which build, on which server"; the badge
   * answers that *and* "how is it right now".
   */
  get identityTag(): string {
    return formatBuildTag(this.info, this.srv, null);
  }

  /** A session was welcomed onto a Machine (the allocator's `machine`/`region`). */
  connected(machine: string, region: string): void {
    this.set({ machine, region }, this.rtt);
  }

  /** The socket closed, or the player left the match: back to build-only. Drops
   *  the round trip with it — the wire it measured is gone, and a stale `62ms`
   *  surviving a disconnect is the sort of number a screenshot gets believed on. */
  disconnected(): void {
    this.rtt = null;
    this.rttAtMs = null;
    this.set(null, null);
  }

  /**
   * Offer the badge a round trip, at whatever rate the caller has one — a frame
   * loop may call this 60 times a second and it will change the tag at most once
   * per {@link BADGE_RTT_INTERVAL_MS} (ratified: "updated ~2s").
   *
   * `rttMs` must be the **decomposed NETWORK** round trip (`@net/telemetry`
   * `networkRttMs` / a finalized sample's `networkMeanMs`), never the composite —
   * see the header for why that distinction is the whole point of the field.
   *
   * `nowMs` is the caller's monotonic clock (`performance.now()`), passed in so
   * this module keeps no clock of its own and the cadence is testable as
   * arithmetic. Two cases skip the throttle, because both are *news* rather than a
   * refresh: the first sample of a session, and a measurement going absent — a
   * connection that stopped answering must not leave its last good number on
   * screen for two more seconds.
   */
  sampleRtt(rttMs: number | null, nowMs: number): void {
    const next = formatRttSuffix(rttMs) === '' ? null : Math.round(rttMs as number);
    if (next === this.rtt) return;
    const due =
      next === null || this.rtt === null || this.rttAtMs === null
        ? true
        : nowMs - this.rttAtMs >= BADGE_RTT_INTERVAL_MS;
    if (!due) return;
    this.rttAtMs = next === null ? null : nowMs;
    this.set(this.srv, next);
  }

  /**
   * Subscribe to tag changes. Fires **immediately** with the current tag, so a
   * consumer that attaches after a connect (a badge rebuilt on a resize, a log
   * installed late) is never a state behind. Returns the unsubscribe.
   */
  subscribe(listener: BuildTagListener): () => void {
    this.listeners.add(listener);
    notify(listener, this.cached);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private set(server: ServerIdentity | null, rttMs: number | null): void {
    const next = formatBuildTag(this.info, server, rttMs);
    this.srv = server;
    this.rtt = rttMs;
    if (next === this.cached) return;
    this.cached = next;
    for (const listener of this.listeners) notify(listener, next);
  }
}

/**
 * Hand a listener the tag, and let it fail on its own time.
 *
 * A throwing listener must not take the caller down with it, and the callers here
 * are the connect path (`welcome`, a socket close) and `boot()` itself: this is a
 * *display* concern wired into the netcode lifecycle, and it earns no veto over
 * either. The failure is not silent — it goes to the console, which the session
 * log's own capture then records.
 */
function notify(listener: BuildTagListener, tag: string): void {
  try {
    listener(tag);
  } catch (err) {
    console.warn('build-identity: a tag listener threw', err);
  }
}

/** The process-wide identity. One string, one owner (see the file header). */
let singleton: BuildIdentity | null = null;

/** The live {@link BuildIdentity}. Created on first use so importing this module
 *  costs nothing in a test that only wants the pure formatters. */
export function buildIdentity(): BuildIdentity {
  singleton ??= new BuildIdentity();
  return singleton;
}

/** Drop the singleton — tests only, so one spec's connect cannot leak into the
 *  next one's expectations. Never called by the game. */
export function resetBuildIdentity(): void {
  singleton = null;
}
