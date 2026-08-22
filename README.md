# PR #70309 screenshots

Feature screenshots for https://github.com/NousResearch/hermes-agent/pull/70309
(journey star map / memory-provider integration). This orphan branch exists
only to host the images referenced by the PR body.

## 01–11 — synthetic sandbox

Captured against a fully synthetic sandbox (invented skills, memories, and
provider conclusions — no real user data): the core journey feature set —
slash command, star map, search/filter, provenance drill-down, source corpus,
and the `/recall` flow.

## 12–13 — multi-profile consolidation

The multi-profile selector and cross-profile insert only render when 2+
profiles are selected, so these two were captured against a running desktop
build in multi-profile mode. They are framed tightly on the UI chrome (the
"Select bots" selector and the node context menu); individual node labels are
not legible and no memory content is shown. The only readable text is the
control labels themselves and a public bundled skill name (`kanban-worker`).

- `12-multi-profile-selector.png` — the "Select bots" selector open, two
  profiles merged on one map.
- `13-cross-profile-insert.png` — right-clicking a node in multi-profile mode
  exposes the "Insert into <profile>" cross-profile action.
