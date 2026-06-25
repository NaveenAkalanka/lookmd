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
- Browser persistence: `localStorage` only — no cookies, no telemetry. **One
  deliberate exception:** the File System Access directory-handle store uses
  IndexedDB (handles aren't JSON-serializable), so a granted local folder
  survives reload. Nothing else may use IndexedDB.
- Local dev runs via npm scripts on localhost. A single-origin Docker image now
  also exists (multi-stage `Dockerfile` — the Fastify server serves the built
  client and the API on one port) for Coolify / any Docker host. Docker is no
  longer out of scope; keep the npm-scripts path as the primary local workflow.

## Architecture

Client + thin backend. Files live on the host filesystem. The backend is a dumb,
root-scoped file API. All Markdown rendering happens in the client.

- The backend launches pointed at a BASE directory (CLI arg or env var).
- A "workspace" is a folder within the base (or the base itself).
- The active workspace root travels with each file request; the backend
  re-validates it on every call.
- Frontend ↔ backend over a small REST API.

### File sources (client-side adapter)

The client addresses files through a `FileSource` interface (`client/src/sources`):
`tree / file / save / create / remove / move`, bound to one workspace. Two
implementations exist behind it, so the UI never knows which is active:

- **`rest`** — the Node backend above. Local-first, and the Tailscale edit build.
- **`fsa`** — the browser File System Access API. All file I/O runs client-side
  against a directory handle the user grants, so a statically-hosted build can
  edit folders on the *viewer's own machine* with no server in the loop.
  Chromium-only; the UI hides it elsewhere. It mirrors the REST semantics
  exactly (allowlist, skip rules, ordering, the sha256/409 save check).

A remote server can never reach a viewer's local disk — that's a browser
boundary, not a lookmd one. The `fsa` source is the only way to edit local
files from a hosted build.

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
- **FSA source boundary**: for the File System Access source there is no server
  to trust or distrust — the browser's own folder-permission grant *is* the
  sandbox, and segment lookups can't escape the chosen directory. It still
  enforces the same extension allowlist client-side.
- **Deployment split**: a public build is VIEW-ONLY (write/create/delete endpoints
  don't exist in it); the full edit build is gated behind Tailscale. The config
  switch exists now — `LOOKMD_READ_ONLY` (env) / `--read-only` (CLI) leaves the
  write endpoints unregistered. The full edit-capable version is the default.
- **Production CSP**: when the server serves the built client (`LOOKMD_STATIC_DIR`),
  it sends a document-level Content-Security-Policy plus baseline hardening
  headers; raw image assets get their own stricter sandbox CSP. Dev (Vite) is
  unaffected.

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

- Server-side full-filesystem browser (the *server* picker stays base-scoped).
  Note: opening a local folder client-side via the File System Access source is
  now supported — that's the browser's native picker, not a server endpoint.
- Per-workspace settings files
- Auth beyond the future Tailscale gating

### Already built (no longer out of scope)

- Docker / packaging — single-origin image for Coolify (see Stack note above).
- WebSocket / live file-watching — implemented (`server/src/watcher.ts`); the
  client reloads clean open files and flags dirty ones on external change.
- Live split preview while editing — a split view exists.

## How to work with me (Naveen)

- One step at a time. Propose the next step, do it, show the result, continue.
- Counsel, don't flatter. If an approach is wrong, say so plainly, with the reason.
- Build first, refine later — except the security and token-foundation rules above,
  which must be right from the start.
- Ask before anything destructive or irreversible.
