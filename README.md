# lookmd

A self-hosted, workspace-scoped Markdown viewer and editor. It opens one folder
(a "workspace") the way VS Code opens a folder, and lets you **read** (rendered),
view **source** (raw), and **edit** the `.md` files inside it. Local-first now,
deployable later.

## Features

- **Workspace picker** — browse folders under a base directory and open one as a
  workspace. Recent and last-used workspaces are remembered per browser.
- **File tree** sidebar with create, rename, and delete (each behind a confirm).
- **Three modes per file** — Read (rendered Markdown), Source (raw, read-only),
  and Edit (CodeMirror 6) — switched by one segmented toggle.
- **Explicit, safe save** — `Ctrl/Cmd-S` or the Save button. Never autosaves.
  Every save is hash-checked: if the file changed on disk since you opened it
  (Obsidian, git, another tab), the save is refused with a conflict prompt
  rather than silently clobbering it. Line endings are preserved.
- **Dirty-buffer guard** — a `●` marks unsaved changes and you're prompted before
  switching files, changing workspace, or closing the tab.
- **Themes & fonts** — four built-in themes (Paper, Daylight, Slate, Sanctum)
  and configurable reading/mono fonts, all token-driven and saved per browser.

## Requirements

- Node.js **22 or newer** (the server runs TypeScript directly via Node's
  built-in type stripping; tests use `node --test`).

## Quick start

```bash
npm install
npm run dev
```

`npm run dev` starts the backend (`127.0.0.1:4317`) and the Vite client
(`localhost:5173`) together. Open the client URL in your browser.

By default the server's **base directory** is the repository's parent folder.
To point it at your own notes, run the server with a base:

```bash
# from the repo root
npm run dev:server -- --base /path/to/your/notes
# or
LOOKMD_BASE=/path/to/your/notes npm run dev:server
```

A workspace is any folder within that base (or the base itself).

## Configuration

The server reads, in order of precedence, a CLI flag/positional, then an
environment variable, then a default:

| Setting   | CLI            | Env             | Default                |
| --------- | -------------- | --------------- | ---------------------- |
| Base dir  | `--base <dir>` | `LOOKMD_BASE`   | current directory      |
| Port      | `--port <n>`   | `LOOKMD_PORT`   | `4317`                 |
| Host      | `--host <h>`   | `LOOKMD_HOST`   | `127.0.0.1`            |
| Read-only | `--read-only`  | `LOOKMD_READ_ONLY` | off (writes enabled) |

In **read-only** mode the write/create/delete/move endpoints are never
registered — the build is genuinely view-only, not just hidden in the UI.

## Security model

The backend is a thin, root-scoped file API; it never renders Markdown. On every
request it:

- resolves the base, the workspace root, and the target to canonical absolute
  paths and verifies `target ⊆ workspace root ⊆ base` (no naive `startsWith`);
- refuses symlinks that resolve outside the root;
- operates only on a `.md` / plain-text allowlist;
- re-validates every path server-side — client confirm dialogs are UX only.

Paths travel over the wire as POSIX-relative strings and are translated to
native paths on the server, so Windows and POSIX hosts behave the same.

## Project layout

```
shared/   API request/response types — the single contract, imported by both ends
server/   Fastify backend: file I/O + path validation only (no business logic)
client/   React + Vite + TypeScript frontend; CodeMirror 6 editor
```

## Scripts

| Command             | What it does                                      |
| ------------------- | ------------------------------------------------- |
| `npm run dev`       | Run server + client together                      |
| `npm run dev:server`| Run only the backend                              |
| `npm run dev:client`| Run only the Vite client                          |
| `npm run build`     | Production build of the client                    |
| `npm test`          | Run all workspace tests                           |
| `npm run typecheck` | Type-check every workspace                        |

## License

MIT
