/**
 * src/net/playtest-log-button.test.ts — the DOWNLOAD LOG affordance
 * (`./playtest-log-button`, M10 playtest-log brief §2, §3).
 *
 * The button is the whole feature from the developer's side: if its words are wrong,
 * or if a press looks like it did nothing, the log never travels. So the wording
 * and the phases are asserted through the pure model, and the DOM half is driven with
 * a fake document — the same split (and the same reason) as
 * `@platform/boot-error`'s tests, since this repo has no jsdom.
 *
 * The ratification these tests now enforce (M10): *"Clipboard goes away for all (PC
 * and mobile)"*. There is ONE control here, it reads DOWNLOAD LOG, and no press it
 * can take reaches a clipboard on any device.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaytestLog, describeEnvironment } from './playtest-log';
import {
  DOWNLOAD_LOG_BUTTON_ID,
  DOWNLOAD_LOG_HINT_ID,
  DOWNLOAD_LOG_ROOT_ID,
  DownloadLogAffordance,
  ERROR_OFFER_HINT,
  downloadLogLabel,
  downloadLogModel,
  disconnectOfferHint,
  hideDownloadLog,
  installDownloadLogButton,
  renderDownloadLogHtml,
  resetDownloadLogButton,
  showDownloadLog,
} from './playtest-log-button';
import type { DownloadLogDom, DownloadLogElement } from './playtest-log-button';
// a0-98: the corner rule itself lives in `src/ui` (it is a placement decision about
// the game's own screens, and `src/net` owns none of them). The brief names THIS
// file for the test, so the import crosses lanes deliberately and in one direction
// only — `src/net/lifecycle.test.ts` already reaches into `../ui/healthbar` the
// same way.
import { kickOutClaimsTheGlass, matchLogOffer } from '../ui/log-offer';
import type { MatchLogOfferState } from '../ui/log-offer';

afterEach(() => resetDownloadLogButton());

function newLog(): PlaytestLog {
  const log = new PlaytestLog({ env: describeEnvironment({ sha: 'abc1234' }) });
  log.recordSessionStart();
  return log;
}

// ---------------------------------------------------------------------------
// A fake document, just enough to mount into
// ---------------------------------------------------------------------------

interface FakeElement extends DownloadLogElement {
  readonly listeners: (() => void)[];
  readonly children: FakeElement[];
  removed: boolean;
  /** Who currently holds this node — the fake's `appendChild` MOVES, as a real
   *  one does, which is what makes a re-home observable (a0-28). */
  parent: FakeElement | null;
}

/** The fake document, plus the two handles a0-28's tests need: the element the
 *  browser is "presenting fullscreen", and the document-level `fullscreenchange`
 *  the affordance follows. */
interface FakeDom extends DownloadLogDom {
  body: FakeElement;
  fullscreenElement: FakeElement | null;
  find: (id: string) => FakeElement | null;
  /** Make `el` (or none) the fullscreen element and fire `fullscreenchange`, the
   *  way a browser does when the player enters or backs out of fullscreen. */
  setFullscreen: (el: FakeElement | null) => void;
  /** A bare element to stand in for the game root — what `#app` is at runtime. */
  makeElement: () => FakeElement;
}

function fakeDom(): FakeDom {
  const registry = new Map<string, FakeElement>();
  const documentListeners = new Map<string, (() => void)[]>();

  const make = (): FakeElement => {
    const el: FakeElement = {
      id: '',
      hidden: false,
      listeners: [],
      children: [],
      removed: false,
      parent: null,
      get innerHTML(): string {
        return html;
      },
      set innerHTML(value: string) {
        html = value;
        // A write replaces the children: re-register the ids the markup declares, so
        // `getElementById` behaves like a browser's after an innerHTML write.
        for (const id of [DOWNLOAD_LOG_BUTTON_ID, DOWNLOAD_LOG_HINT_ID]) {
          registry.delete(id);
          if (value.includes(`id="${id}"`)) {
            const child = make();
            child.id = id;
            registry.set(id, child);
          }
        }
      },
      addEventListener: (_type, handler): void => void el.listeners.push(handler),
      appendChild: (child): void => {
        const c = child as FakeElement;
        // A real `appendChild` MOVES a node that already has a parent. The fake does
        // too, so "it left `body` and joined the fullscreen element" is one readback
        // rather than two that could both be true.
        if (c.parent) {
          const at = c.parent.children.indexOf(c);
          if (at >= 0) c.parent.children.splice(at, 1);
        }
        c.parent = el;
        el.children.push(c);
        if (c.id) registry.set(c.id, c);
      },
      remove: (): void => void (el.removed = true),
    };
    let html = '';
    return el;
  };

  const body = make();
  const dom: FakeDom = {
    body,
    fullscreenElement: null,
    createElement: (): DownloadLogElement => make(),
    getElementById: (id): DownloadLogElement | null => registry.get(id) ?? null,
    addEventListener: (type, handler): void => {
      const list = documentListeners.get(type) ?? [];
      list.push(handler);
      documentListeners.set(type, list);
    },
    find: (id): FakeElement | null => registry.get(id) ?? null,
    makeElement: make,
    setFullscreen: (el): void => {
      dom.fullscreenElement = el;
      for (const handler of documentListeners.get('fullscreenchange') ?? []) handler();
    },
  };
  return dom;
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

describe('the words on the button', () => {
  it('rests on DOWNLOAD LOG — the label the ratification names', () => {
    expect(downloadLogLabel('idle')).toBe('DOWNLOAD LOG');
  });

  it('answers a press, so it never looks dead', () => {
    expect(downloadLogLabel('working')).toBe('SAVING…');
    // The share sheet is the phone's route out (M10 action-echo §5), and the
    // button says where the file actually went rather than claiming a Downloads
    // folder it never reached.
    expect(downloadLogLabel('shared')).toBe('LOG SENT');
    expect(downloadLogLabel('saved')).toBe('LOG SAVED');
    expect(downloadLogLabel('failed')).toBe('SAVE FAILED');
  });

  it('never offers a clipboard word in any phase (ratified M10)', () => {
    const phases = ['idle', 'working', 'shared', 'saved', 'failed'] as const;
    for (const phase of phases) {
      expect(downloadLogLabel(phase), `phase ${phase} spoke of copying`).not.toMatch(/COP/i);
    }
  });

  it('offers the report on an error screen (the auto-offer, brief §3)', () => {
    expect(downloadLogModel({ reason: 'error' }, 'idle').hint).toBe(ERROR_OFFER_HINT);
    expect(ERROR_OFFER_HINT).toBe('DOWNLOAD LOG to report this.');
  });

  it('lets an error screen name its own failure instead', () => {
    const hint = "Couldn't reach the servers.";
    expect(downloadLogModel({ reason: 'error', hint }, 'idle').hint).toBe(hint);
  });

  it('stays quiet on the pause menu — the label says enough there', () => {
    expect(downloadLogModel({ reason: 'pause' }, 'idle').hint).toBe('');
  });

  it('tells the developer where the file went, and that it is a file', () => {
    expect(downloadLogModel({ reason: 'pause' }, 'saved').hint).toContain('attach that file');
    expect(downloadLogModel({ reason: 'pause' }, 'shared').hint).toContain('share sheet');
    // The failure names the device, not a clipboard that is no longer in the chain.
    expect(downloadLogModel({ reason: 'error' }, 'failed').hint).toBe(
      'Could not save the log on this device.',
    );
  });

  it('names what happened before it asks for the log, on a drop', () => {
    expect(disconnectOfferHint('reconnecting')).toBe(`Reconnecting — ${ERROR_OFFER_HINT}`);
    expect(disconnectOfferHint('closed', 'grace-elapsed')).toBe(
      `Disconnected (grace-elapsed) — ${ERROR_OFFER_HINT}`,
    );
    // No reason to give (a plain drop) still reads as a sentence.
    expect(disconnectOfferHint('closed', null)).toBe(`Disconnected — ${ERROR_OFFER_HINT}`);
  });

  it('disables the button only while a press is in flight', () => {
    expect(downloadLogModel({ reason: 'pause' }, 'working').busy).toBe(true);
    expect(downloadLogModel({ reason: 'pause' }, 'idle').busy).toBe(false);
  });
});

describe('the markup', () => {
  it('carries the ids, a real touch target, and no reserved colour', () => {
    const html = renderDownloadLogHtml(downloadLogModel({ reason: 'error' }, 'idle'));

    expect(html).toContain(`id="${DOWNLOAD_LOG_BUTTON_ID}"`);
    expect(html).toContain(`id="${DOWNLOAD_LOG_HINT_ID}"`);
    expect(html).toContain('DOWNLOAD LOG');
    // 44px minimum touch target (mobile amendment §1).
    expect(html).toContain('min-height:44px');
    // Signal yellow means ore or danger; threat red means damage (style-guide §2).
    // A diagnostic button is neither, so neither colour appears.
    expect(html.toUpperCase()).not.toContain('F2D24B');
    expect(html.toUpperCase()).not.toContain('B23A3A');
  });

  it('draws exactly one button — there is no sibling to choose between', () => {
    // The ratification's whole point: one control, so the developer never has to
    // pick the route that works. Counts elements, not stylesheet selectors.
    const html = renderDownloadLogHtml(downloadLogModel({ reason: 'pause' }, 'idle'));
    expect(html.match(/<button/g)).toHaveLength(1);
  });

  it('omits the hint element entirely when there is no hint', () => {
    const html = renderDownloadLogHtml(downloadLogModel({ reason: 'pause' }, 'idle'));
    expect(html).not.toContain(DOWNLOAD_LOG_HINT_ID);
  });

  it('escapes a hint, which can carry a server’s own words', () => {
    const html = renderDownloadLogHtml(
      downloadLogModel({ reason: 'error', hint: '<script>alert("x")</script>' }, 'idle'),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('marks the button disabled while working', () => {
    expect(renderDownloadLogHtml(downloadLogModel({ reason: 'pause' }, 'working'))).toContain(
      'disabled',
    );
  });

  // a0-28. `hide()` sets `hidden`, and the UA rule that acts on it —
  // `[hidden]{display:none}` — loses to this stylesheet's own `#id{display:flex}`.
  // Without a rule of our own the withdrawal never happens and the affordance sits
  // over live play, which is exactly the chrome the HUD budget refuses (GDD §2.2).
  it('lets `hidden` actually hide it, over its own display:flex', () => {
    const css = renderDownloadLogHtml(downloadLogModel({ reason: 'pause' }, 'idle'));
    expect(css).toContain(`#${DOWNLOAD_LOG_ROOT_ID}[hidden]{display:none;}`);
  });

  // The landscape lock (`@platform/orientation`). The game root is rotated +90° on a
  // touch viewport held portrait, so this affordance — DOM over the canvas, laid out
  // in physical space — has to rotate with it or be the one thing on the screen
  // reading sideways, in the wrong corner. Asserted as CSS text because that is the
  // whole mechanism: there is no JS to exercise, which is the point of doing it with
  // a media query rather than a resize handler this module would have to own.
  describe('under the landscape lock', () => {
    const css = renderDownloadLogHtml(downloadLogModel({ reason: 'pause' }, 'idle'));

    it('rotates only on a touch viewport held portrait — the lock’s own condition', () => {
      // `pointer:coarse` is the `isTouch` main.ts hands `computeRootTransform`;
      // `orientation:portrait` is its `physH > physW`. Anything else (desktop, or a
      // phone already in landscape) leaves the affordance untransformed.
      expect(css).toContain('@media (pointer:coarse) and (orientation:portrait)');
    });

    it('turns the same way the root does, so its text reads with the game’s', () => {
      // +π/2, matching `computeRootTransform`'s rotation — not -90, which would read
      // upside down relative to every other word on the screen.
      expect(css).toContain('rotate(90deg)');
      expect(css).not.toContain('rotate(-90deg)');
    });

    it('lands on the logical bottom-right, which is the PHYSICAL bottom-left', () => {
      // The root's +π/2-about-origin-then-translate-x-by-physW puts logical
      // bottom-right — where this sits unrotated — at physical (0, physH). So the
      // rotated rule anchors left/bottom and releases the `right` the base rule set.
      expect(css).toContain('right:auto');
      expect(css).toContain('left:max(12px,env(safe-area-inset-left))');
      expect(css).toContain('bottom:max(12px,env(safe-area-inset-bottom))');
      // Origin and pre-rotation shift together are what make it grow back INTO the
      // logical viewport instead of off its right edge.
      expect(css).toContain('transform-origin:left bottom');
      expect(css).toContain('translateX(-100%)');
    });

    it('caps its width against the physical height it is now measured along', () => {
      // Unrotated the cap is 80vw; rotated, the element's width runs down the
      // physical screen, so the viewport unit that bounds it is vh.
      expect(css).toContain('max-width:min(22rem,80vh)');
    });

    it('still states the 44px touch minimum, which a rotation cannot rescue', () => {
      // A rotated box swaps which edge is which; both minima are set, so the target
      // clears 44px in either orientation.
      expect(css).toContain('min-height:44px');
      expect(css).toContain('min-width:44px');
    });
  });
});

// ---------------------------------------------------------------------------
// The DOM edge
// ---------------------------------------------------------------------------

describe('DownloadLogAffordance', () => {
  it('mounts on the first show and hides rather than unmounting', () => {
    const dom = fakeDom();
    const affordance = new DownloadLogAffordance({ dom, log: newLog(), schedule: null });

    affordance.show({ reason: 'pause' });
    expect(dom.body.children).toHaveLength(1);
    expect(dom.body.children[0]!.id).toBe(DOWNLOAD_LOG_ROOT_ID);
    expect(dom.body.children[0]!.hidden).toBe(false);

    affordance.hide();
    expect(dom.body.children[0]!.hidden).toBe(true);
    expect(dom.body.children[0]!.removed).toBe(false);
    expect(affordance.visible).toBe(false);

    // Re-showing reuses the same element: the screens it serves come and go often.
    affordance.show({ reason: 'pause' });
    expect(dom.body.children).toHaveLength(1);
  });

  it('is a no-op on a repeat of the same offer, so a per-frame caller is free', () => {
    const dom = fakeDom();
    const affordance = new DownloadLogAffordance({ dom, log: newLog(), schedule: null });
    affordance.show({ reason: 'pause' });
    const button = dom.find(DOWNLOAD_LOG_BUTTON_ID)!;

    for (let i = 0; i < 100; i++) affordance.show({ reason: 'pause' });
    // The element was not rewritten, so no listener piled up on it.
    expect(dom.find(DOWNLOAD_LOG_BUTTON_ID)).toBe(button);
    expect(button.listeners).toHaveLength(1);
  });

  // ── a0-28: it mounts where the pixels are ────────────────────────────────
  //
  // *"download logs used to live in match as well pretty sure it was in pause
  // menu."* … *"I was on mobile."* On touch, PLAY makes the game root the
  // FULLSCREEN element (`@platform/fullscreen`), which puts it in the browser's top
  // layer and paints a `::backdrop` over the rest of the document. The top layer is
  // not a z-index: an affordance left in `body` beside the fullscreen element is
  // laid out, sized, `visibility: visible` — and painted under the backdrop, at the
  // largest z-index the platform has. Measured on a real 844×390 landscape touch
  // boot: a 189×44 box at (643, 334), and `elementFromPoint` at its own centre
  // returning the canvas.
  //
  // These assert the parent, which is the thing that decides it. That the result is
  // actually ON THE GLASS is `tests/live-stage/log-download-fullscreen.spec.ts`,
  // because a parent is a claim and a photograph is not.
  describe('with the game root fullscreen', () => {
    it('mounts INSIDE the fullscreen element, never beside it', () => {
      const dom = fakeDom();
      const app = dom.makeElement();
      app.id = 'app';
      dom.setFullscreen(app);

      const affordance = new DownloadLogAffordance({ dom, log: newLog(), schedule: null });
      affordance.show({ reason: 'pause' });

      expect(app.children.map((c) => c.id), 'the log is buried under the backdrop').toEqual([
        DOWNLOAD_LOG_ROOT_ID,
      ]);
      expect(dom.body.children, 'a sibling of the fullscreen element is a hidden one').toHaveLength(
        0,
      );
    });

    it('follows the player in, and back out again', () => {
      const dom = fakeDom();
      const app = dom.makeElement();
      app.id = 'app';

      // Offered first — the boot-error screen and the desk both reach it this way.
      const affordance = new DownloadLogAffordance({ dom, log: newLog(), schedule: null });
      affordance.show({ reason: 'error', hint: 'Boot failed.' });
      expect(dom.body.children).toHaveLength(1);

      // …and then PLAY goes fullscreen under it. The player can also back out with a
      // system gesture at any moment (the game offers a re-enter affordance for
      // exactly that), so this has to run both ways, not once at mount.
      dom.setFullscreen(app);
      expect(app.children.map((c) => c.id)).toEqual([DOWNLOAD_LOG_ROOT_ID]);
      expect(dom.body.children).toHaveLength(0);

      dom.setFullscreen(null);
      expect(dom.body.children.map((c) => c.id)).toEqual([DOWNLOAD_LOG_ROOT_ID]);
      expect(app.children).toHaveLength(0);
    });

    it('re-homes on the next per-frame show, for a browser that fired no event', () => {
      const dom = fakeDom();
      const affordance = new DownloadLogAffordance({ dom, log: newLog(), schedule: null });
      affordance.show({ reason: 'pause' });

      // Fullscreen arrives with NO `fullscreenchange` — the pessimistic case. The
      // per-frame caller (`main.ts` `syncDownloadLog`, every rendered frame) repeats
      // the identical offer, and the fast path is what has to notice.
      const app = dom.makeElement();
      app.id = 'app';
      dom.fullscreenElement = app;
      affordance.show({ reason: 'pause' });

      expect(app.children.map((c) => c.id)).toEqual([DOWNLOAD_LOG_ROOT_ID]);
      expect(dom.body.children).toHaveLength(0);
    });

    it('still mounts into body where there is no fullscreen at all', () => {
      // The desk, iPhone Safari, and the boot-error screen — character for character
      // what they were. `fullscreenElement` is optional on the seam for this reason.
      const dom = fakeDom();
      const affordance = new DownloadLogAffordance({ dom, log: newLog(), schedule: null });
      affordance.show({ reason: 'pause' });
      expect(dom.body.children.map((c) => c.id)).toEqual([DOWNLOAD_LOG_ROOT_ID]);
    });
  });

  it('hands the share sheet a FILE when the platform takes one', async () => {
    const dom = fakeDom();
    const shared: { title?: string; files?: unknown[] }[] = [];
    const affordance = new DownloadLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: {
        share: { share: async (d) => void shared.push(d) },
        makeShareFile: (name, text) => ({ name, text }),
        save: null,
      },
    });

    affordance.show({ reason: 'error', hint: "Couldn't reach the servers." });
    const result = await affordance.download();

    expect(result.ok && result.route).toBe('share');
    expect(shared[0]!.files).toHaveLength(1);
    expect(affordance.state).toBe('shared');
    expect(dom.body.children[0]!.innerHTML).toContain('LOG SENT');
  });

  it('saves a parseable file when there is no share sheet', async () => {
    const dom = fakeDom();
    const saved: { name: string; text: string }[] = [];
    const affordance = new DownloadLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { share: null, save: (name, text) => void saved.push({ name, text }) },
    });
    affordance.show({ reason: 'pause' });

    const result = await affordance.download();
    expect(result.ok && result.route).toBe('download');
    // Named for the build, and a `.json` — the timestamp half is
    // `playtestLogFilename`'s own test, since node has no clock to stamp here.
    expect(saved[0]!.name).toMatch(/^planet-rush-log-abc1234-.+\.json$/);
    expect(JSON.parse(saved[0]!.text)).toMatchObject({ schema: 'planet-rush.playtest-log' });
    expect(affordance.state).toBe('saved');
    expect(dom.body.children[0]!.innerHTML).toContain('LOG SAVED');
  });

  it('says SAVE FAILED rather than pretending', async () => {
    const dom = fakeDom();
    const affordance = new DownloadLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { share: null, save: null },
    });
    affordance.show({ reason: 'pause' });

    await affordance.download();
    expect(affordance.state).toBe('failed');
    expect(dom.body.children[0]!.innerHTML).toContain('SAVE FAILED');
  });

  it('collapses a doubled thumb into one export', async () => {
    const dom = fakeDom();
    const save = vi.fn();
    const affordance = new DownloadLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { share: null, save },
    });
    affordance.show({ reason: 'pause' });

    const [first, second] = await Promise.all([affordance.download(), affordance.download()]);
    expect(first.ok).toBe(true);
    expect(second.ok, 'the second press started a second write of a 40 KB file').toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('is wired to the button element a tap actually hits', async () => {
    const dom = fakeDom();
    const save = vi.fn();
    const affordance = new DownloadLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { share: null, save },
    });
    affordance.show({ reason: 'pause' });

    dom.find(DOWNLOAD_LOG_BUTTON_ID)!.listeners.forEach((fn) => fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(1);
  });

  it('reverts to DOWNLOAD LOG once the answer has been read', async () => {
    const dom = fakeDom();
    const pending: (() => void)[] = [];
    const affordance = new DownloadLogAffordance({
      dom,
      log: newLog(),
      schedule: (fn) => void pending.push(fn),
      exportOptions: { share: null, save: () => {} },
    });
    affordance.show({ reason: 'pause' });

    await affordance.download();
    expect(affordance.state).toBe('saved');
    pending.forEach((fn) => fn());
    expect(affordance.state).toBe('idle');
    expect(dom.body.children[0]!.innerHTML).toContain('DOWNLOAD LOG');
  });

  it('does not let a stale revert wipe a newer press’s answer', async () => {
    const dom = fakeDom();
    const pending: (() => void)[] = [];
    const affordance = new DownloadLogAffordance({
      dom,
      log: newLog(),
      schedule: (fn) => void pending.push(fn),
      exportOptions: { share: null, save: () => {} },
    });
    affordance.show({ reason: 'pause' });

    await affordance.download();
    await affordance.download(); // a second press before the first timer fires
    pending[0]!(); // the FIRST press's revert, now stale
    expect(affordance.state).toBe('saved');
  });

  it('drops a previous answer when a new screen makes a new offer', async () => {
    const dom = fakeDom();
    const affordance = new DownloadLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { share: null, save: () => {} },
    });
    affordance.show({ reason: 'pause' });
    await affordance.download();
    expect(affordance.state).toBe('saved');

    affordance.show({ reason: 'error', hint: 'Lost the match server.' });
    expect(affordance.state).toBe('idle');
    expect(dom.body.children[0]!.innerHTML).toContain('Lost the match server.');
    expect(dom.body.children[0]!.innerHTML).toContain('DOWNLOAD LOG');
  });

  it('survives a page with no body to mount into', () => {
    const dom: DownloadLogDom = {
      body: null,
      createElement: fakeDom().createElement,
      getElementById: () => null,
    };
    const affordance = new DownloadLogAffordance({ dom, log: newLog(), schedule: null });
    expect(() => affordance.show({ reason: 'pause' })).not.toThrow();
  });
});

describe('the shared affordance', () => {
  it('does nothing where none was installed — a caller needs no null check', () => {
    expect(() => showDownloadLog({ reason: 'pause' })).not.toThrow();
    expect(() => hideDownloadLog()).not.toThrow();
  });

  it('routes show/hide to the installed one', () => {
    const dom = fakeDom();
    const affordance = installDownloadLogButton({ dom, log: newLog(), schedule: null });

    showDownloadLog({ reason: 'error' });
    expect(affordance.visible).toBe(true);
    hideDownloadLog();
    expect(affordance.visible).toBe(false);
  });

  it('tears the old element down when a new affordance is installed', () => {
    const dom = fakeDom();
    const first = installDownloadLogButton({ dom, log: newLog(), schedule: null });
    first.show({ reason: 'pause' });
    installDownloadLogButton({ dom, log: newLog(), schedule: null });
    expect(dom.body.children[0]!.removed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// a0-98 — the offer never lands on a control the player needs
// ---------------------------------------------------------------------------

/**
 * A rect in page pixels, exactly as the capture measured it on the built bundle.
 * These are not numbers anybody chose: every one of them came back from a real
 * Chromium, and the collisions came back from `document.elementFromPoint` at the
 * point the CLIENT ITSELF said it drew the control
 * (`evidence/a0-98-corner-collisions-everywhere-else`).
 */
interface MeasuredBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One control the client drew, and the browser's verdict at its own centre. */
interface MeasuredControl {
  readonly name: string;
  readonly box: MeasuredBox;
  /** `document.elementFromPoint` at the control's own reported point. */
  readonly topmost: string;
}

/**
 * One state of the client, measured. `rule` says which of the four offer sites in
 * `src/main.ts` decides this screen — the match one is
 * `@ui` log-offer `matchLogOffer`, and it is the one this file asserts against;
 * the others are recorded so a later change to them is measured against the same
 * table rather than against nothing.
 */
interface MeasuredState {
  readonly what: string;
  readonly viewport: string;
  readonly rule: 'match' | 'front-door' | 'boot';
  /** The inputs the match rule reads. `null` on a screen it does not decide. */
  readonly match: MatchLogOfferState | null;
  /** Where the affordance actually stood, or `null` if it was never mounted. */
  readonly offer: MeasuredBox | null;
  /** Every control that was LIVE — one the client would route a press to.
   *  Elements merely DRAWN under an overlay that consumes every press (the HUD
   *  beneath the pause menu) are not controls and are not listed here. */
  readonly liveControls: readonly MeasuredControl[];
}

/** Whether the client's rule stands the offer up in this measured state. The match
 *  rule is `matchLogOffer`; the other two sites are unchanged by a0-98, so for those
 *  the capture's own answer — was it mounted and shown — is the rule. */
function offeredIn(s: MeasuredState): boolean {
  if (s.rule === 'match' && s.match) return matchLogOffer(s.match) !== null;
  return s.offer !== null;
}

/** Do two measured rects share any pixel? */
function overlaps(a: MeasuredBox, b: MeasuredBox): boolean {
  return (
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height
  );
}

/**
 * **The cross-product, as measured.** Every state in which any of the four sites
 * shows the offer, crossed with what the client draws in the bottom-right corner
 * of that state, on a phone and a desktop viewport — plus a phone held PORTRAIT,
 * because the affordance's own CSS re-homes it to the other physical corner there.
 *
 * The offline rows come from the shipped artifact through its real front door; the
 * online ones from the shipped client against a real allocator and a real match
 * server, with the wire really cut.
 */
const MEASURED: readonly MeasuredState[] = [
  {
    what: 'room list, a row refused',
    viewport: 'desktop 1280x800',
    rule: 'front-door',
    match: null,
    offer: { x: 1062, y: 706, width: 206, height: 82 },
    liveControls: [
      { name: '__onlineMenu.doorControls[0]<mode:browse>', box: { x: 44, y: 192, width: 168, height: 48 }, topmost: 'CANVAS#app' },
      { name: '__onlineMenu.doorControls[1]<mode:code>', box: { x: 219, y: 192, width: 168, height: 48 }, topmost: 'CANVAS#app' },
      { name: '__onlineMenu.doorControls[2]<back>', box: { x: 44, y: 726, width: 140, height: 56 }, topmost: 'CANVAS#app' },
    ],
  },
  {
    what: 'boot failure (no WebGL)',
    viewport: 'desktop 1280x800',
    rule: 'boot',
    match: null,
    offer: { x: 978, y: 706, width: 290, height: 82 },
    liveControls: [
      { name: 'dom#boot-error-retry', box: { x: 305, y: 672, width: 107, height: 44 }, topmost: 'BUTTON#boot-error-retry' },
    ],
  },
  {
    what: 'boot failure, RETRY scrolled into view',
    viewport: 'desktop 1280x800',
    rule: 'boot',
    match: null,
    offer: { x: 978, y: 706, width: 290, height: 82 },
    liveControls: [
      { name: 'dom#boot-error-retry', box: { x: 305, y: 668, width: 107, height: 44 }, topmost: 'BUTTON#boot-error-retry' },
    ],
  },
  {
    what: 'pause menu, offline match',
    viewport: 'desktop 1280x800',
    rule: 'match',
    match: { pauseScreen: 'menu', session: null, glass: 'match' },
    offer: { x: 1079, y: 744, width: 189, height: 44 },
    liveControls: [],
  },
  {
    what: 'online match, session dropped',
    viewport: 'desktop 1280x800',
    rule: 'match',
    match: { pauseScreen: 'closed', session: 'reconnecting', glass: 'kicked-out' },
    offer: { x: 959, y: 706, width: 309, height: 82 },
    liveControls: [
      { name: '__cornerStage.elements[7]<minimap>', box: { x: 1120, y: 600, width: 148, height: 148 }, topmost: 'DIV#pr-link-loss' },
      { name: 'dom#pr-link-loss-reconnect', box: { x: 436, y: 424, width: 198, height: 44 }, topmost: 'BUTTON#pr-link-loss-reconnect' },
      { name: 'dom#pr-link-loss-abandon', box: { x: 644, y: 424, width: 200, height: 44 }, topmost: 'BUTTON#pr-link-loss-abandon' },
    ],
  },
  {
    what: 'online match, dropped and backgrounded',
    viewport: 'desktop 1280x800',
    rule: 'match',
    match: { pauseScreen: 'closed', session: 'reconnecting', glass: 'kicked-out' },
    offer: { x: 959, y: 706, width: 309, height: 82 },
    liveControls: [
      { name: '__cornerStage.elements[7]<minimap>', box: { x: 1120, y: 600, width: 148, height: 148 }, topmost: 'DIV#pr-link-loss' },
      { name: 'dom#pr-link-loss-reconnect', box: { x: 436, y: 424, width: 198, height: 44 }, topmost: 'BUTTON#pr-link-loss-reconnect' },
      { name: 'dom#pr-link-loss-abandon', box: { x: 644, y: 424, width: 200, height: 44 }, topmost: 'BUTTON#pr-link-loss-abandon' },
    ],
  },
  {
    what: 'online match, dropped, pause menu open',
    viewport: 'desktop 1280x800',
    rule: 'match',
    match: { pauseScreen: 'menu', session: 'reconnecting', glass: 'match' },
    offer: { x: 916, y: 688, width: 352, height: 100 },
    liveControls: [
      { name: 'dom#pr-link-loss-menu', box: { x: 551, y: 427, width: 178, height: 44 }, topmost: 'BUTTON#pr-link-loss-menu' },
    ],
  },
  {
    what: 'boot failure (no WebGL)',
    viewport: 'phone 798x384',
    rule: 'boot',
    match: null,
    offer: { x: 496, y: 290, width: 290, height: 82 },
    liveControls: [],
  },
  {
    what: 'boot failure, RETRY scrolled into view',
    viewport: 'phone 798x384',
    rule: 'boot',
    match: null,
    offer: { x: 496, y: 290, width: 290, height: 82 },
    liveControls: [
      { name: 'dom#boot-error-retry', box: { x: 64, y: 252, width: 107, height: 44 }, topmost: 'BUTTON#boot-error-retry' },
    ],
  },
  {
    what: 'pause menu, offline match',
    viewport: 'phone 798x384',
    rule: 'match',
    match: { pauseScreen: 'menu', session: null, glass: 'match' },
    offer: { x: 597, y: 328, width: 189, height: 44 },
    liveControls: [],
  },
  {
    what: 'online match, session dropped',
    viewport: 'phone 798x384',
    rule: 'match',
    match: { pauseScreen: 'closed', session: 'reconnecting', glass: 'match' },
    offer: { x: 477, y: 290, width: 309, height: 82 },
    liveControls: [
      { name: '__cornerStage.elements[1]<build-button>', box: { x: 54, y: 134, width: 76, height: 76 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[3]<pause-button>', box: { x: 72, y: 16, width: 48, height: 48 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[7]<zoom-control>', box: { x: 718, y: 61, width: 64, height: 48 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[9]<minimap>', box: { x: 586, y: 292, width: 80, height: 80 }, topmost: 'BUTTON#playtest-download-log-button' },
      { name: 'dom#pr-link-loss-reconnect', box: { x: 195, y: 216, width: 198, height: 44 }, topmost: 'CANVAS#app' },
      { name: 'dom#pr-link-loss-abandon', box: { x: 403, y: 216, width: 200, height: 44 }, topmost: 'CANVAS#app' },
    ],
  },
  {
    what: 'online match, dropped and backgrounded',
    viewport: 'phone 798x384',
    rule: 'match',
    match: { pauseScreen: 'closed', session: 'reconnecting', glass: 'match' },
    offer: { x: 477, y: 290, width: 309, height: 82 },
    liveControls: [
      { name: '__cornerStage.elements[1]<build-button>', box: { x: 54, y: 134, width: 76, height: 76 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[3]<pause-button>', box: { x: 72, y: 16, width: 48, height: 48 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[7]<zoom-control>', box: { x: 718, y: 61, width: 64, height: 48 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[9]<minimap>', box: { x: 586, y: 292, width: 80, height: 80 }, topmost: 'BUTTON#playtest-download-log-button' },
      { name: 'dom#pr-link-loss-reconnect', box: { x: 195, y: 216, width: 198, height: 44 }, topmost: 'CANVAS#app' },
      { name: 'dom#pr-link-loss-abandon', box: { x: 403, y: 216, width: 200, height: 44 }, topmost: 'CANVAS#app' },
    ],
  },
  {
    what: 'online match, dropped, pause menu open',
    viewport: 'phone 798x384',
    rule: 'match',
    match: { pauseScreen: 'menu', session: 'reconnecting', glass: 'match' },
    offer: { x: 434, y: 272, width: 352, height: 100 },
    liveControls: [
      { name: 'dom#pr-link-loss-menu', box: { x: 310, y: 219, width: 178, height: 44 }, topmost: 'CANVAS#app' },
    ],
  },
  {
    what: 'online match, session dropped',
    viewport: 'phone portrait 390x844',
    rule: 'match',
    match: { pauseScreen: 'closed', session: 'reconnecting', glass: 'match' },
    offer: { x: 12, y: 571, width: 79, height: 261 },
    liveControls: [
      { name: '__cornerStage.elements[1]<build-button>', box: { x: 174, y: 54, width: 76, height: 76 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[3]<pause-button>', box: { x: 326, y: 72, width: 48, height: 48 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[7]<zoom-control>', box: { x: 281, y: 764, width: 48, height: 64 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[9]<minimap>', box: { x: 12, y: 632, width: 80, height: 80 }, topmost: 'BUTTON#playtest-download-log-button' },
      { name: 'dom#pr-link-loss-reconnect', box: { x: 108, y: 411, width: 174, height: 44 }, topmost: 'CANVAS#app' },
      { name: 'dom#pr-link-loss-abandon', box: { x: 107, y: 465, width: 177, height: 44 }, topmost: 'CANVAS#app' },
    ],
  },
  {
    what: 'online match, dropped and backgrounded',
    viewport: 'phone portrait 390x844',
    rule: 'match',
    match: { pauseScreen: 'closed', session: 'reconnecting', glass: 'match' },
    offer: { x: 12, y: 571, width: 79, height: 261 },
    liveControls: [
      { name: '__cornerStage.elements[1]<build-button>', box: { x: 174, y: 54, width: 76, height: 76 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[3]<pause-button>', box: { x: 326, y: 72, width: 48, height: 48 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[7]<zoom-control>', box: { x: 281, y: 764, width: 48, height: 64 }, topmost: 'CANVAS#app' },
      { name: '__cornerStage.elements[9]<minimap>', box: { x: 12, y: 632, width: 80, height: 80 }, topmost: 'BUTTON#playtest-download-log-button' },
      { name: 'dom#pr-link-loss-reconnect', box: { x: 108, y: 411, width: 174, height: 44 }, topmost: 'CANVAS#app' },
      { name: 'dom#pr-link-loss-abandon', box: { x: 107, y: 465, width: 177, height: 44 }, topmost: 'CANVAS#app' },
    ],
  },
  {
    what: 'online match, dropped, pause menu open',
    viewport: 'phone portrait 390x844',
    rule: 'match',
    match: { pauseScreen: 'menu', session: 'reconnecting', glass: 'match' },
    offer: { x: 12, y: 491, width: 79, height: 341 },
    liveControls: [
      { name: 'dom#pr-link-loss-menu', box: { x: 116, y: 447, width: 159, height: 44 }, topmost: 'CANVAS#app' },
    ],
  },
];

describe('the offer never lands on a control the player needs', () => {
  it('is not the topmost thing at any control the client drew', () => {
    // The brief's own definition, and a0-97's: a collision is `elementFromPoint`
    // answering with this affordance AT THE CONTROL'S OWN REPORTED POINT. Every row
    // below carries the browser's actual answer, so this asserts against what a
    // press would really hit rather than against arithmetic on two rects.
    for (const s of MEASURED) {
      if (!offeredIn(s)) continue;
      for (const c of s.liveControls) {
        expect(
          c.topmost.includes(DOWNLOAD_LOG_ROOT_ID),
          `${s.what} @ ${s.viewport}: a press at ${c.name} hits the offer`,
        ).toBe(false);
      }
    }
  });

  it('does not even overlap a control, on the screens where the match owns the pointer', () => {
    // Stricter than the line above, and deliberately narrower in scope. Where the
    // MATCH owns the glass, a control half-buried is a control half-gone: the
    // player's thumb is aimed at a target whose edge is under a button, and only
    // the centre was hit-tested. So those screens have to be clear by RECT.
    //
    // Screens where something else owns the pointer are excluded, and that is not a
    // let-off — it is the measurement. On a desktop drop the CONNECTION LOST card
    // takes every press, and `elementFromPoint` at the minimap's own centre answers
    // `DIV#pr-link-loss`: the offer's box does clip the map's bottom corner there,
    // and no press was going to reach the map anyway. Withdrawing over that would be
    // withdrawing where nothing collides, which the brief forbids.
    for (const s of MEASURED) {
      if (!offeredIn(s) || s.match?.glass !== 'match') continue;
      for (const c of s.liveControls) {
        expect(
          overlaps(s.offer!, c.box),
          `${s.what} @ ${s.viewport}: the offer's box sits on ${c.name}`,
        ).toBe(false);
      }
    }
  });

  it('withdraws from every state the browser caught it covering a control', () => {
    // The rows where `elementFromPoint`, at the control's OWN reported point,
    // answered with this affordance. Each one has to be a state the rule now
    // refuses — anything else is the bug still shipping.
    const caught = MEASURED.filter((s) =>
      s.liveControls.some((c) => c.topmost.includes(DOWNLOAD_LOG_ROOT_ID)),
    );
    expect(caught.length, 'the capture proved at least one collision').toBeGreaterThan(0);
    for (const s of caught) {
      expect(s.rule, `${s.what}: decided by the match rule`).toBe('match');
      expect(matchLogOffer(s.match!), `${s.what} @ ${s.viewport}`).toBeNull();
    }
  });

  it('refuses the drop that a0-97 never had to look at — the live match HUD', () => {
    // The single line this brief is about. Before a0-98 this answered "offer"
    // whatever was on the glass, and a networked match is never pausable, so the
    // overlay is CLOSED for the whole of one.
    expect(matchLogOffer({ pauseScreen: 'closed', session: 'reconnecting', glass: 'match' })).toBeNull();
    expect(matchLogOffer({ pauseScreen: 'closed', session: 'closed', glass: 'match' })).toBeNull();
  });

  it('does NOT withdraw where the corner is free — the offer is not the bug', () => {
    // The other half of the brief, and the half a nervous fix gets wrong. A player
    // filing "it kept dropping" needs this button.
    expect(matchLogOffer({ pauseScreen: 'closed', session: 'reconnecting', glass: 'kicked-out' })).toBe('disconnect');
    expect(matchLogOffer({ pauseScreen: 'closed', session: 'closed', glass: 'kicked-out' })).toBe('disconnect');
    // …and on the pause menu, drop or no drop.
    expect(matchLogOffer({ pauseScreen: 'menu', session: null, glass: 'match' })).toBe('pause');
    expect(matchLogOffer({ pauseScreen: 'menu', session: 'open', glass: 'match' })).toBe('pause');
    expect(matchLogOffer({ pauseScreen: 'menu', session: 'closed', glass: 'match' })).toBe('disconnect');
  });

  it('keeps a0-97: nothing layered over pause carries it, whatever the wire is doing', () => {
    for (const screen of ['settings', 'confirm'] as const) {
      for (const session of [null, 'open', 'reconnecting', 'closed'] as const) {
        for (const glass of ['match', 'kicked-out'] as const) {
          expect(matchLogOffer({ pauseScreen: screen, session, glass }), `${screen}/${session}/${glass}`).toBeNull();
        }
      }
    }
  });

  it('knows a raised card is not a painted one — the fullscreen top layer', () => {
    // Measured, not assumed: on a 798x384 touch boot the card is un-hidden and
    // laid out, and `elementFromPoint` at RECONNECT NOW's own centre answers
    // `CANVAS#app`. The game root is fullscreen, and the top layer outranks every
    // z-index (a0-28, from this affordance's own side).
    expect(kickOutClaimsTheGlass(true, false)).toBe('kicked-out');
    expect(kickOutClaimsTheGlass(true, true)).toBe('match');
    expect(kickOutClaimsTheGlass(false, false)).toBe('match');
    expect(kickOutClaimsTheGlass(false, true)).toBe('match');
  });

  it('is total — every state has an answer, so no frame can fall through it', () => {
    const screens = ['closed', 'menu', 'settings', 'confirm'] as const;
    const sessions = [null, 'connecting', 'open', 'reconnecting', 'closed'] as const;
    const glasses = ['match', 'kicked-out'] as const;
    for (const pauseScreen of screens) {
      for (const session of sessions) {
        for (const glass of glasses) {
          const answer = matchLogOffer({ pauseScreen, session, glass });
          expect([null, 'pause', 'disconnect']).toContain(answer);
        }
      }
    }
  });
});
