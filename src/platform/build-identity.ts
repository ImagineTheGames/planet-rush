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
 *   connected  `3d7cc6a · d891dd0a (gru)`
 *
 * There is exactly ONE of that string in the process ({@link buildIdentity}), and
 * three consumers read it: the persistent corner badge (`@render/build-badge`),
 * the session log's env (`@net/playtest-log`), and the live-stage seam. That
 * singleton is the point — a screenshot and a pasted log must never disagree about
 * which Machine a session was on, which they would the moment two places each
 * formatted their own version of it.
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
 * The one string: `"3d7cc6a"` offline, `"3d7cc6a · d891dd0a (gru)"` connected.
 * A dirty working tree still carries its `*` (`displaySha`), so "my fix isn't in
 * the build" and "my fix isn't committed" stay distinguishable on the phone.
 */
export function formatBuildTag(info: BuildInfo, server: ServerIdentity | null): string {
  const suffix = formatServerSuffix(server);
  const sha = displaySha(info);
  return suffix === '' ? sha : `${sha}${TAG_SEPARATOR}${suffix}`;
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
  private cached: string;
  private readonly listeners = new Set<BuildTagListener>();

  constructor(info: BuildInfo = BUILD_INFO) {
    this.info = info;
    this.cached = formatBuildTag(info, null);
  }

  /** The server this session is on, or `null` when offline / disconnected. */
  get server(): ServerIdentity | null {
    return this.srv;
  }

  /** The string the badge draws and the log's env carries. */
  get tag(): string {
    return this.cached;
  }

  /** A session was welcomed onto a Machine (the allocator's `machine`/`region`). */
  connected(machine: string, region: string): void {
    this.set({ machine, region });
  }

  /** The socket closed, or the player left the match: back to build-only. */
  disconnected(): void {
    this.set(null);
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

  private set(server: ServerIdentity | null): void {
    const next = formatBuildTag(this.info, server);
    this.srv = server;
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
