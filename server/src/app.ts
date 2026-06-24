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

export function buildApp(config: Config): FastifyInstance {
  const app = Fastify({ logger: false });

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
  const staticDir = process.env.LOOKMD_STATIC_DIR;
  if (staticDir && fs.existsSync(staticDir)) {
    app.register(fastifyStatic, { root: path.resolve(staticDir), wildcard: false });
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
