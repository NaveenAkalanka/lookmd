/**
 * WebSocket-based live file watcher. One watcher per connected client, scoped
 * to the workspace root they request. Sends two event shapes:
 *
 *   { type: 'tree' }            — a file/folder was added, removed, or renamed;
 *                                 the client should reload the file tree.
 *   { type: 'change', path }    — a tracked file's content changed; the client
 *                                 should reload the file if it's open and clean,
 *                                 or flag a conflict if it has unsaved edits.
 *
 * Root validation uses the same containment + symlink logic as every other
 * request so the watcher cannot escape the base directory.
 */

import { WebSocketServer, type WebSocket } from 'ws';
import chokidar, { type FSWatcher } from 'chokidar';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { URL } from 'node:url';
import { resolveInRoot, assertNoSymlinkEscape, toPosix, isAllowedFile } from './security/paths.ts';
import { PathValidationError } from './security/paths.ts';

/** Debounce rapid filesystem bursts so we don't flood the client. */
function debounce<T extends (...args: never[]) => void>(fn: T, ms: number): T {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return ((...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; fn(...args); }, ms);
  }) as T;
}

function send(ws: WebSocket, msg: object): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

export function attachWatcher(
  server: import('node:http').Server,
  base: string,
): void {
  const wss = new WebSocketServer({ noServer: true });

  // Upgrade HTTP → WebSocket only for /ws paths.
  server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host ?? 'localhost'}`);
    const root = url.searchParams.get('root') ?? '';

    // Validate the root the same way as every other endpoint.
    let rootAbs: string;
    try {
      const resolved = resolveInRoot({ base, root, relPath: '' });
      assertNoSymlinkEscape(resolved.baseAbs, resolved.rootAbs);
      rootAbs = resolved.rootAbs;
    } catch (err) {
      const msg = err instanceof PathValidationError ? err.message : 'invalid root';
      ws.close(1008, msg);
      return;
    }

    let watcher: FSWatcher | null = null;

    const onTree = debounce(() => send(ws, { type: 'tree' }), 80);

    const onChange = debounce((absPath: string) => {
      const rel = path.relative(rootAbs, absPath);
      if (!rel || rel.startsWith('..')) return;
      if (!isAllowedFile(absPath)) return;
      send(ws, { type: 'change', path: toPosix(rel) });
    }, 80);

    watcher = chokidar.watch(rootAbs, {
      ignoreInitial: true,
      ignored: /(^|[/\\])(\..|node_modules)/,
      persistent: false,
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });

    watcher
      .on('add', onTree)
      .on('unlink', onTree)
      .on('addDir', onTree)
      .on('unlinkDir', onTree)
      .on('change', onChange);

    ws.on('close', () => {
      void watcher?.close();
      watcher = null;
    });

    ws.on('error', () => {
      void watcher?.close();
      watcher = null;
    });
  });
}
