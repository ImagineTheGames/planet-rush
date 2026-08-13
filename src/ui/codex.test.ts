/**
 * src/ui/codex.test.ts — the CODEX screen model, headless.
 *
 * The screen decides four things: which tabs, which entries are in the live
 * tab, which one's detail is shown, and where a tap lands. All four are pure
 * functions of the parsed codex data and a viewport, so the whole screen is
 * asserted here with no Pixi and no canvas. Two data sources: the REAL
 * `content/codex/*.json` (so a regenerated file that broke the shape would fail
 * here), and small synthetic fixtures for the deterministic layout/selection/
 * hit-test cases. The *wiring* (the main menu opens this, BACK leaves) is the
 * live-stage suite's job — the M2 lesson that a screen can be model-green and
 * never reached.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Rect } from '@platform/layout-registry';
import { TOUCH_MIN } from '../art/materials';
import { singlePrimary } from './gantry';
import {
  CODEX_BACK_LABEL,
  CODEX_TABS,
  CODEX_TITLE,
  activeEntries,
  activeEntry,
  activeEntryIndex,
  codexBotHint,
  codexShipHint,
  codexEntryPlate,
  codexHitTest,
  codexLayout,
  codexModel,
  codexRailContentHeight,
  codexTabPlate,
  codexTargetKey,
  createCodex,
  formatFactValue,
  normalizeCodex,
  selectCodexEntry,
  selectCodexTab,
} from './codex';
import type { CodexData, CodexLayout } from './codex';

const VIEWPORT = { width: 1280, height: 720 };
const center = (r: Rect) => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

// --- The real content, loaded the way the pipeline test loads it -----------
const CODEX_DIR = fileURLToPath(new URL('../../content/codex/', import.meta.url));
function loadReal(): CodexData {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(`${CODEX_DIR}codex-${name}.json`, 'utf8'));
  return normalizeCodex({
    objective: read('objective'),
    bots: read('bots'),
    ships: read('ships'),
    systems: read('systems'),
    strategy: read('strategy'),
  });
}
const REAL = loadReal();

// --- A tiny synthetic fixture for deterministic geometry -------------------
function fixture(): CodexData {
  const entry = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
    id,
    title,
    summary: `${title} summary`,
    body: `${title} body`,
    ...extra,
  });
  return normalizeCodex({
    // OBJECTIVE first, as CODEX_TABS orders it (a0-34) — so a fixture-driven
    // test opens where a player opens.
    objective: { title: 'Objective', entries: [entry('o1', 'Last station standing')] },
    bots: {
      title: 'Bots',
      entries: [
        entry('b1', 'Alpha', { difficulty: 'Easy', hull: 'Hauler', see_also: ['b2'] }),
        entry('b2', 'Beta', { difficulty: 'Hard', hull: 'Interceptor' }),
      ],
    },
    ships: { title: 'Ships', entries: [entry('s1', 'Vanguard', { facts: [{ label: 'Hull HP', value: 120, unit: 'HP' }] })] },
    systems: { title: 'Systems', entries: [entry('y1', 'Repair'), entry('y2', 'Ore'), entry('y3', 'Waves')] },
    strategy: { title: 'Strategy', entries: [entry('t1', 'Triangle')] },
  });
}

describe('normalize', () => {
  it('parses all five real files into non-empty sections', () => {
    for (const tab of CODEX_TABS) {
      expect(REAL[tab.id].entries.length, `${tab.id} has entries`).toBeGreaterThan(0);
      expect(REAL[tab.id].title, `${tab.id} has a file title`).not.toBe('');
    }
  });

  it('leads with OBJECTIVE, and its first entry is the win condition (a0-34)', () => {
    // The developer's ruling: "id make it the first thing in the codex, and make
    // sure it's section is the first." Asserted on the REAL files, because the
    // failure worth catching is a section that exists and is not where it was
    // ruled to be — or one whose first entry is not the objective.
    expect(CODEX_TABS[0]!.id).toBe('objective');
    expect(CODEX_TABS.map((t) => t.id).slice(1)).toEqual(['bots', 'ships', 'systems', 'strategy']);
    const first = REAL.objective.entries[0]!;
    expect(first.title).toMatch(/last station standing/i);
    // GDD §1, enforced by `src/sim/match.ts` resolveWinner: the last surviving
    // reactor takes it, and in Teams the last side with one. Both halves have to
    // be in the entry, because the FFA half alone is what left a developer
    // reporting "i lost somehow but my team is the one that won".
    expect(first.body).toMatch(/reactor/i);
    expect(REAL.objective.entries.map((e) => e.body).join(' ')).toMatch(/in Teams/i);
  });

  it("keeps the bots' difficulty and hull, and the systems' machine-checked facts", () => {
    // A bot carries its tier + hull; a systems entry carries at least one fact.
    expect(REAL.bots.entries.some((e) => e.difficulty !== null && e.hull !== null)).toBe(true);
    expect(REAL.systems.entries.some((e) => e.facts.length > 0)).toBe(true);
    // Every real fact has a numeric value — the thing the screen renders.
    for (const e of [...REAL.systems.entries, ...REAL.ships.entries]) {
      for (const f of e.facts) expect(typeof f.value).toBe('number');
    }
  });

  it('drops an entry missing id, title or body, and coerces the rest', () => {
    const data = normalizeCodex({
      bots: {
        title: 'B',
        entries: [
          { id: 'ok', title: 'Ok', body: 'has a body' },
          { id: 'no-body', title: 'No body' }, // dropped
          { title: 'No id', body: 'x' }, // dropped
          { id: 'no-title', body: 'x' }, // dropped
          'not an object', // dropped
        ],
      },
    });
    expect(data.bots.entries.map((e) => e.id)).toEqual(['ok']);
    // Absent optional fields normalise to safe empties, never undefined.
    const only = data.bots.entries[0]!;
    expect(only.summary).toBe('');
    expect(only.facts).toEqual([]);
    expect(only.seeAlso).toEqual([]);
    expect(only.difficulty).toBeNull();
    expect(only.hull).toBeNull();
  });

  it('yields an empty section for a missing or malformed file rather than throwing', () => {
    const data = normalizeCodex({ bots: null, ships: 42, systems: undefined });
    for (const tab of CODEX_TABS) {
      expect(data[tab.id].entries).toEqual([]);
      expect(data[tab.id].category).toBe(tab.id);
    }
  });

  it('skips a fact with no numeric value', () => {
    const data = normalizeCodex({
      systems: { title: 'S', entries: [{ id: 'e', title: 'E', body: 'b', facts: [{ label: 'bad', value: 'nope' }, { label: 'ok', value: 5, unit: 's' }] }] },
    });
    expect(data.systems.entries[0]!.facts).toEqual([{ label: 'ok', value: 5, unit: 's' }]);
  });
});

describe('selection', () => {
  it('opens on OBJECTIVE — the first tab — with its first entry selected', () => {
    // The developer's ruling (a0-34): the objective is the first thing in the
    // codex and its section is the first, so a codex opened from the menu with no
    // tab argument lands on it.
    const state = createCodex(fixture());
    expect(state.activeTab).toBe('objective');
    expect(state.selectedId).toBe('o1');
    expect(activeEntry(state)?.title).toBe('Last station standing');
  });

  it('still opens on an explicitly named tab', () => {
    const state = createCodex(fixture(), 'bots');
    expect(state.activeTab).toBe('bots');
    expect(state.selectedId).toBe('b1');
    expect(activeEntry(state)?.title).toBe('Alpha');
  });

  it('switches tab and selects that tab\'s first entry', () => {
    const state = selectCodexTab(createCodex(fixture()), 'systems');
    expect(state.activeTab).toBe('systems');
    expect(state.selectedId).toBe('y1');
    expect(activeEntries(state)).toHaveLength(3);
  });

  it('is identity-stable when re-selecting the live tab or entry', () => {
    const state = createCodex(fixture(), 'bots');
    expect(selectCodexTab(state, 'bots')).toBe(state);
    expect(selectCodexEntry(state, 0)).toBe(state);
    // Out-of-range entry index is a no-op too.
    expect(selectCodexEntry(state, 99)).toBe(state);
  });

  it('selects an entry by index within the active tab', () => {
    const state = selectCodexEntry(createCodex(fixture(), 'bots'), 1);
    expect(state.selectedId).toBe('b2');
    expect(activeEntryIndex(state)).toBe(1);
  });

  it('carries no selection for an empty tab', () => {
    const state = createCodex(normalizeCodex({ bots: { title: 'B', entries: [] } }), 'bots');
    expect(state.selectedId).toBeNull();
    expect(activeEntry(state)).toBeNull();
  });
});

describe('the model', () => {
  it('names the screen, the back control and the five tabs in order', () => {
    const model = codexModel(createCodex(fixture()));
    expect(model.title).toBe(CODEX_TITLE);
    expect(model.backLabel).toBe(CODEX_BACK_LABEL);
    // OBJECTIVE leads and the original four keep their contents and their
    // relative order behind it (a0-34).
    expect(model.tabs.map((t) => t.label)).toEqual([
      'OBJECTIVE',
      'BOTS',
      'SHIPS',
      'SYSTEMS',
      'STRATEGY',
    ]);
    expect(model.tabs.map((t) => t.active)).toEqual([true, false, false, false, false]);
  });

  it('marks exactly the selected entry in the rail', () => {
    const model = codexModel(selectCodexEntry(createCodex(fixture(), 'bots'), 1));
    expect(model.entries.map((e) => e.title)).toEqual(['Alpha', 'Beta']);
    expect(model.entries.map((e) => e.selected)).toEqual([false, true]);
  });

  it('shows difficulty then hull as badges on a bot, and none elsewhere', () => {
    const bots = codexModel(createCodex(fixture(), 'bots'));
    expect(bots.detail?.badges).toEqual(['Easy', 'Hauler']);
    const systems = codexModel(selectCodexTab(createCodex(fixture()), 'systems'));
    expect(systems.detail?.badges).toEqual([]);
  });

  it('renders facts with their unit', () => {
    const ships = codexModel(selectCodexTab(createCodex(fixture()), 'ships'));
    expect(ships.detail?.facts).toEqual([{ label: 'Hull HP', value: '120 HP' }]);
  });

  it('formats a unit-less fact as a bare number', () => {
    expect(formatFactValue({ label: 'x', value: 8, unit: null })).toBe('8');
    expect(formatFactValue({ label: 'x', value: 10, unit: 's' })).toBe('10 s');
  });

  it('carries the active file title', () => {
    expect(codexModel(createCodex(fixture())).sectionTitle).toBe('Objective');
    expect(codexModel(createCodex(fixture(), 'bots')).sectionTitle).toBe('Bots');
  });

  it('resolves see-also ids to titles and drops unknown ids', () => {
    // b1's see_also is ['b2'] → "Beta".
    expect(codexModel(createCodex(fixture(), 'bots')).detail?.seeAlso).toEqual(['Beta']);
    const data = normalizeCodex({
      bots: { title: 'B', entries: [{ id: 'a', title: 'A', body: 'x', see_also: ['ghost', 'a'] }] },
    });
    // 'ghost' names nothing and is dropped; 'a' resolves to itself.
    expect(codexModel(createCodex(data, 'bots')).detail?.seeAlso).toEqual(['A']);
  });

  it('has a null detail for an empty tab', () => {
    const model = codexModel(createCodex(normalizeCodex({ bots: { title: 'B', entries: [] } }), 'bots'));
    expect(model.detail).toBeNull();
    expect(model.entries).toEqual([]);
  });
});

describe('layout', () => {
  const layoutFor = (vp = VIEWPORT, count = 3, opts = {}): CodexLayout => codexLayout(vp, count, opts);

  it('keeps every chrome rect inside the viewport', () => {
    const l = layoutFor();
    for (const rect of [l.title, l.back, ...l.tabs, l.rail, l.detail]) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
      expect(rect.x + rect.width).toBeLessThanOrEqual(VIEWPORT.width + 0.001);
      expect(rect.y + rect.height).toBeLessThanOrEqual(VIEWPORT.height + 0.001);
    }
  });

  it('sits the rail left of the detail, both below the tabs', () => {
    const l = layoutFor();
    expect(l.rail.x + l.rail.width).toBeLessThanOrEqual(l.detail.x);
    expect(l.rail.y).toBeGreaterThanOrEqual(l.tabs[0]!.y + l.tabs[0]!.height);
    expect(l.detail.width).toBeGreaterThan(l.rail.width); // detail is the wider pane
  });

  it('lays out one tab chip per section, left-to-right with no overlap', () => {
    const l = layoutFor();
    // Pinned to CODEX_TABS rather than to a literal, so the fifth section (a0-34)
    // is laid out rather than silently dropped off the strip.
    expect(l.tabs).toHaveLength(CODEX_TABS.length);
    for (let i = 1; i < l.tabs.length; i++) {
      expect(l.tabs[i]!.x).toBeGreaterThanOrEqual(l.tabs[i - 1]!.x + l.tabs[i - 1]!.width);
    }
  });

  it('lays out one rail rect per entry, stacked', () => {
    const l = layoutFor(VIEWPORT, 5);
    expect(l.railEntries).toHaveLength(5);
    for (let i = 1; i < l.railEntries.length; i++) {
      expect(l.railEntries[i]!.y).toBeGreaterThan(l.railEntries[i - 1]!.y);
    }
  });

  it('clears the thumb floor on every device, WITHOUT being told it is one (u7-04)', () => {
    // The tabs used to be 44px on a pointer and 52 under a thumb, which meant a
    // caller that forgot `isTouch` shipped a 44px tab to a finger. Under Gantry the
    // floor is a property of the FRAME, not of the flag: `valueChipHeight` and
    // `rowHeight` never return less than TOUCH_MIN, so the same viewport gives the
    // same thumb-sized control whether or not anyone remembered to say "touch".
    // The brief's one hard number for this screen is the tab row's 48.
    for (const isTouch of [false, true]) {
      for (const vp of [VIEWPORT, { width: 844, height: 390 }, { width: 390, height: 844 }]) {
        const l = codexLayout(vp, 3, { isTouch });
        expect(l.tabs[0]!.height, `tab height at ${vp.width}×${vp.height}`).toBeGreaterThanOrEqual(
          TOUCH_MIN,
        );
        expect(l.entryHeight, `entry height at ${vp.width}×${vp.height}`).toBeGreaterThanOrEqual(
          TOUCH_MIN,
        );
      }
    }
  });

  it('reports the rail content height so the view can clamp its scroll', () => {
    const l = layoutFor(VIEWPORT, 14, { isTouch: true }); // SYSTEMS-sized
    const h = codexRailContentHeight(l);
    expect(h).toBe(14 * l.entryHeight + 13 * l.entryGap);
    // Fourteen thumb-height rows overflow a short landscape rail — the case the
    // view scrolls.
    expect(h).toBeGreaterThan(l.rail.height);
  });

  it('never lets the rail take more than half the width on a narrow viewport', () => {
    const l = codexLayout({ width: 360, height: 320 }, 3);
    expect(l.rail.width).toBeLessThanOrEqual(l.content.width / 2 + 0.001);
    expect(l.detail.width).toBeGreaterThanOrEqual(l.rail.width);
    expect(l.detail.width).toBeGreaterThanOrEqual(0);
  });

  it('yields non-backwards rects on a comically small viewport', () => {
    const l = codexLayout({ width: 4, height: 4 }, 3);
    for (const rect of [l.title, l.back, ...l.tabs, l.rail, l.detail, ...l.railEntries]) {
      expect(rect.width).toBeGreaterThanOrEqual(0);
      expect(rect.height).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the CODEX in Gantry/Bone (u7-04)', () => {
  const state = createCodex(REAL, 'bots');

  it('draws NO bright plate — a reference screen has no headline action', () => {
    // Zero primaries is legal and correct here: `singlePrimary` allows it, and a
    // screen you consult rather than act on should not be shouting at you. BACK is
    // secondary, every rail row is a secondary plate or an inert surface, and the
    // active TAB's brightness is a CHIP state, which is a different size family
    // (`./gantry` countPrimaries takes a screen's PLATES).
    const model = codexModel(state);
    const platePlates = ['secondary' as const, ...model.entries.map((e) => codexEntryPlate(e))];
    expect(singlePrimary(platePlates)).toBe(true);
    expect(platePlates.filter((r) => r === 'primary')).toHaveLength(0);
  });

  it('marks the ACTIVE TAB and the SELECTED ENTRY differently (the brief’s rule)', () => {
    const model = codexModel(state);
    const active = model.tabs.filter((t) => t.active);
    const selected = model.entries.filter((e) => e.selected);
    expect(active).toHaveLength(1);
    expect(selected).toHaveLength(1);

    // The tab is marked by BRIGHTNESS — it takes the brightest chip material.
    expect(codexTabPlate(active[0]!)).toBe('primary');
    expect(codexTabPlate(model.tabs.find((t) => !t.active)!)).toBe('secondary');

    // The entry is NOT: it rises from a surface to a raised plate (and the view
    // hangs a Bone bar off its leading edge). Different question, different mark —
    // the two never share a treatment.
    expect(codexEntryPlate(selected[0]!)).toBe('secondary');
    expect(codexEntryPlate(model.entries.find((e) => !e.selected)!)).toBe('inert');
    expect(codexEntryPlate(selected[0]!)).not.toBe(codexTabPlate(active[0]!));
  });

  it('presses and hovers, keyed by the same string the pointer layer routes on', () => {
    expect(codexTargetKey({ kind: 'back' })).toBe('back');
    expect(codexTargetKey({ kind: 'tab', index: 2 })).toBe('tab:2');
    expect(codexTargetKey({ kind: 'entry', index: 5 })).toBe('entry:5');
    expect(codexTargetKey(null)).toBeNull();

    const hovered = codexModel(state, { hover: 'tab:1' });
    expect(hovered.tabs[1]?.state).toBe('hover');
    expect(hovered.tabs[0]?.state).toBe('rest');
    // A press outranks a hover on the same plate.
    const pressed = codexModel(state, { hover: 'tab:1', press: 'tab:1' });
    expect(pressed.tabs[1]?.state).toBe('press');
    expect(codexModel(state, { press: 'back' }).backState).toBe('press');
    expect(codexModel(state, { press: 'entry:2' }).entries[2]?.state).toBe('press');
  });

  it('keeps the ARTICLE the wider pane, and clear of the rail, on every profile', () => {
    // The reading pane is what the screen is for; the rail is an index into it.
    for (const vp of [
      { width: 1280, height: 800 },
      { width: 844, height: 390 },
      { width: 390, height: 844 },
      { width: 915, height: 412 },
    ]) {
      const l = codexLayout(vp, 14, { isTouch: true });
      expect(l.detail.width, `article wider at ${vp.width}×${vp.height}`).toBeGreaterThan(l.rail.width);
      expect(l.rail.x + l.rail.width, `panes clear at ${vp.width}×${vp.height}`).toBeLessThanOrEqual(
        l.detail.x,
      );
      // …and both live between the beams, never under one.
      expect(l.rail.y).toBeGreaterThanOrEqual(l.header.y + l.header.height);
      expect(l.detail.y + l.detail.height).toBeLessThanOrEqual(l.footer.y + 0.5);
    }
  });
});

describe('hit test', () => {
  const l = codexLayout(VIEWPORT, 5);

  it('lands BACK, then each tab, then each entry', () => {
    expect(codexHitTest(l, center(l.back).x, center(l.back).y)).toEqual({ kind: 'back' });
    l.tabs.forEach((rect, i) => {
      expect(codexHitTest(l, center(rect).x, center(rect).y)).toEqual({ kind: 'tab', index: i });
    });
    l.railEntries.forEach((rect, i) => {
      expect(codexHitTest(l, center(rect).x, center(rect).y)).toEqual({ kind: 'entry', index: i });
    });
  });

  it('is null off every control', () => {
    // The title heading is a label, not a control.
    expect(codexHitTest(l, l.title.x + 4, center(l.title).y)).toBeNull();
    expect(codexHitTest(l, -5, -5)).toBeNull();
  });

  it('shifts entry hits by the rail scroll', () => {
    const stride = l.entryHeight + l.entryGap;
    const topOfRail = { x: l.rail.x + 4, y: l.rail.y + l.entryHeight / 2 };
    // Unscrolled, the top of the rail is entry 0.
    expect(codexHitTest(l, topOfRail.x, topOfRail.y)).toEqual({ kind: 'entry', index: 0 });
    // Scrolled down by one stride, entry 0 has left the top and entry 1 sits there.
    expect(codexHitTest(l, topOfRail.x, topOfRail.y, stride)).toEqual({ kind: 'entry', index: 1 });
    // A fixed lower screen point shows a later entry once content scrolls up.
    const second = l.railEntries[1]!;
    expect(codexHitTest(l, center(second).x, center(second).y, stride)).toEqual({ kind: 'entry', index: 2 });
  });

  it('drops an entry scrolled above the rail top (clipped, so untappable)', () => {
    const stride = l.entryHeight + l.entryGap;
    // With a full-stride scroll, entry 0's shifted rect is entirely above the
    // rail, so nothing at a point above the rail top is hit.
    expect(codexHitTest(l, l.rail.x + 4, l.rail.y - 2, stride)).toBeNull();
  });

  it('never hits an entry outside the rail clip even at scroll 0', () => {
    // A y below the rail's bottom edge is off the list.
    const belowRail = { x: l.rail.x + 4, y: l.rail.y + l.rail.height + 20 };
    expect(codexHitTest(l, belowRail.x, belowRail.y)).toBeNull();
  });
});

describe('lobby reuse (GDD §2.10 point 2)', () => {
  it('resolves a bot dossier from the REAL data by personality id and by display name', () => {
    // The lobby seat name IS the character name; the personality id is its
    // lowercase. Both must land on the same real codex bot entry.
    const byId = codexBotHint(REAL, 'rusty');
    const byName = codexBotHint(REAL, 'Rusty');
    expect(byId).not.toBeNull();
    expect(byId).toEqual(byName);
    expect(byId!.title.toLowerCase()).toContain('rusty');
    expect(byId!.summary.length).toBeGreaterThan(0);
    // A bot dossier carries its tier and hull as badges.
    expect(byId!.badges.length).toBeGreaterThanOrEqual(1);
  });

  it('resolves every real bot personality to a dossier', () => {
    for (const p of ['rusty', 'bolt', 'foreman', 'patch', 'sable', 'vulture', 'warden']) {
      expect(codexBotHint(REAL, p), `${p} has a dossier`).not.toBeNull();
    }
  });

  it('resolves a hull description from the REAL data by ship class', () => {
    for (const cls of ['interceptor', 'vanguard', 'excavator', 'hauler']) {
      const hint = codexShipHint(REAL, cls);
      expect(hint, `${cls} has a hull description`).not.toBeNull();
      expect(hint!.summary.length).toBeGreaterThan(0);
    }
  });

  it('returns null for an unknown bot or hull rather than throwing', () => {
    expect(codexBotHint(REAL, 'nobody')).toBeNull();
    expect(codexShipHint(REAL, 'dreadnought')).toBeNull();
  });
});
