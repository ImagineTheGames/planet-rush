/**
 * Build-time stamp tests (build-stamp.ts — the node-side half). Two contracts:
 * the git probe must produce a usable {@link BuildInfo} on every path including
 * the ones where git isn't there at all (a build must never fail over a cosmetic
 * stamp), and the `version.json` plugin must emit exactly the shape the studio
 * dashboard polls for.
 */
import { describe, it, expect } from 'vitest';
import {
  readGitStamp,
  defineBuildInfo,
  versionJsonPlugin,
  versionJsonSource,
  VERSION_FILE,
  type EmitFileContext,
} from './build-stamp';
import { DEV_SHA, type BuildInfo } from './build-info';

const NOW = (): Date => new Date('2026-07-24T09:07:42.000Z');
const ISO = '2026-07-24T09:07:42.000Z';

/** A fake git: canned stdout per subcommand; anything else throws like git does. */
function fakeGit(out: { sha?: string; status?: string }) {
  return (args: readonly string[]): string => {
    if (args[0] === 'rev-parse') return out.sha ?? '';
    if (args[0] === 'status') return out.status ?? '';
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
}

function throwingGit(): never {
  throw new Error('git: command not found');
}

describe('readGitStamp — probing the repo', () => {
  it('reads the short sha and a clean tree', () => {
    const info = readGitStamp({ git: fakeGit({ sha: 'a1b2c3d\n', status: '' }), env: {}, now: NOW });
    expect(info).toEqual({ sha: 'a1b2c3d', time: ISO, dirty: false });
  });

  it('flags a dirty tree from porcelain output', () => {
    const info = readGitStamp({
      git: fakeGit({ sha: 'a1b2c3d\n', status: ' M src/main.ts\n?? scratch.txt\n' }),
      env: {},
      now: NOW,
    });
    expect(info.dirty).toBe(true);
  });

  it('asks git for a 7-char short sha and for porcelain status', () => {
    const calls: string[][] = [];
    readGitStamp({
      git: (args) => {
        calls.push([...args]);
        return args[0] === 'rev-parse' ? 'a1b2c3d' : '';
      },
      env: {},
      now: NOW,
    });
    expect(calls).toEqual([
      ['rev-parse', '--short=7', 'HEAD'],
      ['status', '--porcelain'],
    ]);
  });

  it('falls back to a CI env sha when git is unavailable', () => {
    const info = readGitStamp({
      git: throwingGit,
      env: { GITHUB_SHA: '0123456789abcdef0123456789abcdef01234567' },
      now: NOW,
    });
    expect(info).toEqual({ sha: '0123456', time: ISO, dirty: false });
  });

  it('prefers an explicit VITE_BUILD_SHA over the CI-provided one', () => {
    const info = readGitStamp({
      git: throwingGit,
      env: { VITE_BUILD_SHA: 'deadbee', GITHUB_SHA: '0123456' },
      now: NOW,
    });
    expect(info.sha).toBe('deadbee');
  });

  it('degrades to the dev stamp — never throws — with no git and no env', () => {
    const info = readGitStamp({ git: throwingGit, env: {}, now: NOW });
    expect(info).toEqual({ sha: DEV_SHA, time: ISO, dirty: true });
  });

  it('treats an empty sha (detached/empty repo) as no git at all', () => {
    const info = readGitStamp({ git: fakeGit({ sha: '\n' }), env: {}, now: NOW });
    expect(info.sha).toBe(DEV_SHA);
  });

  it('works against the real repo without throwing', () => {
    const info = readGitStamp();
    expect(typeof info.sha).toBe('string');
    expect(info.sha.length).toBeGreaterThan(0);
    expect(Number.isFinite(Date.parse(info.time))).toBe(true);
  });
});

describe('defineBuildInfo — the injected global', () => {
  it('produces a __BUILD_INFO__ define whose value is valid JSON source', () => {
    const info: BuildInfo = { sha: 'a1b2c3d', time: ISO, dirty: false };
    const define = defineBuildInfo(info);
    expect(Object.keys(define)).toEqual(['__BUILD_INFO__']);
    expect(JSON.parse(define['__BUILD_INFO__'] as string)).toEqual(info);
  });
});

describe('versionJsonPlugin — the dashboard artifact', () => {
  const info: BuildInfo = { sha: 'a1b2c3d', time: ISO, dirty: true };

  /** Collect what the plugin emits, standing in for Rollup's PluginContext. */
  function run(plugin: ReturnType<typeof versionJsonPlugin>) {
    const emitted: Array<{ type: string; fileName: string; source: string }> = [];
    const ctx: EmitFileContext = {
      emitFile: (file) => {
        emitted.push(file);
        return 'ref';
      },
    };
    plugin.generateBundle.call(ctx);
    return emitted;
  }

  it('is a build-only plugin with a stable name', () => {
    const plugin = versionJsonPlugin(info);
    expect(plugin.name).toBe('planet-rush:version-json');
    expect(plugin.apply).toBe('build');
  });

  it('emits exactly one asset at version.json', () => {
    const emitted = run(versionJsonPlugin(info));
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe('asset');
    expect(emitted[0]?.fileName).toBe(VERSION_FILE);
    expect(VERSION_FILE).toBe('version.json');
  });

  it('emits { sha, time } and nothing else — dirty stays local', () => {
    const emitted = run(versionJsonPlugin(info));
    const payload = JSON.parse(emitted[0]?.source ?? '');
    expect(payload).toEqual({ sha: 'a1b2c3d', time: ISO });
    expect(Object.keys(payload).sort()).toEqual(['sha', 'time']);
  });

  it('writes newline-terminated JSON (curl/cat friendly)', () => {
    expect(versionJsonSource(info).endsWith('\n')).toBe(true);
    expect(() => JSON.parse(versionJsonSource(info))).not.toThrow();
  });
});
