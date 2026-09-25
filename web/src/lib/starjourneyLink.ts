/**
 * Terminal link routing for the dashboard's own star-map page.
 *
 * The TUI's /journey prints `Star map: <origin>/starjourney` when it runs
 * inside the dashboard PTY (HERMES_DASHBOARD_ORIGIN injected by
 * hermes_cli/web_server_chat.py). Clicking that URL in xterm.js should navigate
 * the SPA in place — it is the same app — while every other link keeps the
 * default open-in-new-tab behavior.
 */

/**
 * Return the in-app path (pathname + search + hash) when `url` points at
 * this origin's /starjourney page, or null when the click should fall back
 * to window.open.
 */
export function starjourneyNavigationPath(
  url: string,
  currentOrigin: string,
  basePath: string = "",
): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  // Same-origin only: a /starjourney path on a foreign host is someone
  // else's page, not this SPA's route.
  if (parsed.origin !== currentOrigin) return null;
  const prefix = basePath.replace(/\/+$/, "");
  const path = prefix && parsed.pathname.startsWith(`${prefix}/`)
    ? parsed.pathname.slice(prefix.length) : parsed.pathname;
  if (path !== "/starjourney" && !path.startsWith("/starjourney/")) return null;
  return `${path}${parsed.search}${parsed.hash}`;
}

// ── OSC 7770 payloads (TUI /starjourney command) ──────────────────────────
//
// The PTY scrollback is REPLAYED into xterm every time the chat tab
// reattaches (tab switch, session resume, navigating back from the star
// map). A navigation sequence that re-fired on replay would bounce the user
// straight back to the star map — closing it would become impossible. The
// TUI therefore stamps each emission `<epoch-ms>;<nonce>;<url>`
// (ui-tui/src/lib/starjourneyNav.ts) and this parser only honors payloads
// that are BOTH fresh and previously unseen. Legacy bare-URL payloads (no
// stamp) are ignored outright — any still sitting in old scrollback are
// exactly the replays the stamp exists to kill.

/** Reject emissions older than this. Generous enough for PTY→WS latency;
 *  far shorter than any human tab-switch round-trip. */
export const STARJOURNEY_OSC_FRESH_MS = 5_000;

const seenNonces = new Set<string>();
const SEEN_NONCE_CAP = 128;

/** Test hook: forget replay-protection state. */
export function resetStarjourneyOscReplayGuard(): void {
  seenNonces.clear();
}

/**
 * Return the in-app path for a stamped OSC 7770 payload, or null when the
 * payload is malformed, foreign, stale, or a replay of an already-honored
 * emission.
 */
export function starjourneyOscNavigationPath(
  payload: string,
  currentOrigin: string,
  now: number = Date.now(),
  basePath: string = "",
): string | null {
  const first = payload.indexOf(";");
  const second = first === -1 ? -1 : payload.indexOf(";", first + 1);
  if (first === -1 || second === -1) return null;

  const ts = Number(payload.slice(0, first));
  const nonce = payload.slice(first + 1, second);
  const url = payload.slice(second + 1);
  if (!Number.isFinite(ts) || !nonce) return null;

  // Stale = a scrollback replay (or a clock so skewed we can't tell — the
  // printed link remains as the fallback).
  if (Math.abs(now - ts) > STARJOURNEY_OSC_FRESH_MS) return null;

  const path = starjourneyNavigationPath(url.trim(), currentOrigin, basePath);
  if (!path) return null;

  // Fresh-but-seen = a fast replay (e.g. resume within the window).
  if (seenNonces.has(nonce)) return null;
  seenNonces.add(nonce);
  if (seenNonces.size > SEEN_NONCE_CAP) {
    const oldest = seenNonces.values().next().value;
    if (oldest !== undefined) seenNonces.delete(oldest);
  }

  return path;
}
