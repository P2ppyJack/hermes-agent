import { beforeEach, describe, expect, it } from "vitest";

import {
  resetStarjourneyOscReplayGuard,
  STARJOURNEY_OSC_FRESH_MS,
  starjourneyNavigationPath,
  starjourneyOscNavigationPath,
} from "./starjourneyLink";

const ORIGIN = "http://127.0.0.1:9119";

describe("starjourneyNavigationPath", () => {
  it("removes the configured proxy prefix for basename-aware SPA routing", () => {
    expect(starjourneyNavigationPath(`${ORIGIN}/tools/starjourney?recall=1`, ORIGIN, "/tools"))
      .toBe("/starjourney?recall=1");
    expect(starjourneyNavigationPath(`${ORIGIN}/tools-else/starjourney`, ORIGIN, "/tools"))
      .toBeNull();
    expect(starjourneyNavigationPath(`https://foreign.example/tools/starjourney`, ORIGIN, "/tools"))
      .toBeNull();
    const now = Date.now();
    resetStarjourneyOscReplayGuard();
    const payload = `${now};prefix-test;${ORIGIN}/tools/starjourney`;
    expect(starjourneyOscNavigationPath(payload, ORIGIN, now, "/tools")).toBe("/starjourney");
    expect(starjourneyOscNavigationPath(payload, ORIGIN, now, "/tools")).toBeNull();
  });

  it("returns the SPA path for a same-origin /starjourney link", () => {
    expect(starjourneyNavigationPath(`${ORIGIN}/starjourney`, ORIGIN)).toBe(
      "/starjourney",
    );
  });

  it("preserves subpaths, query, and hash", () => {
    expect(
      starjourneyNavigationPath(`${ORIGIN}/starjourney/node?id=3#top`, ORIGIN),
    ).toBe("/starjourney/node?id=3#top");
  });

  it("rejects cross-origin URLs even when the path matches", () => {
    expect(
      starjourneyNavigationPath("http://evil.example/starjourney", ORIGIN),
    ).toBeNull();
    // Same host, different port is a different origin.
    expect(
      starjourneyNavigationPath("http://127.0.0.1:9999/starjourney", ORIGIN),
    ).toBeNull();
  });

  it("rejects same-origin URLs on other paths", () => {
    expect(starjourneyNavigationPath(`${ORIGIN}/sessions`, ORIGIN)).toBeNull();
    // Prefix without a path boundary is a different page.
    expect(
      starjourneyNavigationPath(`${ORIGIN}/starjourneyx`, ORIGIN),
    ).toBeNull();
  });

  it("rejects unparseable URLs", () => {
    expect(starjourneyNavigationPath("not a url", ORIGIN)).toBeNull();
  });
});

describe("starjourneyOscNavigationPath (replay-guarded OSC 7770 payloads)", () => {
  const NOW = 1_755_400_000_000;
  const stamped = (ts: number, nonce: string, url = `${ORIGIN}/starjourney`) =>
    `${ts};${nonce};${url}`;

  beforeEach(() => {
    resetStarjourneyOscReplayGuard();
  });

  it("navigates for a fresh, unseen, same-origin payload", () => {
    expect(
      starjourneyOscNavigationPath(stamped(NOW, "abc123"), ORIGIN, NOW),
    ).toBe("/starjourney");
  });

  it("preserves the recall query (?recall=1 — TUI /recall command)", () => {
    expect(
      starjourneyOscNavigationPath(
        stamped(NOW, "rc1", `${ORIGIN}/starjourney?recall=1`),
        ORIGIN,
        NOW,
      ),
    ).toBe("/starjourney?recall=1");
  });

  it("drops an exact replay of an already-honored payload (scrollback re-attach)", () => {
    const payload = stamped(NOW, "abc123");
    expect(starjourneyOscNavigationPath(payload, ORIGIN, NOW)).toBe(
      "/starjourney",
    );
    // Same bytes replayed moments later — the bug that trapped the user on
    // the star map: navigating back to /chat re-ran the scrollback and the
    // sequence re-fired.
    expect(starjourneyOscNavigationPath(payload, ORIGIN, NOW + 1000)).toBeNull();
  });

  it("drops stale payloads outright (old scrollback, fresh nonce)", () => {
    expect(
      starjourneyOscNavigationPath(
        stamped(NOW - STARJOURNEY_OSC_FRESH_MS - 1, "zzz999"),
        ORIGIN,
        NOW,
      ),
    ).toBeNull();
  });

  it("accepts distinct emissions back-to-back (user runs /starjourney twice)", () => {
    expect(
      starjourneyOscNavigationPath(stamped(NOW, "first111"), ORIGIN, NOW),
    ).toBe("/starjourney");
    expect(
      starjourneyOscNavigationPath(stamped(NOW + 50, "second22"), ORIGIN, NOW + 50),
    ).toBe("/starjourney");
  });

  it("rejects legacy bare-URL payloads (no stamp)", () => {
    expect(
      starjourneyOscNavigationPath(`${ORIGIN}/starjourney`, ORIGIN, NOW),
    ).toBeNull();
  });

  it("rejects malformed stamps and foreign origins", () => {
    expect(
      starjourneyOscNavigationPath(`garbage;${ORIGIN}/starjourney`, ORIGIN, NOW),
    ).toBeNull();
    expect(
      starjourneyOscNavigationPath(
        stamped(NOW, "abc123", "http://evil.example/starjourney"),
        ORIGIN,
        NOW,
      ),
    ).toBeNull();
  });
});
