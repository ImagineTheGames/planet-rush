/**
 * A barrel. Re-exporting is plumbing, not use: `forwardedNeverUsed` below is
 * carried through here and consumed by nobody, and must still report dark. A
 * scan that counted a barrel would call this whole repo live — the real
 * barrels (`src/sim/index.ts`, `src/ui/index.ts`) forward nearly everything.
 */

export * from './helpers';
export { forwardedNeverUsed } from './forwarded';
