/**
 * tests/tools/dark-matter-scan.test.ts — the scan's own spec. OWNER: Platform.
 *
 * `tools/dark-matter-scan.mjs` exists because `matchAbundance` shipped tested,
 * covered, green and uncalled. A detector for that has to be trustworthy in one
 * specific way: it must not call a thing live because its NAME appears
 * somewhere. So the fixture under `tools/fixtures/dark-matter/` is built out of
 * the exact ways a name can appear without being a call — a prose comment, a
 * `{@link}`, a barrel re-export, an import with no call, a same-named local in
 * another scope — and this file asserts the scan sees through every one.
 *
 * It runs the CLI as a subprocess rather than importing it, because the CLI
 * (its flags, its JSON, and above all its EXIT CODE) is what CI depends on, and
 * that is the contract worth pinning.
 *
 * The fixture lives under `tools/` on purpose: the root tsconfig's `include`
 * does not cover it, so the repo's own typecheck never compiles it and the
 * repo's own scan never counts its deliberately-dark exports.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO = resolve(__dirname, '../..');
const SCAN = join(REPO, 'tools/dark-matter-scan.mjs');
const FIXTURE = join(REPO, 'tools/fixtures/dark-matter/tsconfig.json');

interface Row {
  id: string;
  name: string;
  kind: string;
  dark: boolean;
  booted: boolean;
  verdictHint: string;
  uses: {
    prod: number;
    orphan: number;
    test: number;
    tool: number;
    internal: number;
    reexport: number;
  };
}

function runScan(args: string[] = []): { rows: Map<string, Row>; raw: string } {
  const raw = execFileSync(
    process.execPath,
    [SCAN, '--project', FIXTURE, '--entry', 'src/main.ts', '--json', ...args],
    { encoding: 'utf8', cwd: REPO },
  );
  const parsed = JSON.parse(raw) as { exports: Row[] };
  return { rows: new Map(parsed.exports.map((r) => [r.name, r])), raw };
}

/** Run the CLI and hand back its exit code and output instead of throwing. */
function runCli(args: string[]): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [SCAN, ...args], {
      encoding: 'utf8',
      cwd: REPO,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { code: e.status ?? -1, out: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

const scan = runScan();
const row = (name: string): Row => {
  const r = scan.rows.get(name);
  if (!r) throw new Error(`fixture export ${name} missing from the scan output`);
  return r;
};

describe('dark-matter-scan: what counts as a use', () => {
  it('counts a real call — the control', () => {
    expect(row('calledByMain').dark).toBe(false);
    expect(row('calledByMain').uses.prod).toBeGreaterThan(0);
  });

  it('does NOT count a name that only appears in prose and a {@link}', () => {
    // The whole reason this is not a grep. `proseOnly` is named in main.ts's
    // header comment and in its own JSDoc, and called by nothing but a spec.
    const r = row('proseOnly');
    expect(r.dark).toBe(true);
    expect(r.uses.prod).toBe(0);
    expect(r.verdictHint).toBe('test-only');
  });

  it('does NOT count an import with no call in the body', () => {
    const r = row('importedNeverCalled');
    expect(r.dark).toBe(true);
    expect(r.uses.prod).toBe(0);
  });

  it('does NOT count a same-named local in another scope', () => {
    // main.ts declares `const shadowed = () => …`. Text matching sees a use.
    expect(row('shadowed').uses.prod).toBe(0);
    expect(row('shadowed').dark).toBe(true);
  });

  it('treats a barrel re-export as pass-through, not use', () => {
    const r = row('forwardedNeverUsed');
    expect(r.dark).toBe(true);
    expect(r.uses.reexport).toBeGreaterThan(0);
    expect(r.uses.prod).toBe(0);
    expect(r.verdictHint).toBe('reexported-unused');
  });

  it('DOES count a call inside `export default …`', () => {
    // The regression guard: an ancestor-walk that stopped at the first export
    // node called this plumbing, and reported vite.config.ts's own
    // `defineBuildInfo` call dark while every build was making it.
    expect(row('defineThing').dark).toBe(false);
    expect(row('defineThing').uses.prod).toBeGreaterThan(0);
  });
});

describe('dark-matter-scan: how a candidate is classified', () => {
  it('calls a cross-file reference from an unreachable module an orphan, not a use', () => {
    const helper = row('islandHelper');
    expect(helper.booted).toBe(false);
    expect(helper.uses.orphan).toBeGreaterThan(0); // island-user.ts calls it
    expect(helper.uses.prod).toBe(0); // …and nothing boots island-user.ts
    expect(helper.dark).toBe(true);
    expect(helper.verdictHint).toBe('orphan-module');
    expect(row('islandCaller').verdictHint).toBe('orphan-module');
  });

  it('separates a module using its own helper from an unwired one', () => {
    // `selfUsed` runs on every call to `callsSelfUsed`; only the `export` is
    // too wide. Ranking that with the matchAbundance class would bury it.
    const r = row('selfUsed');
    expect(r.uses.internal).toBeGreaterThan(0);
    expect(r.verdictHint).toBe('self-used');
  });

  it('reports an export nothing names at all as unreferenced', () => {
    expect(row('NEVER_NAMED').verdictHint).toBe('unreferenced');
  });
});

describe('dark-matter-scan --check: the gate', () => {
  const allowlistWith = (ids: string[]): string => {
    const dir = mkdtempSync(join(tmpdir(), 'dm-allow-'));
    const path = join(dir, 'allowlist.json');
    writeFileSync(
      path,
      JSON.stringify({ gate: {}, allow: Object.fromEntries(ids.map((id) => [id, 'fixture'])) }),
    );
    return path;
  };

  /** Every gate-relevant dark export in the fixture, by id. */
  const gateRelevant = [...scan.rows.values()]
    .filter(
      (r) =>
        r.dark &&
        ['function', 'const', 'class', 'enum'].includes(r.kind) &&
        r.verdictHint !== 'self-used',
    )
    .map((r) => r.id);

  const base = ['--project', FIXTURE, '--entry', 'src/main.ts', '--check'];

  it('is RED when a dark export is missing from the allowlist', () => {
    const missing = 'src/helpers.ts#proseOnly';
    expect(gateRelevant).toContain(missing);
    const { code, out } = runCli([
      ...base,
      '--allowlist',
      allowlistWith(gateRelevant.filter((id) => id !== missing)),
    ]);
    expect(code).toBe(1);
    expect(out).toContain('proseOnly');
    expect(out).toContain('DARK MATTER');
  });

  it('is GREEN once that export is triaged onto the allowlist', () => {
    const { code, out } = runCli([...base, '--allowlist', allowlistWith(gateRelevant)]);
    expect(code).toBe(0);
    expect(out).toContain('no new dark exports');
  });

  it('ignores a self-used export — the gate does not fire on a wide export keyword', () => {
    // `selfUsed` is dark by the report's definition but absent from the
    // allowlist below, and the gate stays green.
    expect(gateRelevant).not.toContain('src/helpers.ts#selfUsed');
  });

  it('refuses to report a clean scan when it resolved no files', () => {
    // A gate that passes by measuring nothing is worse than no gate. Pointing
    // --project at something that yields an empty program must be loud.
    const dir = mkdtempSync(join(tmpdir(), 'dm-empty-'));
    const cfg = join(dir, 'tsconfig.json');
    writeFileSync(cfg, JSON.stringify({ include: ['nothing-here'] }));
    const { code, out } = runCli(['--project', cfg, '--check']);
    expect(code).not.toBe(0);
    expect(out).toContain('Refusing to report a clean scan of nothing');
  });
});
