#!/usr/bin/env node
/**
 * tools/dark-matter-scan.mjs — find exports that production never calls.
 *
 * WHY THIS EXISTS (a1-09). `matchAbundance` in `src/sim/match-config.ts` is
 * three lines, correct, and tested. Its entire job is applying the ratified
 * SCARCE default. It had zero non-test callers: production read
 * `config.abundance` raw, which resolved to `standard`, and every match ever
 * played ran a 150 s wave schedule under a lobby chip that read SCARCE. Types
 * passed. Tests passed. CI was green. The function was covered. The only
 * symptom was that nobody called it. That is the fifth time a merged-green
 * feature was never wired into the boot path, and every one was found by a
 * human eventually noticing. This is the part worth automating.
 *
 * WHAT IT DOES. For every export declared under `src/`, count the references to
 * it from PRODUCTION files. Zero is a candidate for triage. It reports test-only
 * and tooling-only references separately, because "called by tests and nothing
 * else" is the exact shape of the bug above.
 *
 * "Production" means REACHABLE PRODUCTION: a file the boot path can actually
 * arrive at, by following imports from `src/main.ts` and `server/index.ts`. A
 * reference from a module that nothing boots is not a use — that is how a whole
 * unwired cluster keeps itself alive in a naive scan, every member "called" by
 * a sibling nobody ever loads. Those references are counted under `orphan`.
 *
 * ── Why the TypeScript compiler API and not grep ──────────────────────────
 *
 * `matchAbundance` appears in prose — a `{@link}` in its own JSDoc, and a
 * comment in `src/platform/match-boot.ts` explaining the default it applies. A
 * text search finds three "callers" and calls the function live. The whole bug
 * would have been invisible. So references are resolved through the checker:
 * an identifier counts only when its symbol resolves to the export, which means
 * comments, strings, and same-named locals in other scopes never count.
 *
 * ── The three rules that decide what a "use" is ───────────────────────────
 *
 * 1. RE-EXPORTS ARE PASS-THROUGH, NOT USE. `export { x } from './y'` in a
 *    barrel is plumbing. A symbol re-exported through `src/sim/index.ts` and
 *    consumed by nobody is still dark, and a scan that counted the barrel would
 *    say every symbol in this repo is live — the barrels re-export nearly
 *    everything.
 * 2. AN IMPORT IS NOT A USE. `import { x } from './y'` with no call in the body
 *    is the signature of a half-finished wiring. The identifier at the import
 *    specifier is skipped; the ones in the body are what count. (This falls out
 *    for free and it is worth naming, because it is how a "wired" feature that
 *    is imported and then forgotten still shows up dark.)
 * 3. THE DECLARATION IS NOT A USE. Obviously. But also: a reference from inside
 *    the declaring file is counted SEPARATELY from a cross-file one, because a
 *    helper its own module calls IS RUNNING. The finding there is only that the
 *    `export` is wider than the use — untidy, not dark — so it is reported as
 *    `self-used` and the CI gate ignores it.
 *
 * ── What it cannot see, stated so the report can be read honestly ─────────
 *
 * A symbol reached by string key (a registry, a `Record<string, Handler>` built
 * elsewhere, a dynamic `import()` of a computed path) resolves to no identifier
 * and will be reported dark. That is a FALSE POSITIVE and it is what triage in
 * `docs/dark-matter-scan.md` is for. The scan finds candidates; a human says
 * which are DARK, which are SURFACE, and which are DEAD.
 *
 * That last sentence is also where this can go wrong in the other direction: the
 * human can be wrong about a candidate the scan got right. `--audit` (a1-14)
 * holds the written verdicts to the numbers they were written next to.
 *
 * ── Usage ────────────────────────────────────────────────────────────────
 *
 *   npm run dark-matter                  # the candidate list, grouped by file
 *   npm run dark-matter -- --json        # machine-readable, for diffing
 *   npm run dark-matter -- --modules     # the per-module rollup + unreachable files
 *   npm run dark-matter -- --check       # CI gate: fail on a NEW dark export
 *   npm run dark-matter -- --audit       # hold the allowlist's verdicts to the numbers
 *   npm run dark-matter -- --all         # every export with its use counts
 *   npm run dark-matter -- --write-allowlist   # re-baseline the gate
 *   node tools/dark-matter-scan.mjs --project ../old/tsconfig.json
 *                                        # scan another checkout (see --project)
 */

import ts from 'typescript';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ── File roles ────────────────────────────────────────────────────────────
//
// PROD is the only role whose references keep an export out of the candidate
// list. `server/` is production: it is the match authority and it ships. So is
// `allocator/` — a THIRD deployed app, which cost two false positives before it
// was listed here: it imports `signTicket` and `verifyFleetRequest` out of
// `src/net/`, and with `allocator/` unclassified the scan called the fleet's
// request-signing dark while the control plane was calling it on every request.
// A production tree missing from this list is the one way this scan can be
// confidently wrong, so unclassified directories are NAMED in the report rather
// than silently bucketed (see `otherDirs`).
//
// `harness/` is the balance/soak CLI — real, useful, and NOT the game, so an
// export only the harness reaches is still not on any player's boot path.

/** @typedef {'prod' | 'test' | 'tool' | 'other'} Role */

/** @returns {Role} */
function roleOf(rel) {
  if (/\.(test|spec)\.[cm]?tsx?$/.test(rel)) return 'test';
  if (rel.startsWith('tests/')) return 'test';
  if (rel.startsWith('harness/') || rel.startsWith('tools/') || rel.startsWith('evidence/')) {
    return 'tool';
  }
  if (rel.startsWith('src/') || rel.startsWith('server/') || rel.startsWith('allocator/')) {
    return 'prod';
  }
  if (/^vite\.config\.ts$|^vitest\.config\.ts$|^playwright[.\w-]*\.config\.ts$/.test(rel)) {
    return 'prod';
  }
  return 'other';
}

// ── Arguments ─────────────────────────────────────────────────────────────

/**
 * The boot path's front doors — all three deployed apps, plus the build. Miss
 * one and everything only it reaches reports dark. `server/index.ts` is what the
 * fly.io gameserver runs; `allocator/index.ts` is the fleet control plane;
 * `vite.config.ts` is loaded by the build itself (it imports
 * `src/platform/build-stamp`, which is therefore live even though no game code
 * calls it).
 *
 * `index.html` loads **two** modules, not one (u14-01). Its inline entry script
 * statically imports `src/ui/font-boot.ts` and awaits it before it dynamically
 * imports `src/main.ts` — the boot gate that blocks first paint on the two
 * self-hosted typefaces, which has to run before the renderer is built or the
 * first frame bakes a fallback face into a texture (GDD §5.6). It is a literal
 * front door, so it is listed as one: without it the gate and everything only it
 * reaches — the ratified-face table — report dark while actually running on
 * every boot, which is the exact inversion this scan exists to prevent.
 */
const DEFAULT_ENTRIES = [
  'src/main.ts',
  'src/ui/font-boot.ts',
  'server/index.ts',
  'allocator/index.ts',
  'vite.config.ts',
];

function parseArgs(argv) {
  const opts = {
    json: false,
    all: false,
    check: false,
    audit: false,
    modules: false,
    writeAllowlist: false,
    project: resolve(REPO_ROOT, 'tsconfig.json'),
    allowlist: resolve(REPO_ROOT, 'tools/dark-matter-allowlist.json'),
    types: true,
    entries: [...DEFAULT_ENTRIES],
  };
  let userEntries = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--check') opts.check = true;
    else if (a === '--audit') opts.audit = true;
    else if (a === '--modules') opts.modules = true;
    else if (a === '--write-allowlist') opts.writeAllowlist = true;
    else if (a === '--no-types') opts.types = false;
    else if (a === '--project' || a === '-p') opts.project = resolve(argv[++i]);
    else if (a === '--entry') {
      if (!userEntries) {
        opts.entries = [];
        userEntries = true;
      }
      opts.entries.push(argv[++i]);
    } else if (a === '--allowlist') opts.allowlist = resolve(argv[++i]);
    else if (a === '--help' || a === '-h') {
      process.stdout.write(HELP);
      process.exit(0);
    } else {
      process.stderr.write(`dark-matter-scan: unknown argument ${a}\n${HELP}`);
      process.exit(2);
    }
  }
  return opts;
}

const HELP = `
Usage: node tools/dark-matter-scan.mjs [options]

  --json               emit JSON instead of the human report
  --all                list every export, not just the zero-production ones
  --modules            per-module rollup, and the modules no entry point reaches
  --check              exit 1 if a candidate is missing from the allowlist
  --audit              hold the allowlist's written verdicts to the scan's
                       numbers (a1-14). Reports, never fails.
  --write-allowlist    rewrite the allowlist from today's candidates (re-baseline)
  --no-types           skip type-only exports (interfaces, type aliases)
  --entry PATH         boot-path entry point, repeatable
                       (default: ${DEFAULT_ENTRIES.join(', ')})
  -p, --project PATH   tsconfig to scan (default: this repo's)
  --allowlist PATH     allowlist for --check (default: tools/dark-matter-allowlist.json)
`;

// ── Program ───────────────────────────────────────────────────────────────

function createProgram(configPath) {
  const host = {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: (d) => {
      throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
    },
  };
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, host);
  if (!parsed) throw new Error(`could not read ${configPath}`);
  // `noEmit` is already set; force it anyway so a stray tsconfig can never make
  // a read-only scan write files into the tree it is scanning.
  const options = { ...parsed.options, noEmit: true };
  return ts.createProgram(parsed.fileNames, options);
}

// ── Reachability from the boot path ───────────────────────────────────────
//
// The bug this tool is named after is "merged green and never wired into the
// boot path", so the boot path is walked literally: start at the entry points,
// follow every static import and every `import()` with a literal path, and see
// which modules you can arrive at. A module you cannot arrive at cannot run,
// and a reference from inside one is not evidence that anything is called.
//
// Tests are NOT entry points, which is the whole point — a spec file importing
// a module is exactly the situation being detected.

function moduleSpecifiersOf(file) {
  const specs = [];
  const visit = (node) => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specs.push(node.moduleSpecifier.text);
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length &&
      ts.isStringLiteralLike(node.arguments[0])
    ) {
      // A computed `import(variable)` resolves to nothing here; that is a known
      // blind spot, stated in the report rather than papered over.
      specs.push(node.arguments[0].text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specs;
}

/**
 * @returns {Set<string>} normalized absolute paths of every module an entry
 *   point can reach through non-test imports.
 */
function reachableFrom(program, entries, projectRoot) {
  const options = program.getCompilerOptions();
  const byPath = new Map();
  for (const f of program.getSourceFiles()) byPath.set(resolve(f.fileName), f);

  const seen = new Set();
  const queue = [];
  const missing = [];
  for (const entry of entries) {
    const abs = resolve(projectRoot, entry);
    if (byPath.has(abs)) queue.push(abs);
    else missing.push(entry);
  }

  while (queue.length) {
    const abs = queue.pop();
    if (seen.has(abs)) continue;
    seen.add(abs);
    const file = byPath.get(abs);
    if (!file) continue;
    for (const spec of moduleSpecifiersOf(file)) {
      const resolved = ts.resolveModuleName(spec, file.fileName, options, ts.sys).resolvedModule;
      if (!resolved || resolved.isExternalLibraryImport) continue;
      const target = resolve(resolved.resolvedFileName);
      if (!byPath.has(target)) continue;
      if (!seen.has(target)) queue.push(target);
    }
  }
  return { seen, missing };
}

// ── Symbol identity ───────────────────────────────────────────────────────
//
// Every reference is followed to the ORIGINAL declaration before it is counted,
// so a use through a barrel lands on the symbol that actually declares the
// thing. `getAliasedSymbol` throws on a symbol that is not an alias, and the
// chain can be several links long (source -> barrel -> parent barrel -> use),
// hence the loop and the guard.

function unalias(checker, symbol) {
  let s = symbol;
  for (let i = 0; i < 16 && s && s.flags & ts.SymbolFlags.Alias; i++) {
    let next;
    try {
      next = checker.getAliasedSymbol(s);
    } catch {
      return s;
    }
    if (!next || next === s) return s;
    s = next;
  }
  return s;
}

/** The kind we print — good enough to triage by, not a type system. */
function kindOf(symbol) {
  const f = symbol.flags;
  if (f & ts.SymbolFlags.Function) return 'function';
  if (f & ts.SymbolFlags.Class) return 'class';
  if (f & ts.SymbolFlags.Interface) return 'interface';
  if (f & ts.SymbolFlags.TypeAlias) return 'type';
  if (f & ts.SymbolFlags.Enum || f & ts.SymbolFlags.EnumMember) return 'enum';
  if (f & ts.SymbolFlags.Variable || f & ts.SymbolFlags.BlockScopedVariable) return 'const';
  if (f & ts.SymbolFlags.Module) return 'namespace';
  return 'other';
}

const TYPE_ONLY_KINDS = new Set(['interface', 'type']);

/**
 * Is this identifier the NAME of the declaration it belongs to? Those are not
 * references. `export function matchAbundance()` mentions the name once as a
 * declaration and that must not count as its own caller.
 */
function isDeclarationName(node) {
  const p = node.parent;
  if (!p) return false;
  return (
    (ts.isFunctionDeclaration(p) ||
      ts.isClassDeclaration(p) ||
      ts.isInterfaceDeclaration(p) ||
      ts.isTypeAliasDeclaration(p) ||
      ts.isEnumDeclaration(p) ||
      ts.isEnumMember(p) ||
      ts.isModuleDeclaration(p) ||
      ts.isVariableDeclaration(p) ||
      ts.isBindingElement(p) ||
      ts.isParameter(p) ||
      ts.isPropertyDeclaration(p) ||
      ts.isPropertySignature(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isMethodSignature(p)) &&
    p.name === node
  );
}

/**
 * Classify a reference site. Returns 'reexport' for barrel plumbing, 'import'
 * for a bare import specifier, 'ref' for a real use.
 *
 * Both non-uses are deliberate and both matter: see rules 1 and 2 in the header.
 */
function siteKindOf(node) {
  const p = node.parent;
  if (!p) return 'ref';

  // `export { x }` / `export { x } from './y'` — the barrel's own plumbing.
  if (ts.isExportSpecifier(p)) return 'reexport';

  // `export default x` forwards a local binding, so THAT is plumbing too — but
  // ONLY when the identifier is the whole expression. This cost a false
  // positive: `export default defineConfig({ define: defineBuildInfo(...) })`
  // in vite.config.ts puts a genuine call inside an ExportAssignment, and an
  // ancestor-walk that stopped at the first export node discarded it, marking
  // `defineBuildInfo` dark while the build called it on every single run. The
  // check is on the immediate parent for exactly that reason: an ancestor walk
  // answers a question about the wrong node.
  if (ts.isExportAssignment(p) && p.expression === node) return 'reexport';

  // The import statement itself is not a use; the call in the body is.
  if (
    ts.isImportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isNamespaceImport(p) ||
    ts.isImportEqualsDeclaration(p)
  ) {
    return 'import';
  }

  // A JSDoc `{@link matchAbundance}` is prose — the trap that makes grep
  // useless here. `ts.forEachChild` does not descend into JSDoc, so this is a
  // guard rather than a hot path; it stays because "the scan quietly started
  // counting comments" is not a failure anyone would notice.
  if (
    ts.isJSDoc(p) ||
    p.kind === ts.SyntaxKind.JSDocLink ||
    p.kind === ts.SyntaxKind.JSDocLinkCode ||
    p.kind === ts.SyntaxKind.JSDocLinkPlain ||
    p.kind === ts.SyntaxKind.JSDocMemberName
  ) {
    return 'doc';
  }

  return 'ref';
}

// ── The scan ──────────────────────────────────────────────────────────────

function scan(opts) {
  const program = createProgram(opts.project);
  const checker = program.getTypeChecker();
  const projectRoot = dirname(opts.project);

  const relOf = (file) => relative(projectRoot, file.fileName).split('\\').join('/');

  const { seen: reachable, missing: missingEntries } = reachableFrom(
    program,
    opts.entries,
    projectRoot,
  );
  const isReachable = (file) => reachable.has(resolve(file.fileName));

  /** symbol -> record. Keyed on the ORIGINAL symbol object, which is stable
   *  within one Program, so a use resolved through three barrels still lands
   *  on the one record. */
  const exports = new Map();

  // 1. Collect every export declared under src/.
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    const rel = relOf(file);
    if (!rel.startsWith('src/')) continue;
    if (roleOf(rel) !== 'prod') continue; // src/**/*.test.ts declares test helpers

    const moduleSymbol = checker.getSymbolAtLocation(file);
    if (!moduleSymbol) continue; // not a module (no top-level import/export)

    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const origin = unalias(checker, exported);
      const decl = origin.declarations?.[0];
      if (!decl) continue;
      const declFile = decl.getSourceFile();
      const declRel = relOf(declFile);
      // A symbol re-exported from elsewhere is attributed to where it is
      // declared, so a barrel does not clone every symbol it forwards.
      if (declRel !== rel) continue;
      if (exports.has(origin)) continue;

      const { line } = declFile.getLineAndCharacterOfPosition(decl.getStart());
      exports.set(origin, {
        name: exported.getName(),
        file: rel,
        line: line + 1,
        kind: kindOf(origin),
        /** Does the boot path reach the module this is declared in at all? */
        booted: isReachable(file),
        uses: { prod: 0, orphan: 0, test: 0, tool: 0, other: 0, internal: 0, reexport: 0 },
        /** Where the production references are, for the report. */
        prodSites: [],
        testSites: [],
      });
    }
  }

  // Every top-level directory whose files this scan does not recognise. A
  // production app landing in here is the failure mode that matters: its calls
  // are counted as nothing and everything only it uses reports dark. It is
  // printed with the results rather than logged, because a diagnostic nobody
  // reads is how `allocator/` went unnoticed in the first place.
  const otherDirs = new Set();

  // 2. Count references, from every file in the program.
  for (const file of program.getSourceFiles()) {
    if (file.isDeclarationFile) continue;
    const rel = relOf(file);
    if (roleOf(rel) === 'other') otherDirs.add(rel.split('/')[0]);
    // A production file the boot path never reaches contributes `orphan`
    // references, not `prod` ones. See the reachability note above.
    const role = roleOf(rel) === 'prod' && !isReachable(file) ? 'orphan' : roleOf(rel);

    const visit = (node) => {
      if (ts.isIdentifier(node) && !isDeclarationName(node)) {
        const sym = checker.getSymbolAtLocation(node);
        if (sym) {
          const origin = unalias(checker, sym);
          const record = exports.get(origin);
          if (record) {
            const site = siteKindOf(node);
            if (site === 'reexport') {
              record.uses.reexport++;
            } else if (site === 'ref') {
              if (rel === record.file) {
                record.uses.internal++;
              } else {
                record.uses[role]++;
                if (role === 'prod' && record.prodSites.length < 4) record.prodSites.push(rel);
                if (role === 'test' && record.testSites.length < 4) record.testSites.push(rel);
              }
            }
            // 'import' and 'doc' sites are counted as nothing, on purpose.
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }

  const all = [...exports.values()].sort(
    (a, b) => a.file.localeCompare(b.file) || a.line - b.line,
  );
  for (const r of all) {
    r.id = `${r.file}#${r.name}`;
    r.dark = r.uses.prod === 0;
    r.verdictHint = classify(r);
  }

  // The module rollup: which files under src/ the boot path never reaches, and
  // how much of each file's surface is dark.
  const modules = new Map();
  for (const r of all) {
    if (!modules.has(r.file)) {
      modules.set(r.file, { file: r.file, booted: r.booted, exports: 0, dark: 0, values: 0, darkValues: 0 });
    }
    const m = modules.get(r.file);
    m.exports++;
    const isValue = !TYPE_ONLY_KINDS.has(r.kind);
    if (isValue) m.values++;
    if (r.dark) {
      m.dark++;
      if (isValue) m.darkValues++;
    }
  }

  // A scan that resolved nothing must not report "no dark exports" — that is a
  // green check measuring an empty set, which is how a gate silently stops
  // gating (the same trap `vitest.config.ts` documents about a dropped
  // `include`). Pointing `--project` at the wrong file is enough to cause it.
  if (all.length === 0) {
    throw new Error(
      `no exports found under src/ via ${opts.project} — wrong --project, or an empty checkout. ` +
        `Refusing to report a clean scan of nothing.`,
    );
  }

  return {
    all,
    modules: [...modules.values()],
    missingEntries,
    otherDirs: [...otherDirs].sort(),
    program,
  };
}

/**
 * A first-pass label so triage starts from something. It is a HINT — the
 * report's DARK / SURFACE / DEAD verdicts are written by a human, because only
 * a human knows that `registerServiceWorker` is called by the platform and
 * `matchAbundance` should have been called by world-build.
 */
function classify(r) {
  if (!r.dark) return 'live';
  if (!r.booted) return 'orphan-module'; // nothing boots the file this lives in
  // ORDER MATTERS, and it cost a false positive to learn it. `reducedSkyDensity`
  // (src/art/backdrop.ts) is called twice inside its own module and asserted by
  // its spec. Testing `test` before `internal` labelled it "test-only" — the
  // matchAbundance shape — when the code demonstrably runs on every frame the
  // sky is throttled. A symbol its own module uses is LIVE; the only finding is
  // that the `export` is wider than the use, which is untidy, not dark.
  if (r.uses.internal > 0) return 'self-used';
  if (r.uses.test > 0) return 'test-only'; // the matchAbundance shape
  if (r.uses.tool > 0) return 'tool-only';
  if (r.uses.reexport > 0) return 'reexported-unused'; // forwarded by a barrel, consumed by nobody
  return 'unreferenced';
}

// ── Reporting ─────────────────────────────────────────────────────────────

const HINT_ORDER = [
  'orphan-module',
  'test-only',
  'tool-only',
  'unreferenced',
  'reexported-unused',
  'self-used',
];

/**
 * The two ways this scan is wrong rather than merely noisy: an entry point that
 * does not resolve (so a whole app looks unreachable), and a directory it does
 * not recognise (so a real caller is counted as nothing). Both are printed with
 * every result — human, module and gate — because they invalidate the output
 * they appear next to.
 */
function warnings(diag) {
  const out = [];
  if (diag.missingEntries?.length) {
    out.push(
      `WARNING: entry point not found in the program: ${diag.missingEntries.join(', ')} —` +
        ` everything only it reaches will report dark.`,
    );
  }
  if (diag.otherDirs?.length) {
    out.push(
      `WARNING: unclassified directories in the program: ${diag.otherDirs.join(', ')} —` +
        ` if any of those ship, add it to roleOf() and to the entry points, or its` +
        ` calls count as nothing (this is how allocator/ was missed).`,
    );
  }
  return out;
}

function moduleReport(modules, diag, opts) {
  const out = [...warnings(diag)];
  const unbooted = modules.filter((m) => !m.booted).sort((a, b) => a.file.localeCompare(b.file));
  out.push('');
  out.push(`── modules the boot path never reaches  (${unbooted.length}) ${'─'.repeat(24)}`);
  out.push('   Nothing imported from these can run. Entry points: ' + opts.entries.join(', '));
  for (const m of unbooted) out.push(`  ${m.file}  (${m.exports} exports)`);

  const partial = modules
    .filter((m) => m.booted && m.darkValues > 0)
    .sort((a, b) => b.darkValues - a.darkValues || a.file.localeCompare(b.file));
  out.push('');
  out.push(`── booted modules with dark value exports  (${partial.length}) ${'─'.repeat(21)}`);
  for (const m of partial) {
    out.push(`  ${String(m.darkValues).padStart(3)}/${String(m.values).padEnd(3)} dark  ${m.file}`);
  }
  return out.join('\n');
}

function humanReport(rows, opts, diag) {
  const out = [];
  const shown = opts.all ? rows : rows.filter((r) => r.dark);
  const byHint = new Map();
  for (const r of shown) {
    const k = opts.all && !r.dark ? 'live' : r.verdictHint;
    if (!byHint.has(k)) byHint.set(k, []);
    byHint.get(k).push(r);
  }

  const order = opts.all ? [...HINT_ORDER, 'live'] : HINT_ORDER;
  for (const hint of order) {
    const group = byHint.get(hint);
    if (!group?.length) continue;
    out.push('');
    out.push(`── ${hint}  (${group.length}) ${'─'.repeat(Math.max(0, 56 - hint.length))}`);
    for (const r of group) {
      const u = r.uses;
      const counts = [
        `prod:${u.prod}`,
        `orphan:${u.orphan}`,
        `test:${u.test}`,
        `tool:${u.tool}`,
        `self:${u.internal}`,
        `re-export:${u.reexport}`,
      ].join(' ');
      out.push(`  ${r.file}:${r.line}  ${r.name}  [${r.kind}]`);
      out.push(`      ${counts}${r.testSites.length ? `   tests: ${r.testSites.join(', ')}` : ''}`);
    }
  }

  const dark = rows.filter((r) => r.dark);
  out.push('');
  out.push('─'.repeat(64));
  out.push(...warnings(diag));
  out.push(`${rows.length} exports under src/ · ${dark.length} with zero production references`);
  const values = dark.filter((r) => !TYPE_ONLY_KINDS.has(r.kind));
  out.push(`${values.length} of those are values (function/const/class/enum), ${dark.length - values.length} are types`);
  return out.join('\n');
}

// ── The gate ──────────────────────────────────────────────────────────────
//
// `--check` fails on a NEW dark export and only that. Today's triaged list is
// the allowlist, so the gate says "you just added one" rather than "this
// codebase has 60 findings", which is the difference between a check people
// act on and a check people learn to skip.

const DEFAULT_GATE = {
  kinds: ['function', 'const', 'class', 'enum'],
  hints: ['orphan-module', 'test-only', 'tool-only', 'unreferenced', 'reexported-unused'],
};

/** The rows the gate is allowed to fail on: value exports, minus the hints the
 *  allowlist's `gate` block excludes (`self-used` by default — a module that
 *  calls its own helper is running it; the wide `export` is untidy, not dark). */
function gatedRows(rows, gate) {
  const kinds = new Set(gate.kinds ?? DEFAULT_GATE.kinds);
  const hints = new Set(gate.hints ?? DEFAULT_GATE.hints);
  return rows.filter((r) => kinds.has(r.kind) && (!r.dark || hints.has(r.verdictHint)));
}

function writeAllowlist(rows, opts) {
  const previous = existsSync(opts.allowlist)
    ? JSON.parse(readFileSync(opts.allowlist, 'utf8'))
    : {};
  const gate = { ...DEFAULT_GATE, ...(previous.gate ?? {}) };
  const dark = gatedRows(rows, gate).filter((r) => r.dark);
  const allow = {};
  for (const r of dark.sort((a, b) => a.id.localeCompare(b.id))) {
    allow[r.id] = previous.allow?.[r.id] ?? `baselined a1-09 (${r.verdictHint})`;
  }
  const doc = {
    $comment: previous.$comment ?? ALLOWLIST_COMMENT,
    gate,
    allow,
  };
  writeFileSync(opts.allowlist, JSON.stringify(doc, null, 2) + '\n');
  process.stdout.write(
    `dark-matter-scan: wrote ${Object.keys(allow).length} entries to ${relative(REPO_ROOT, opts.allowlist)}\n`,
  );
  return 0;
}

const ALLOWLIST_COMMENT = [
  'Known dark exports as of a1-09, triaged in docs/dark-matter-scan.md.',
  'The gate (tools/dark-matter-scan.mjs --check, run by CI) fails on a NEW one.',
  'Adding a line here is a claim that the export is a deliberate seam, public',
  'surface, or an accepted backlog item — say which in docs/dark-matter-scan.md.',
].join(' ');

function runCheck(rows, opts, diag) {
  if (!existsSync(opts.allowlist)) {
    process.stderr.write(`dark-matter-scan: --check needs an allowlist at ${opts.allowlist}\n`);
    return 2;
  }
  const allow = JSON.parse(readFileSync(opts.allowlist, 'utf8'));
  const gate = { ...DEFAULT_GATE, ...(allow.gate ?? {}) };
  const known = new Map(Object.entries(allow.allow ?? {}));

  const relevant = gatedRows(rows, gate);
  const dark = relevant.filter((r) => r.dark);
  const added = dark.filter((r) => !known.has(r.id));
  const stale = [...known.keys()].filter((id) => {
    const row = rows.find((r) => r.id === id);
    return !row || !row.dark;
  });

  // The gate is the one output nobody reads by choice — it is read when it goes
  // red — so the two "this scan may be wrong" warnings have to travel with it.
  // An unclassified production tree makes the gate fail on exports that tree
  // calls on every request (`allocator/`, exactly), and the warning is the only
  // thing that says so at the moment someone is staring at the failure.
  const lines = [...warnings(diag)];
  if (stale.length) {
    lines.push('');
    lines.push(`NOTE: ${stale.length} allowlist entr${stale.length === 1 ? 'y is' : 'ies are'} no longer dark — production now calls them.`);
    lines.push('      Drop them from tools/dark-matter-allowlist.json; this is not a failure.');
    for (const id of stale) lines.push(`      ${id}`);
  }
  if (added.length) {
    lines.push('');
    lines.push(`DARK MATTER: ${added.length} new export${added.length === 1 ? '' : 's'} that no production code calls.`);
    lines.push('');
    for (const r of added) {
      lines.push(`  ${r.file}:${r.line}  ${r.name}  [${r.kind}]  (${r.verdictHint})`);
      if (r.uses.test) lines.push(`      tested by: ${r.testSites.join(', ')}`);
    }
    lines.push('');
    lines.push('  An export nothing calls is either unfinished wiring or dead code.');
    lines.push('  This gate exists because `matchAbundance` shipped tested, covered, green');
    lines.push('  and uncalled, and every match ran the wrong wave schedule for weeks.');
    lines.push('');
    lines.push('  Wire it up, delete it, or — if it is a deliberate seam or public');
    lines.push('  surface — add it to tools/dark-matter-allowlist.json with a reason,');
    lines.push('  and record the verdict in docs/dark-matter-scan.md.');
    process.stdout.write(lines.join('\n') + '\n');
    return 1;
  }
  lines.push('');
  lines.push(`dark-matter-scan: no new dark exports (${dark.length} known, ${relevant.length} value exports scanned).`);
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

// ── The verdict audit ─────────────────────────────────────────────────────
//
// `--audit` checks the allowlist's *prose* against the scan's numbers. It exists
// because of a1-14: §4.3 of the report recommended deleting
// `src/net/connect-trace-view.ts`, which puts RETRY and DOWNLOAD LOG on a failed
// join and is called from `src/main.ts` three times. The scan had that right —
// it flagged two of the module's fourteen exports and called the other five
// live. The *triage* generalised two symbol findings into a module verdict,
// justified by the module's header rather than by the numbers next to it.
//
// A tool cannot stop a human misreading a header. It can notice when a DEAD
// verdict has been written next to symbols in a module whose other exports the
// same scan calls live, which is the shape that misreading leaves behind. So
// this reports and never fails: it is a prompt to re-read a row, not a gate.

/** The verdict word a triage line opens with — `DEAD — …` → `DEAD`. */
function verdictWordOf(reason) {
  const word = String(reason).trim().split(/[\s—:-]/, 1)[0];
  return /^[A-Z]{3,}$/.test(word) ? word : null;
}

function runAudit(rows, opts, diag) {
  if (!existsSync(opts.allowlist)) {
    process.stderr.write(`dark-matter-scan: --audit needs an allowlist at ${opts.allowlist}\n`);
    return 2;
  }
  const allow = Object.entries(JSON.parse(readFileSync(opts.allowlist, 'utf8')).allow ?? {});
  const byId = new Map(rows.map((r) => [r.id, r]));
  const lines = [...warnings(diag), ''];

  // (1) A DEAD verdict sitting in a module the scan still finds live exports in.
  const deadModules = new Map();
  for (const [id, reason] of allow) {
    if (verdictWordOf(reason) !== 'DEAD') continue;
    const file = id.split('#')[0];
    if (!deadModules.has(file)) deadModules.set(file, []);
    deadModules.get(file).push(id);
  }
  const mixed = [];
  for (const [file, ids] of deadModules) {
    const live = rows.filter((r) => r.file === file && !r.dark);
    if (live.length) mixed.push({ file, ids, live });
  }
  if (mixed.length) {
    const one = mixed.length === 1;
    lines.push(
      `VERDICTS TO RE-READ: ${mixed.length} module${one ? '' : 's'} ${one ? 'carries' : 'carry'} a DEAD verdict and still ${one ? 'has' : 'have'} exports production calls.`,
    );
    lines.push('      The verdict may still be right about the symbols it names — but it is');
    lines.push('      not right about the file, and a reader will take it for the file.');
    for (const { file, ids, live } of mixed) {
      lines.push('');
      lines.push(`      ${file}  — ${ids.length} marked DEAD, ${live.length} live`);
      for (const r of live) {
        const sites = [...new Set(r.prodSites)].join(', ');
        lines.push(`        LIVE  ${r.name} (prod:${r.uses.prod}${sites ? ` — ${sites}` : ''})`);
      }
    }
    lines.push('');
  }

  // (2) A verdict written about a symbol that is gone, or that production now calls.
  const gone = allow.filter(([id]) => !byId.has(id)).map(([id]) => id);
  const revived = allow.filter(([id]) => byId.get(id) && !byId.get(id).dark).map(([id]) => id);
  for (const [one, many, ids] of [
    ['names a symbol that no longer exists', 'name symbols that no longer exist', gone],
    [
      'is no longer dark — production calls it now',
      'are no longer dark — production calls them now',
      revived,
    ],
  ]) {
    if (!ids.length) continue;
    const single = ids.length === 1;
    lines.push(`NOTE: ${ids.length} allowlist entr${single ? 'y' : 'ies'} ${single ? one : many}.`);
    for (const id of ids) lines.push(`      ${id}`);
    lines.push('');
  }

  const clean = !mixed.length && !gone.length && !revived.length;
  lines.push(
    clean
      ? `dark-matter-scan: ${allow.length} allowlist verdicts agree with the scan.`
      : `dark-matter-scan: ${allow.length} allowlist verdicts audited — see above. (Reporting only; exit 0.)`,
  );
  process.stdout.write(lines.join('\n') + '\n');
  return 0;
}

// ── main ──────────────────────────────────────────────────────────────────

const opts = parseArgs(process.argv.slice(2));
const { all, modules, missingEntries, otherDirs } = scan(opts);
const diag = { missingEntries, otherDirs };
const rows = opts.types ? all : all.filter((r) => !TYPE_ONLY_KINDS.has(r.kind));

if (opts.writeAllowlist) {
  process.exit(writeAllowlist(rows, opts));
} else if (opts.check) {
  process.exit(runCheck(rows, opts, diag));
} else if (opts.audit) {
  process.exit(runAudit(rows, opts, diag));
} else if (opts.json) {
  process.stdout.write(
    JSON.stringify(
      {
        project: relative(REPO_ROOT, opts.project) || opts.project,
        entries: opts.entries,
        missingEntries,
        otherDirs,
        total: rows.length,
        dark: rows.filter((r) => r.dark).length,
        modules,
        exports: rows,
      },
      null,
      2,
    ) + '\n',
  );
} else if (opts.modules) {
  process.stdout.write(moduleReport(modules, diag, opts) + '\n');
} else {
  process.stdout.write(humanReport(rows, opts, diag) + '\n');
}
