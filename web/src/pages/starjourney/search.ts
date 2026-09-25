import { atom, type WritableAtom } from "nanostores";

import type { StarmapGraph, StarmapNode } from "./engine";

// Pure search/filter logic plus persisted state for the star-map sidebar.
// Keeping this module free of React makes the matching rules unit-testable.
// Search state is stored directly in localStorage, the dashboard persistence
// surface.

/** How the date filter is expressed. 'range' = explicit from/to days;
 *  'year' = a whole calendar year; 'yearMonth' = a single month of a year.
 *  All three collapse to a unix-second [from, to] window via effectiveRange. */
export type DateMode = "range" | "year" | "yearMonth";

export interface SearchFilters {
  /** Which date control is active. Range uses from/to; year uses year;
   *  yearMonth uses year (+ optional month). */
  dateMode: DateMode;
  /** ISO date 'YYYY-MM-DD' (local), or '' for unbounded — range mode. */
  from: string;
  /** 'memory' excludes conclusions (disjoint categories); 'conclusion' is
   *  provider-derived durable facts, only meaningful under Honcho. */
  kind: "all" | "conclusion" | "memory" | "skill";
  /** '01'–'12', or '' for the whole year — yearMonth mode. */
  month: string;
  /** 'all' | 'hermes' | any import origin ('chatgpt', …) — open-ended so new
   *  import sources need no code change here. */
  source: string;
  /** ISO date 'YYYY-MM-DD' (local), or '' for unbounded — range mode. */
  to: string;
  /** 'YYYY', or '' for unbounded — year / yearMonth modes. */
  year: string;
}

export interface SavedSearch extends SearchFilters {
  query: string;
}

export const EMPTY_FILTERS: SearchFilters = {
  dateMode: "range",
  from: "",
  kind: "all",
  month: "",
  source: "all",
  to: "",
  year: "",
};

/** Active provider name, lowercased, or '' — no external provider active. */
function providerName(graph: Pick<StarmapGraph, "memoryProvider">): string {
  return (graph.memoryProvider ?? "").trim().toLowerCase();
}

/** Whether the conclusion category + legend + node styling should surface at
 *  all: any external memory provider is active. Provider-agnostic by design —
 *  the backend advertises the active provider's name in `memoryProvider` and
 *  the UI treats it as an opaque label; whether individual nodes are
 *  conclusions is decided per-node from `memoryLevel` (see isConclusion), so a
 *  provider that never emits derived levels simply yields zero conclusion
 *  nodes and an empty (harmless) category. Honcho is the reference
 *  implementation, not a special case. */
export function conclusionsEnabled(
  graph: Pick<StarmapGraph, "memoryProvider">,
): boolean {
  return providerName(graph) !== "";
}

/** Memory levels that mark a provider entry as a DERIVED fact (a conclusion)
 *  rather than a directly-stated one. Generic taxonomy (Honcho's, adopted as
 *  the wire contract): 'explicit' = a fact stated outright (a true memory);
 *  'inductive' / 'deductive' = an inference the provider synthesized (a
 *  conclusion). Kept as a set so an unknown future derived level can be added
 *  in one place. */
const DERIVED_LEVELS = new Set(["inductive", "deductive"]);

/** A node is a "conclusion" — a durable DERIVED fact — when an external
 *  provider is active, the node came from THAT provider, AND the provider
 *  tagged it with a derived level ('inductive'/'deductive'). An 'explicit'
 *  level, a missing level (a provider that predates / doesn't implement the
 *  field), or any non-provider node is a plain memory. Keying on the derived
 *  level — not merely "came from a provider" — is what stops genuine memories
 *  (the vast majority) from being mislabeled as conclusions; missing-level
 *  safely degrades to memory. No provider name is special-cased: any
 *  MemoryProvider whose journey_cards() emits `level` gets conclusion styling
 *  and filtering for free. */
export function isConclusion(
  n: StarmapNode,
  memoryProvider?: null | string,
): boolean {
  const provider = (memoryProvider ?? "").trim().toLowerCase();
  if (!provider) {
    return false;
  }
  if ((n.memorySource ?? "").trim().toLowerCase() !== provider) {
    return false;
  }
  return DERIVED_LEVELS.has((n.memoryLevel ?? "").trim().toLowerCase());
}

/** Where a node's knowledge originally came from. The backend stamps provider
 *  nodes (explicit `origin`, or the `<source>-import-…` session convention);
 *  everything else — file memories, skills, older backends — is Hermes-born. */
export function nodeOrigin(n: StarmapNode): string {
  return (n.origin ?? "hermes").trim().toLowerCase() || "hermes";
}

/** Distinct origins present in the graph: 'hermes' first, imports A→Z after.
 *  Drives the source filter, so a future 'claude'/'gemini' import shows up
 *  automatically. */
export function distinctOrigins(nodes: StarmapNode[]): string[] {
  const seen = new Set<string>();

  for (const n of nodes) {
    seen.add(nodeOrigin(n));
  }

  const imports = [...seen].filter((o) => o !== "hermes").sort();

  return seen.has("hermes") ? ["hermes", ...imports] : imports;
}

function dayStart(iso: string): null | number {
  const [y, m, d] = iso.split("-").map(Number);

  if (!y || !m || !d) {
    return null;
  }

  return new Date(y, m - 1, d).getTime() / 1000;
}

function dayEnd(iso: string): null | number {
  const start = dayStart(iso);

  return start === null ? null : start + 86_400 - 1;
}

// Whole-year / whole-month boundaries, local time. yearEnd/monthEnd are
// "first instant of the next period, minus 1s" so they're inclusive of the
// period's final day without date-arithmetic edge cases (leap years, 31 vs 30).
function yearStart(year: number): number {
  return new Date(year, 0, 1).getTime() / 1000;
}

function yearEnd(year: number): number {
  return new Date(year + 1, 0, 1).getTime() / 1000 - 1;
}

function monthStart(year: number, month1: number): number {
  return new Date(year, month1 - 1, 1).getTime() / 1000;
}

function monthEnd(year: number, month1: number): number {
  return new Date(year, month1, 1).getTime() / 1000 - 1;
}

/** Collapse whichever date control is active into a unix-second [from, to]
 *  window (null = that edge unbounded). A blank/partial selection widens
 *  rather than excludes: an empty year → unbounded; a year with no month →
 *  the whole year. This is the single source of truth for date filtering and
 *  for whether a date narrowing is even active. */
export function effectiveRange(f: SearchFilters): {
  from: null | number;
  to: null | number;
} {
  if (f.dateMode === "year" || f.dateMode === "yearMonth") {
    const y = Number(f.year);

    if (!y) {
      return { from: null, to: null };
    }

    const m = f.dateMode === "yearMonth" ? Number(f.month) : 0;

    if (m >= 1 && m <= 12) {
      return { from: monthStart(y, m), to: monthEnd(y, m) };
    }

    return { from: yearStart(y), to: yearEnd(y) };
  }

  return {
    from: f.from ? dayStart(f.from) : null,
    to: f.to ? dayEnd(f.to) : null,
  };
}

/** True when the query/filters actually narrow the graph — the pulse and the
 *  "save this search" affordance key off this, so an idle open sidebar (full
 *  chronological list) doesn't light up every node. */
export function hasActiveNarrowing(
  query: string,
  filters: SearchFilters,
): boolean {
  const { from, to } = effectiveRange(filters);

  return (
    query.trim() !== "" ||
    filters.kind !== "all" ||
    filters.source !== "all" ||
    from !== null ||
    to !== null
  );
}

/** Filter + chronologically sort the graph's nodes.
 *
 *  Matching: every whitespace-separated term must appear (AND) in the node's
 *  label, category, origin, or — for memories — full card body, so a query
 *  reaches text the truncated node label dropped. Date range applies to the
 *  node's timestamp; undated nodes survive only an unbounded range. Result is
 *  oldest→newest (undated last) — callers reverse for newest-first.
 */
export function filterNodes(
  graph: StarmapGraph,
  query: string,
  filters: SearchFilters,
): StarmapNode[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const { from, to } = effectiveRange(filters);
  const provider = graph.memoryProvider;

  // memory:<source>:<index>[:<fingerprint>] ids index into graph.memory for full bodies.
  // File cards carry a fingerprint in their node id (agent.learning_graph.memory_node_id);
  // provider cards and imported/older graphs don't — key both shapes.
  const bodyById = new Map<string, string>();

  graph.memory.forEach((card, i) => {
    bodyById.set(`memory:${card.source}:${i}`, card.body);

    if (card.fingerprint) {
      bodyById.set(`memory:${card.source}:${i}:${card.fingerprint}`, card.body);
    }
  });

  const out = graph.nodes.filter((n) => {
    // Kind: memory/conclusion are DISJOINT — a conclusion is a Honcho-derived
    // fact, so 'memory' means a memory that is NOT a conclusion, and the
    // dedicated 'conclusion' bucket captures the rest. 'skill' is unchanged.
    if (filters.kind === "skill") {
      if (n.kind !== "skill") {
        return false;
      }
    } else if (filters.kind === "conclusion") {
      if (!isConclusion(n, provider)) {
        return false;
      }
    } else if (filters.kind === "memory") {
      if (n.kind !== "memory" || isConclusion(n, provider)) {
        return false;
      }
    }

    if (filters.source !== "all" && nodeOrigin(n) !== filters.source) {
      return false;
    }

    const ts = n.timestamp ?? null;

    if (from !== null || to !== null) {
      if (ts === null) {
        return false;
      }

      if ((from !== null && ts < from) || (to !== null && ts > to)) {
        return false;
      }
    }

    if (terms.length === 0) {
      return true;
    }

    const haystack =
      `${n.label}\n${n.category}\n${nodeOrigin(n)}\n${bodyById.get(n.id) ?? ""}`.toLowerCase();

    return terms.every((term) => haystack.includes(term));
  });

  return out.sort((a, b) => {
    const ta = a.timestamp ?? null;
    const tb = b.timestamp ?? null;

    if (ta === null && tb === null) {
      return a.label.localeCompare(b.label);
    }

    if (ta === null) {
      return 1;
    }

    if (tb === null) {
      return -1;
    }

    return ta - tb;
  });
}

// ── Persisted search state (recent queries + saved searches) ────────────────

const HISTORY_KEY = "hermes.web.starmap.search.history";
const SAVED_KEY = "hermes.web.starmap.search.saved";
const HISTORY_MAX = 12;
const SAVED_MAX = 20;

/** Maps a value to/from its stored string form. `decode` only ever sees a
 *  real stored string (absence falls back); `encode` returning null removes
 *  the key. Mirrors the desktop Codec contract. */
interface Codec<T> {
  decode(raw: string): T;
  encode(value: T): null | string;
}

// localStorage access is defensive throughout: privacy modes / test
// environments (vitest node env) may not expose it, and a full quota throws
// on write. All failures degrade to in-memory-only state.
function readKey(key: string): null | string {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function writeKey(key: string, value: null | string): void {
  try {
    if (value === null) {
      globalThis.localStorage?.removeItem(key);
    } else {
      globalThis.localStorage?.setItem(key, value);
    }
  } catch {
    /* quota / privacy mode — state stays in-memory */
  }
}

/** A nanostore that auto-persists to localStorage. Persists CHANGES only —
 *  never the creation-time value — so a cold boot can't clobber a populated
 *  record with the fallback (same guard as the desktop persistentAtom). */
function persistentAtom<T>(
  key: string,
  fallback: T,
  codec: Codec<T>,
): WritableAtom<T> {
  const raw = readKey(key);
  let initial = fallback;

  if (raw !== null) {
    try {
      initial = codec.decode(raw);
    } catch {
      initial = fallback;
    }
  }

  const $value = atom<T>(initial);
  let creationEmission = true;

  $value.subscribe((value) => {
    if (creationEmission) {
      creationEmission = false;

      return;
    }

    writeKey(key, codec.encode(value));
  });

  return $value;
}

const stringArray: Codec<string[]> = {
  decode: (raw) => {
    const parsed = JSON.parse(raw) as unknown;

    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is string => typeof item === "string" && item.length > 0,
        )
      : [];
  },
  encode: (value) => (value.length === 0 ? null : JSON.stringify(value)),
};

const savedSearches: Codec<SavedSearch[]> = {
  decode: (raw) => {
    const parsed = JSON.parse(raw) as unknown;

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.flatMap((item): SavedSearch[] => {
      if (!item || typeof item !== "object") {
        return [];
      }

      const rec = item as Record<string, unknown>;

      const kind =
        rec.kind === "memory" || rec.kind === "skill" || rec.kind === "conclusion"
          ? rec.kind
          : "all";

      const dateMode =
        rec.dateMode === "year" || rec.dateMode === "yearMonth"
          ? rec.dateMode
          : "range";

      return [
        {
          dateMode,
          from: typeof rec.from === "string" ? rec.from : "",
          kind,
          month: typeof rec.month === "string" ? rec.month : "",
          query: typeof rec.query === "string" ? rec.query : "",
          source:
            typeof rec.source === "string" && rec.source ? rec.source : "all",
          to: typeof rec.to === "string" ? rec.to : "",
          year: typeof rec.year === "string" ? rec.year : "",
        },
      ];
    });
  },
  encode: (value) => (value.length === 0 ? null : JSON.stringify(value)),
};

/** Recent committed queries, newest first — the Google-style dropdown. */
export const $searchHistory = persistentAtom<string[]>(
  HISTORY_KEY,
  [],
  stringArray,
);

/** Saved searches (query + filters), newest first. */
export const $savedSearches = persistentAtom<SavedSearch[]>(
  SAVED_KEY,
  [],
  savedSearches,
);

/** Record a committed query (Enter / picking a result). Dedupes, caps. */
export function commitSearchHistory(query: string): void {
  const q = query.trim();

  if (!q) {
    return;
  }

  $searchHistory.set(
    [q, ...$searchHistory.get().filter((h) => h !== q)].slice(0, HISTORY_MAX),
  );
}

const savedKey = (s: SavedSearch) =>
  JSON.stringify([
    s.query.trim(),
    s.kind,
    s.source,
    s.dateMode,
    s.from,
    s.to,
    s.year,
    s.month,
  ]);

/** Persist the current query+filters; replaces an identical existing save. */
export function saveSearch(next: SavedSearch): void {
  const key = savedKey(next);

  $savedSearches.set(
    [
      { ...next, query: next.query.trim() },
      ...$savedSearches.get().filter((s) => savedKey(s) !== key),
    ].slice(0, SAVED_MAX),
  );
}

export function removeSavedSearch(target: SavedSearch): void {
  const key = savedKey(target);

  $savedSearches.set($savedSearches.get().filter((s) => savedKey(s) !== key));
}
