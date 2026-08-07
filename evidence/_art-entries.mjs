/**
 * evidence/_art-entries.mjs — merge the three art-campaign-close entries into
 * evidence/manifest.json. OWNER: QA Manager.
 *
 * Idempotent: an entry with the same id is replaced, not duplicated, so a re-shoot
 * re-runs this without growing the manifest. Same shape as every other entry
 * ({ id, title, area, image, capturedAt, buildSha, attestation, verdict }).
 *
 * Usage: node evidence/_art-entries.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const MANIFEST = join(HERE, 'manifest.json');

const SHA = '369d7a6';
const AT = '2026-08-07T14:35:00Z';

const PREAMBLE =
  'SELF-WITNESSED, 2026-08-07T13:20Z–14:35Z, on the build under test 369d7a6 — the repo at this branch\'s merge base, ' +
  'built HERE with `npx vite build` and served by `vite preview` on :4188. dist/version.json reads sha 369d7a6, built ' +
  '2026-08-07T13:14:08.671Z, and the badge bottom-left of every clean-boot frame reads "369d7a6*". Viewport 1280x800, ' +
  'deviceScaleFactor 2 (3 for the hull crops). The BOARD half of every composite is docs/art-direction/*.html shot from ' +
  'this same repo state, addressed BY DOM SELECTOR (the board\'s own .scene / .card / svg / .lobby / .menuwrap elements), ' +
  'so a board edit moves the crop instead of silently changing what the composite claims. Nothing is retouched, ' +
  'colour-corrected or composited except the nearest-neighbour magnification labelled on the ships figure. ' +
  'Instruments committed beside this manifest: capture-art-boards.mjs, capture-art-live.mjs, probe-art-palette.mjs, ' +
  'build-art-composites.mjs.';

const FADE_NOTE =
  'THE TRAP THIS GATE IS BUILT AROUND, REPORTED BECAUSE I NEARLY FILED IT AS THE HEADLINE FINDING. ' +
  'render/index.ts:874 draws a ship at `alpha 0.5` while ship.spawnProtect > 0, and :656 draws a station at 0.75; ' +
  'SPAWN_PROTECTION_S is 10 s (sim/constants.ts:68). PALETTE.hullSteel #7E8894 composited at exactly one half over ' +
  'vacuum #0D1015 is #454C55 on all three channels. My first pass shot every hull at +2.2 s after RUSH!, measured ' +
  '#454C55, and was one step from attesting "the ships are painted a full value step dark — they wear the value the ' +
  'boards give to ROCK". It was the arithmetic landing on exactly 0.500 that stopped it. A second pass waited a flat ' +
  '14 s and STILL caught the fade, because under a dsf-3 capture the sim clock lags the wall clock and the flip lands ' +
  'between +9 s and +14 s (measured: I sampled the ship crop every 4 s through a real front-door match and watched ' +
  '#454C54 become #7E8894 between +9 s and +14 s, and again under ?debug=1 between +6 s and +9 s). The capture now ' +
  'POLLS the ship crop until the un-faded steel is on screen instead of trusting any clock. Every colour quoted in ' +
  'these three entries is measured off a frame past that flip; the pinned ?freeze=1 frames sit at tick 120 — two ' +
  'seconds — and are therefore deliberately half-faded by construction.';

const entries = [
  {
    id: 'art-vs-board-scene',
    area: 'art',
    title:
      'FAILED — the game\'s battle scene against scene-gallery.html: planets, turrets, shields, the damage arc and the ' +
      'alarm all read as the boards\' world, but the ASTEROID FAMILY never received either of the art campaign\'s two ' +
      'levers. Live rock body is #939BA5 against the board\'s #454E59 (luminance 155 vs 79 — about twice the value), ' +
      'and its outline is rockFissure #2D3239 rather than the single crisp ink #262C34 that the same build paints ' +
      'correctly on every ship',
    image: 'images/art-vs-board-scene.png',
    capturedAt: AT,
    buildSha: SHA,
    verdict: 'failed',
    attestation: '',
  },
  {
    id: 'art-vs-board-ships',
    area: 'art',
    title:
      'VERIFIED — the four hulls the running match draws against ship-classes.html: four separate front-door runs ' +
      '(PLAY → PLAY SOLO → hull tile i → RUSH!), each hull confirmed by the lobby\'s own selectedClass readback. All ' +
      'four silhouettes are distinct and read as their board card, the hull plate measures #7E8894 EXACTLY — the ' +
      'board\'s own steel — and the crisp #262C34 ink Lever A asked for is on the screen',
    image: 'images/art-vs-board-ships.png',
    capturedAt: AT,
    buildSha: SHA,
    verdict: 'verified',
    attestation: '',
  },
  {
    id: 'art-vs-board-ui',
    area: 'art',
    title:
      'VERIFIED — the shipped menu / HUD against ui-mockup.html, scored against the RATIFIED half of that board: the ' +
      'in-match HUD carries the mockup\'s furniture and its exact bone / gold / vacuum shades, and the menu, lobby and ' +
      'wheels correctly follow the Gantry/Bone direction that superseded those mockup panels on 2026-08-05. One real ' +
      'defect found and handed to UI: the persistent coach plate is drawn over the wheel\'s bottom wedge and hides its ' +
      'cost line',
    image: 'images/art-vs-board-ui.png',
    capturedAt: AT,
    buildSha: SHA,
    verdict: 'verified',
    attestation: '',
  },
];

// --- the attestations -------------------------------------------------------

entries[0].attestation = [
  PREAMBLE,
  '',
  'WHAT THE COMPOSITE PAIRS. Four pairs, board left, live right. (1) MINING RUN — board scene-gallery.html "Mining run" ' +
  'against a frame the shipped build produced from REAL INPUT: ?debug=1, the ship flown 748 world units west with the ' +
  'keyboard (shipWorld 1968 -> 1220, read back off __planetRush) and the trigger held on a real mouse, with the input ' +
  'probe reporting fire:true. (2) SIEGE — board "Sieging a defended planet — alone" against ?debug=1&freeze=1 ' +
  '(worldHash 4302b39e), the freeze stamp\'s three turret Mks, mid-build scaffold and two shields, then ' +
  '__repairStage.siege(105) to lift the station\'s spawn protection and bleed the core through the sim\'s own ' +
  'damageStation. (3) ALARM — board "The alarm — the game\'s whole design in one frame" against a LIVE unpinned match ' +
  'where twelve queued core hits took coreHp from 100 to 40, read back off the sim each step. (4) THE FIELD — board ' +
  '"Asteroid wave drop" against the pinned arena left of the home ring, nothing staged.',
  '',
  'WHAT READS RIGHT, AND IT IS MOST OF THE FRAME. The siege pair is close to the board beat for beat: a steel-blue ' +
  'ocean with green continents and a gold core, a bright plasma shield ring carrying A RED CORE-DAMAGE ARC down its ' +
  'right side at exactly the 55/100 the sim reported, three grey turrets seated on the rim, and the ship docked at ' +
  'three o\'clock with a 50/50 hull bar. The alarm pair fires: a dark red vignette frames the whole screen and a red ' +
  'arc appears on the home ring. Vacuum measures #0D1015 against the board\'s #0D1015 — exact. Core and ore gold ' +
  'measure #F2D24B against #F2D24B — exact. And the SHIP family in these same frames measures #7E8894, the board\'s ' +
  'steel, unmodified (see art-vs-board-ships).',
  '',
  'THE DEFECT. THE ASTEROIDS. The live asteroid body measures #939BA5 — distance ZERO from DERIVED.rockBody 0x939ba5 ' +
  '(src/art/palette.ts:169), which palette.ts itself derives as "hullSteel mixed 16% toward WHITE". The board\'s rock ' +
  'measures #454E59. Luminance 155 against 79: the live rock is roughly twice the board\'s value, and it is the one ' +
  'family that is on screen for the whole match. Its outline is no better — I measure #373D44 on screen, which is ' +
  'DERIVED.rockFissure 0x2d3239 blended at the rock\'s edge, where the board draws #262C34. These are not my ' +
  'judgement calls about a direction: they are, verbatim, the two "current" cells of the art campaign\'s OWN gap table ' +
  '(docs/art-direction/GAP-ANALYSIS.md §2, Lever A row "Asteroids / wrecks" and Lever B row "Asteroid body ' +
  'DERIVED.rockBody #939BA5 (a *light* tint) -> #454E59 (dark charcoal)"), and they are unmoved. GAP-ANALYSIS calls ' +
  'Lever A "the single highest impact-per-effort change on the board" and annotates the rock row "Every rock, the ' +
  'whole match". The same build applied both levers to the ships correctly, which is exactly what makes this a gap ' +
  'rather than a change of direction: the campaign landed on one family and not the other. OWNER: Art.',
  '',
  'DIFFERENCES THAT ARE NOT DEFECTS, EACH WITH THE RATIFICATION THAT MAKES THEM SO. (a) THE BEAM IS GONE. The board ' +
  'draws one continuous plasma beam from ship to rock and captions the dogfight "Same beam that mines"; the shipped ' +
  'build throws discrete round shots, plainly visible mid-flight in the mining pair. That is the p2-03b amendment ' +
  '("mining is shooting, beam retired"), already evidenced in this manifest under mining-by-projectile — a gameplay ' +
  'ratification, not an art miss. (b) THE OCEAN. Live #2F4A63 against the board\'s #2E6E9E. GAP-ANALYSIS §5.2 ' +
  'supersedes the board hex outright ("adopting #2E6E9E literally needs the Director — a new hue") and asks instead ' +
  'for "bluer, still in-ramp" from the then-current, too-grey #4F565F. #2F4A63 is (47,74,99) against (79,86,95): it ' +
  'moved bluer, as asked, inside the ramp. (c) THE ATMOSPHERE RING is a broken teal arc where the board draws a yellow ' +
  'dashed one. (d) THE ALARM SAYS IT QUIETLY. The board puts a hard red banner "PLANET UNDER ATTACK" across the top ' +
  'and drains MY PLANET to a red stub; the live build fires the red vignette and the red ring arc, but the words are ' +
  'a neutral coach line — "Your station is under attack — follow the arrow" — in bone on the standard dark plate, and ' +
  'the HOME bar top-right was still full-width plasma at 94/100 in the frame where the alarm was already up. I am ' +
  'recording that as an OBSERVATION rather than a defect: style-guide §2 reserves threat red #B23A3A for exactly this ' +
  'tell and the build is spending it, and I found no ratification either way on the banner. UI should decide whether ' +
  'the board\'s banner survived the Gantry pass.',
  '',
  'A SECOND TRAP, REPORTED BECAUSE I NEARLY FILED IT TOO. Every live arena frame carries a bright vertical rule at ' +
  '~83% of the width, #454C54, 4 CSS px wide, running the entire height with a peak per-column delta of 103 against ' +
  'its neighbours — the shape of a texture seam, and I began writing it up as one. It is not. It sits at a FIXED ' +
  'WORLD x: it holds at x=2140 across four horizontal slabs of the same frame to the identical hex and luminance, it ' +
  'moves left when the ship parks further east, and it leaves the frame entirely once the ship has flown 748 units ' +
  'west. It is ARENA_WALL_BANDS (src/art/backdrop.ts) — "the crisp outer frame — the world ends here", 4 px at alpha ' +
  '0.5, with the inset 6/16/30 glow bands stepping inward exactly as the table declares. Drawn as designed. It is ' +
  'named on the composite so the next reviewer does not file it either.',
  '',
  FADE_NOTE,
  '',
  'VERDICT: FAILED. Planets, turrets, shields, the core-damage arc, the alarm state, vacuum and gold all read as the ' +
  'boards\' world, and the ship family carries the campaign\'s levers exactly. The asteroids do not: body #939BA5 ' +
  'against #454E59 and outline #2D3239 against #262C34, both of them the art campaign\'s own named targets, both ' +
  'untouched. On the boards a rock is a dark charcoal slab inside one crisp ink line and it recedes; in the build it ' +
  'is the palest thing in the frame and it advances. Because rock is the family that fills every mining, wave and ' +
  'field scene in scene-gallery.html, the composite does not support "the game reads as the boards\' world" and this ' +
  'gate does not pass. The fix is two shade constants and is already specified in GAP-ANALYSIS §2.',
].join('\n');

entries[1].attestation = [
  PREAMBLE,
  '',
  'HOW THESE FRAMES WERE REACHED, AND WHY IT HAD TO BE THIS WAY. ?debug=1 CANNOT produce this evidence: main.ts:751 ' +
  'and :786 build the menu and the lobby only when flags.debug is FALSE, so ?debug=1 skips the front door entirely, ' +
  'and its boot world is eight Vanguards (freeze.ts freezePlayers). The four classes are reachable only as a player ' +
  'reaches them, so each hull is a separate clean-boot run: __mainMenu.play() -> __onlineMenu.solo() -> ' +
  '__lobby.selectClass(i) -> __lobby.rush(), with the lobby\'s OWN selectedClass read back before the match starts. ' +
  'It answered "interceptor", "vanguard", "excavator", "hauler" for i = 0..3, matching its classOrder. The camera ' +
  'targets the local ship, so every crop is the viewport centre; the crops are captured at deviceScaleFactor 3 for ' +
  'real render pixels and shown on the figure at nearest-neighbour x5, which enlarges the game\'s own pixels without ' +
  'inventing a colour. That magnification is necessary and is labelled: the game draws these hulls at a measured ' +
  '19-23 CSS px across (bounding boxes 20x23, 19x21, 22x24, 23x29) where the board card draws them at 98-115.',
  '',
  'WHAT IS VISIBLE. All four silhouettes are distinct from each other and each reads as its board card. INTERCEPTOR ' +
  '- Quadfin: a swept delta with four fins, blue tips fore and aft, a blue cockpit dot. VANGUARD - Anvil: a blunt ' +
  'arrowhead body with a round blue cockpit and blue strakes down both flanks. EXCAVATOR - Pincer: a rounded ' +
  'rectangular body with two forward mandibles and a large round cockpit centred — the closest of the four to its ' +
  'card. HAULER - Hammerhead: a body with two side pods and a full-width transverse bar at the stern, blue-capped at ' +
  'both ends. Where they drift from the board is in proportion, not vocabulary — the live Vanguard is a narrower dart ' +
  'than the board\'s wide Anvil, and the live Interceptor carries a longer nose than the board\'s Quadfin.',
  '',
  'WHAT THEY ARE PAINTED WITH, MEASURED. Exact unquantised modal colours of each hull interior, 25% inset from its own ' +
  'measured bounding box so no edge pixel is counted. HULL PLATE #7E8894 — 51.7% of the Interceptor\'s interior and ' +
  '21.4% of the Vanguard\'s — against the board\'s #7E8894. EXACT MATCH, to the byte. OUTLINE INK #282C33 against the ' +
  'board\'s #262C34: distance 2. That is Lever A of GAP-ANALYSIS §2 — "one crisp ink outline #262C34, everywhere", ' +
  'which the document opens by saying "No generator paints #262C34 today" — landed on this family. TRIM AND COCKPIT ' +
  '#3D7BFF, with its lit face at #49B1FF, against the board\'s #4DC3FF: that is the RESOLVED divergence of ' +
  'GAP-ANALYSIS §5.1 — the board\'s cyan/red/gold roster is superseded by style-guide §3.1 and tokens.ts ' +
  'PLAYER_ROSTER, whose P1 is Azure 0x3d7bff — and #3D7BFF is that azure exactly, not an approximation of it. ' +
  'Corroboration from outside my own capture path: assets/preview/sprite-sheet.svg, the art pipeline\'s committed ' +
  'contact sheet, carries fill="#7e8894" 393 times and fill="#3d7bff" 166 times.',
  '',
  FADE_NOTE,
  '',
  'WHAT I DID NOT WITNESS, STATED PLAINLY. The game has no screen anywhere that draws a hull large: the lobby\'s hull ' +
  'tiles carry the class name, the nickname, six stat pips and a blurb, and NO ship art (src/ui/lobby-view.ts ' +
  'drawClassTile — its `hull` node is the nickname text). So there is no in-game frame that puts a hull next to the ' +
  'board card at the board\'s size, and this gate does not claim one: the right-hand panels are gameplay-scale sprites ' +
  'magnified, and the figure says so on every caption. I also did not compare the DAMAGED or DESTROYED hull states, ' +
  'the turret Mk sprites or the wrecks against their boards; this entry is the four flyable hulls only.',
  '',
  'VERDICT: VERIFIED. On 369d7a6 the four hulls a player can actually pick are four distinct silhouettes that read as ' +
  'their ship-classes.html cards, painted in the board\'s own #7E8894 steel with the crisp #262C34-class ink the ' +
  'campaign\'s Lever A asked for, and trimmed in the ratified roster azure that supersedes the board\'s cyan. The ' +
  'only difference of substance is drawn size, which is a gameplay sprite against a display card and not a gap.',
].join('\n');

entries[2].attestation = [
  PREAMBLE,
  '',
  'WHICH HALF OF THIS BOARD IS STILL THE TARGET — ESTABLISHED BEFORE SCORING ANYTHING. ui-mockup.html is only half in ' +
  'force. Its menu, lobby, ship-select, build-wheel and settings drawings were superseded on 2026-08-05 by the ' +
  'developer-ratified Gantry / Bone direction: docs/design/gantry-bone-handoff.md is subtitled "menu / lobby / HUD / ' +
  'build-wheel visual + audio direction" and states it is "applied across the five screens that set the game\'s tone: ' +
  'title, build wheel, lobby, ship select, settings", and style-guide.md names it "the worked example" of the ' +
  'direction. Its governing rule is the one the live screens are obeying: "the primary action is simply the ' +
  'brightest plate on screen. It spends no colour on the menu." So a missing gold wordmark on the live lobby is the ' +
  'ratified direction being followed, not the board being missed. The one part of ui-mockup.html that still governs ' +
  'is the IN-MATCH HUD — style-guide §2.1\'s 2026-08-06 amendment says in terms that it "licenses nothing in a menu, ' +
  'on the HUD, in the lobby, or on any other screen". The composite states this on its face rather than quietly ' +
  'scoring a lobby against a drawing nobody is building to any more.',
  '',
  'PAIR 1, THE WHOLE SCREEN — the part of the board still in force. The board: ORE 11 with two filled hold squares ' +
  'top-left, a ghosted PLANET RUSH wordmark with "ASTEROID WAVE 3/5 · NEXT 0:47 · 07:12" on ONE line top-centre, MY ' +
  'PLANET as a plasma bar top-right, rival planets ringed and labelled, a radial BUILD & UPGRADE wheel over the ship, ' +
  'a rounded minimap bottom-right, a seven-item control strip. The live build, first seconds of a real PLAY SOLO ' +
  'match: TOTAL 3 top-left; "WAVE 1/5 · Outer Drift", then NEXT 2:25, then MATCH 0:06, on THREE stacked lines with no ' +
  'wordmark; "100/100 HOME" top-right, numerals then word, over a full plasma bar; rival SHIPS labelled "Warden ' +
  '(HARD)" and "Rusty (EASY)" in their roster colours with HP bars, though the rival PLANETS are outside this zoom; a ' +
  'circular minimap bottom-right; a four-item control strip "WASD Thrust · Mouse Aim · Left mouse Fire / Mine · E ' +
  'Build & Upgrade". Same furniture in the same corners; the differences are line-breaking, wording (HOME for MY ' +
  'PLANET) and three fewer control hints, not a different screen. Measured: bone #C6CDD6 against #C6CDD6, gold ' +
  '#F2D24B against #F2D24B, vacuum #0D1015 against #0D1015 — three exact matches. The friendly bar reads #3C77F4 ' +
  'against the board\'s #4DC3FF, which is the §5.1 roster supersession again: the bar wears its OWNER\'s colour, and ' +
  'P1 is Azure. The HUD face is split — a display face for headings, mono numerals — against the board\'s all-' +
  'Audiowide, which GAP-ANALYSIS §5.3 resolves explicitly in the split\'s favour.',
  '',
  'PAIR 2, THE BUILD WHEEL, opened by the ratified __upgradeWheelStage.openBuild() seam (it parks the ship docked and ' +
  'toggles the REAL wheel — the same state a press produces; it returned {open:true}). The radial form and the ' +
  'UPGRADE SHIP arrow survive from the board, and so does the five-wedge count. The contents differ: the board draws ' +
  'TURRET 3 / SHIELD 5 / BANK / REPAIR CORE 1 / UPGRADE SHIP; the build draws TURRET / SHIELD / RADAR / REPAIR ' +
  'REACTOR / UPGRADE SHIP — BANK is gone, RADAR is new, REPAIR CORE is renamed REPAIR REACTOR. The hub holds the ore ' +
  'count and CLOSE · ESC where the board drew the ship. Each wedge carries a target line ("YOUR STATION") and a state ' +
  'line ("FULL 4 / 4 BUILT"). I checked one thing that looked wrong and it is not: RADAR showed a red "6 / 3" on one ' +
  'frame and a gold "6 / 11" on another — that is cost over ore, red when unaffordable and gold when affordable, ' +
  'consistent with the style-guide §2.1 cost-numeral carve-out, not a broken count.',
  '',
  'PAIR 3, UPGRADE. The board draws a rectangular PANEL — title UPGRADE SHIP, ORE 11, the ship at left, four ' +
  'full-width rows BEAM / ENGINE / CARGO / HULL each with a tier bar, a before->after figure and a cost, and a gold ' +
  'BUY · 4 button. The build re-forms the same four tracks as a RADIAL WHEEL: WEAPON (with its own DAMAGE / SPEED ' +
  'pips and a sub-wheel arrow), ENGINE 100% -> 115%, CARGO, HULL 50 -> 60, costs 3 / 2 / 3 in gold on the wedges, hub ' +
  'carrying ore 11, the hull name VANGUARD and BACK · ESC. The wedge readback confirms the drawn state: four wedges, ' +
  'tiers 0, costs 3/2/3, all "ready". The table became a wheel and BEAM became WEAPON — a form change ratified by the ' +
  'same Gantry pass (main.ts: "The upgrade screen is now a radial wheel drawn by the same view as the Build wheel").',
  '',
  'PAIRS 4 AND 5, THE LOBBY AND THE MENU — scored against Gantry/Bone, not against the superseded drawings. The board ' +
  'lobby is a huge gold PLANET RUSH wordmark over ROOM GRAV-7, eight roster rows and a solid-gold LAUNCH. The live ' +
  'lobby is titled CREW MUSTER and has NO wordmark and NO gold anywhere: machined steel plates with lit top edges and ' +
  'rivets, MODE · FFA and ORE · SCARCE chips, eight seat rows (P1 "YOU ★ INTERCEPTOR" TAKEN, seven OPEN bots at ' +
  'EASY/MEDIUM/HARD) each carrying a roster-coloured spine, four hull cards with SPD/ACC/TRN/HULL/PWR/HOLD as both ' +
  'pips AND numbers, four arena cards, and RUSH! as the single brightest plate. Those eight spine colours are the ' +
  'ratified PLAYER_ROSTER — azure, cyan, spring, violet, magenta, orange, chalk, slate-blue — visibly NOT the board\'s ' +
  'cyan/red/gold/pink/white, which is §5.1 landing where a player can see it. The menu is the same discipline: DEEP ' +
  'FIELD MINING AUTHORITY / CONTRACT OPEN · SECTOR 04, a chalk wordmark, and four bevelled plates of which PLAY SOLO ' +
  'is the one raised bright one — one primary per screen, carried by brightness rather than hue, exactly as the ' +
  'handoff requires.',
  '',
  'THE DEFECT, HANDED TO UI. THE COACH PLATE IS DRAWN OVER THE WHEEL\'S BOTTOM WEDGE. On the build wheel the ' +
  'persistent hint plate "Spend ore on defense — or UPGRADE SHIP to mine and hit harder" covers the REPAIR REACTOR ' +
  'wedge and cuts its "1 / 3" in half; on the upgrade wheel the same plate cuts CARGO\'s label in half and hides its ' +
  'cost entirely. A cost numeral a player cannot read is the one thing style-guide §2.1 carved an exception out of ' +
  'the palette to guarantee, so this is worth fixing even though it is a layout bug rather than an art-direction one. ' +
  'It is visible in both wheel panels of the composite. OWNER: UI.',
  '',
  'A TRAP I DID NOT FILE. Every live arena frame carries a bright vertical rule at ~83% width (#454C54, peak column ' +
  'delta 103). It is ARENA_WALL_BANDS — "the crisp outer frame — the world ends here" — not a render seam: it holds ' +
  'at a fixed WORLD x and leaves the frame once the ship flies away from it. Detailed in art-vs-board-scene.',
  '',
  'WHAT I DID NOT WITNESS. The settings screen, the pause overlay, the end-of-match screen and the phone layouts are ' +
  'not in this composite; ui-mockup.html draws a settings panel I did not pair. This entry is the title screen, the ' +
  'doors, the lobby, the in-match HUD and the two wheels, on desktop, at 1280x800 only.',
  '',
  'VERDICT: VERIFIED. Against the half of ui-mockup.html still in force — the in-match HUD — the build carries the ' +
  'board\'s furniture in the board\'s corners and its bone, gold and vacuum shades match to the byte. Against the half ' +
  'superseded on 2026-08-05, the menu, lobby and wheels are visibly obeying Gantry/Bone rather than the drawing, ' +
  'which is the correct outcome and not a miss. The game reads as this board\'s world where the board still speaks ' +
  'for it. The coach-plate overlap is carried as a named, unresolved defect rather than folded into the pass.',
].join('\n');

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const ids = new Set(entries.map((e) => e.id));
const kept = manifest.filter((e) => !ids.has(e.id));
const out = [...kept, ...entries];
writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + '\n');
console.log(`[manifest] ${manifest.length} -> ${out.length} entries (replaced ${manifest.length - kept.length})`);
for (const e of entries) console.log(`  ${e.id}: ${e.verdict} (${e.attestation.length} chars)`);
