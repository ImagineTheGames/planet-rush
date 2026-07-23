/**
 * src/platform/input.ts — the input→action mapping. OWNER: Platform Engineer.
 *
 * Turns keyboard/mouse, gamepad, and touch into the abstract `Action` union
 * (src/shared/types) BEFORE input crosses into the sim (GDD §2.4). Touch is the
 * dynamic twin virtual sticks with fire-mode morph (mobile amendment §2); the
 * device-aware controls strip reads its labels from this same map so it can
 * never drift out of sync with the real bindings.
 *
 * Placeholder only — no mapping yet (day-0 scaffold; touch + kb/mouse + gamepad
 * all land in the day-1 milestone).
 */
import type { Action } from '@shared/types';

/** A source of abstract actions for one player, whatever the device. */
export interface InputSource {
  /** Drain the actions produced since the last poll. */
  poll(): Action[];
}

export const INPUT_PLACEHOLDER = true;
