import { afterEach, describe, expect, it, vi } from "vitest";
import { stashRecallDraft, takeRecallDraft, wrapBracketedPaste } from "./starjourney-recall";

describe("one-shot recall handoff", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("preserves ordinary Unicode and multiline text without adding Enter", () => {
    const text = "Reference α 🐚\nsecond line\tvalue\r\n";
    expect(wrapBracketedPaste(text)).toBe(`\x1b[200~${text}\x1b[201~`);
  });

  it("removes terminal controls that could break out of the paste frame", () => {
    const text = "before\x1b[201~\rnot-a-command\r\x9b201~\x03after";
    const wrapped = wrapBracketedPaste(text);
    expect(wrapped).toBe("\x1b[200~before[201~\rnot-a-command\r201~after\x1b[201~");
    expect(wrapped.split("\x1b[201~")).toHaveLength(2);
  });

  it("consumes a tab-local draft only once", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      setItem: (key: string, value: string) => data.set(key, value),
      getItem: (key: string) => data.get(key) ?? null,
      removeItem: (key: string) => data.delete(key),
    });
    expect(stashRecallDraft("fixture")).toBe(true);
    expect(takeRecallDraft()).toBe("fixture");
    expect(takeRecallDraft()).toBeNull();
    expect(data.size).toBe(0);
  });

  it("reports blocked storage instead of claiming success", () => {
    vi.stubGlobal("sessionStorage", {
      setItem: () => { throw new Error("storage blocked"); },
      getItem: () => { throw new Error("storage blocked"); },
    });
    expect(stashRecallDraft("fixture")).toBe(false);
    expect(takeRecallDraft()).toBeNull();
  });
});
