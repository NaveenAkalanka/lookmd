# PLAN.md — lookmd MVP

## Goal

Ship a working, local-first, workspace-scoped Markdown viewer/editor in ~3 focused
days. UI-first, so there's always something running to test — but backend
correctness (security + file handling) is where the engineering investment goes.

## MVP definition (done = all of these are true)

- Open a workspace folder; switch workspaces; recents remembered (`localStorage`).
- File-tree sidebar; open files into tabs.
- Three modes per file — Read / Source / Edit — with a toggle.
- Explicit save with hash-based conflict detection.
- Create / delete / rename with confirm dialogs; backend re-validates every path.
- 4 themes (Paper, Daylight, Slate, Sanctum) + reading-font and mono-font settings,
  all token-driven.
- Path security: canonical in-root checks, symlink refusal, `.md`/text only,
  cross-platform.

## Build-order principle

Stand up a **thin real backend from hour one** — no mocks. The UI gives you
something to look at; the backend is where the rigor lives.

---

## Day 1 — Skeleton that runs end to end

**Backend**
- Scaffold (Node/TS + Vite/React/TS, shared types module).
- BASE config (CLI arg / env). Write the canonical-path + in-root validation
  helper **and unit-test it before any read endpoint exists.**
- `GET /api/folders`, `GET /api/tree`, `GET /api/file` (returns content + hash).

**Frontend**
- Workspace picker + welcome / empty state; `localStorage` recents + last-active.
- File-tree sidebar; click to open.
- Read mode (client-side Markdown render).

**Win condition:** launch → open a folder → click a file → read it rendered. It works.

---

## Day 2 — Backend depth (the priority)

- Source mode (raw, read-only) and Edit mode (CodeMirror 6).
- `PUT /api/file` with hash/`409` conflict check; explicit save; dirty-buffer guard.
- `POST /api/file` (create), `DELETE /api/file` (delete), `POST /api/move` (rename),
  each with a UI confirm dialog.
- Harden: symlink refusal, `.md`/text allowlist, re-validate every path, preserve
  line endings.
- Wire the Read / Source / Edit toggle across the open file.

**Win condition:** full create / read / edit / save / delete / rename — done safely.

---

## Day 3 — Design system + polish

- Token layer: every color and font as a CSS variable; strip any hardcoded values.
- 4 themes as token sets; theme switcher; persists to `localStorage`.
- Reading-font + mono-font settings (curated choices + custom field); persists.
- Read-view typography pass (measure, line-height, heading scale, code blocks).
- States: empty / loading / error; unsaved-changes prompt.
- Edge cases: large files, CRLF/LF, missing file, `409` conflict UX.
- README with run instructions (npm scripts, localhost).

**Win condition:** clean, themes and fonts swap live, usable daily.

---

## Explicitly deferred (v1.1+)

Docker / packaging · WebSocket file-watching · full-filesystem browser ·
per-workspace settings · Tailscale / public-deployment split · live split preview.

## Notes

- 3 days is MVP-tight. It holds **only** if the deferred list stays deferred.
- The two things expensive to retrofit are the **token foundation** and the
  **path-security helpers** — get both right even under time pressure.
