/**
 * src/ui/wheel-cost-grammar.test.ts — ONE rule, EVERY page of the build menu.
 *
 * The developer, 2026-08-13, holding a screenshot of the upgrade wheel at 8 ore:
 *
 * > *"I had said I didn't want stuff like 5/6 only the cost . it got done on the
 * > page before this one but none of the sub pages. we need to make sure changes
 * > to build menu affect all pages"*
 *
 * The second sentence is why this file exists rather than one more assertion in
 * one more page's spec. a0-03 took the denominator off the Build wheel and left
 * a guard on the Build wheel; the Upgrade wheel and the WEAPON sub-wheel behind
 * it went on quoting `cost/held` for six days, on pages nobody screenshotted.
 * A per-page guard cannot catch that by construction — it only ever knows its
 * own page.
 *
 * So this walks **every wedge on every level of the menu** — Build wheel,
 * Upgrade wheel, WEAPON sub-wheel — through the two functions that decide what a
 * cost slot draws (`./wheel-stack`'s {@link costWords} and
 * {@link upgradeCostWords}, which every view reads and nothing bypasses), and
 * asserts the same grammar on all of them: a cost slot is the price, one of the
 * two wheels' state words, or the arrow that opens a screen. Never a
 * denominator.
 *
 * The day a fourth page is added to this menu, add it to `PAGES` below and it is
 * held to the rule too. The day one quotes a wallet again, this fails — which is
 * the one thing the a0-03 guard could not do.
 *
 * Scope, said plainly so it is not mistaken for more: this is the *cost slot's*
 * rule. `2 / 4 BUILT` on the Build wheel and the ladder pips `●●○` on the
 * Upgrade wheel are separately ratified (GDD §2.5, amended 2026-08-06), live in
 * the DETAIL slot, and are none of this file's business.
 */
import { describe, it, expect } from 'vitest';
import { buildWheelModel, WHEEL_ORDER } from './build-wheel';
import type { BuildWheelSignals } from './build-wheel';
import { upgradeWheelModel, UpgradeTrack, STOCK_TIERS, UPGRADE_LADDER, WEAPON_GROUP } from './upgrade-wheel';
import type { UpgradeWheelSignals, UpgradeTiers } from './upgrade-wheel';
import { costWords, upgradeCostWords, OPENS_SCREEN } from './wheel-stack';
import { ShipClass } from '@shared/types';
import { REPAIR_COOLDOWN_SECONDS, SATELLITE, SHIELD, TURRET } from '../sim/constants';

function buildSig(over: Partial<BuildWheelSignals> = {}): BuildWheelSignals {
  return {
    requested: true,
    docked: true,
    shipAlive: true,
    stationAlive: true,
    cargo: 0,
    banked: 0,
    turrets: 0,
    shields: 0,
    satellites: 0,
    coreHp: 100,
    maxCoreHp: 100,
    ...over,
  };
}

function upgradeSig(over: Partial<UpgradeWheelSignals> = {}): UpgradeWheelSignals {
  return {
    open: true,
    weaponOpen: false,
    shipClass: ShipClass.Vanguard,
    tiers: STOCK_TIERS,
    ore: 0,
    ...over,
  };
}

function tiers(over: Partial<Record<UpgradeTrack, number>> = {}): UpgradeTiers {
  return { ...STOCK_TIERS, ...over };
}

/** Every track maxed — the state that makes a wedge say `MAX` instead of a price. */
const MAXED: UpgradeTiers = Object.fromEntries(
  (Object.keys(STOCK_TIERS) as UpgradeTrack[]).map((t) => [t, UPGRADE_LADDER[t].costs.length]),
) as UpgradeTiers;

/** One cost slot, wherever in the menu it was drawn. */
interface CostSlot {
  readonly page: string;
  readonly frame: string;
  readonly wedge: string;
  readonly text: string;
}

/**
 * A page of the menu: a name, and a way to list every cost slot it draws over a
 * spread of frames that between them hit ready / unaffordable / capped-or-maxed
 * / inactive. The frames matter as much as the wedges — a denominator that only
 * appears when the player is broke is still a denominator.
 */
const PAGES: readonly { name: string; slots: () => CostSlot[] }[] = [
  {
    name: 'build wheel',
    slots: () => {
      const frames: [string, Partial<BuildWheelSignals>][] = [
        ['broke', {}],
        ['some ore', { cargo: 2 }],
        ['flush', { banked: 99 }],
        ['fractional', { cargo: 1, banked: 6.8 }],
        [
          'everything capped',
          { banked: 99, turrets: TURRET.capPerStation, shields: SHIELD.capPerStation, satellites: SATELLITE.capPerStation },
        ],
        ['repair cooling', { banked: 99, coreHp: 40, repairGate: REPAIR_COOLDOWN_SECONDS }],
        ['collapsed', { banked: 99, coreHp: 40, collapsed: true }],
      ];
      const out: CostSlot[] = [];
      for (const [frame, over] of frames) {
        for (const seg of buildWheelModel(buildSig(over)).segments) {
          const text = costWords(seg);
          if (text !== null) out.push({ page: 'build wheel', frame, wedge: seg.id, text });
        }
      }
      return out;
    },
  },
  {
    name: 'upgrade wheel',
    slots: () => collectUpgrade('upgrade wheel', false),
  },
  {
    // The page the report says was missed — one level deeper than the screenshot.
    // `upgradeWheelSlots` expands the weapon run here, so DAMAGE and SPEED price
    // themselves through the very same `costLabelOf` the main wheel uses.
    name: 'WEAPON sub-wheel',
    slots: () => collectUpgrade('WEAPON sub-wheel', true),
  },
];

function collectUpgrade(page: string, weaponOpen: boolean): CostSlot[] {
  const frames: [string, Partial<UpgradeWheelSignals>][] = [
    ['broke', { ore: 0 }],
    ["the developer's 8 ore", { ore: 8 }],
    ['fractional', { ore: 6.8 }],
    ['flush', { ore: 999 }],
    ['mid-ladder, short', { ore: 8, tiers: tiers({ [UpgradeTrack.Engine]: 2 }) }],
    ['every track maxed', { ore: 999, tiers: MAXED }],
  ];
  const out: CostSlot[] = [];
  for (const [frame, over] of frames) {
    for (const w of upgradeWheelModel(upgradeSig({ ...over, weaponOpen })).wedges) {
      const text = upgradeCostWords(w);
      if (text !== null) out.push({ page, frame, wedge: w.label, text });
    }
  }
  return out;
}

describe('the cost slot says ONE number, on every page of the build menu (a0-41)', () => {
  it('draws a cost slot on every page — the walk is not silently empty', () => {
    for (const page of PAGES) {
      expect(page.slots().length, `${page.name} draws cost slots`).toBeGreaterThan(0);
    }
    // ...and the pages really are the whole menu: five Build segments, the
    // Upgrade wheel's tracks, and the weapon tracks behind WEAPON.
    expect(WHEEL_ORDER.length).toBe(5);
    const weaponTracks = (Object.keys(UPGRADE_LADDER) as UpgradeTrack[]).filter(
      (t) => UPGRADE_LADDER[t].group === WEAPON_GROUP,
    );
    expect(weaponTracks.length).toBeGreaterThan(0);
  });

  it('puts NO SLASH in any cost slot, on any page, in any state', () => {
    // The whole sentence, in one assertion: build wheel, upgrade wheel, and the
    // sub-page behind WEAPON, over frames that hit every wedge state each page
    // has. It fails the day a fourth page quotes a wallet next to a price.
    for (const page of PAGES) {
      for (const slot of page.slots()) {
        expect(slot.text, `${slot.page} · ${slot.wedge} @ ${slot.frame}`).not.toContain('/');
      }
    }
  });

  it('spends its whole vocabulary on prices and state words — nothing else', () => {
    // The slash guard alone would pass on `12 of 8`. A cost slot is the bare
    // price, one of the two wheels' own nouns for "no price left to quote", or
    // the arrow that means "there is another screen behind this".
    const STATE_WORDS = ['FULL', 'MAX', OPENS_SCREEN];
    for (const page of PAGES) {
      for (const slot of page.slots()) {
        const where = `${slot.page} · ${slot.wedge} @ ${slot.frame}`;
        if (STATE_WORDS.includes(slot.text)) continue;
        expect(slot.text, where).toMatch(/^\d+$/);
      }
    }
  });

  it('moves the price with the PRICE and never with the wallet', () => {
    // The proof the denominator is gone rather than hidden: the same wedge, at
    // wallets that span broke to flush, prints one identical string per page.
    for (const page of PAGES) {
      const byWedge = new Map<string, Set<string>>();
      for (const slot of page.slots()) {
        // Only the frames that vary the WALLET; the maxed/capped/cooling frames
        // vary the wedge's state, which is allowed to change the word.
        if (!['broke', "the developer's 8 ore", 'fractional', 'flush', 'some ore'].includes(slot.frame)) continue;
        const seen = byWedge.get(slot.wedge) ?? new Set<string>();
        seen.add(slot.text);
        byWedge.set(slot.wedge, seen);
      }
      for (const [wedge, seen] of byWedge) {
        expect([...seen], `${page.name} · ${wedge} across wallets`).toHaveLength(1);
      }
    }
  });
});
