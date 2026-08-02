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
}

function fakeDom(): DownloadLogDom & {
  body: FakeElement;
  find: (id: string) => FakeElement | null;
} {
  const registry = new Map<string, FakeElement>();

  const make = (): FakeElement => {
    const el: FakeElement = {
      id: '',
      hidden: false,
      listeners: [],
      children: [],
      removed: false,
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
        el.children.push(c);
        if (c.id) registry.set(c.id, c);
      },
      remove: (): void => void (el.removed = true),
    };
    let html = '';
    return el;
  };

  const body = make();
  return {
    body,
    createElement: (): DownloadLogElement => make(),
    getElementById: (id): DownloadLogElement | null => registry.get(id) ?? null,
    find: (id): FakeElement | null => registry.get(id) ?? null,
  };
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
