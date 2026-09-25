import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { Sparkles, X } from "lucide-react";
import { useNavigate, useSearchParams } from "react-router";

import { api, CHAT_PICKER_EXCLUDED_SOURCES } from "@/lib/api";
import { useProfileScope } from "@/contexts/useProfileScope";
import { cn, themedBody } from "@/lib/utils";
import { stashRecallDraft } from "@/lib/starjourney-recall";
import { Button } from "@nous-research/ui/ui/components/button";
import { Spinner } from "@nous-research/ui/ui/components/spinner";
import { Toast } from "@nous-research/ui/ui/components/toast";
import { useToast } from "@nous-research/ui/hooks/use-toast";
import type { StarmapGraph } from "./engine";

import { StarMap } from "./StarMap";

// How many most-recently-active sessions the "Add to a session" submenu offers.
const RECALL_RECENT_SESSIONS = 5;

// The journey star map as a full-bleed overlay the user can dismiss with the
// × button (or Escape) — matching the desktop app's dismissible star-map
// surface. Renders the same shared canvas/d3-force engine the desktop map
// uses (bundled here under ./engine), fed by the live /api/learning/graph
// payload for the active profile, plus the full desktop feature layer:
// right-click node menu (details/edit/delete/provenance/recall), the
// provenance drill-down with corpus viewer + materialize, and the search/
// filter sidebar with saved searches.
//
// Capability probing: the graph + node GET/PUT/DELETE endpoints exist on any
// current backend, but recall-draft and the provider-session pair may not.
// Both are feature-detected once per load (404 → the corresponding UI is
// hidden), so the page works against any backend vintage.
export default function StarJourneyPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { profile } = useProfileScope();
  const { toast, showToast } = useToast();

  const [graph, setGraph] = useState<StarmapGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Bumped after a node edit/delete so the map refetches without a remount.
  const [graphNonce, setGraphNonce] = useState(0);
  const [recallSupported, setRecallSupported] = useState(false);
  const [provenanceSupported, setProvenanceSupported] = useState(false);
  const [recentSessions, setRecentSessions] = useState<
    { key: string; title: string }[]
  >([]);

  // `/starjourney?recall=1` (e.g. a future TUI /recall link) opens with the
  // search sidebar focused — the "find something to recall" entry point.
  const initialSearchFocus = useMemo(
    () => searchParams.get("recall") === "1",
    [searchParams],
  );

  const close = useCallback(() => {
    // Prefer going back so the user lands where they opened the map from;
    // fall back to the dashboard root on a cold deep-link.
    if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate("/");
    }
  }, [navigate]);

  // Dismiss on Escape, mirroring the desktop overlay's keyboard close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);

    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  // Load (and reload when the active management profile changes — the graph is
  // a profile-scoped view — or after a node mutation). Best-effort: any failure
  // renders an inline message instead of throwing.
  useEffect(() => {
    let stale = false;
    setLoading(graphNonce === 0);
    setError(null);
    api
      .getLearningGraph()
      .then((g) => {
        if (!stale) setGraph(g);
      })
      .catch((err) => {
        if (!stale) setError(String(err));
      })
      .finally(() => {
        if (!stale) setLoading(false);
      });

    return () => {
      stale = true;
    };
  }, [profile, graphNonce]);

  // Capability probe: the provider-session endpoint is contractually
  // best-effort (unknown session → empty messages, HTTP 200), so probing with
  // a sentinel id cleanly separates "endpoint exists" (200) from "backend
  // predates it" (404) with zero side effects.
  useEffect(() => {
    let stale = false;
    api
      .getLearningProviderSession("__capability_probe__")
      .then(() => {
        if (!stale) setProvenanceSupported(true);
      })
      .catch(() => {
        if (!stale) setProvenanceSupported(false);
      });

    return () => {
      stale = true;
    };
  }, [profile]);

  // Capability probe: recall-draft needs a REAL node id (a bogus id 404s on
  // both old and new backends), so probe with the first node once the graph
  // is in. Read-only server-side (build + scan a draft, mutate nothing).
  useEffect(() => {
    const first = graph?.nodes[0]?.id;

    if (!first) {
      setRecallSupported(false);

      return;
    }

    let stale = false;
    api
      .getLearningRecallDraft(first)
      .then((res) => {
        if (!stale) setRecallSupported(Boolean(res.ok));
      })
      .catch(() => {
        if (!stale) setRecallSupported(false);
      });

    return () => {
      stale = true;
    };
  }, [graph]);

  // The most-recently-active sessions offered in "Add to a session".
  useEffect(() => {
    let stale = false;
    api
      .getSessions(RECALL_RECENT_SESSIONS, 0, {
        // Human chats only — recall targets. Without the exclusion the
        // picker fills with cron/tool automation rows (see api.ts).
        order: "recent",
        excludeSources: CHAT_PICKER_EXCLUDED_SOURCES,
      })
      .then((res) => {
        if (stale) return;
        setRecentSessions(
          res.sessions.map((s) => ({
            key: s.id,
            title: s.title || s.preview || s.id,
          })),
        );
      })
      .catch(() => {
        if (!stale) setRecentSessions([]);
      });

    return () => {
      stale = true;
    };
  }, [profile]);

  // Fetch the injection-hardened, provenance-tagged draft for a node. The
  // body is scanned + defanged + wrapped server-side; we only place the
  // returned text. Returns null (after a toast) when unavailable.
  const fetchRecallText = useCallback(
    async (id: string): Promise<null | string> => {
      try {
        const draft = await api.getLearningRecallDraft(id);

        if (!draft.ok || !draft.text.trim()) {
          showToast("Could not load that memory to insert.", "error");

          return null;
        }

        return draft.text;
      } catch {
        showToast("Could not load that memory to insert.", "error");

        return null;
      }
    },
    [showToast],
  );

  // Recall into the live chat tab: stash the draft, then navigate to /chat
  // with the one-shot ?recall flag. ChatPage delivers it into the TUI
  // composer as a bracketed paste — an editable draft the user reviews and
  // sends. Nothing is ever auto-sent.
  const recallIntoChat = useCallback(
    async (node: { id: string; kind: "memory" | "skill"; label: string }) => {
      const text = await fetchRecallText(node.id);

      if (!text) {
        return;
      }

      if (!stashRecallDraft(text)) {
        showToast("Could not stage the draft (storage unavailable).", "error");

        return;
      }

      navigate("/chat?recall=1");
    },
    [fetchRecallText, navigate, showToast],
  );

  // Recall into a specific recent session: same draft, but resume that
  // session in the chat tab first so the paste lands in ITS composer.
  const addToSession = useCallback(
    async (
      node: { id: string; kind: "memory" | "skill"; label: string },
      sessionKey: string,
    ) => {
      const text = await fetchRecallText(node.id);

      if (!text) {
        return;
      }

      if (!stashRecallDraft(text)) {
        showToast("Could not stage the draft (storage unavailable).", "error");

        return;
      }

      navigate(`/chat?resume=${encodeURIComponent(sessionKey)}&recall=1`);
    },
    [fetchRecallText, navigate, showToast],
  );

  // Conclusion nodes: seed a chat about the conclusion's text — as a
  // reviewed composer draft in the chat tab (never auto-sent). The web chat
  // is a persistent TUI, so the seed lands in the live composer; the user
  // can /new first if they want a fresh session.
  const startConversation = useCallback(
    (conclusion: { id: string; label: string }) => {
      const seed = `I want to talk about something you've concluded about me:\n\n> ${conclusion.label}\n\n`;

      if (!stashRecallDraft(seed)) {
        showToast("Could not stage the draft (storage unavailable).", "error");

        return;
      }

      navigate("/chat?recall=1");
    },
    [navigate, showToast],
  );

  // Drill-down / materialize result: open the conversation in the chat tab.
  const openSession = useCallback(
    (storedSessionId: string) => {
      navigate(`/chat?resume=${encodeURIComponent(storedSessionId)}`);
    },
    [navigate],
  );

  const isEmpty =
    !!graph && graph.nodes.length === 0 && graph.memory.length === 0;

  // Portal to document.body: the main dashboard column in App.tsx is
  // `relative z-2`, which creates a stacking context that would trap this
  // fixed overlay *below* the app sidebar (z-50) and leave the nav clickable
  // behind it. Portaling out + z-[100] makes it a true full-bleed overlay
  // (same pattern as ModelPickerDialog / Toast). themedBody re-applies the
  // Mondwest font + case that the shell would otherwise provide.
  return createPortal(
    <div
      className={cn(
        themedBody,
        "fixed inset-0 z-[100] flex flex-col bg-background text-foreground",
      )}
      role="dialog"
      aria-modal="true"
      aria-label="Journey star map"
    >
      {/* Header bar: title on the left, × close on the right. */}
      <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-[var(--theme-primary,var(--color-primary))]" />
          <span>Journey</span>
          <span className="text-muted-foreground/70">— what Hermes has learned</span>
        </div>
        <Button
          aria-label="Close journey"
          ghost
          onClick={close}
          size="icon"
        >
          <X className="size-4" />
        </Button>
      </div>

      {/* Canvas region. The shared StarMap fills the remaining space; it reads
          --theme-primary / --theme-secondary, aliased here from the web design
          system's --color-* tokens so the palette resolves on the dashboard. */}
      <div
        className="relative min-h-0 flex-1"
        style={
          {
            "--theme-primary": "var(--color-primary)",
            "--theme-secondary": "var(--color-secondary)",
          } as React.CSSProperties
        }
      >
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Spinner />
          </div>
        )}

        {!loading && error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-sm text-muted-foreground">
              Couldn&apos;t load the journey map.
            </p>
            <p className="max-w-md text-xs text-muted-foreground/70">{error}</p>
          </div>
        )}

        {!loading && !error && isEmpty && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            <Sparkles className="size-6 text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">
              Nothing to map yet.
            </p>
            <p className="max-w-md text-xs text-muted-foreground/70">
              As Hermes learns skills and accumulates memories, they&apos;ll
              appear here as a star map — oldest at the core, newest on the
              outer rings.
            </p>
          </div>
        )}

        {!loading && !error && graph && !isEmpty && (
          <div className="absolute inset-0 flex">
            <StarMap
              graph={graph}
              initialSearchFocus={initialSearchFocus}
              onAddToSession={recallSupported ? addToSession : undefined}
              onGraphMutated={() => setGraphNonce((n) => n + 1)}
              onNotify={showToast}
              onOpenSession={openSession}
              onRecallIntoChat={recallSupported ? recallIntoChat : undefined}
              onStartConversation={startConversation}
              provenanceSupported={provenanceSupported}
              recallSupported={recallSupported}
              recentSessions={recentSessions}
            />
          </div>
        )}
      </div>

      <Toast toast={toast} />
    </div>,
    document.body,
  );
}
