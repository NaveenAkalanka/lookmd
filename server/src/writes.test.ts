import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.ts';
import type { Config } from './config.ts';
import type {
  CreateFileResponse,
  DeleteFileResponse,
  MoveResponse,
  ApiError,
} from '@lookmd/shared';

let tmp: string;
let base: string;
let app: FastifyInstance;

const WS = 'ws';
const wsAbs = (rel: string) => path.join(base, WS, rel);

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lookmd-writes-'));
  base = fs.realpathSync.native(tmp);
  app = buildApp({ base, host: '127.0.0.1', port: 0, allowWrite: true });
  await app.ready();
});

after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  fs.rmSync(path.join(base, WS), { recursive: true, force: true });
  fs.mkdirSync(path.join(base, WS), { recursive: true });
});

describe('POST /api/file (create)', () => {
  it('creates an empty file and returns 201 + hash', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/file',
      payload: { root: WS, path: 'new.md' },
    });
    assert.equal(res.statusCode, 201);
    const body = res.json() as CreateFileResponse;
    assert.equal(body.path, 'new.md');
    assert.match(body.hash, /^[0-9a-f]{64}$/);
    assert.equal(fs.readFileSync(wsAbs('new.md'), 'utf8'), '');
  });

  it('creates from initial content, making parent folders', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/file',
      payload: { root: WS, path: 'a/b/deep.md', content: '# Deep\n' },
    });
    assert.equal(res.statusCode, 201);
    assert.equal(fs.readFileSync(wsAbs('a/b/deep.md'), 'utf8'), '# Deep\n');
  });

  it('409s if the file already exists', async () => {
    fs.writeFileSync(wsAbs('dup.md'), 'x');
    const res = await app.inject({
      method: 'POST',
      url: '/api/file',
      payload: { root: WS, path: 'dup.md' },
    });
    assert.equal(res.statusCode, 409);
    assert.equal((res.json() as ApiError).code, 'ALREADY_EXISTS');
  });

  it('400s on a disallowed type, 403 on escape', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/file', payload: { root: WS, path: 'x.exe' } });
    assert.equal((bad.json() as ApiError).code, 'DISALLOWED_TYPE');
    const esc = await app.inject({ method: 'POST', url: '/api/file', payload: { root: WS, path: '../x.md' } });
    assert.equal(esc.statusCode, 403);
  });
});

describe('DELETE /api/file', () => {
  it('deletes an existing file', async () => {
    fs.writeFileSync(wsAbs('gone.md'), 'bye');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/file',
      payload: { root: WS, path: 'gone.md' },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json() as DeleteFileResponse, { path: 'gone.md', deleted: true });
    assert.equal(fs.existsSync(wsAbs('gone.md')), false);
  });

  it('404s for a missing file', async () => {
    const res = await app.inject({ method: 'DELETE', url: '/api/file', payload: { root: WS, path: 'ghost.md' } });
    assert.equal(res.statusCode, 404);
    assert.equal((res.json() as ApiError).code, 'NOT_FOUND');
  });

  it('refuses to delete a directory', async () => {
    fs.mkdirSync(wsAbs('folder.md')); // a dir that happens to pass the ext allowlist
    const res = await app.inject({ method: 'DELETE', url: '/api/file', payload: { root: WS, path: 'folder.md' } });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as ApiError).code, 'INVALID_PATH');
  });
});

describe('POST /api/move (rename)', () => {
  it('renames a file', async () => {
    fs.writeFileSync(wsAbs('old.md'), 'content');
    const res = await app.inject({
      method: 'POST',
      url: '/api/move',
      payload: { root: WS, from: 'old.md', to: 'renamed.md' },
    });
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json() as MoveResponse, { from: 'old.md', to: 'renamed.md' });
    assert.equal(fs.existsSync(wsAbs('old.md')), false);
    assert.equal(fs.readFileSync(wsAbs('renamed.md'), 'utf8'), 'content');
  });

  it('moves into a new subfolder, creating it', async () => {
    fs.writeFileSync(wsAbs('top.md'), 'x');
    const res = await app.inject({
      method: 'POST',
      url: '/api/move',
      payload: { root: WS, from: 'top.md', to: 'sub/moved.md' },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(fs.readFileSync(wsAbs('sub/moved.md'), 'utf8'), 'x');
  });

  it('404s when the source is missing', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/move',
      payload: { root: WS, from: 'nope.md', to: 'x.md' },
    });
    assert.equal(res.statusCode, 404);
  });

  it('409s when the destination already exists', async () => {
    fs.writeFileSync(wsAbs('a.md'), '1');
    fs.writeFileSync(wsAbs('b.md'), '2');
    const res = await app.inject({
      method: 'POST',
      url: '/api/move',
      payload: { root: WS, from: 'a.md', to: 'b.md' },
    });
    assert.equal(res.statusCode, 409);
    assert.equal((res.json() as ApiError).code, 'ALREADY_EXISTS');
    // Neither file should be disturbed.
    assert.equal(fs.readFileSync(wsAbs('a.md'), 'utf8'), '1');
    assert.equal(fs.readFileSync(wsAbs('b.md'), 'utf8'), '2');
  });

  it('403s when destination escapes the root', async () => {
    fs.writeFileSync(wsAbs('c.md'), '1');
    const res = await app.inject({
      method: 'POST',
      url: '/api/move',
      payload: { root: WS, from: 'c.md', to: '../escape.md' },
    });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as ApiError).code, 'OUTSIDE_ROOT');
  });
});

describe('write endpoints disabled in read-only build', () => {
  it('POST/DELETE/move all 404 when allowWrite is false', async () => {
    const ro = buildApp({ base, host: '127.0.0.1', port: 0, allowWrite: false });
    await ro.ready();
    try {
      for (const [method, url] of [
        ['POST', '/api/file'],
        ['DELETE', '/api/file'],
        ['POST', '/api/move'],
      ] as const) {
        const res = await ro.inject({ method, url, payload: { root: WS, path: 'x.md', from: 'a', to: 'b' } });
        assert.equal(res.statusCode, 404, `${method} ${url} should not exist`);
      }
    } finally {
      await ro.close();
    }
  });
});
