/**
 * src/render/ — the PixiJS render layer. OWNER: Platform Engineer.
 *
 * Draws the deterministic sim state to a WebGL2 canvas: batched, pooled, zero
 * per-frame allocations (GDD §4.1, §4.3). Sprites are pooled from day 1; the
 * canvas scales by viewport × devicePixelRatio and HUD anchors respect
 * safe-area insets (mobile amendment §1). This layer reads sim state and never
 * writes it; the sim never imports PixiJS.
 *
 * Placeholder only — no renderer yet (day-0 scaffold; lands day 1).
 */
export const RENDER_PLACEHOLDER = true;
