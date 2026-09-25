/**
 * /starjourney → dashboard navigation over a private-use OSC sequence.
 *
 * When the TUI runs inside the web dashboard's PTY (xterm.js), the page
 * registers a handler for OSC 7770 (see web/src/pages/ChatPage.tsx) and
 * SPA-navigates to the star-map route when the payload is a same-origin
 * /starjourney URL. Terminals that don't know the sequence ignore it, and
 * the command also prints a plain clickable link, so nothing is lost when
 * the host doesn't participate.
 *
 * REPLAY SAFETY: the PTY scrollback is replayed to the browser every time
 * the chat tab reattaches (tab switch, session resume, navigating back from
 * the star map). A bare-URL payload would therefore re-fire on every
 * reattach and trap the user on the star-map route. The payload carries
 * `<epoch-ms>;<nonce>;<url>` so the web handler can drop stale copies (old
 * timestamp) and exact replays (seen nonce) — only a freshly emitted
 * sequence navigates.
 *
 * 7770 sits in the private-use space alongside iTerm2 (1337) and VS Code
 * (633) app-integration sequences; the web side validates the payload
 * against the same-origin /starjourney matcher before acting on it.
 */

export const STARJOURNEY_NAV_OSC = 7770

type WritableStream = Pick<NodeJS.WriteStream, 'isTTY' | 'write'>

/** Build the `<epoch-ms>;<nonce>;<url>` payload (exported for tests). */
export function buildStarjourneyNavPayload(
  origin: string,
  now: number = Date.now(),
  path: string = '/starjourney'
): string {
  // `|| 'n0'` guards the astronomically-rare empty slice (Math.random() → 0):
  // the web parser rejects empty nonces outright.
  const nonce = Math.random().toString(36).slice(2, 10) || 'n0'

  return `${now};${nonce};${origin}${path}`
}

/**
 * Emit the navigation sequence for `origin``path` (default /starjourney).
 * `path` must stay on the star-map route — the web-side validator
 * (web/src/lib/starjourneyLink.ts) only honors same-origin /starjourney
 * URLs, so query variants like `/starjourney?recall=1` work but other
 * routes are dropped. Returns true when the sequence was written. No-op
 * off a TTY (tests, piped output) — only a real terminal host can act on
 * it.
 */
export function emitStarjourneyNavigation(
  origin: string,
  stream: WritableStream = process.stdout,
  path: string = '/starjourney'
): boolean {
  const trimmed = origin.trim().replace(/\/+$/, '')

  if (!trimmed || !stream.isTTY) {
    return false
  }

  try {
    stream.write(
      `\x1b]${STARJOURNEY_NAV_OSC};${buildStarjourneyNavPayload(trimmed, Date.now(), path)}\x07`
    )

    return true
  } catch {
    // A host that can't take the write just keeps the printed link.
    return false
  }
}
