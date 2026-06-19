# CLAUDE.md — lookmd

Standing directives. Read this every session before working on lookmd.

## What lookmd is

A self-hosted, workspace-scoped Markdown viewer and editor. It opens one folder
(a "workspace") the way VS Code opens a folder, and lets you read, view source,
and edit the `.md` files inside it. Local-first now; deployable later.
Project / CLI / package name: `lookmd`. Domain: `look.md`.

## Stack (locked — do not substitute)

- Frontend: React + Vite + TypeScript
- Editor: CodeMirror 6
- Markdown rendering: client-side (`markdown-it` or `react-markdown`). The backend never renders.
- Backend: Node + TypeScript (Fastify preferred, Express acceptable)
- Shared API request/response types in one module, imported by both ends
- Browser persistence: `localStorage` only — no IndexedDB, no cookies, no telemetry
- No Docker for MVP. Run via npm scripts on localhost.

## Architecture

Client + thin backend. Files live on the host filesystem. The backend is a dumb,
root-scoped file API. All Markdown rendering happens in the client.

- The backend launches pointed at a BASE directory (CLI arg or env var).
- A "workspace" is a folder within the base (or the base itself).
- The active workspace root travels with each file request; the backend
  re-validates it on every call.
- Frontend ↔ backend over a small REST API.

### API contract

The operations and the hash-checked save are the contract; choose query-vs-body
sensibly per method.

- `GET /api/folders?path=` — list directories within base (workspace picker)
- `GET /api/tree` — file/folder tree for a workspace, as relative paths
- `GET /api/file` — returns `{ content, hash }` for one file
- `PUT /api/file` — `{ root, path, content, baseHash }`; if on-disk hash differs
  from `baseHash`, return `409`; otherwise write and return the new hash
- `POST /api/file` — create (empty or from template)
- `DELETE /api/file` — delete
- `POST /api/move` — rename / move

## Security — non-negotiable, build it Day 1

Not "later." These go into the first file-touching commit.

- **Root containment**: resolve BASE, the workspace root, and the joined target
  to canonical ABSOLUTE paths, then verify target ⊆ workspace root ⊆ base.
  Never validate with a naive string `startsWith` on un-normalized paths.
- **Cross-platform paths**: handle Windows (`\`, drive letters) and POSIX (`/`).
  Use the platform path module. Send POSIX-style relative paths over the wire,
  translate server-side.
- **Refuse symlinks** that resolve outside the root.
- **File-type allowlist**: operate only on `.md` / plain-text files; reject the rest.
- **Never trust the client.** Frontend confirm dialogs are UX only — the backend
  re-validates every path on every call.
- **Deployment split (later, not MVP)**: a public build is VIEW-ONLY (write/create/
  delete endpoints don't exist in it); the full edit build is gated behind Tailscale.
  For local-first MVP, build the full edit-capable version, but structure the code
  so write endpoints can be disabled by config.

## File handling

- **Three modes per file**: Read (rendered), Source (raw, read-only),
  Edit (raw, editable). One segmented toggle switches between them.
- **Explicit save** (Ctrl/Cmd-S or a button) — never autosave. Use the hash/`409`
  check so external edits (Obsidian, git) are never silently overwritten; on `409`,
  warn the user.
- **Dirty-buffer guard**: prompt before leaving / switching files with unsaved changes.
- **Create and delete** show a clear confirm in the UI before the backend call.
  Delete especially.
- **Preserve line endings** on save (no silent CRLF↔LF normalization).

## Design system — token-driven, zero hardcoding

THE rule: no component hardcodes any color or font. Every visual value reads from a
CSS custom property. A theme is a set of values for those properties; a font choice
sets the font properties. Switching either swaps data only — components never change.

- **Core tokens**: background, surface, text (primary / secondary / tertiary),
  accent, border, plus `--font-read` and `--font-mono`.
- **Layout / DNA (constant across all themes)**: VS Code-style — file-tree sidebar,
  open-file tabs, the Read/Source/Edit toggle. The rendered Read view uses clean
  reading typography (comfortable measure, line-height, real heading scale).
- **Starter themes (4)**:
  - `Paper` — warm light (default light)
  - `Daylight` — cool / crisp light
  - `Slate` — neutral dark (default dark)
  - `Sanctum` — gothic / 40K dark: bone text on near-black, crimson primary accent
    with gold highlights (active file, links)
  Adding a theme = adding one token-value set, nothing else.
- **Fonts**: expose two settings — reading font (`--font-read`) and editor/mono
  font (`--font-mono`). The UI/chrome font stays fixed. Offer a few curated choices
  per slot plus a custom font-family field.
- **Config persistence**: active theme, fonts, recent workspaces, and last-active
  workspace all live in `localStorage`, per browser.

## Conventions

- TypeScript strict mode on both ends. One shared types module for the API.
- Keep the backend thin: file I/O + validation only. No business logic, no rendering.
- Small, reviewable commits — one concern each.

## Out of scope for MVP (do NOT build yet)

- Docker / packaging
- WebSocket / live file-watching (manual refresh is fine)
- Full-filesystem browser (stick to the base-dir-scoped workspace picker)
- Per-workspace settings files
- Auth beyond the future Tailscale gating
- Live split preview while editing (stretch — only if Day 3 has room)

## How to work with me (Naveen)

- One step at a time. Propose the next step, do it, show the result, continue.
- Counsel, don't flatter. If an approach is wrong, say so plainly, with the reason.
- Build first, refine later — except the security and token-foundation rules above,
  which must be right from the start.
- Ask before anything destructive or irreversible.
