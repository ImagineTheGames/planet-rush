# a1-09 — evidence

Three things, each reproducible from a clean checkout of this branch.

## 1. The acceptance test: the scan flags `matchAbundance` at `51e8445^`

`51e8445` is n5-01, the fix. The commit before it is `7e175ac`, the tree on
which QA measured a 151 s wave interval on the live build under a lobby chip
reading `YIELD · SCARCE`. A scan that cannot find the bug we already know about
is not evidence of anything, so it is run against that tree and nothing else is
claimed for it.

```
$ git worktree add --detach /tmp/dm-pre 51e8445^
$ ln -s "$PWD/node_modules" /tmp/dm-pre/node_modules      # deps only; sources are the old tree
$ node tools/dark-matter-scan.mjs --project /tmp/dm-pre/tsconfig.json --json \
    | jq '.exports[] | select(.name == "matchAbundance")'
```

`acceptance-51e8445-parent.json` is that output, verbatim:

```json
{
  "name": "matchAbundance",
  "file": "src/sim/match-config.ts",
  "line": 83,
  "kind": "function",
  "booted": true,
  "uses": { "prod": 0, "orphan": 0, "test": 3, "tool": 0, "other": 0, "internal": 0, "reexport": 0 },
  "prodSites": [],
  "testSites": ["src/sim/abundance.test.ts", "src/sim/abundance.test.ts", "src/sim/abundance.test.ts"],
  "id": "src/sim/match-config.ts#matchAbundance",
  "dark": true,
  "verdictHint": "test-only"
}
```

`prod: 0`, `test: 3`, `dark: true`, hint `test-only` — three spec references and
no caller, on the tree where the bug was live.

### The same question asked with grep, on the same tree

`grep-counterfactual.txt` is what a text search returns there:

```
$ cd /tmp/dm-pre && grep -rn "matchAbundance" --include='*.ts' src server tests harness \
    | grep -v '\.test\.ts:'
src/sim/match-config.ts:72:   * {@link matchAbundance}. Optional so pre-p11 configs (and the lobby before the
src/sim/match-config.ts:74:   * SCARCE default ({@link matchAbundance}, `DEFAULT_ABUNDANCE`) — "by default
src/sim/match-config.ts:83:export function matchAbundance(cfg: MatchConfig): Abundance {
```

Three hits outside the tests: two prose lines and the declaration. Nothing a
skim distinguishes from three callers. This is why the brief forbade a bare
grep, and `src/ui/gantry.ts#singlePrimary` is the same trap an order of
magnitude worse — 19 non-test hits at HEAD, every one of them a comment.

## 2. The gate, red then green

`gate-red-then-green.txt` is a live run against this repo (not the fixture): a
deliberately dark export is added, `--check` goes red and names it, the export
is removed, `--check` goes green. The same red/green is asserted automatically
in `tests/tools/dark-matter-scan.test.ts` against `tools/fixtures/dark-matter/`,
so it stays true without anyone re-running this by hand.

## 3. Today's scan

`scan-head.json` — the 278 gate-relevant candidates at the branch head, with
their use counts, and the module rollup. This is the input
`docs/dark-matter-scan.md` triages and `tools/dark-matter-allowlist.json`
records a verdict for, one line each. It is the trimmed view: the full
2769-export dump is 1.6 MB and reproducible with `npm run dark-matter -- --json`,
so it is not committed.

`modules-head.txt` is the `--modules` rollup: the 17 modules under `src/` that no
entry point reaches, and every booted module's dark-value count.
