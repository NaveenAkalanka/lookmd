/**
 * Fastify application factory. Registers the read endpoints and a single error
 * handler that turns thrown errors into the shared `ApiError` shape. The app is
 * built from a `Config` so tests can inject a temp BASE without a real socket.
 */

import Fastify, { type FastifyInstance } from 'fastify';

import type { PutFileRequest } from '@lookmd/shared';
import type { Config } from './config.ts';
import { toApiError, HttpError } from './errors.ts';
import { listFolders, getTree, readFile, writeFile } from './workspace.ts';

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
  }

  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = toApiError(err);
    reply.code(status).send(body);
  });

  return app;
}
