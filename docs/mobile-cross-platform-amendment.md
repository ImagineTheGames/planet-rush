# Planet Rush — Mobile / Cross-Platform Amendment

**Date:** 2026-07-22
**Status:** Approved in brainstorming (Reinaldo)
**Amends:** `Planet_Rush_GDD_v0.3.md` → to be issued as **GDD v0.4**
**Relates to:** Planet Rush Studio (build environment — already ships the ntfy ping + milestones.json plumbing this spec reuses)

## Decisions made

| Question | Decision |
|---|---|
| Platform scope | **Mobile browser + PWA in week one**; native store packaging (Capacitor) designed-for-now, built post-week |
| Touch scheme | **Twin virtual sticks**, dynamic (appear under thumb, one per screen half) |
| Aim modes | **Manual** and **Auto-aim**, selectable by the player on any platform — player choice, no fairness gating |
| Auto-aim touch UI | Right-side control **morphs with mode**: Manual = aim stick (beam fires while engaged); Auto-aim = **hold-to-FIRE button**, beam engages nearest valid target in range while held |
| Integration approach | **Mobile first-class from day 1** — touch ships in the day-1 milestone; every later feature built against all three input methods |
| Team | **No ninth agent.** Mobile is a cross-cutting concern inside existing ownership: Platform Engineer (touch input, PWA, scaling, platform.ts), UI Engineer (thumb-scale HUD, stick/button visuals, settings), QA (mobile gates) |
| Test cadence | **Day-milestone pings + on-demand**: each of the 7 day-milestones tags, deploys, and pings the phone with URL + test notes; "deploy now" to the Director pushes current main to the /dev URL and pings |

## 1. Platform architecture

One web build, three input methods — keyboard/mouse, gamepad, **touch** — all feeding
the existing device-agnostic action layer (GDD §2.4). Touch is a third implementation
of the same actions; the simulation never knows the device.

- **PWA**: manifest + service worker; installable to home screen; fullscreen;
  landscape orientation lock. (Service worker caches the app shell — the game is
  already offline-capable vs bots by design.)
- **Capacitor-ready**: no bare `window`-global reliance in game code; platform
  calls (fullscreen, vibration, storage, orientation) behind one `platform.ts`
  interface. Store packaging post-week = wrapper, not rewrite.
- **Responsive rendering**: PixiJS canvas scales by viewport × devicePixelRatio;
  HUD anchors respect safe-area insets (notches/punch-holes).

## 2. Touch controls (GDD §2.4 amendment)

- **Left half**: dynamic virtual stick — thrust/steer.
- **Right half, Manual mode**: dynamic aim stick — beam **fires while the stick is
  engaged** (one gesture: aim = fire, matching "your gun is your mining tool").
- **Right half, Auto-aim mode**: **hold-to-FIRE button** — while held, the beam
  engages the **nearest valid target in range** (asteroid, ship, turret, shield,
  core). The player decides *when* to fire; positioning decides *what* gets hit.
  No aim stick is shown in this mode.
- **Fire mode is a player setting on every platform** (desktop auto-aim: hold
  LMB/trigger, targeting automatic). Default: Manual on desktop/gamepad,
  **Auto-aim on touch** (best first-run experience; changeable in settings and
  from the pause menu).
- Build & Upgrade wheel: BUILD button appears near own planet (E-equivalent);
  tap segments to buy. Boost: dedicated button above the left stick. Minimap
  ping: tap the minimap. Rematch/menus: plain taps.
- The controls strip (bottom edge) is replaced on touch by the visible controls
  themselves; onboarding prompts (§2.10) get touch-specific wording via the
  action-mapping layer (already input-agnostic).
- Auto-aim targeting rule: nearest valid target by distance within beam range and
  a 360° radius (no front-arc restriction — simple, predictable). `TUNABLE`.

## 3. "Playable milestone" — definition (new GDD §4.6a)

> A **playable milestone** is a tagged, CI-green build, live at the public URL,
> that a first-time player can open **on a phone browser** and verify that day's
> player-facing checks in under 2 minutes — touch and keyboard both working —
> announced by a phone ping containing the play URL and a 2-line "what to test"
> note.

- The 7 day-milestones (GDD §4.6) are the playable milestones. Each gains a
  `test_notes` field in `milestones.json`; the deploy workflow pings ntfy on tag
  with URL + notes. (Studio already watches milestones.json → ping plumbing exists.)
- **On-demand**: "deploy now" to the Director → current `main` deploys to the
  `/dev` URL → ping. No tag required.

## 4. Performance budget (GDD §4.3 amendment)

- Desktop gate unchanged: 60 fps on integrated graphics at full entity counts.
- **New mobile gate (day 5)**: 60 fps on the developer's own phone (primary test
  device); 30 fps floor on a 3-year-old mid-range Android; "reduce VFX" setting
  auto-engages on sustained drops below floor.
- Entity counts unchanged; pooling/batching disciplines (already mandated) are
  what make this feasible.

## 5. Scope & risk (GDD §4.3b / §4.9 amendments)

- **Cost**: Platform + UI Engineer briefs grow (~+1.5 M tokens combined; budget
  total ~41.5 M). Day-1 and day-2 milestones now include touch from the start.
- **Not-cuttable additions**: twin virtual sticks, auto-aim fire mode, mobile
  browser playability.
- **Cuttable additions** (ranked into the §4.9 list): PWA installability (the
  URL still plays in a mobile browser without it); landscape lock enforcement.
- **New named risk**: mobile browser quirks (audio unlock requires a user
  gesture, fullscreen API differences, Safari WebGL memory limits). Mitigation:
  the developer's phone is a first-class test device from day 1 — every
  milestone is phone-verified, so quirks surface the day they're introduced,
  not at day 6.

## Out of scope (this amendment)

- Native app store packaging (Capacitor) — architecture prepared, work deferred
  post-week.
- Tablet-specific layouts (phone layout scales up acceptably).
- Touch gestures beyond the specified set (no pinch-zoom camera, no swipes).

## Addendum (same session): multiplayer architecture reaffirmed + reconnect grace

Evaluated against Photon, Go REST frameworks (Gin/Chi/go-swagger), gRPC, and
Nakama: the GDD's authoritative TypeScript WebSocket server stands — the
one-codebase deterministic sim is the load-bearing property and none of the
alternatives preserve it. Meta-services (accounts, leaderboards) are a post-week
bolt-on (Nakama or a small TS REST layer) and change nothing now.

**New requirement for GDD v0.4 (§4.2): reconnect grace.** On mid-match
disconnect, a bot substitutes immediately; the player may rejoin by room code
within ~60 s (TUNABLE) and reclaim their ship with upgrades intact. Motivated by
mobile play (screen lock, backgrounding, cellular drops).
