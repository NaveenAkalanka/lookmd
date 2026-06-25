import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.ts';
import type { Config } from './config.ts';
import type {
  ListFoldersResponse,
  GetTreeResponse,
  GetFileResponse,
  TreeNode,
  ApiError,
} from '@lookmd/shared';

/**
 * Fixture layout under BASE:
 *   base/
 *     other.md
 *     ws/
 *       note.md            ("# Note\r\nbody\n"  — mixed endings on purpose)
 *       image.png
 *       .hidden/secret.md
 *       node_modules/pkg/readme.md
 *       sub/deep.md
 */
let tmp: string;
let base: string;
let app: FastifyInstance;

function flatten(nodes: TreeNode[], acc: string[] = []): string[] {
  for (const n of nodes) {
    acc.push(n.path);
    if (n.children) flatten(n.children, acc);
  }
  return acc;
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lookmd-app-'));
  base = fs.realpathSync.native(tmp);
  const ws = path.join(base, 'ws');
  fs.mkdirSync(path.join(ws, '.hidden'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'node_modules', 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(ws, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(base, 'other.md'), '# other\n');
  fs.writeFileSync(path.join(ws, 'note.md'), '# Note\r\nbody\n');
  fs.writeFileSync(path.join(ws, 'image.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  fs.writeFileSync(path.join(ws, '.hidden', 'secret.md'), '# secret\n');
  fs.writeFileSync(path.join(ws, 'node_modules', 'pkg', 'readme.md'), '# dep\n');
  fs.writeFileSync(path.join(ws, 'sub', 'deep.md'), '# deep\n');

  const config: Config = { base, host: '127.0.0.1', port: 0, allowWrite: true };
  app = buildApp(config);
  await app.ready();
});

after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('GET /api/health', () => {
  it('reports status and write mode', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), { ok: true, allowWrite: true });
  });

  it('sets baseline hardening headers on every response', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
    assert.equal(res.headers['x-frame-options'], 'DENY');
    assert.equal(res.headers['referrer-policy'], 'no-referrer');
  });
});

describe('GET /api/folders', () => {
  it('lists directories at BASE, skipping files', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/folders' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as ListFoldersResponse;
    assert.equal(body.path, '');
    assert.equal(body.parent, null);
    assert.deepEqual(body.folders.map((f) => f.name), ['ws']);
  });

  it('lists sub-directories, skipping hidden and node_modules', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/folders?path=ws' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as ListFoldersResponse;
    assert.equal(body.parent, '');
    // .hidden and node_modules skipped; only sub remains
    assert.deepEqual(body.folders.map((f) => f.name), ['sub']);
    assert.deepEqual(body.folders.map((f) => f.path), ['ws/sub']);
  });

  it('404s for a missing folder', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/folders?path=nope' });
    assert.equal(res.statusCode, 404);
    assert.equal((res.json() as ApiError).code, 'NOT_FOUND');
  });

  it('403s for an escape attempt', async () => {
    // For /folders the workspace root is BASE itself, so escaping it trips the
    // target-vs-root check (OUTSIDE_ROOT), still a 403.
    const res = await app.inject({ method: 'GET', url: '/api/folders?path=..' });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as ApiError).code, 'OUTSIDE_ROOT');
  });
});

describe('GET /api/tree', () => {
  it('returns allowed files + dirs, excluding hidden, node_modules, and non-text', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tree?root=ws' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as GetTreeResponse;
    assert.equal(body.root, 'ws');
    const paths = flatten(body.tree);
    assert.ok(paths.includes('note.md'), 'note.md present');
    assert.ok(paths.includes('sub'), 'sub dir present');
    assert.ok(paths.includes('sub/deep.md'), 'nested file present');
    assert.ok(!paths.includes('image.png'), 'png excluded');
    assert.ok(!paths.some((p) => p.includes('.hidden')), 'hidden excluded');
    assert.ok(!paths.some((p) => p.includes('node_modules')), 'node_modules excluded');
  });

  it('orders directories before files', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tree?root=ws' });
    const body = res.json() as GetTreeResponse;
    assert.equal(body.tree[0]?.type, 'dir'); // sub
    assert.equal(body.tree[body.tree.length - 1]?.type, 'file'); // note.md
  });
});

describe('GET /api/file', () => {
  it('returns content and a stable hash, preserving line endings', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/file?root=ws&path=note.md' });
    assert.equal(res.statusCode, 200);
    const body = res.json() as GetFileResponse;
    assert.equal(body.path, 'note.md');
    assert.equal(body.content, '# Note\r\nbody\n'); // CRLF intact
    assert.match(body.hash, /^[0-9a-f]{64}$/);

    const again = await app.inject({ method: 'GET', url: '/api/file?root=ws&path=note.md' });
    assert.equal((again.json() as GetFileResponse).hash, body.hash);
  });

  it('400s on a disallowed file type', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/file?root=ws&path=image.png' });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as ApiError).code, 'DISALLOWED_TYPE');
  });

  it('404s for a missing file', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/file?root=ws&path=ghost.md' });
    assert.equal(res.statusCode, 404);
    assert.equal((res.json() as ApiError).code, 'NOT_FOUND');
  });

  it('403s on a traversal escape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/file?root=ws&path=../other.md',
    });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as ApiError).code, 'OUTSIDE_ROOT');
  });

  it('400s when path is missing', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/file?root=ws' });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as ApiError).code, 'INVALID_PATH');
  });
});

describe('GET /api/raw', () => {
  it('serves an allowed image with its content type', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/raw?root=ws&path=image.png' });
    assert.equal(res.statusCode, 200);
    assert.equal(res.headers['content-type'], 'image/png');
    assert.deepEqual(res.rawPayload, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  });

  it('locks down assets with a sandbox CSP (defuses SVG script on direct nav)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/raw?root=ws&path=image.png' });
    assert.equal(res.headers['content-security-policy'], "default-src 'none'; sandbox");
    assert.equal(res.headers['x-content-type-options'], 'nosniff');
  });

  it('400s on a non-image type', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/raw?root=ws&path=note.md' });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as ApiError).code, 'DISALLOWED_TYPE');
  });

  it('403s on a traversal escape', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/raw?root=ws&path=../other.md' });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as ApiError).code, 'OUTSIDE_ROOT');
  });
});

describe('GET /api/tree — symlink loop safety', () => {
  it('does not hang or crash on a directory symlink cycle', async () => {
    // Build an isolated base with `loopws/self -> loopws` (a cycle inside root).
    const loopBase = fs.realpathSync.native(
      fs.mkdtempSync(path.join(os.tmpdir(), 'lookmd-loop-')),
    );
    const loopWs = path.join(loopBase, 'loopws');
    fs.mkdirSync(loopWs, { recursive: true });
    fs.writeFileSync(path.join(loopWs, 'a.md'), '# a\n');

    let linked = true;
    try {
      fs.symlinkSync(loopWs, path.join(loopWs, 'self'), 'dir');
    } catch {
      linked = false; // Windows without symlink privilege — nothing to test.
    }

    if (linked) {
      const loopApp = buildApp({ base: loopBase, host: '127.0.0.1', port: 0, allowWrite: false });
      await loopApp.ready();
      try {
        const res = await loopApp.inject({ method: 'GET', url: '/api/tree?root=loopws' });
        assert.equal(res.statusCode, 200); // returned at all => no infinite recursion
        const paths = flatten((res.json() as GetTreeResponse).tree);
        assert.ok(paths.includes('a.md'), 'real file still listed');
      } finally {
        await loopApp.close();
      }
    }
    fs.rmSync(loopBase, { recursive: true, force: true });
  });
});

describe('POST /api/folder', () => {
  it('creates a new folder (and nested parents)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/folder',
      payload: { root: 'ws', path: 'notes/2026' },
    });
    assert.equal(res.statusCode, 201);
    assert.deepEqual(res.json(), { path: 'notes/2026', created: true });
    assert.ok(fs.statSync(path.join(base, 'ws', 'notes', '2026')).isDirectory());
  });

  it('409s when the folder already exists', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/folder',
      payload: { root: 'ws', path: 'sub' },
    });
    assert.equal(res.statusCode, 409);
    assert.equal((res.json() as ApiError).code, 'ALREADY_EXISTS');
  });

  it('403s on a traversal escape', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/folder',
      payload: { root: 'ws', path: '../escape' },
    });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as ApiError).code, 'OUTSIDE_ROOT');
  });
});
