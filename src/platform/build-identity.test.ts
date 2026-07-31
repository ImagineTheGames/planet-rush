/**
 * Build-identity tests (build-identity.ts) — the ONE string the badge draws and
 * the session log carries.
 *
 * The developer's spec is two literal strings, so most of this file is those two
 * strings asserted verbatim: `3d7cc6a` offline, `3d7cc6a · d891dd0a (gru)`
 * connected. The rest is the failure modes a live fleet actually produces — an
 * allocator that answers with no region, or no machine id at all — where the tag
 * must still say *something true* rather than silently reading as offline.
 */
import { describe, it, expect, afterEach } from 'vitest';
import {
  BADGE_RTT_INTERVAL_MS,
  BuildIdentity,
  MACHINE_SHORT_LENGTH,
  UNKNOWN_MACHINE,
  buildIdentity,
  formatBuildTag,
  formatRttSuffix,
  formatServerSuffix,
  normalizeRegion,
  resetBuildIdentity,
  shortMachine,
} from './build-identity';
import type { BuildInfo } from './build-info';

/** The developer's own example build, clean. */
const CLEAN: BuildInfo = { sha: '3d7cc6a', time: '2026-07-30T09:07:00.000Z', dirty: false };
const DIRTY: BuildInfo = { ...CLEAN, dirty: true };

/** The developer's own example Machine: a full 14-char Fly id in São Paulo. */
const MACHINE = 'd891dd0a1e6598';
const REGION = 'gru';

afterEach(() => resetBuildIdentity());

describe('formatBuildTag — the two strings the developer specified', () => {
  it('is the bare sha offline', () => {
    expect(formatBuildTag(CLEAN, null)).toBe('3d7cc6a');
  });

  it('appends the machine short-form and its region once connected', () => {
    expect(formatBuildTag(CLEAN, { machine: MACHINE, region: REGION })).toBe('3d7cc6a · d891dd0a (gru)');
  });

  it('keeps the dirty marker in both states — "not in the build" vs "not committed"', () => {
    expect(formatBuildTag(DIRTY, null)).toBe('3d7cc6a*');
    expect(formatBuildTag(DIRTY, { machine: MACHINE, region: REGION })).toBe('3d7cc6a* · d891dd0a (gru)');
  });
});

describe('the server suffix, on a fleet that answers imperfectly', () => {
  it('is empty when there is no session — nothing to append, nothing appended', () => {
    expect(formatServerSuffix(null)).toBe('');
  });

  it('drops the parenthetical when the allocator reported no region', () => {
    expect(formatServerSuffix({ machine: MACHINE, region: '' })).toBe('d891dd0a');
  });

  it('still says CONNECTED when the machine id is missing — silence would read as offline', () => {
    expect(formatServerSuffix({ machine: '', region: REGION })).toBe(`${UNKNOWN_MACHINE} (gru)`);
    expect(formatServerSuffix({ machine: '', region: '' })).toBe(UNKNOWN_MACHINE);
    expect(formatBuildTag(CLEAN, { machine: '', region: '' })).toBe(`3d7cc6a · ${UNKNOWN_MACHINE}`);
  });

  it('shortens a machine id to the same 8 chars the connecting screen shows', () => {
    expect(shortMachine(MACHINE)).toBe('d891dd0a');
    expect(shortMachine(MACHINE)).toHaveLength(MACHINE_SHORT_LENGTH);
    expect(shortMachine('  D891DD0A1E6598 ')).toBe('d891dd0a');
    expect(shortMachine('')).toBe('');
  });

  it('normalizes a region and clamps a server that answers with a sentence', () => {
    expect(normalizeRegion(' GRU ')).toBe('gru');
    expect(normalizeRegion('a'.repeat(50))).toHaveLength(8);
  });
});

describe('BuildIdentity — one owner, so screen and log cannot disagree', () => {
  it('starts offline and grows the suffix on connect', () => {
    const id = new BuildIdentity(CLEAN);
    expect(id.tag).toBe('3d7cc6a');
    expect(id.server).toBeNull();

    id.connected(MACHINE, REGION);
    expect(id.tag).toBe('3d7cc6a · d891dd0a (gru)');
    expect(id.server).toEqual({ machine: MACHINE, region: REGION });
  });

  it('clears back to build-only on disconnect (the ratified §2 rule)', () => {
    const id = new BuildIdentity(CLEAN);
    id.connected(MACHINE, REGION);
    id.disconnected();
    expect(id.tag).toBe('3d7cc6a');
    expect(id.server).toBeNull();
  });

  it('tells a subscriber the current tag immediately, then every change', () => {
    const id = new BuildIdentity(CLEAN);
    const seen: string[] = [];
    id.subscribe((tag) => seen.push(tag));

    id.connected(MACHINE, REGION);
    id.disconnected();

    expect(seen).toEqual(['3d7cc6a', '3d7cc6a · d891dd0a (gru)', '3d7cc6a']);
  });

  it('stays quiet when the tag does not move — a re-welcome inside the grace window', () => {
    const id = new BuildIdentity(CLEAN);
    const seen: string[] = [];
    id.subscribe((tag) => seen.push(tag));

    id.connected(MACHINE, REGION);
    id.connected(MACHINE, REGION); // the reconnect replays the same welcome
    id.disconnected();
    id.disconnected();

    expect(seen).toHaveLength(3); // initial, connect, disconnect — and no more
  });

  it('reports a Machine CHANGE, because that is exactly what a reader is looking for', () => {
    const id = new BuildIdentity(CLEAN);
    const seen: string[] = [];
    id.subscribe((tag) => seen.push(tag));
    id.connected(MACHINE, REGION);
    id.connected('0800d5b6c4e211', 'iad');
    expect(seen[seen.length - 1]).toBe('3d7cc6a · 0800d5b6 (iad)');
  });

  it('unsubscribes cleanly', () => {
    const id = new BuildIdentity(CLEAN);
    const seen: string[] = [];
    const off = id.subscribe((tag) => seen.push(tag));
    off();
    id.connected(MACHINE, REGION);
    expect(seen).toEqual(['3d7cc6a']);
  });

  it('does not let a throwing listener take the connect path down with it', () => {
    const id = new BuildIdentity(CLEAN);
    const seen: string[] = [];
    id.subscribe(() => {
      throw new Error('the badge blew up');
    });
    id.subscribe((tag) => seen.push(tag));

    expect(() => id.connected(MACHINE, REGION)).not.toThrow();
    // …and the well-behaved listener still heard about it.
    expect(seen[seen.length - 1]).toBe('3d7cc6a · d891dd0a (gru)');
  });
});

describe('the rtt field — the badge grows connection stats (ratified M10)', () => {
  it('is the developer\'s third string, verbatim', () => {
    expect(formatBuildTag(CLEAN, { machine: MACHINE, region: REGION }, 62)).toBe(
      '3d7cc6a · d891dd0a (gru) · 62ms',
    );
  });

  it('rounds once, so the badge and the log\'s `net` column print one integer', () => {
    expect(formatRttSuffix(61.6)).toBe('62ms');
    expect(formatRttSuffix(0)).toBe('0ms'); // a measured zero IS a measurement
  });

  it('shows NOTHING for anything that is not a measurement — never a lying 0ms', () => {
    for (const bad of [null, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(formatRttSuffix(bad)).toBe('');
    }
    expect(formatBuildTag(CLEAN, { machine: MACHINE, region: REGION }, null)).toBe(
      '3d7cc6a · d891dd0a (gru)',
    );
  });

  it('never appends an rtt with no server behind it — a round trip to nowhere', () => {
    expect(formatBuildTag(CLEAN, null, 62)).toBe('3d7cc6a');
  });

  it('reaches the tag on the first sample, without waiting out the interval', () => {
    const id = new BuildIdentity(CLEAN);
    id.connected(MACHINE, REGION);
    id.sampleRtt(62, 1_000);
    expect(id.tag).toBe('3d7cc6a · d891dd0a (gru) · 62ms');
    expect(id.rttMs).toBe(62);
  });

  it('changes the number at most once per ~2s, however often a frame loop offers one', () => {
    const id = new BuildIdentity(CLEAN);
    id.connected(MACHINE, REGION);
    id.sampleRtt(62, 0);

    // 120 frames of a wandering connection across the next two seconds.
    for (let f = 1; f < 120; f++) id.sampleRtt(62 + f, f * (BADGE_RTT_INTERVAL_MS / 120));
    expect(id.tag, 'the corner renumbered inside the interval').toBe(
      '3d7cc6a · d891dd0a (gru) · 62ms',
    );

    // The frame that crosses the interval takes the current reading.
    id.sampleRtt(180, BADGE_RTT_INTERVAL_MS);
    expect(id.tag).toBe('3d7cc6a · d891dd0a (gru) · 180ms');
  });

  it('drops a number that went absent immediately — a dead wire keeps no last good reading', () => {
    const id = new BuildIdentity(CLEAN);
    id.connected(MACHINE, REGION);
    id.sampleRtt(62, 0);
    id.sampleRtt(null, 16); // well inside the interval
    expect(id.tag).toBe('3d7cc6a · d891dd0a (gru)');
    expect(id.rttMs).toBeNull();
  });

  it('loses the rtt with the socket — a stale 62ms must not outlive the session', () => {
    const id = new BuildIdentity(CLEAN);
    id.connected(MACHINE, REGION);
    id.sampleRtt(62, 0);
    id.disconnected();
    expect(id.tag).toBe('3d7cc6a');
    expect(id.rttMs).toBeNull();

    // And the next session starts its own throttle, rather than inheriting a
    // timestamp that would make its first reading two seconds late.
    id.connected(MACHINE, REGION);
    id.sampleRtt(80, 10);
    expect(id.tag).toBe('3d7cc6a · d891dd0a (gru) · 80ms');
  });

  it('keeps the rtt across a re-welcome onto the same Machine (the grace window)', () => {
    const id = new BuildIdentity(CLEAN);
    id.connected(MACHINE, REGION);
    id.sampleRtt(62, 0);
    id.connected(MACHINE, REGION);
    expect(id.tag).toBe('3d7cc6a · d891dd0a (gru) · 62ms');
  });

  it('tells subscribers about an rtt change — the badge is one of them', () => {
    const id = new BuildIdentity(CLEAN);
    const seen: string[] = [];
    id.connected(MACHINE, REGION);
    id.subscribe((tag) => seen.push(tag));
    id.sampleRtt(62, 0);
    expect(seen).toEqual(['3d7cc6a · d891dd0a (gru)', '3d7cc6a · d891dd0a (gru) · 62ms']);
  });

  it('leaves `identityTag` still — so the log\'s env is not rewritten every 2s', () => {
    const id = new BuildIdentity(CLEAN);
    id.connected(MACHINE, REGION);
    const before = id.identityTag;
    id.sampleRtt(62, 0);
    id.sampleRtt(180, BADGE_RTT_INTERVAL_MS);
    id.sampleRtt(240, BADGE_RTT_INTERVAL_MS * 2);
    expect(id.identityTag).toBe(before);
    expect(id.identityTag).toBe('3d7cc6a · d891dd0a (gru)');
    // …while the badge itself did move.
    expect(id.tag).toBe('3d7cc6a · d891dd0a (gru) · 240ms');
  });
});

describe('the singleton — the reason screen and log agree', () => {
  it('is one instance for the whole process', () => {
    expect(buildIdentity()).toBe(buildIdentity());
  });

  it('is reset between tests, so one spec cannot leak a connect into the next', () => {
    buildIdentity().connected(MACHINE, REGION);
    resetBuildIdentity();
    expect(buildIdentity().server).toBeNull();
  });
});
