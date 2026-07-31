/**
 * src/net/playtest-log-button.test.ts — the COPY LOG affordance
 * (`./playtest-log-button`, M10 playtest-log brief §2, §3).
 *
 * The button is the whole feature from the developer's side: if its words are wrong,
 * or if a press looks like it did nothing, the log never gets pasted. So the wording
 * and the phases are asserted through the pure model, and the DOM half is driven with
 * a fake document — the same split (and the same reason) as
 * `@platform/boot-error`'s tests, since this repo has no jsdom.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { PlaytestLog, describeEnvironment } from './playtest-log';
import {
  COPY_LOG_BUTTON_ID,
  COPY_LOG_DOWNLOAD_ID,
  COPY_LOG_HINT_ID,
  COPY_LOG_ROOT_ID,
  CopyLogAffordance,
  ERROR_OFFER_HINT,
  copyLogLabel,
  copyLogModel,
  downloadLogLabel,
  disconnectOfferHint,
  hideCopyLog,
  installCopyLogButton,
  renderCopyLogHtml,
  resetCopyLogButton,
  showCopyLog,
} from './playtest-log-button';
import type { CopyLogDom, CopyLogElement } from './playtest-log-button';

afterEach(() => resetCopyLogButton());

function newLog(): PlaytestLog {
  const log = new PlaytestLog({ env: describeEnvironment({ sha: 'abc1234' }) });
  log.recordSessionStart();
  return log;
}

// ---------------------------------------------------------------------------
// A fake document, just enough to mount into
// ---------------------------------------------------------------------------

interface FakeElement extends CopyLogElement {
  readonly listeners: (() => void)[];
  readonly children: FakeElement[];
  removed: boolean;
}

function fakeDom(): CopyLogDom & { body: FakeElement; find: (id: string) => FakeElement | null } {
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
        for (const id of [COPY_LOG_BUTTON_ID, COPY_LOG_DOWNLOAD_ID, COPY_LOG_HINT_ID]) {
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
    createElement: (): CopyLogElement => make(),
    getElementById: (id): CopyLogElement | null => registry.get(id) ?? null,
    find: (id): FakeElement | null => registry.get(id) ?? null,
  };
}

// ---------------------------------------------------------------------------
// Wording
// ---------------------------------------------------------------------------

describe('the words on the button', () => {
  it('rests on COPY LOG — the label the brief names', () => {
    expect(copyLogLabel('idle')).toBe('COPY LOG');
  });

  it('answers a press, so it never looks dead', () => {
    expect(copyLogLabel('working')).toBe('COPYING…');
    // The share sheet is the phone's route out (M10 action-echo §5), and the
    // button says where the log actually went rather than claiming a clipboard it
    // never touched.
    expect(copyLogLabel('shared')).toBe('LOG SENT');
    expect(copyLogLabel('copied')).toBe('LOG COPIED');
    expect(copyLogLabel('saved')).toBe('LOG SAVED');
    expect(copyLogLabel('failed')).toBe('COPY FAILED');
  });

  it('offers the report on an error screen (the auto-offer, brief §3)', () => {
    expect(copyLogModel({ reason: 'error' }, 'idle').hint).toBe(ERROR_OFFER_HINT);
  });

  it('lets an error screen name its own failure instead', () => {
    const hint = "Couldn't reach the servers.";
    expect(copyLogModel({ reason: 'error', hint }, 'idle').hint).toBe(hint);
  });

  it('stays quiet on the pause menu — the label says enough there', () => {
    expect(copyLogModel({ reason: 'pause' }, 'idle').hint).toBe('');
  });

  it('tells the developer where the log went, including the download case', () => {
    expect(copyLogModel({ reason: 'pause' }, 'copied').hint).toContain('paste it into chat');
    expect(copyLogModel({ reason: 'pause' }, 'saved').hint).toContain('downloaded as a file');
    expect(copyLogModel({ reason: 'pause' }, 'shared').hint).toContain('share sheet');
    expect(copyLogModel({ reason: 'error' }, 'failed').hint).toContain('Could not copy');
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
    expect(copyLogModel({ reason: 'pause' }, 'working').busy).toBe(true);
    expect(copyLogModel({ reason: 'pause' }, 'idle').busy).toBe(false);
  });
});

describe('the markup', () => {
  it('carries the ids, a real touch target, and no reserved colour', () => {
    const html = renderCopyLogHtml(copyLogModel({ reason: 'error' }, 'idle'));

    expect(html).toContain(`id="${COPY_LOG_BUTTON_ID}"`);
    expect(html).toContain(`id="${COPY_LOG_HINT_ID}"`);
    expect(html).toContain('COPY LOG');
    // 44px minimum touch target (mobile amendment §1).
    expect(html).toContain('min-height:44px');
    // Signal yellow means ore or danger; threat red means damage (style-guide §2).
    // A diagnostic button is neither, so neither colour appears.
    expect(html.toUpperCase()).not.toContain('F2D24B');
    expect(html.toUpperCase()).not.toContain('B23A3A');
  });

  it('omits the hint element entirely when there is no hint', () => {
    const html = renderCopyLogHtml(copyLogModel({ reason: 'pause' }, 'idle'));
    expect(html).not.toContain(COPY_LOG_HINT_ID);
  });

  it('escapes a hint, which can carry a server’s own words', () => {
    const html = renderCopyLogHtml(
      copyLogModel({ reason: 'error', hint: '<script>alert("x")</script>' }, 'idle'),
    );
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('marks the button disabled while working', () => {
    expect(renderCopyLogHtml(copyLogModel({ reason: 'pause' }, 'working'))).toContain('disabled');
  });

  // The landscape lock (`@platform/orientation`). The game root is rotated +90° on a
  // touch viewport held portrait, so this affordance — DOM over the canvas, laid out
  // in physical space — has to rotate with it or be the one thing on the screen
  // reading sideways, in the wrong corner. Asserted as CSS text because that is the
  // whole mechanism: there is no JS to exercise, which is the point of doing it with
  // a media query rather than a resize handler this module would have to own.
  describe('under the landscape lock', () => {
    const css = renderCopyLogHtml(copyLogModel({ reason: 'pause' }, 'idle'));

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

describe('CopyLogAffordance', () => {
  it('mounts on the first show and hides rather than unmounting', () => {
    const dom = fakeDom();
    const affordance = new CopyLogAffordance({ dom, log: newLog(), schedule: null });

    affordance.show({ reason: 'pause' });
    expect(dom.body.children).toHaveLength(1);
    expect(dom.body.children[0]!.id).toBe(COPY_LOG_ROOT_ID);
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
    const affordance = new CopyLogAffordance({ dom, log: newLog(), schedule: null });
    affordance.show({ reason: 'pause' });
    const button = dom.find(COPY_LOG_BUTTON_ID)!;

    for (let i = 0; i < 100; i++) affordance.show({ reason: 'pause' });
    // The element was not rewritten, so no listener piled up on it.
    expect(dom.find(COPY_LOG_BUTTON_ID)).toBe(button);
    expect(button.listeners).toHaveLength(1);
  });

  it('copies the log when the button is pressed', async () => {
    const dom = fakeDom();
    const log = newLog();
    const writeText = vi.fn(async (_text: string) => {});
    const affordance = new CopyLogAffordance({
      dom,
      log,
      schedule: null,
      exportOptions: { clipboard: { writeText }, save: null },
    });

    affordance.show({ reason: 'error', hint: "Couldn't reach the servers." });
    const result = await affordance.copy();

    expect(result.ok && result.route).toBe('clipboard');
    expect(JSON.parse(writeText.mock.calls[0]![0])).toMatchObject({
      schema: 'planet-rush.playtest-log',
    });
    expect(affordance.state).toBe('copied');
    expect(dom.body.children[0]!.innerHTML).toContain('LOG COPIED');
  });

  it('reports the download fallback in its own words', async () => {
    const dom = fakeDom();
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { clipboard: null, save: () => {} },
    });
    affordance.show({ reason: 'pause' });

    await affordance.copy();
    expect(affordance.state).toBe('saved');
    expect(dom.body.children[0]!.innerHTML).toContain('LOG SAVED');
  });

  it('says COPY FAILED rather than pretending', async () => {
    const dom = fakeDom();
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { clipboard: null, save: null },
    });
    affordance.show({ reason: 'pause' });

    await affordance.copy();
    expect(affordance.state).toBe('failed');
    expect(dom.body.children[0]!.innerHTML).toContain('COPY FAILED');
  });

  it('collapses a doubled press into one export', async () => {
    const dom = fakeDom();
    let writes = 0;
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { clipboard: { writeText: async () => void writes++ }, save: null },
    });
    affordance.show({ reason: 'pause' });

    const [first, second] = await Promise.all([affordance.copy(), affordance.copy()]);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(writes).toBe(1);
  });

  it('reverts to COPY LOG once the answer has been read', async () => {
    const dom = fakeDom();
    const pending: (() => void)[] = [];
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: (fn) => void pending.push(fn),
      exportOptions: { clipboard: { writeText: async () => {} }, save: null },
    });
    affordance.show({ reason: 'pause' });

    await affordance.copy();
    expect(affordance.state).toBe('copied');
    pending.forEach((fn) => fn());
    expect(affordance.state).toBe('idle');
    expect(dom.body.children[0]!.innerHTML).toContain('COPY LOG');
  });

  it('does not let a stale revert wipe a newer press’s answer', async () => {
    const dom = fakeDom();
    const pending: (() => void)[] = [];
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: (fn) => void pending.push(fn),
      exportOptions: { clipboard: { writeText: async () => {} }, save: null },
    });
    affordance.show({ reason: 'pause' });

    await affordance.copy();
    await affordance.copy(); // a second press before the first timer fires
    pending[0]!(); // the FIRST press's revert, now stale
    expect(affordance.state).toBe('copied');
  });

  it('drops a previous answer when a new screen makes a new offer', async () => {
    const dom = fakeDom();
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      schedule: null,
      exportOptions: { clipboard: { writeText: async () => {} }, save: null },
    });
    affordance.show({ reason: 'pause' });
    await affordance.copy();
    expect(affordance.state).toBe('copied');

    affordance.show({ reason: 'error', hint: 'Lost the match server.' });
    expect(affordance.state).toBe('idle');
    expect(dom.body.children[0]!.innerHTML).toContain('Lost the match server.');
  });

  it('survives a page with no body to mount into', () => {
    const dom: CopyLogDom = {
      body: null,
      createElement: fakeDom().createElement,
      getElementById: () => null,
    };
    const affordance = new CopyLogAffordance({ dom, log: newLog(), schedule: null });
    expect(() => affordance.show({ reason: 'pause' })).not.toThrow();
  });
});

describe('the shared affordance', () => {
  it('does nothing where none was installed — a caller needs no null check', () => {
    expect(() => showCopyLog({ reason: 'pause' })).not.toThrow();
    expect(() => hideCopyLog()).not.toThrow();
  });

  it('routes show/hide to the installed one', () => {
    const dom = fakeDom();
    const affordance = installCopyLogButton({ dom, log: newLog(), schedule: null });

    showCopyLog({ reason: 'error' });
    expect(affordance.visible).toBe(true);
    hideCopyLog();
    expect(affordance.visible).toBe(false);
  });

  it('tears the old element down when a new affordance is installed', () => {
    const dom = fakeDom();
    const first = installCopyLogButton({ dom, log: newLog(), schedule: null });
    first.show({ reason: 'pause' });
    installCopyLogButton({ dom, log: newLog(), schedule: null });
    expect(dom.body.children[0]!.removed).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The DOWNLOAD sibling (ratified M10 — "too large for mobile clipboard")
// ---------------------------------------------------------------------------

describe('the DOWNLOAD sibling', () => {
  it('rests on the word that names what you get — a file', () => {
    expect(downloadLogLabel('idle')).toBe('DOWNLOAD');
    expect(downloadLogLabel('working')).toBe('SAVING…');
    expect(downloadLogLabel('saved')).toBe('LOG SAVED');
    expect(downloadLogLabel('shared')).toBe('LOG SENT');
    expect(downloadLogLabel('failed')).toBe('SAVE FAILED');
  });

  it('is drawn beside COPY LOG, with its own id and the same 44-px touch target', () => {
    const html = renderCopyLogHtml(copyLogModel({ reason: 'pause' }, 'idle'));
    expect(html).toContain(`id="${COPY_LOG_BUTTON_ID}"`);
    expect(html).toContain('COPY LOG');
    expect(html).toContain(`id="${COPY_LOG_DOWNLOAD_ID}"`);
    expect(html).toContain('DOWNLOAD');
    expect(html).toContain('min-height:44px');
    // The row wraps rather than pushing the second button off a narrow phone.
    expect(html).toContain('flex-wrap:wrap');
  });

  it('wears its own answer, and leaves COPY LOG at rest', () => {
    const m = copyLogModel({ reason: 'pause' }, 'saved', 'download');
    expect(m.downloadLabel).toBe('LOG SAVED');
    expect(m.label, 'the clipboard button claimed a press it never took').toBe('COPY LOG');
    expect(m.hint).toContain('attach that file');
  });

  it('…and the converse: a copy answer leaves DOWNLOAD at rest', () => {
    const m = copyLogModel({ reason: 'pause' }, 'copied', 'copy');
    expect(m.label).toBe('LOG COPIED');
    expect(m.downloadLabel).toBe('DOWNLOAD');
  });

  it('disables BOTH while either is working — one export at a time', () => {
    const m = copyLogModel({ reason: 'pause' }, 'working', 'download');
    expect(m.busy).toBe(true);
    expect(m.downloadBusy).toBe(true);
    // Both button elements carry the attribute (the CSS's own `[disabled]` rule
    // is matched out, so this counts elements and not stylesheet selectors).
    expect(renderCopyLogHtml(m).match(/<button[^>]* disabled>/g)).toHaveLength(2);
  });

  it('names the phone failure honestly rather than blaming the clipboard', () => {
    expect(copyLogModel({ reason: 'pause' }, 'failed', 'download').hint).toBe(
      'Could not save the log on this device.',
    );
  });

  it('a press on it takes the FILE route — never the clipboard', async () => {
    const dom = fakeDom();
    const writeText = vi.fn(async (_t: string) => {});
    const save = vi.fn();
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      exportOptions: { share: null, clipboard: { writeText }, save },
      schedule: null,
    });
    affordance.show({ reason: 'pause' });

    const result = await affordance.download();

    expect(result.ok && result.route).toBe('download');
    expect(save).toHaveBeenCalledTimes(1);
    expect(writeText, 'DOWNLOAD reached for the clipboard').not.toHaveBeenCalled();
    expect(affordance.state).toBe('saved');
    expect(affordance.actingOn).toBe('download');
    expect(dom.find(COPY_LOG_DOWNLOAD_ID)).not.toBeNull();
    expect(dom.body.children[0]!.innerHTML).toContain('LOG SAVED');
  });

  it('is wired to the DOWNLOAD element, not to COPY LOG\'s', async () => {
    const dom = fakeDom();
    const save = vi.fn();
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      exportOptions: { share: null, clipboard: null, save },
      schedule: null,
    });
    affordance.show({ reason: 'pause' });

    dom.find(COPY_LOG_DOWNLOAD_ID)!.listeners.forEach((fn) => fn());
    await Promise.resolve();
    await Promise.resolve();

    expect(save).toHaveBeenCalledTimes(1);
    expect(affordance.actingOn).toBe('download');
  });

  it('collapses a doubled thumb into one export', async () => {
    const dom = fakeDom();
    const save = vi.fn();
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      exportOptions: { share: null, clipboard: null, save },
      schedule: null,
    });
    affordance.show({ reason: 'pause' });

    const [first, second] = await Promise.all([affordance.download(), affordance.download()]);
    expect(first.ok).toBe(true);
    expect(second.ok, 'the second press started a second write of a 40 KB file').toBe(false);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('drops back to a resting pair when a new screen makes a new offer', async () => {
    const dom = fakeDom();
    const affordance = new CopyLogAffordance({
      dom,
      log: newLog(),
      exportOptions: { share: null, clipboard: null, save: vi.fn() },
      schedule: null,
    });
    affordance.show({ reason: 'pause' });
    await affordance.download();
    expect(affordance.state).toBe('saved');

    affordance.show({ reason: 'error', hint: 'Couldn’t reach the servers.' });
    expect(affordance.state).toBe('idle');
    expect(affordance.actingOn, 'a stale download answer survived onto another screen').toBe('copy');
    expect(dom.body.children[0]!.innerHTML).toContain('DOWNLOAD');
  });
});
