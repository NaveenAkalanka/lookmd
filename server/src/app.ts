/**
 * Fastify application factory. Registers the read endpoints and a single error
 * handler that turns thrown errors into the shared `ApiError` shape. The app is
 * built from a `Config` so tests can inject a temp BASE without a real socket.
 */

import path from 'node:path';
import fs from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';

import type {
  PutFileRequest,
  CreateFileRequest,
  CreateFolderRequest,
  DeleteFileRequest,
  MoveRequest,
} from '@lookmd/shared';
import type { Config } from './config.ts';
import { toApiError, HttpError } from './errors.ts';
import {
  listFolders,
  getTree,
  readFile,
  readAsset,
  writeFile,
  createFile,
  createFolder,
  deleteFile,
  moveFile,
} from './workspace.ts';

function requireString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new HttpError(400, 'INVALID_PATH', `${field} is required`);
  }
  return value;
}

/** Generous cap on a single request body. Comfortably fits large Markdown (and
 *  the code/text files in the allowlist) while bounding per-request memory so a
 *  giant POST/PUT can't exhaust the server. The Fastify default is only 1 MB,
 *  which silently 413s legitimate large saves. */
const BODY_LIMIT_BYTES = 25 * 1024 * 1024;

/**
 * Document Content-Security-Policy for the served SPA (production single-origin
 * only). Tuned to exactly what the built client needs:
 *   - script-src 'self'      — the build emits only an external module script
 *                              (verified: no inline <script> in index.html).
 *   - style-src 'unsafe-inline' — CodeMirror and React inject inline styles.
 *   - img-src … https:        — Markdown may reference external image URLs; blob:
 *                              covers File System Access object URLs.
 *   - connect-src 'self'      — fetch /api and the same-origin /ws WebSocket.
 * Everything else is locked to 'self' / 'none'. The dev server (Vite) never
 * serves through here, so this can't interfere with HMR.
 */
const APP_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'none'",
].join('; ');

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({ logger: false, bodyLimit: BODY_LIMIT_BYTES });

  // Whether this process also serves the built client (production single-origin).
  // Computed once so the header hook and the static registration agree.
  const staticDir = process.env.LOOKMD_STATIC_DIR;
  const serveStatic = !!(staticDir && fs.existsSync(staticDir));

  // Baseline hardening headers on every response (incl. errors and static
  // assets). Cheap, never breaks a same-origin SPA, and closes MIME-sniffing
  // and clickjacking vectors. Set early so all later handlers inherit them.
  app.addHook('onRequest', async (_req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    // Document CSP only when we serve the SPA. (/api/raw overrides this with its
    // own stricter sandbox CSP inside its handler.)
    if (serveStatic) reply.header('Content-Security-Policy', APP_CSP);
  });

  app.get('/api/health', async () => ({ ok: true, allowWrite: config.allowWrite }));

  app.get('/api/folders', async (req) => {
    const { path = '' } = req.query as { path?: string };
    return listFolders(config.base, path);
  });

  app.get('/api/tree', async (req) => {
    const { root = '' } = req.query as { root?: string };
    return getTree(config.base, root);
  });

  app.get('/api/file', async (req) => {
    const { root = '', path = '' } = req.query as { root?: string; path?: string };
    return readFile(config.base, root, path);
  });

  // Raw image bytes for inline rendering in the Read view (read-only).
  app.get('/api/raw', async (req, reply) => {
    const { root = '', path = '' } = req.query as { root?: string; path?: string };
    const { buffer, contentType } = await readAsset(config.base, root, path);
    reply.header('content-type', contentType);
    reply.header('cache-control', 'no-cache');
    // Defuse SVG (and any future text-ish image type): embedded as <img> these
    // bytes are inert, but navigating directly to this URL would render an SVG
    // as a *document* in our origin and run any <script> inside it. A sandbox
    // CSP with no allowed sources blocks script/plugins/navigation on that
    // document while leaving normal <img> embedding untouched.
    reply.header('content-security-policy', "default-src 'none'; sandbox");
    return reply.send(buffer);
  });

  // Write endpoints exist only when writes are enabled (deployment split: a
  // view-only build simply never registers them).
  if (config.allowWrite) {
    app.put('/api/file', async (req) => {
      const body = (req.body ?? {}) as Partial<PutFileRequest>;
      const root = typeof body.root === 'string' ? body.root : '';
      const path = requireString(body.path, 'path');
      const content = requireString(body.content, 'content');
      const baseHash = requireString(body.baseHash, 'baseHash');
      return writeFile(config.base, root, path, content, baseHash);
    });

    app.post('/api/file', async (req, reply) => {
      const body = (req.body ?? {}) as Partial<CreateFileRequest>;
      const root = typeof body.root === 'string' ? body.root : '';
      const path = requireString(body.path, 'path');
      const content = typeof body.content === 'string' ? body.content : '';
      reply.code(201);
      return createFile(config.base, root, path, content);
    });

    app.post('/api/folder', async (req, reply) => {
      const body = (req.body ?? {}) as Partial<CreateFolderRequest>;
      const root = typeof body.root === 'string' ? body.root : '';
      const path = requireString(body.path, 'path');
      reply.code(201);
      return createFolder(config.base, root, path);
    });

    app.delete('/api/file', async (req) => {
      const body = (req.body ?? {}) as Partial<DeleteFileRequest>;
      const root = typeof body.root === 'string' ? body.root : '';
      const path = requireString(body.path, 'path');
      return deleteFile(config.base, root, path);
    });

    app.post('/api/move', async (req) => {
      const body = (req.body ?? {}) as Partial<MoveRequest>;
      const root = typeof body.root === 'string' ? body.root : '';
      const from = requireString(body.from, 'from');
      const to = requireString(body.to, 'to');
      return moveFile(config.base, root, from, to);
    });
  }

  // Serve the built client (single-origin deploy). Enabled only when
  // LOOKMD_STATIC_DIR points at the client build — dev and tests leave it unset,
  // so they keep the pure-API behaviour. Non-asset GETs fall back to index.html
  // so a refresh on any path still loads the SPA; /api and /ws keep JSON 404s.
  if (serveStatic) {
    app.register(fastifyStatic, { root: path.resolve(staticDir!), wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/ws')) {
        return reply.sendFile('index.html');
      }
      reply.code(404).send({ error: `not found: ${req.url}`, code: 'NOT_FOUND' });
    });
  }

  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = toApiError(err);
    reply.code(status).send(body);
  });

  return app;
}
