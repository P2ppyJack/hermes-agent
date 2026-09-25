# Star Journey — web dashboard

Star Journey adds a full-screen, theme-aware learning-graph view at
`/starjourney`. It is a standalone dashboard/TUI change and does not require
provider-aware desktop Journey support.

## Why this change exists

The dashboard already exposes generic learning graph and node APIs. This view
makes their contents navigable without moving the browser to another app:
search and filter, inspect relationships and dates, and return to the existing
chat. The render engine is a self-contained dashboard copy of the desktop
engine. It does not add a memory provider or change model routing.

![Desktop view with synthetic fixture data](images/starjourney/desktop-fixture.png)

## Opening and leaving

- Open `/starjourney` directly on the dashboard host.
- In the embedded TUI, `/journey` offers a same-dashboard link.
- `/starjourney` emits a timestamped, one-shot navigation message consumed by
  the dashboard. Replayed, stale, and cross-origin navigation payloads are
  rejected. Reverse-proxy path prefixes are retained.
- Close returns through browser history, with a dashboard-root fallback when
  no history exists. There is deliberately no additional main navigation item.

The browser-facing URL is passed to the TUI through
`HERMES_DASHBOARD_ORIGIN` after the existing WebSocket origin validation.
Native terminals without that browser context keep text-mode guidance.

## Responsibilities and optional features

| Component | Responsibility |
|---|---|
| Existing `/api/learning/graph` | Supplies the selected profile's graph |
| Dashboard engine | Canvas layout, timeline, colors, pan/zoom and selection |
| Search sidebar | Local filtering, saved searches and search history |
| Existing node APIs | Node details and supported edit/delete operations |
| Optional provider endpoints | Provenance and source-session operations when available |
| Optional recall endpoint | Builds the reviewable text; absence hides the recall action |
| PTY bridge | Maintains replay/readiness state and transports the draft |

Provider entries remain read-only in this UI. Provider provenance, session
materialization, and recall depend on backend capabilities: an absent endpoint
is not evidence that those features are installed.

The graph view itself does not submit a model request. It does **not** imply
that the underlying memory or skills cost zero prompt tokens: normal Hermes
memory/context loading continues independently.

## Recall safety boundary

A supported recall action fetches a draft, stores it once in tab-local
`sessionStorage`, and returns to chat. The composer handoff:

1. Binds the pending text to the active profile and clears it when scope changes.
2. Waits for the PTY bracketed-paste readiness marker; OFF markers revoke
   readiness and a later ON marker permits another quiet-window attempt.
3. Waits for 450 ms of quiet. The maximum wait is 12 seconds. If still unready,
   it drops the pending draft and shows a notice; it never pastes merely
   because the deadline elapsed.
4. Removes terminal control characters from recalled text, then frames it as
   one bracketed paste, without appending Enter. Ordinary Unicode and line
   breaks are retained.
5. Preserves a pending draft on a failed socket send for a same-scope reconnect.

The user still reviews and submits the draft. This transport boundary is not a
guarantee against prompt injection: retrieved content remains untrusted, and
provider/backend safeguards are separate from the browser's framing logic.

![390-pixel-wide view with synthetic fixture data](images/starjourney/mobile-fixture.png)

## Build

Use an isolated checkout and the repository's pinned dependency installation.
If lifecycle scripts were skipped, build the local Ink workspace first:

```bash
npm run build:ink --workspace ui-tui
npm run build --workspace ui-tui
npm run typecheck --workspace ui-tui
npm run build --workspace web
npm exec --workspace web -- vitest run
npm exec --workspace ui-tui -- vitest run
HERMES_TEST_FILE_RETRIES=0 bash scripts/run_tests.sh \
  tests/hermes_cli/test_journey_render.py \
  tests/hermes_cli/test_journey_star_map_link.py \
  tests/hermes_cli/test_pty_session.py
```
