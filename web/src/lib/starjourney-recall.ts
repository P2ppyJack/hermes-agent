// One-shot handoff of a star-journey recall draft from the /starjourney page
// to the chat tab's TUI composer.
//
// The /starjourney map fetches an injection-hardened, provenance-tagged draft
// (GET /api/learning/recall-draft), stashes it here, and navigates to
// /chat?recall=1 (optionally with ?resume=<id> to target another session).
// ChatPage watches for the flag and delivers the stash into the live TUI
// composer as a BRACKETED PASTE — no trailing carriage return — so the text
// lands as an editable draft the user reviews and sends. Nothing is ever
// auto-sent.
//
// sessionStorage (not localStorage): the draft is tab-scoped and transient —
// it must not survive the tab or leak into other dashboard tabs.

const KEY = "hermes.starjourney.recallDraft";

export function stashRecallDraft(text: string): boolean {
  try {
    sessionStorage.setItem(KEY, text);

    return true;
  } catch {
    // Privacy mode / quota — the caller surfaces the failure.
    return false;
  }
}

/** Read AND clear the stashed draft (one-shot). */
export function takeRecallDraft(): string | null {
  try {
    const value = sessionStorage.getItem(KEY);

    if (value !== null) {
      sessionStorage.removeItem(KEY);
    }

    return value;
  } catch {
    return null;
  }
}

/** Wrap text in a bracketed-paste sequence (ESC[200~ … ESC[201~). The TUI's
 *  composer treats it as a single paste — multi-line safe, and crucially it
 *  does NOT submit: the user still reviews and sends. */
export function wrapBracketedPaste(text: string): string {
  // Recall is text, never terminal control input. In particular, an embedded
  // paste terminator must not escape the outer frame and expose following CRs.
  const plainText = Array.from(text).filter((char) => {
    const code = char.charCodeAt(0);
    return code === 9 || code === 10 || code === 13
      || (code >= 32 && (code < 127 || code > 159));
  }).join("");
  return `\x1b[200~${plainText}\x1b[201~`;
}
