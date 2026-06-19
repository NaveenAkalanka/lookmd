import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import type { FastifyInstance } from 'fastify';

import { buildApp } from './app.ts';
import type { Config } from './config.ts';
import type { GetFileResponse, PutFileResponse, ApiError } from '@lookmd/shared';

let tmp: string;
let base: string;
let app: FastifyInstance;

const WS = 'ws';
const FILE = 'note.md';

function abs(rel: string): string {
  return path.join(base, WS, rel);
}

async function readApi(): Promise<GetFileResponse> {
  const res = await app.inject({ method: 'GET', url: `/api/file?root=${WS}&path=${FILE}` });
  return res.json() as GetFileResponse;
}

function putApi(body: unknown) {
  return app.inject({ method: 'PUT', url: '/api/file', payload: body as object });
}

before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lookmd-save-'));
  base = fs.realpathSync.native(tmp);
  fs.mkdirSync(path.join(base, WS), { recursive: true });
  const config: Config = { base, host: '127.0.0.1', port: 0, allowWrite: true };
  app = buildApp(config);
  await app.ready();
});

after(async () => {
  await app.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

beforeEach(() => {
  fs.writeFileSync(abs(FILE), '# Note\noriginal\n');
});

describe('PUT /api/file — happy path', () => {
  it('saves when baseHash matches and returns the new hash', async () => {
    const { hash } = await readApi();
    const res = await putApi({ root: WS, path: FILE, content: '# Note\nupdated\n', baseHash: hash });
    assert.equal(res.statusCode, 200);
    const body = res.json() as PutFileResponse;
    assert.equal(body.path, FILE);
    assert.match(body.hash, /^[0-9a-f]{64}$/);
    assert.notEqual(body.hash, hash);
    assert.equal(fs.readFileSync(abs(FILE), 'utf8'), '# Note\nupdated\n');
  });

  it('preserves CRLF line endings exactly as sent', async () => {
    const { hash } = await readApi();
    const crlf = '# Title\r\nline one\r\nline two\r\n';
    const res = await putApi({ root: WS, path: FILE, content: crlf, baseHash: hash });
    assert.equal(res.statusCode, 200);
    // Read raw bytes to be sure no normalization happened.
    assert.equal(fs.readFileSync(abs(FILE)).toString('binary'), Buffer.from(crlf).toString('binary'));
  });

  it('round-trips: the returned hash is accepted by a subsequent save', async () => {
    const first = await readApi();
    const r1 = await putApi({ root: WS, path: FILE, content: 'v2\n', baseHash: first.hash });
    const h1 = (r1.json() as PutFileResponse).hash;
    const r2 = await putApi({ root: WS, path: FILE, content: 'v3\n', baseHash: h1 });
    assert.equal(r2.statusCode, 200);
  });
});

describe('PUT /api/file — conflict detection', () => {
  it('409s when the file changed on disk since it was read', async () => {
    const { hash } = await readApi();
    // Simulate an external edit (Obsidian/git) after the client read it.
    fs.writeFileSync(abs(FILE), '# Note\nexternally changed\n');

    const res = await putApi({ root: WS, path: FILE, content: 'mine\n', baseHash: hash });
    assert.equal(res.statusCode, 409);
    assert.equal((res.json() as ApiError).code, 'CONFLICT');
    // The external content must be left untouched.
    assert.equal(fs.readFileSync(abs(FILE), 'utf8'), '# Note\nexternally changed\n');
  });

  it('409s on a stale (wrong) baseHash', async () => {
    const res = await putApi({ root: WS, path: FILE, content: 'x\n', baseHash: 'deadbeef' });
    assert.equal(res.statusCode, 409);
    assert.equal((res.json() as ApiError).code, 'CONFLICT');
  });
});

describe('PUT /api/file — validation and safety', () => {
  it('404s when saving a non-existent file (create is POST)', async () => {
    const res = await putApi({ root: WS, path: 'ghost.md', content: 'x', baseHash: 'whatever' });
    assert.equal(res.statusCode, 404);
    assert.equal((res.json() as ApiError).code, 'NOT_FOUND');
  });

  it('400s on a disallowed file type', async () => {
    const res = await putApi({ root: WS, path: 'evil.exe', content: 'x', baseHash: 'x' });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as ApiError).code, 'DISALLOWED_TYPE');
  });

  it('403s on a traversal escape', async () => {
    const res = await putApi({ root: WS, path: '../escape.md', content: 'x', baseHash: 'x' });
    assert.equal(res.statusCode, 403);
    assert.equal((res.json() as ApiError).code, 'OUTSIDE_ROOT');
  });

  it('400s when required fields are missing', async () => {
    const res = await putApi({ root: WS, path: FILE });
    assert.equal(res.statusCode, 400);
    assert.equal((res.json() as ApiError).code, 'INVALID_PATH');
  });
});

describe('PUT /api/file — disabled in read-only build', () => {
  it('is not registered when allowWrite is false', async () => {
    const ro = buildApp({ base, host: '127.0.0.1', port: 0, allowWrite: false });
    await ro.ready();
    try {
      const res = await ro.inject({
        method: 'PUT',
        url: '/api/file',
        payload: { root: WS, path: FILE, content: 'x', baseHash: 'x' },
      });
      assert.equal(res.statusCode, 404); // route does not exist
    } finally {
      await ro.close();
    }
  });
});
