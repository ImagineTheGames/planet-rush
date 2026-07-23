/**
 * harness/ — headless QA harness. OWNER: QA Agent (GDD §3.8, §4.8).
 *
 * Runs headless bot-vs-bot matches with an ENFORCED match timeout (a hung match
 * is a failed test, not a hung harness), the determinism replay test (same
 * inputs → same final state hash), and balance reports against the two
 * measurable targets (match length 10–15 min; no strategy > stated win rate).
 * Imports src/sim/ and src/bots/ headless — never PixiJS.
 *
 * Placeholder only — no harness yet (day-0 scaffold; QA back-loaded to days 5–7).
 */
export const HARNESS_PLACEHOLDER = true;
