/**
 * tests/net/lobby-ping-fit.test.ts — the ping survives BOTH form factors.
 * OWNER: Netcode Engineer (ratified developer: "lobby renders it next to each
 * HUMAN player's name … Both form factors").
 *
 * The model half of this feature is next door (`./lobby-ping-model.test.ts`:
 * which seats get a number and how it grades). This file defends the half that
 * only geometry can answer — **is there room to draw it** — because "both form
 * factors" is a claim about a 221px roster row on a phone in landscape, not about
 * the 693px one on the desktop where the feature was written.
 *
 * The failure this pins down was real: the row used to reserve a flat 120px at
 * its right edge for trailing chips. The chips reserve at most 90px, a human seat
 * in FFA carries none at all — and on the phone that over-reservation was wider
 * than the space a full-length callsign left, so an ordinary 12-character name
 * silently cost the player their ping on the one form factor most likely to need
 * it. A fixed guard cannot see that; `pingFits` measured against the row's real
 * content edge can.
 *
 * Text is measured here as a stated upper bound per glyph rather than by Pixi —
 * these tests run in node, and the point is the *layout budget*, which is real
 * whatever the font rounds to. The bound is deliberately generous: if the number
 * fits at 8px a glyph it fits at Oxanium 11.
 */

import { describe, expect, it } from 'vitest';
import { lobbyLayout } from '../../src/ui/lobby-geometry';
import { PLAYER_NAME_MAX_CHARS } from '../../src/ui/lobby';
import { PING_CHIP_GAP, pingFits } from '../../src/net/ping';

/** Generous upper bound for one glyph of the row's 11px body face. Real Oxanium
 *  digits measure under 7px; 8 gives the assertions headroom to be honest. */
const GLYPH_W = 8;

/** The row's own furniture, mirrored from `lobby-view.drawSeat`: the identity
 *  stripe, its pad, the chip and the pad after it. */
const STRIPE = 4;
const PAD = 8;
const PING_GAP = 8;

/** The device matrix the lobby geometry itself is tested against — the landscape
 *  phone first, because that is the orientation Planet Rush is played in. */
const PROFILES = [
  { name: 'iphone/landscape', vp: { width: 844, height: 390 }, touch: true },
  { name: 'ipad/landscape', vp: { width: 1024, height: 768 }, touch: true },
  { name: 'desktop', vp: { width: 1280, height: 720 }, touch: false },
  { name: 'desktop/wide', vp: { width: 1920, height: 1080 }, touch: false },
] as const;

/** Where the name starts on a row, and where its ping would begin after a name of
 *  `chars` glyphs — the same arithmetic the view draws with. */
function pingXFor(rect: { x: number; height: number }, chars: number): number {
  const chipSize = Math.min(26, rect.height - 2 * PAD);
  const textX = rect.x + STRIPE + PAD + chipSize + PAD;
  return textX + chars * GLYPH_W + PING_GAP;
}

/** `· 245ms` — the widest ordinary readout: a three-digit round trip. */
const READOUT_W = '· 245ms'.length * GLYPH_W;

describe('the roster ping fits the row it is drawn on', () => {
  for (const profile of PROFILES) {
    describe(profile.name, () => {
      const layout = lobbyLayout(profile.vp, { isTouch: profile.touch });
      const rect = layout.seats[0]!;
      const tierChip = layout.seatChips[0]!;
      const teamChip = layout.seatTeamChips[0]!;

      it('draws a full-length callsign AND a three-digit ping on a human FFA seat', () => {
        // FFA, human: no trailing chip at all — the tier chip is a bot control —
        // so the row's content edge is its right edge. This is the case the old
        // flat 120px guard got wrong on the phone.
        const chipsLeft = rect.x + rect.width;
        expect(pingFits(pingXFor(rect, PLAYER_NAME_MAX_CHARS), READOUT_W, chipsLeft)).toBe(true);
      });

      it('draws them on a human TEAMS seat wherever the row has the width', () => {
        // TEAMS puts a side chip on every human seat, so the row's edge moves in
        // by 90px. Every form factor but the landscape phone still holds a
        // full-length callsign and its number; the phone's 221px row is the
        // documented exception below, asserted rather than wished away.
        const chipsLeft = teamChip.width > 0 ? teamChip.x : rect.x + rect.width;
        const fits = pingFits(pingXFor(rect, PLAYER_NAME_MAX_CHARS), READOUT_W, chipsLeft);
        expect(fits).toBe(profile.name !== 'iphone/landscape');
      });

      it('never lets the number reach the chip it stops short of', () => {
        // The guarantee is spatial, not merely boolean: whatever the row's edge
        // is, a readout that is drawn ends at least one pad clear of it.
        const chipsLeft = teamChip.width > 0 ? teamChip.x : tierChip.x;
        const x = pingXFor(rect, PLAYER_NAME_MAX_CHARS);
        if (pingFits(x, READOUT_W, chipsLeft)) {
          expect(x + READOUT_W).toBeLessThanOrEqual(chipsLeft - PING_CHIP_GAP);
        }
      });
    });
  }

  it('drops the number rather than overlapping when a row genuinely cannot hold it', () => {
    // The rule still has to say no. A readout whose END lands under the chip is
    // rejected even though its START sits in clear space — the overlap the old
    // start-position-only check would have drawn.
    expect(pingFits(100, 40, 130)).toBe(false);
    expect(pingFits(100, 40, 148)).toBe(true);
  });

  it('spends the phone\'s TEAMS ping on the word the side chip now carries', () => {
    // The one place the feature is genuinely width-bound: a landscape phone (221px
    // row) in TEAMS. This assertion used to read the other way — a short name kept
    // its number, only a near-maximum one spent the space — and it is written to
    // fail loudly when the row's furniture changes. It did exactly that, so the
    // new boundary is recorded rather than wished away.
    //
    // What changed: the side chip carries the WORD (`TEAM A`, m10 teams-wire —
    // the developer reported a teams match they could not read sides in, and
    // ratified that colour alone is insufficient), so `SEAT_TEAM_CHIP_WIDTH` went
    // 30 → 64. On this row the chip is not even that wide: `teamChipRect` clamps
    // it strictly right of centre, so it lands at 47.68px and its LEFT EDGE — the
    // edge the ping measures against — sits at the centre pad whatever the
    // constant says. There is no chip width above ~34px that leaves a 56px readout
    // room here, so the two ratified features cannot both have this row.
    //
    // The side label wins: it answers a reported bug and is ratified for both form
    // factors, and the ping already owns a graceful way to lose — `pingFits` drops
    // the number instead of drawing it under the chip. So on a landscape phone in
    // TEAMS the roster ping is dropped at EVERY name length, not just long ones.
    // Narrow in scope and named in `docs/netcode-teams-wire.md` §5: FFA on the same
    // phone is untouched (the case above), and every wider form factor still holds
    // a full-length callsign AND its number in TEAMS.
    const layout = lobbyLayout({ width: 844, height: 390 }, { isTouch: true });
    const rect = layout.seats[0]!;
    const chipsLeft = layout.seatTeamChips[0]!.x;
    expect(pingFits(pingXFor(rect, 4), READOUT_W, chipsLeft)).toBe(false);
    expect(pingFits(pingXFor(rect, PLAYER_NAME_MAX_CHARS), READOUT_W, chipsLeft)).toBe(false);

    // The trade is a *width* fact, not a mode fact: give the row a desktop's width
    // and the number comes back with the word still on it. This is what makes the
    // line above a documented cost rather than the feature being broken.
    const wide = lobbyLayout({ width: 1280, height: 720 }, { isTouch: false });
    const wideRect = wide.seats[0]!;
    expect(pingFits(pingXFor(wideRect, 4), READOUT_W, wide.seatTeamChips[0]!.x)).toBe(true);
  });

  it('gives a human FFA seat the whole row, and a TEAMS seat measurably less', () => {
    // The regression in one assertion: the space available to a ping depends on
    // the chips the row ACTUALLY draws, so these two cannot be equal.
    const layout = lobbyLayout({ width: 844, height: 390 }, { isTouch: true });
    const rect = layout.seats[0]!;
    const teamChip = layout.seatTeamChips[0]!;
    expect(teamChip.x).toBeLessThan(rect.x + rect.width);
  });
});
