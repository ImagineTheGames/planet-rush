/**
 * src/net/link-loss-view.test.ts — the kick-out overlay, asserted without a
 * browser. OWNER: Netcode Engineer (m10 disconnect honesty).
 *
 * Same discipline as `./connect-trace-view.test.ts`: the markup is pure, so the
 * wording, the ids, the touch minimum and — the one that matters — *which buttons
 * appear at which moment* are all testable in node, and a fake DOM covers the
 * mounting half.
 *
 * The load-bearing assertions are the two the developer's report is about: while
 * the link is live this module draws **nothing**, and the instant it is not, the
 * overlay covers the screen and names the actual cause.
 */

import { describe, expect, it } from 'vitest';
import { LinkWatch } from './link-loss';
import type { LinkStatus } from './link-loss';
import {
  LINK_LOSS_BUTTON_IDS,
  LINK_LOSS_ROOT_ID,
  LINK_LOSS_TITLE_ID,
  LinkLossView,
  renderLinkLossHtml,
} from './link-loss-view';
import { linkNotice } from './link-loss';
import type { TraceDom, TraceElement } from './connect-trace-view';

const T0 = 1_700_000_000_000;

/** A watch driven to a backgrounded-tab loss — the developer's own case. */
function lostStatus(silentMs = 8_000, graceWindowMs = 60_000): LinkStatus {
  const watch = new LinkWatch(T0, { graceWindowMs });
  watch.hide();
  watch.shown(T0 + silentMs);
  return watch.poll(T0 + silentMs);
}

function expiredStatus(): LinkStatus {
  const watch = new LinkWatch(T0, { graceWindowMs: 10_000 });
  watch.poll(T0 + 5_000);
  return watch.poll(T0 + 11_000);
}

// --- A fake DOM, the same shape `./connect-trace-view.test.ts` uses ----------

function fakeElement(id = ''): TraceElement & { listeners: Record<string, (() => void)[]>; children: unknown[] } {
  return {
    id,
    innerHTML: '',
    hidden: false,
    listeners: {},
    children: [],
    addEventListener(type, handler): void {
      (this.listeners[type] ??= []).push(handler);
    },
    appendChild(child): void {
      this.children.push(child);
    },
    remove(): void {
      this.children.length = 0;
    },
  };
}

function fakeDom(): TraceDom & {
  root: ReturnType<typeof fakeElement>;
  byId: Map<string, ReturnType<typeof fakeElement>>;
} {
  const body = fakeElement('body');
  const byId = new Map<string, ReturnType<typeof fakeElement>>();
  const dom = {
    body,
    byId,
    root: body,
    createElement(): TraceElement {
      const el = fakeElement();
      dom.root = el;
      return el;
    },
    getElementById(id: string): TraceElement | null {
      // A button only "exists" once the overlay's markup names it, which is what
      // makes "is RECONNECT on screen?" a real question rather than a stub's opinion.
      if (!dom.root.innerHTML.includes(`id="${id}"`)) return null;
      let el = byId.get(id);
      if (!el) {
        el = fakeElement(id);
        byId.set(id, el);
      }
      return el;
    },
  };
  return dom;
}

describe('renderLinkLossHtml', () => {
  it('draws NOTHING while the link is live', () => {
    const watch = new LinkWatch(T0);
    expect(renderLinkLossHtml(linkNotice(watch.poll(T0)))).toBe('');
  });

  it('says what was actually detected, loudly, with both buttons', () => {
    const html = renderLinkLossHtml(linkNotice(lostStatus()));
    expect(html).toContain('CONNECTION LOST — no server data for 8s (tab was backgrounded)');
    expect(html).toContain(`id="${LINK_LOSS_BUTTON_IDS.reconnect}"`);
    expect(html).toContain(`id="${LINK_LOSS_BUTTON_IDS.abandon}"`);
    expect(html).toContain('ABANDON MATCH');
    // The countdown rides the button: the seconds are the decision.
    expect(html).toContain('RECONNECT · 52s');
  });

  it('covers the whole screen and swallows taps — this is a kick-out, not a toast', () => {
    const html = renderLinkLossHtml(linkNotice(lostStatus()));
    expect(html).toContain(`#${LINK_LOSS_ROOT_ID}{position:fixed;inset:0`);
    // A stray tap must not reach the frozen match's touch controls behind it.
    expect(html).toContain('pointer-events:auto');
  });

  it('gives every button a real touch target (mobile amendment §1)', () => {
    const html = renderLinkLossHtml(linkNotice(lostStatus()));
    expect(html).toContain('min-height:44px');
    expect(html).toContain('min-width:44px');
  });

  it('draws the ask in plasma and only the ending in threat red (style-guide §2)', () => {
    expect(renderLinkLossHtml(linkNotice(lostStatus()))).toContain('#4DC3FF');
    expect(renderLinkLossHtml(linkNotice(lostStatus()))).not.toContain('#B23A3A');
    const gone = renderLinkLossHtml(linkNotice(expiredStatus()));
    expect(gone).toContain('#B23A3A');
  });

  it('offers one way out once the seat is gone — no retry into nothing', () => {
    const html = renderLinkLossHtml(linkNotice(expiredStatus()));
    expect(html).toContain('SEAT EXPIRED — a bot flew your ship, match went on');
    expect(html).toContain(`id="${LINK_LOSS_BUTTON_IDS.menu}"`);
    expect(html).not.toContain(`id="${LINK_LOSS_BUTTON_IDS.reconnect}"`);
    expect(html).not.toContain(`id="${LINK_LOSS_BUTTON_IDS.abandon}"`);
  });

  it('announces itself assertively — a player being kicked out is interrupted', () => {
    const html = renderLinkLossHtml(linkNotice(lostStatus()));
    expect(html).toContain('role="alertdialog"');
    expect(html).toContain('aria-live="assertive"');
    expect(html).toContain(`id="${LINK_LOSS_TITLE_ID}"`);
  });

  it('escapes what it is handed — the cause line is built from server words', () => {
    const html = renderLinkLossHtml({
      visible: true,
      title: '<script>alert(1)</script>',
      detail: 'a & b',
      grace: '',
      actions: [{ kind: 'menu', label: '<b>x</b>', primary: true }],
      busy: false,
      failed: true,
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('a &amp; b');
  });
});

describe('LinkLossView', () => {
  it('stays off screen entirely while the link is live', () => {
    const dom = fakeDom();
    const view = new LinkLossView({ dom, onReconnect: () => {}, onAbandon: () => {}, onMenu: () => {} });
    const watch = new LinkWatch(T0);
    view.update(watch.poll(T0));
    expect(view.visible).toBe(false);
    expect(view.html).toBe('');
  });

  it('mounts on the loss and wires each button to its own handler', () => {
    const dom = fakeDom();
    const pressed: string[] = [];
    const view = new LinkLossView({
      dom,
      onReconnect: () => pressed.push('reconnect'),
      onAbandon: () => pressed.push('abandon'),
      onMenu: () => pressed.push('menu'),
    });
    view.update(lostStatus());
    expect(view.visible).toBe(true);
    expect(dom.root.id).toBe(LINK_LOSS_ROOT_ID);

    dom.byId.get(LINK_LOSS_BUTTON_IDS.reconnect)?.listeners['click']?.forEach((h) => h());
    dom.byId.get(LINK_LOSS_BUTTON_IDS.abandon)?.listeners['click']?.forEach((h) => h());
    expect(pressed).toEqual(['reconnect', 'abandon']);
  });

  it('re-writes the DOM only when the drawn shape changed', () => {
    const dom = fakeDom();
    const view = new LinkLossView({ dom, onReconnect: () => {}, onAbandon: () => {}, onMenu: () => {} });
    const watch = new LinkWatch(T0, { graceWindowMs: 60_000 });
    watch.hide();
    watch.shown(T0 + 8_000);

    view.update(watch.poll(T0 + 8_000));
    const first = view.html;
    // 400 ms later: same whole seconds on the countdown, so nothing is redrawn.
    view.update(watch.poll(T0 + 8_400));
    expect(view.html).toBe(first);
    // A second on: the countdown moved, so it is.
    view.update(watch.poll(T0 + 9_100));
    expect(view.html).not.toBe(first);
  });

  it('comes down the moment the link is back', () => {
    const dom = fakeDom();
    const view = new LinkLossView({ dom, onReconnect: () => {}, onAbandon: () => {}, onMenu: () => {} });
    const watch = new LinkWatch(T0, { graceWindowMs: 60_000 });
    watch.hide();
    watch.shown(T0 + 8_000);
    view.update(watch.poll(T0 + 8_000));
    expect(view.visible).toBe(true);

    watch.frame(T0 + 8_500);
    view.update(watch.poll(T0 + 8_500));
    expect(view.visible).toBe(false);
  });
});
