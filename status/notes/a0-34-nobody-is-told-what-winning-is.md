# a0-34-nobody-is-told-what-winning-is.md — working notes (ui)

Scratch memory for THIS brief, across retries and resumes. Keep it current as
you work; a future you reads it first. This is a working note, not evidence —
"done" is still the DoD, the PR and QA's attestation, never a line written here.

Branch: `agent/ui/a0-34-teach-the-objective`.

## BUILT

- **`374fdc3` — the red test.** Seven assertions in `src/ui/onboarding.test.ts`:
  a prompt whose copy names the win condition exists, it fires BEFORE the mining
  prompt, it yields to a siege without being retired by the seconds it spent off
  screen, it is shown once across matches, and it reads the same on every device.
  Six failed (`PromptId.Objective` did not exist).
- **`5a8cb45` — the fifth prompt.** `PromptId.Objective`, second in
  `PROMPT_ORDER` (behind UNDER-ATTACK, ahead of MINE), copy:

  > **Be the last station standing — mine ore, build defenses, upgrade your
  > ship, attack when you judge it right**

  Retires on a DWELL (`DWELL_SECONDS`, 8 s of match time) counted only over the
  frames it is the prompt actually SHOWN; persisted through the existing
  `OnboardingMemory` (u15-01). `src/ui/hud.ts` feeds `time: frame.time` — the
  same `world.time` the wave clock uses.
- **`e12db07` — the codex section.** `content/codex/codex-objective.json` (two
  entries), `CodexCategory` gains `'objective'`, `CODEX_TABS` puts OBJECTIVE
  first, `createCodex` defaults to it, `src/main.ts` imports and hands it over,
  `tests/codex/codex-constants.test.ts` checks the fifth file on the same terms
  as the other four. Docs mirrors updated (`content/codex/README.md`,
  `pipeline/spec.md`, `src/ui/index.ts`'s wiring seam).
- **Evidence + the suites that had to move** (next commit): a live-stage spec
  (`tests/live-stage/objective-prompt.spec.ts`) shooting desktop + 390 px
  landscape + the codex section, `tests/live-stage/codex.spec.ts` re-pointed at
  the new tab order, `haul-prompt.spec.ts` waiting out the objective before it
  stages a full hold, and 26 rebaselined mobile goldens.

## DECISIONS

- **The win condition I used, and where it is enforced.** GDD §1: *"Own the last
  surviving station reactor — in Teams, be the last side with a reactor
  standing"*, tie to whoever reached zero last. `src/sim/match.ts`
  `resolveWinner` counts distinct surviving TEAMS, crowns the last one holding a
  core, treats FFA as teams-of-one (`station.team ?? station.owner`) and breaks a
  same-tick tie off `match.eliminated`'s last entry. **They agree** — nothing to
  escalate. The prompt says the FFA reading (one line, and a first match is bots
  in FFA); the codex entry carries the Teams clause and the tiebreak.
- **Prompt, not screen.** §2.10's "no separate tutorial mode" is ratified, so
  this is one more contextual prompt on the same terms as the four.
- **Retires on a dwell, not an action.** The other four retire on the player
  doing the thing; there is nothing to do with a goal, and "the player has
  understood the objective" is not observable from the HUD. The dwell counts
  only frames where it is the SHOWN prompt, so a siege cannot retire it unread.
  Rejected: retiring it when the player first mines (a fast opener would lose the
  frame the prompt exists to provide) and a wall-clock timer (this module owns no
  clock, and a test cannot hand it one).
- **No clock ⇒ no prompt.** A dwell-retired prompt near the TOP of the order that
  never retires would sit on the mining lesson for the whole match — worse than
  the bug being fixed. A caller that feeds no `time` gets today's behaviour.
  Every real feed carries it: it is what the wave clock is drawn from.
- **Scheme-agnostic, so a0-33 and this do not collide.** The copy names no
  gesture and no binding, so it needs no `(scheme, mode)` branch; when the two
  branches meet, the same sentence goes in all three slots. The dwell is a
  `DWELL_SECONDS` **table** keyed by prompt precisely so a0-33's CONTROLS tip
  (which retires on a dwell for the same reason) becomes one more row rather than
  a second mechanism. Expect a small conflict in `PROMPT_COPY`, `PROMPT_ORDER`,
  `OnboardingSignals.time` and the `lastActive`/`lastTime` fields — all of it
  the same intent written twice.
- **A consequence worth stating: for the first 8 s, the objective outranks the
  SPEND prompt too.** Open the wheel in the opening seconds (starting ore makes
  that likely) and the band carries the goal, not "or UPGRADE SHIP". SPEND is not
  retired by that — it fires on the next wheel-open, or on the same one once the
  dwell expires — and the ranking is the design: the goal frames the verbs, and a
  siege still outranks both. Visible in the rebaselined
  `desktop-build-wheel` golden.
- **The codex section is a SECTION** (developer's ruling), not an entry on
  STRATEGY: a fifth `content/codex/codex-*.json`, one-to-one like the others,
  first in the strip. No special case was needed anywhere — the tab strip divides
  by `CODEX_TABS.length`, a tab word that will not fit its chip shrinks (a0-32),
  and the menu's CODEX sub-line derives from the tabs.
- **Two codex entries, not one.** The second one ("How you go out, and how a side
  wins without you") is where the Teams half and the tiebreak live — the
  downstream report the brief cites (*"i lost somehow but my team is the one that
  won"*) is a loss-condition confusion, not a win-condition one.
- **Goldens: deleted before regenerating.** `--update-snapshots` SKIPS a baseline
  that is still within `maxDiffPixelRatio`, and the prompt band's two lines of
  thin text came in under the 1 % ratio on a full frame — `desktop-frozen` PASSED
  with a baseline that shows no prompt at all. Deleting the file first is the only
  way to force the rewrite. 26 files: every match-scene golden (the band now
  carries the objective) plus the three codex ones (five tabs, opens on
  OBJECTIVE). The menu/lobby/doors/ship-select/map-select baselines were left
  alone on purpose.

## NEXT

- Nothing blocking. Remaining: PR body flags the NEW COPY (prompt + both codex
  entries) for the developer's approval of the polish — the substance is ratified
  (LESSONS §17), the wording is not.
- Watch for a0-33 merging first: reconcile `PROMPT_COPY` (three slots per prompt,
  same sentence in all three for OBJECTIVE), `PROMPT_ORDER` (UNDER-ATTACK,
  OBJECTIVE, MINE, HAUL-HOME, SPEND, CONTROLS) and fold `CONTROLS_TIP_SECONDS`
  into `DWELL_SECONDS`.
- `content/codex/` and `tests/codex/` are the Gameplay Engineer's by their file
  headers; touched here because the brief's one-to-one contract required it.
  Flagged in the PR.
