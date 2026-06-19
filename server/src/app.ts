/**
 * Fastify application factory. Registers the read endpoints and a single error
 * handler that turns thrown errors into the shared `ApiError` shape. The app is
 * built from a `Config` so tests can inject a temp BASE without a real socket.
 */

import Fastify, { type FastifyInstance } from 'fastify';

import type { Config } from './config.ts';
import { toApiError } from './errors.ts';
import { listFolders, getTree, readFile } from './workspace.ts';

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

  app.setErrorHandler((err, _req, reply) => {
    const { status, body } = toApiError(err);
    reply.code(status).send(body);
  });

  return app;
}
