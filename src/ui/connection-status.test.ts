/**
 * src/ui/connection-status.test.ts — the server-connection overlay, headless.
 *
 * The overlay's whole job is to be right about *whether to appear* and *what to
 * say*, and both are pure functions of the transport state. The offline promise
 * (GDD §4.8 risk 6) lives or dies on rule 1 — solo never shows it — so that is
 * asserted first.
 */

import { describe, it, expect } from 'vitest';
import type { ConnectionState } from '../net/transport';
import {
  connectionStatusHitTest,
  connectionStatusLayout,
  connectionStatusModel,
} from './connection-status';

const VIEWPORT = { width: 1280, height: 720 };
const center = (r: { x: number; y: number; width: number; height: number }) => ({
  x: r.x + r.width / 2,
  y: r.y + r.height / 2,
});

describe('whether it appears', () => {
  it('never appears for solo — there is no connection to lose (rule 1)', () => {
    for (const state of ['connecting', 'open', 'reconnecting', 'closed'] as ConnectionState[]) {
      expect(connectionStatusModel({ state, online: false }).visible).toBe(false);
    }
  });

  it('is invisible on a live connection (rule 2)', () => {
    expect(connectionStatusModel({ state: 'open', online: true }).visible).toBe(false);
  });

  it('appears while connecting, reconnecting, and once closed', () => {
    for (const state of ['connecting', 'reconnecting', 'closed'] as ConnectionState[]) {
      expect(connectionStatusModel({ state, online: true }).visible).toBe(true);
    }
  });
});

describe('what it says', () => {
  it('spins with hope, and stops once the connection is gone', () => {
    expect(connectionStatusModel({ state: 'connecting', online: true }).spinner).toBe(true);
    expect(connectionStatusModel({ state: 'reconnecting', online: true }).spinner).toBe(true);
    expect(connectionStatusModel({ state: 'closed', online: true }).spinner).toBe(false);
  });

  it('counts the reconnect grace down in whole seconds (GDD §4.2)', () => {
    const m = connectionStatusModel({ state: 'reconnecting', online: true, graceSeconds: 4.2 });
    expect(m.grace).toBe(5); // ceil — a player is told the generous number
    expect(m.detail).toContain('5s');
    expect(m.severity).toBe('warning');
  });

  it('reads reconnecting without a countdown when none is supplied', () => {
    const m = connectionStatusModel({ state: 'reconnecting', online: true });
    expect(m.grace).toBeNull();
    expect(m.detail.length).toBeGreaterThan(0);
  });

  it('names the door that still works when the server is lost (rule 3)', () => {
    const m = connectionStatusModel({ state: 'closed', online: true });
    expect(m.severity).toBe('error');
    expect(m.detail).toMatch(/SOLO/i);
    expect(m.action).toBe('BACK TO MENU');
  });
});

describe('the one live control', () => {
  it('routes a tap on BACK TO MENU to dismiss, only when closed', () => {
    const layout = connectionStatusLayout(VIEWPORT);
    const closed = connectionStatusModel({ state: 'closed', online: true });
    const p = center(layout.action);
    expect(connectionStatusHitTest(layout, p.x, p.y, closed)).toEqual({ kind: 'dismiss' });
  });

  it('swallows the tap while merely waiting — nothing leaks to the game', () => {
    const layout = connectionStatusLayout(VIEWPORT);
    const p = center(layout.action);
    for (const state of ['connecting', 'reconnecting'] as ConnectionState[]) {
      const model = connectionStatusModel({ state, online: true });
      expect(connectionStatusHitTest(layout, p.x, p.y, model)).toBeNull();
    }
  });

  it('is inert when hidden', () => {
    const layout = connectionStatusLayout(VIEWPORT);
    const hidden = connectionStatusModel({ state: 'open', online: true });
    const p = center(layout.action);
    expect(connectionStatusHitTest(layout, p.x, p.y, hidden)).toBeNull();
  });
});
