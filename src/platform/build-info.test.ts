/**
 * Build-identity tests (build-info.ts). The developer's complaint was "I can't
 * tell which build I'm playing", so the two things under test are the two
 * things a human reads — the corner badge string and the boot line — plus the
 * fallback that keeps both meaningful (rather than throwing or printing
 * `undefined`) in a build with no injected stamp.
 */
import { describe, it, expect } from 'vitest';
import {
  resolveBuildInfo,
  formatBuildBadge,
  formatBootLine,
  formatUtcHhMm,
  displaySha,
  toVersionManifest,
  isIsoTime,
  DEV_SHA,
  type BuildInfo,
} from './build-info';

/** A stamped, clean build at 09:07 UTC. */
const CLEAN: BuildInfo = { sha: 'a1b2c3d', time: '2026-07-24T09:07:42.000Z', dirty: false };

describe('formatBuildBadge — the corner stamp', () => {
  it('reads "<sha> · <HH:MM>Z"', () => {
    expect(formatBuildBadge(CLEAN)).toBe('a1b2c3d · 09:07Z');
  });

  it('marks a dirty tree with a trailing * on the sha', () => {
    expect(formatBuildBadge({ ...CLEAN, dirty: true })).toBe('a1b2c3d* · 09:07Z');
  });

  it('reports the time in UTC regardless of the machine zone', () => {
    // Same instant, expressed with a +05:00 offset: the badge still says 09:07Z.
    const offset: BuildInfo = { ...CLEAN, time: '2026-07-24T14:07:42.000+05:00' };
    expect(formatBuildBadge(offset)).toBe('a1b2c3d · 09:07Z');
  });

  it('zero-pads both fields', () => {
    expect(formatUtcHhMm('2026-01-02T03:04:05.000Z')).toBe('03:04');
  });

  it('degrades to --:-- rather than NaN on an unparseable time', () => {
    expect(formatUtcHhMm('whenever')).toBe('--:--');
    expect(formatBuildBadge({ sha: 'abc1234', time: 'whenever', dirty: false })).toBe('abc1234 · --:--Z');
  });

  it('stays short — the badge must not become a UI element', () => {
    expect(formatBuildBadge(CLEAN).length).toBeLessThanOrEqual(24);
  });
});

describe('formatBootLine — the console banner', () => {
  it('names the build and its full build time', () => {
    expect(formatBootLine(CLEAN)).toBe('Planet Rush build a1b2c3d built 2026-07-24T09:07:42.000Z');
  });

  it('carries the same dirty marker as the badge (the two never disagree)', () => {
    const dirty = { ...CLEAN, dirty: true };
    expect(formatBootLine(dirty)).toContain(displaySha(dirty));
    expect(formatBuildBadge(dirty)).toContain(displaySha(dirty));
  });
});

describe('resolveBuildInfo — the dev fallback path', () => {
  const now = (): Date => new Date('2026-07-24T09:07:42.000Z');

  it('yields { dev, now, dirty } when no stamp was injected', () => {
    expect(resolveBuildInfo(undefined, now)).toEqual({
      sha: DEV_SHA,
      time: '2026-07-24T09:07:42.000Z',
      dirty: true,
    });
  });

  it('never throws on hostile input, and still formats', () => {
    for (const raw of [null, 42, 'nope', [], {}, { sha: 1, time: {}, dirty: 'yes' }]) {
      const info = resolveBuildInfo(raw, now);
      expect(info.sha).toBe(DEV_SHA);
      expect(isIsoTime(info.time)).toBe(true);
      expect(formatBuildBadge(info)).toBe('dev* · 09:07Z');
    }
  });

  it('passes a well-formed stamp through untouched', () => {
    expect(resolveBuildInfo(CLEAN, now)).toEqual(CLEAN);
  });

  it('repairs field by field — a good sha survives a broken time', () => {
    const info = resolveBuildInfo({ sha: 'a1b2c3d', time: '', dirty: false }, now);
    expect(info.sha).toBe('a1b2c3d');
    expect(info.time).toBe('2026-07-24T09:07:42.000Z');
    expect(info.dirty).toBe(false);
  });

  it('assumes dirty unless the stamp explicitly says clean', () => {
    expect(resolveBuildInfo({ sha: 'a1b2c3d', time: CLEAN.time }, now).dirty).toBe(true);
    expect(resolveBuildInfo({ sha: 'a1b2c3d', time: CLEAN.time, dirty: false }, now).dirty).toBe(false);
  });

  it('trims whitespace off a sha (git output arrives newline-terminated)', () => {
    expect(resolveBuildInfo({ ...CLEAN, sha: ' a1b2c3d\n' }, now).sha).toBe('a1b2c3d');
  });
});

describe('toVersionManifest — the dashboard payload', () => {
  it('is exactly { sha, time } — no local-only fields leak', () => {
    expect(toVersionManifest(CLEAN)).toEqual({ sha: 'a1b2c3d', time: '2026-07-24T09:07:42.000Z' });
    expect(Object.keys(toVersionManifest(CLEAN)).sort()).toEqual(['sha', 'time']);
  });
});
