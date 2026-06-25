<div align="center">

<img src="client/public/lookmd-icon.svg" alt="lookmd" width="116" height="116" />

# lookmd

**A self-hosted, workspace-scoped Markdown viewer & editor.**
It opens one folder the way VS Code opens a folder — then lets you *read*,
view *source*, and *edit* the Markdown inside it. Local-first now, deployable
anywhere later.

<br/>

![License](https://img.shields.io/badge/license-MIT-ee6e4f)
![Node](https://img.shields.io/badge/node-%E2%89%A522-313f49)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6)
![React](https://img.shields.io/badge/React-19-61dafb)
![Fastify](https://img.shields.io/badge/Fastify-5-000000)
![Editor](https://img.shields.io/badge/editor-CodeMirror%206-6e6eff)

</div>

---

## Why lookmd

Markdown lives in folders — vaults, repos, notes directories. lookmd treats a
**folder as a workspace** and gives it a fast, themeable reading-and-editing
surface, without importing your files into a database or rewriting them. The
backend is a thin, security-hardened file API that **never renders Markdown**;
all rendering happens in the browser. Your `.md` files are touched only when
*you* save, and never reformatted behind your back.

## Features

### Reading & editing
- **Three modes per file** — **Read** (rendered), **Source** (raw, read-only),
  and **Edit** (CodeMirror 6) — one segmented toggle switches between them, plus
  an optional **split** view.
- **Rich Markdown** — GFM tables, task lists, autolinks, `[[wiki-links]]`,
  inline images, heading anchors, and an **outline** for quick navigation.
- **Rich code blocks** in Read — language badge, one-click copy, and line
  numbers, with deep, multi-token **syntax highlighting** that recolors per theme.
- **Content zoom** — scale the reading/editing surface in or out
  (`Ctrl/Cmd +/-/0`), remembered per browser.

### Annotate (temporary marking overlay)
- A toggleable **vector overlay** to draw over any file without changing it:
  **pen, highlighter, arrow, line, box, and text notes**.
- **Select, move, recolor, resize, erase**, and full **undo / redo** history.
- Ephemeral by default; a **📌 keep** toggle persists a file's marks to the
  browser. The document on disk is never modified.

### Safety & sync
- **Explicit, hash-checked save** — `Ctrl/Cmd-S`, never autosave. If the file
  changed on disk since you opened it (git, Obsidian, another tab), the save is
  refused with a conflict prompt instead of clobbering it. **Line endings are
  preserved.**
- **Dirty-buffer guard** — unsaved changes are marked and confirmed before you
  switch files, change workspace, or close the tab.
- **Live file-watching** — external changes stream in over WebSocket; a clean
  open file reloads, a dirty one is flagged.
- **Cross-tab live-sync** — theme, fonts, zoom, and kept annotations stay
  consistent across every open tab of the same origin.

### Look & feel
- **34 built-in themes** — **17 light** (Paper, Daylight, GitHub Light, One
  Light, Ayu Light, Sepia, Snow, …) and **17 dark** (Slate, Nord, Dracula, Tokyo
  Night, Carbon/OLED, Abyss, Noir, …), every value token-driven so themes swap
  data, not components.
- **Configurable fonts** for reading and editor/mono slots, with curated choices
  plus a custom field.
- **Smooth, restrained motion** — short, eased transitions that respect
  `prefers-reduced-motion`.
- **File-type toggles** — choose which file types appear in the tree (Markdown
  always shown).

## Requirements

- **Node.js 22 or newer.** The server runs TypeScript directly via Node's
  built-in type stripping (no build step); tests use `node --test`.

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts the backend (`127.0.0.1:4317`) and the Vite client
(`localhost:5173`) together. Open the client URL in your browser.

By default the server's **base directory** is the repository's parent folder.
To point it at your own notes:

```bash
# from the repo root
npm run dev:server -- --base /path/to/your/notes
# or
LOOKMD_BASE=/path/to/your/notes npm run dev:server
```

A *workspace* is any folder within that base (or the base itself).

## Configuration

The server reads, in order of precedence: a CLI flag/positional → an environment
variable → a default.

| Setting   | CLI                | Env                  | Default            |
| --------- | ------------------ | -------------------- | ------------------ |
| Base dir  | `--base <dir>`     | `LOOKMD_BASE`        | current directory  |
| Port      | `--port <n>`       | `LOOKMD_PORT`        | `4317`             |
| Host      | `--host <h>`       | `LOOKMD_HOST`        | `127.0.0.1`        |
| Read-only | `--read-only`      | `LOOKMD_READ_ONLY`   | off (writes on)    |
| Static dir| —                  | `LOOKMD_STATIC_DIR`  | unset (API only)   |

In **read-only** mode the write/create/delete/move endpoints are never
registered — the build is genuinely view-only, not just hidden in the UI.

## Deployment

The repo ships a multi-stage **`Dockerfile`** that builds a single-origin image:
one Fastify process serves both the built client *and* the file API, so there's
no CORS or proxy to configure. It's ready for **Coolify** or any Docker host.

```bash
docker build -t lookmd .
docker run -p 4317:4317 -v /path/to/notes:/data lookmd
```

Mount your notes at `/data` (the default `LOOKMD_BASE`). Set
`LOOKMD_READ_ONLY=1` for a public, view-only deployment.

## Security model

The backend is a thin, root-scoped file API; it never renders Markdown. On every
request it:

- resolves the base, the workspace root, and the target to canonical absolute
  paths and verifies `target ⊆ workspace root ⊆ base` (via `path.relative`, never
  a naive `startsWith`);
- **refuses symlinks** that resolve outside the root, and guards the tree walk
  against symlink cycles and pathological depth;
- operates only on a **plain-text / Markdown allowlist**;
- re-validates every path server-side — client confirm dialogs are UX only;
- sets baseline **hardening headers** (`nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy`) and serves raw image assets under a locked-down sandbox CSP,
  so a malicious SVG can't execute script in the app's origin.

Paths travel over the wire as POSIX-relative strings and are translated to native
paths on the server, so Windows and POSIX hosts behave identically. The browser
stores only `localStorage` (plus one IndexedDB entry for File System Access
folder handles) — no cookies, no telemetry.

## Opening a local folder

The client talks to files through a `FileSource` interface with two backends, so
the editor behaves identically either way:

- **Server (REST)** — the Node backend above. Use this when lookmd runs on the
  machine that holds your notes (local-first, or reached over a private tunnel
  like Tailscale).
- **Local folder (File System Access)** — on Chromium browsers (Chrome, Edge,
  Brave, Opera), **Open a local folder…** edits a folder on *your own device*.
  All reads and writes happen in the browser against a handle you grant; the
  server is never involved. The handle is remembered (in IndexedDB) so you don't
  re-pick it on reload.

> A remote server can never reach files on your laptop — that's a browser
> security boundary, not a lookmd limitation. Use local-folder mode to edit
> *local* files from a hosted build; use REST mode for files that live *on the
> server*. File System Access needs a secure context (HTTPS or `localhost`) and
> is unavailable on Firefox and Safari.

## Project layout

```
shared/   API request/response types — the single contract, imported by both ends
server/   Fastify backend: file I/O + path validation only (no business logic)
client/   React + Vite + TypeScript frontend; CodeMirror 6 editor
```

## Scripts

| Command               | What it does                         |
| --------------------- | ------------------------------------ |
| `npm run dev`         | Run server + client together         |
| `npm run dev:server`  | Run only the backend                 |
| `npm run dev:client`  | Run only the Vite client             |
| `npm run build`       | Production build of the client       |
| `npm test`            | Run all workspace tests              |
| `npm run typecheck`   | Type-check every workspace           |

## Credits

Designed & developed by **Naveen Akalanka**.

- ☕ [Buy me a coffee](https://buymeacoffee.com/naveenakalanka)
- 💼 [LinkedIn](https://www.linkedin.com/in/naveen-akalanka)

## License

[MIT](./LICENSE) © Naveen Akalanka
