import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button } from "@nous-research/ui/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nous-research/ui/ui/components/dialog";

import { api } from "@/lib/api";
import { ConfirmDialog } from "@/components/ConfirmDialog";

import { isProviderSource } from "./engine";

// Right-click actions for a star-map node: provenance, edit (modal), delete
// (confirm), and recall. The dashboard uses a monospace textarea for edits;
// deletes reload the graph after success, and management-profile changes remount
// the map to invalidate profile-scoped state.

export interface NodeMenuTarget {
  id: string;
  /** True when this node is a provider-derived conclusion (durable derived
   *  fact — memoryLevel 'inductive'/'deductive'). Adds a
   *  "Start a conversation about this" action; conclusions are provider-backed
   *  so they stay read-only (no Edit/Delete). */
  isConclusion?: boolean;
  kind: "memory" | "skill";
  label: string;
  /** Memory nodes only: 'memory' | 'profile' | a provider name ('honcho', …).
   *  Provider-backed nodes are read-only — the menu offers no Edit/Delete. */
  memorySource?: string;
  x: number;
  y: number;
}

/** One recent session offered in the "Add to a session" submenu. `key` is the
 *  stored session id the chat tab resumes; `title` is the display label. */
export interface RecallSessionOption {
  key: string;
  title: string;
}

interface NodeContextMenuProps {
  onClose: () => void;
  onNodeRemoved: () => void;
  /** Surface a transient success/error message (host owns the toast). */
  onNotify?: (message: string, type: "error" | "success") => void;
  /** Open the provenance dialog ("Where this came from…") for this node. */
  onShowProvenance: (id: string) => void;
  /** Conclusion nodes only: seed a chat about this conclusion (for review —
   *  never auto-sent). Absent when the host doesn't support it. */
  onStartConversation?: (target: NodeMenuTarget) => void;
  /** "Add to a session": stash this node's knowledge (as a reviewed,
   *  injection-hardened draft) into an existing session's chat composer.
   *  Given the stored session id. Available for ALL node kinds. */
  onAddToSession?: (target: NodeMenuTarget, sessionKey: string) => void;
  /** Insert this node's knowledge into the live chat tab's composer for
   *  review. Available for ALL node kinds. */
  onRecallIntoChat?: (target: NodeMenuTarget) => void;
  /** Most-recently-active sessions (already capped + ordered) for the
   *  "Add to a session" submenu. Empty/undefined hides that action. */
  recentSessions?: RecallSessionOption[];
  target: NodeMenuTarget | null;
}

interface EditState {
  content: string;
  id: string;
  label: string;
}

const itemCls =
  "block w-full cursor-pointer rounded-md px-2 py-1 text-left text-xs hover:bg-accent hover:text-foreground";

export function NodeContextMenu({
  onAddToSession,
  onClose,
  onNodeRemoved,
  onNotify,
  onRecallIntoChat,
  onShowProvenance,
  onStartConversation,
  recentSessions,
  target,
}: NodeContextMenuProps) {
  const [editing, setEditing] = useState<EditState | null>(null);
  const [deleting, setDeleting] = useState<Omit<
    NodeMenuTarget,
    "x" | "y"
  > | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<null | string>(null);
  // Whether the "Add to a session" submenu is expanded. Reset whenever the
  // menu retargets (a new right-click) so it never opens pre-expanded.
  const [showSessions, setShowSessions] = useState(false);
  // Viewport-clamped menu position. The anchor is a raw client point (canvas
  // node or sidebar-row click), so near the right/bottom edges the card would
  // otherwise overflow off-screen; measure after layout and pull it back in.
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [menuPos, setMenuPos] = useState<null | { x: number; y: number }>(
    null,
  );

  useEffect(() => {
    setShowSessions(false);
  }, [target?.id]);

  useLayoutEffect(() => {
    if (!target) {
      setMenuPos(null);
      return;
    }

    const el = menuRef.current;

    if (!el) {
      setMenuPos({ x: target.x, y: target.y });
      return;
    }

    const MARGIN = 8;
    const rect = el.getBoundingClientRect();
    const maxX = window.innerWidth - rect.width - MARGIN;
    const maxY = window.innerHeight - rect.height - MARGIN;
    setMenuPos({
      x: Math.max(MARGIN, Math.min(target.x, maxX)),
      y: Math.max(MARGIN, Math.min(target.y, maxY)),
    });
    // Re-clamp when the inline submenu expands/collapses (height changes).
  }, [target, showSessions]);

  const noun = target?.kind === "memory" ? "memory" : "skill";

  const openEdit = async () => {
    if (!target) {
      return;
    }

    const id = target.id;
    setLoading(true);
    setError(null);

    try {
      const detail = await api.getLearningNode(id);
      setEditing({ content: detail.content, id, label: target.label });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const save = async () => {
    if (!editing) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const res = await api.editLearningNode(editing.id, editing.content);

      if (!res.ok) {
        throw new Error(res.message);
      }

      setEditing(null);
      onNodeRemoved(); // graph changed — host refetches (label may have moved)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting || removing) {
      return;
    }

    setRemoving(true);

    try {
      const res = await api.deleteLearningNode(deleting.id);

      if (!res.ok) {
        throw new Error(res.message);
      }

      setDeleting(null);
      onNodeRemoved();
    } catch (e) {
      onNotify?.(
        `Couldn't remove ${deleting.label}: ${e instanceof Error ? e.message : String(e)}`,
        "error",
      );
      setDeleting(null);
    } finally {
      setRemoving(false);
    }
  };

  const menuOpen = target && !editing && !deleting;

  return (
    <>
      {menuOpen ? (
        <>
          <div
            className="fixed inset-0 z-50"
            onClick={onClose}
            onContextMenu={(e) => {
              e.preventDefault();
              onClose();
            }}
          />
          {/* Hand-rolled fixed positioning: the anchor is a canvas point, not
              a DOM element, so a portal-less fixed card is the right tool.
              First paint lands at the raw anchor; the layout effect above
              immediately clamps it inside the viewport. */}
          <div
            className="fixed z-50 min-w-36 rounded-lg border border-border bg-popover p-1 shadow-md"
            ref={menuRef}
            style={{
              left: menuPos ? menuPos.x : target.x,
              top: menuPos ? menuPos.y : target.y,
            }}
          >
            <div className="truncate px-2 py-1 text-[0.68rem] text-muted-foreground">
              {target.label}
            </div>
            <button
              className={itemCls}
              onClick={() => {
                onShowProvenance(target.id);
                onClose();
              }}
              type="button"
            >
              Where this came from…
            </button>
            {/* Recall: insert this node's knowledge into the live chat tab.
                The host fetches an injection-hardened, provenance-tagged
                draft and pastes it into the TUI composer for review. */}
            {onRecallIntoChat ? (
              <button
                className={itemCls}
                onClick={() => {
                  onRecallIntoChat(target);
                  onClose();
                }}
                type="button"
              >
                Insert into chat…
              </button>
            ) : null}
            {/* "Add to a session ▸": recall into one of the most-recently-
                active sessions. Inline submenu (canvas-anchored menu can't
                host a native nested menu). */}
            {onAddToSession && recentSessions && recentSessions.length > 0 ? (
              <div>
                <button
                  aria-expanded={showSessions}
                  className="flex w-full cursor-pointer items-center justify-between rounded-md px-2 py-1 text-left text-xs hover:bg-accent hover:text-foreground"
                  onClick={() => setShowSessions((open) => !open)}
                  type="button"
                >
                  <span>Add to a session</span>
                  <span className="ml-2 text-muted-foreground">
                    {showSessions ? "▾" : "▸"}
                  </span>
                </button>
                {showSessions ? (
                  <div className="ml-2 border-l border-border pl-1">
                    {recentSessions.map((session) => (
                      <button
                        className="block w-full cursor-pointer truncate rounded-md px-2 py-1 text-left text-xs hover:bg-accent hover:text-foreground"
                        key={session.key}
                        onClick={() => {
                          onAddToSession(target, session.key);
                          onClose();
                        }}
                        title={session.title}
                        type="button"
                      >
                        {session.title}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}
            {isProviderSource(target.memorySource) ? (
              <>
                {target.isConclusion && onStartConversation ? (
                  <button
                    className={itemCls}
                    onClick={() => {
                      onStartConversation(target);
                      onClose();
                    }}
                    type="button"
                  >
                    Start a conversation about this…
                  </button>
                ) : null}
                <div className="max-w-56 px-2 py-1 text-[0.68rem] text-muted-foreground">
                  Read-only — managed by the {target.memorySource} memory
                  provider
                </div>
              </>
            ) : (
              <>
                <button
                  className={`${itemCls} disabled:opacity-50`}
                  disabled={loading}
                  onClick={() => void openEdit()}
                  type="button"
                >
                  Edit {noun}…
                </button>
                <button
                  className="block w-full cursor-pointer rounded-md px-2 py-1 text-left text-xs text-destructive hover:bg-destructive/10"
                  onClick={() => {
                    setDeleting({
                      id: target.id,
                      kind: target.kind,
                      label: target.label,
                    });
                    onClose();
                  }}
                  type="button"
                >
                  {target.kind === "skill" ? "Archive skill" : "Delete memory"}
                </button>
              </>
            )}
            {error ? (
              <div className="max-w-56 px-2 py-1 text-[0.68rem] text-destructive">
                {error}
              </div>
            ) : null}
          </div>
        </>
      ) : null}

      <Dialog
        onOpenChange={(value) => !value && !saving && setEditing(null)}
        open={Boolean(editing)}
      >
        {/* z-[110]: the star-journey page is a full-bleed z-[100] overlay, and
            the UI-kit dialog portals to document.body at z-50 — without the
            bump the editor would render behind the map (desktop never hits
            this; its starmap host stacks below the shared dialog layer). */}
        <DialogContent className="z-[110] max-w-2xl">
          <DialogHeader>
            <DialogTitle>Edit {editing?.label}</DialogTitle>
          </DialogHeader>
          {editing && (
            <textarea
              aria-label={`Edit ${noun} content`}
              className="h-80 w-full resize-none rounded-md border border-border bg-transparent p-2 font-mono text-xs outline-none focus-visible:ring-1 focus-visible:ring-ring/40"
              key={editing.id}
              onChange={(e) =>
                setEditing((prev) =>
                  prev ? { ...prev, content: e.target.value } : prev,
                )
              }
              spellCheck={false}
              value={editing.content}
            />
          )}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              disabled={saving}
              ghost
              onClick={() => setEditing(null)}
              type="button"
            >
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => void save()} type="button">
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        confirmLabel={deleting?.kind === "skill" ? "Archive" : "Delete"}
        description={
          deleting?.kind === "skill"
            ? "The skill is archived (restorable from ~/.hermes/skills/.archive/)."
            : "This memory is removed permanently."
        }
        destructive
        loading={removing}
        onCancel={() => !removing && setDeleting(null)}
        onConfirm={() => void remove()}
        open={Boolean(deleting)}
        title={`${deleting?.kind === "skill" ? "Archive" : "Delete"} ${deleting?.label ?? ""}?`}
      />
    </>
  );
}
