import { useEffect, useRef, useState } from "react";

import { Button } from "@nous-research/ui/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nous-research/ui/ui/components/dialog";

import { api, type ProviderSessionMessage } from "@/lib/api";

import { isProviderSource, type StarmapNode } from "./engine";

// Double-click drill-down for a star-map node: the conversation(s) the
// knowledge came from, and (provider nodes) the raw source corpus with a
// materialize-into-session action. The corpus viewer and recreation action are
// gated on `provenanceSupported` because the provider-session endpoints may not
// exist on older backends; session lookup and search work independently.

// One resolved conversation behind a node. `direct` = provenance-recorded
// (the node carries its originating session id); false = found by content
// search, which can surface several candidate sessions.
interface SessionHit {
  direct: boolean;
  id: string;
  started: null | number;
  title: string;
}

const fmtDateTime = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

function fmtTs(ts: null | number): string {
  if (!ts) {
    return "";
  }

  try {
    return fmtDateTime.format(new Date(ts * 1000));
  } catch {
    return "";
  }
}

// Search FTS with the node's title. Memory labels arrive truncated with a
// trailing ellipsis — strip it so the last (cut) word can't sink the query.
function searchQuery(label: string): string {
  const clean = label.replace(/…$/, "").trim();
  const words = clean.split(/\s+/).filter(Boolean);

  return words.length > 8 ? words.slice(0, 8).join(" ") : clean;
}

export function NodeSessionsDialog({
  onClose,
  onNotify,
  onOpenSession,
  provenanceSupported,
  target,
}: {
  onClose: () => void;
  /** Surface a transient success/error message (host owns the toast). */
  onNotify?: (message: string, type: "error" | "success") => void;
  onOpenSession: (storedSessionId: string) => void;
  /** Whether /api/learning/provider-session (+materialize) exist on this
   *  backend — feature-detected by the host; hides the corpus/recreate UI. */
  provenanceSupported: boolean;
  target: StarmapNode | null;
}) {
  const [hits, setHits] = useState<SessionHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [corpus, setCorpus] = useState<null | ProviderSessionMessage[]>(null);
  const [corpusLoading, setCorpusLoading] = useState(false);
  const [showCorpus, setShowCorpus] = useState(false);
  const [recreating, setRecreating] = useState(false);

  // Bumped when the dialog's context dies (close) so an in-flight
  // openCorpus/recreate from the old context can't apply late.
  const epochRef = useRef(0);

  const handleClose = () => {
    epochRef.current += 1;
    onClose();
  };

  // Provider-contributed node (any external memory provider): the source corpus lives in the
  // provider backend and is readable via the provider-session endpoint.
  const isProviderNode =
    Boolean(target?.sessionId) && isProviderSource(target?.memorySource);

  useEffect(() => {
    setHits([]);
    setCorpus(null);
    setShowCorpus(false);

    if (!target) {
      return;
    }

    // Local staleness flag: covers target change, close, and unmount.
    // epochRef guards only the imperative callbacks below.
    let stale = false;

    setLoading(true);

    const resolve = async () => {
      const out: SessionHit[] = [];

      // Provenance-recorded id first: for Hermes-born provider sessions the
      // provider session id IS the Hermes session id, so a direct lookup
      // beats any content search. 404 (imported/provider-only history) just
      // falls through to search.
      if (target.sessionId) {
        try {
          const s = await api.getSessionDetail(target.sessionId);

          out.push({
            direct: true,
            id: s.id,
            started: s.started_at ?? null,
            title: s.title || s.preview || s.id,
          });
        } catch {
          // Not a Hermes session — provider-only (e.g. imported history).
        }
      }

      if (out.length === 0) {
        try {
          const res = await api.searchSessions(searchQuery(target.label));

          for (const r of res.results.slice(0, 12)) {
            out.push({
              direct: false,
              id: r.session_id,
              started: r.session_started,
              title: r.snippet ? r.snippet.replace(/<\/?b>/g, "") : r.session_id,
            });
          }
        } catch {
          // Search unavailable — the empty state explains it.
        }
      }

      if (!stale) {
        setHits(out);
        setLoading(false);
      }
    };

    void resolve();

    return () => {
      stale = true;
    };
  }, [target]);

  const openCorpus = async () => {
    if (!target?.sessionId) {
      return;
    }

    const epoch = epochRef.current;
    setShowCorpus(true);

    if (corpus !== null) {
      return;
    }

    setCorpusLoading(true);

    try {
      const res = await api.getLearningProviderSession(target.sessionId);

      if (epochRef.current === epoch) {
        setCorpus(res.messages);
      }
    } catch {
      if (epochRef.current === epoch) {
        setCorpus([]);
      }
    } finally {
      if (epochRef.current === epoch) {
        setCorpusLoading(false);
      }
    }
  };

  // Materialize the provider-side conversation as a real Hermes session and
  // open it. Backend import skips existing ids, so re-running is safe — an
  // already-recreated conversation just reopens.
  const recreate = async () => {
    if (!target?.sessionId || recreating) {
      return;
    }

    const epoch = epochRef.current;
    setRecreating(true);

    try {
      const res = await api.materializeLearningProviderSession(
        target.sessionId,
      );

      if (epochRef.current !== epoch) {
        return;
      }

      onOpenSession(res.session_id);
    } catch (e) {
      if (epochRef.current === epoch) {
        onNotify?.(
          `Couldn't recreate the conversation: ${e instanceof Error ? e.message : String(e)}`,
          "error",
        );
      }
    } finally {
      if (epochRef.current === epoch) {
        setRecreating(false);
      }
    }
  };

  // Only offer "recreate" when the conversation doesn't already exist as a
  // Hermes session — if a direct hit resolved, opening it IS the action.
  const canRecreate =
    provenanceSupported && isProviderNode && !hits.some((h) => h.direct);

  return (
    <Dialog
      onOpenChange={(value) => !value && handleClose()}
      open={Boolean(target)}
    >
      {/* z-[110]: must beat the page's z-[100] full-bleed overlay — the kit
          dialog portals to document.body at z-50 and would otherwise be
          invisible behind the map (web-only stacking; desktop unaffected). */}
      <DialogContent className="z-[110] max-w-2xl">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">
            {showCorpus ? "Source data" : "Where this came from"}
          </DialogTitle>
        </DialogHeader>

        <div className="truncate text-xs text-muted-foreground">
          {target?.label}
        </div>

        {showCorpus ? (
          <div className="max-h-[55vh] min-h-24 space-y-3 overflow-y-auto pr-1">
            {corpusLoading ? (
              <p className="text-sm text-muted-foreground">
                Loading source data…
              </p>
            ) : !corpus || corpus.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Source data unavailable — the memory backend is unreachable or
                no longer holds this session.
              </p>
            ) : (
              corpus.map((m, i) => (
                <div className="rounded-md border border-border p-2" key={i}>
                  <div className="mb-1 flex items-baseline justify-between gap-2 text-[0.68rem] text-muted-foreground">
                    <span className="font-medium">{m.peer || "—"}</span>
                    {m.timestamp ? (
                      <span className="tabular-nums">{fmtTs(m.timestamp)}</span>
                    ) : null}
                  </div>
                  <div className="whitespace-pre-wrap text-xs">{m.content}</div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="max-h-[55vh] min-h-24 space-y-1 overflow-y-auto pr-1">
            {loading ? (
              <p className="text-sm text-muted-foreground">Finding sessions…</p>
            ) : hits.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {isProviderNode
                  ? "This entry came from the memory provider's own history (e.g. imported conversations) — no Hermes session matches it. Use \u201cView source data\u201d to read the original."
                  : "No matching sessions found in this profile's history."}
              </p>
            ) : (
              <>
                {!hits[0]?.direct && (
                  <p className="pb-1 text-[0.68rem] text-muted-foreground">
                    No recorded origin for this node — showing sessions matched
                    by content search.
                  </p>
                )}
                {hits.map((h) => (
                  <button
                    className="block w-full cursor-pointer rounded-md border border-transparent px-2 py-1.5 text-left hover:border-border hover:bg-accent"
                    key={h.id}
                    onClick={() => onOpenSession(h.id)}
                    type="button"
                  >
                    <div className="truncate text-xs">{h.title}</div>
                    <div className="flex items-baseline justify-between text-[0.65rem] text-muted-foreground">
                      <span className="truncate">{h.id}</span>
                      {h.started ? (
                        <span className="shrink-0 pl-2 tabular-nums">
                          {fmtTs(h.started)}
                        </span>
                      ) : null}
                    </div>
                  </button>
                ))}
              </>
            )}
          </div>
        )}

        {/* flex-wrap + nowrap labels: the design-system button renders its
            label with line-height 0, so a WRAPPED label overprints itself
            into glyph soup — let tight footers wrap whole buttons instead. */}
        <DialogFooter className="flex-wrap items-center gap-2">
          {showCorpus ? (
            <Button ghost onClick={() => setShowCorpus(false)} type="button">
              Back
            </Button>
          ) : provenanceSupported && isProviderNode ? (
            <Button
              className="whitespace-nowrap"
              onClick={() => void openCorpus()}
              outlined
              type="button"
            >
              View source data
            </Button>
          ) : null}
          {canRecreate ? (
            <Button
              className="whitespace-nowrap"
              disabled={recreating || loading}
              onClick={() => void recreate()}
              outlined
              type="button"
            >
              {recreating ? "Recreating…" : "Recreate as Hermes session"}
            </Button>
          ) : null}
          <Button ghost onClick={handleClose} type="button">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
