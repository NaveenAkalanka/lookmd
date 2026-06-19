import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import {
  isInside,
  resolveInRoot,
  isAllowedFile,
  assertAllowedFile,
  assertNoSymlinkEscape,
  validateFileTarget,
  fromPosix,
  toPosix,
  PathValidationError,
  ALLOWED_EXTENSIONS,
} from './paths.ts';

/** Assert that `fn` throws a PathValidationError with the given code. */
function throwsCode(fn: () => unknown, code: string): void {
  assert.throws(fn, (err: unknown) => {
    assert.ok(err instanceof PathValidationError, `expected PathValidationError, got ${err}`);
    assert.equal(err.code, code, `expected code ${code}, got ${err.code}`);
    return true;
  });
}

// A base that need not exist on disk — resolveInRoot is purely lexical.
const BASE = path.resolve(os.tmpdir(), 'lookmd-base');

describe('isInside', () => {
  const root = path.resolve('/srv/ws');

  it('treats an identical path as inside', () => {
    assert.equal(isInside(root, root), true);
  });

  it('accepts a nested descendant', () => {
    assert.equal(isInside(root, path.join(root, 'a', 'b.md')), true);
  });

  it('rejects the parent directory', () => {
    assert.equal(isInside(root, path.dirname(root)), false);
  });

  it('rejects a sibling that shares a prefix', () => {
    // The classic naive-startsWith bug: "/srv/ws-evil" starts with "/srv/ws".
    assert.equal(isInside(root, path.resolve('/srv/ws-evil/secret.md')), false);
  });

  it('rejects an outside path reachable via ..', () => {
    assert.equal(isInside(root, path.join(root, '..', '..', 'etc')), false);
  });
});

describe('fromPosix / toPosix', () => {
  it('round-trips a relative path on the host separator', () => {
    const native = fromPosix('a/b/c.md');
    assert.equal(native, ['a', 'b', 'c.md'].join(path.sep));
    assert.equal(toPosix(native), 'a/b/c.md');
  });
});

describe('resolveInRoot — happy paths', () => {
  it('resolves a file directly in the root', () => {
    const r = resolveInRoot({ base: BASE, root: 'ws', relPath: 'note.md' });
    assert.equal(r.baseAbs, BASE);
    assert.equal(r.rootAbs, path.join(BASE, 'ws'));
    assert.equal(r.targetAbs, path.join(BASE, 'ws', 'note.md'));
  });

  it('resolves a nested file', () => {
    const r = resolveInRoot({ base: BASE, root: 'ws', relPath: 'a/b/c.md' });
    assert.equal(r.targetAbs, path.join(BASE, 'ws', 'a', 'b', 'c.md'));
  });

  it('treats an empty root as the base itself', () => {
    const r = resolveInRoot({ base: BASE, root: '', relPath: 'note.md' });
    assert.equal(r.rootAbs, BASE);
    assert.equal(r.targetAbs, path.join(BASE, 'note.md'));
  });

  it('treats an empty relPath as the root itself', () => {
    const r = resolveInRoot({ base: BASE, root: 'ws', relPath: '' });
    assert.equal(r.targetAbs, path.join(BASE, 'ws'));
  });

  it('allows .. segments that stay within the root', () => {
    const r = resolveInRoot({ base: BASE, root: 'ws', relPath: 'sub/../note.md' });
    assert.equal(r.targetAbs, path.join(BASE, 'ws', 'note.md'));
  });

  it('supports a deeply nested workspace root', () => {
    const r = resolveInRoot({ base: BASE, root: 'team/docs/ws', relPath: 'x.md' });
    assert.equal(r.rootAbs, path.join(BASE, 'team', 'docs', 'ws'));
    assert.equal(r.targetAbs, path.join(BASE, 'team', 'docs', 'ws', 'x.md'));
  });
});

describe('resolveInRoot — containment violations', () => {
  it('rejects a target escaping the root via ..', () => {
    throwsCode(() => resolveInRoot({ base: BASE, root: 'ws', relPath: '../secret.md' }), 'OUTSIDE_ROOT');
  });

  it('rejects a target escaping all the way out', () => {
    throwsCode(
      () => resolveInRoot({ base: BASE, root: 'ws', relPath: '../../../../etc/passwd' }),
      'OUTSIDE_ROOT',
    );
  });

  it('rejects .. chains that briefly dip inside then escape', () => {
    throwsCode(
      () => resolveInRoot({ base: BASE, root: 'ws', relPath: 'sub/../../escape.md' }),
      'OUTSIDE_ROOT',
    );
  });

  it('rejects a workspace root escaping the base', () => {
    throwsCode(() => resolveInRoot({ base: BASE, root: '../elsewhere', relPath: 'x.md' }), 'OUTSIDE_BASE');
  });
});

describe('resolveInRoot — malformed wire paths', () => {
  it('rejects an absolute POSIX path', () => {
    throwsCode(() => resolveInRoot({ base: BASE, root: 'ws', relPath: '/etc/passwd' }), 'INVALID_PATH');
  });

  it('rejects a drive-letter path', () => {
    throwsCode(() => resolveInRoot({ base: BASE, root: 'ws', relPath: 'C:/Windows/x.md' }), 'INVALID_PATH');
  });

  it('rejects backslash separators', () => {
    throwsCode(() => resolveInRoot({ base: BASE, root: 'ws', relPath: 'a\\b.md' }), 'INVALID_PATH');
  });

  it('rejects a null byte', () => {
    throwsCode(() => resolveInRoot({ base: BASE, root: 'ws', relPath: 'a\0.md' }), 'INVALID_PATH');
  });

  it('rejects malformed roots too', () => {
    throwsCode(() => resolveInRoot({ base: BASE, root: '/abs', relPath: 'x.md' }), 'INVALID_PATH');
  });
});

describe('file-type allowlist', () => {
  it('accepts known markdown/text extensions', () => {
    for (const ext of ALLOWED_EXTENSIONS) {
      assert.equal(isAllowedFile(`note${ext}`), true, `expected ${ext} allowed`);
    }
  });

  it('is case-insensitive', () => {
    assert.equal(isAllowedFile('README.MD'), true);
    assert.equal(isAllowedFile('NOTES.TXT'), true);
  });

  it('rejects non-text extensions', () => {
    for (const name of ['image.png', 'a.exe', 'archive.zip', 'script.js']) {
      assert.equal(isAllowedFile(name), false, `expected ${name} rejected`);
    }
  });

  it('rejects files with no extension', () => {
    assert.equal(isAllowedFile('Makefile'), false);
  });

  it('assertAllowedFile throws DISALLOWED_TYPE', () => {
    throwsCode(() => assertAllowedFile('photo.png'), 'DISALLOWED_TYPE');
  });
});

// --- Filesystem-backed symlink tests ----------------------------------------
// Symlink creation on Windows can require elevation / developer mode. If it
// fails we skip rather than report a false failure.

describe('assertNoSymlinkEscape', () => {
  let tmp: string;
  let base: string;
  let root: string;
  let outside: string;
  let canSymlink = false;

  before(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lookmd-sym-'));
    base = path.join(tmp, 'base');
    root = path.join(base, 'ws');
    outside = path.join(tmp, 'outside');
    fs.mkdirSync(root, { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(root, 'real.md'), '# real\n');
    fs.writeFileSync(path.join(outside, 'secret.md'), '# secret\n');

    try {
      fs.symlinkSync(outside, path.join(root, 'link-dir'), 'junction');
      fs.symlinkSync(path.join(outside, 'secret.md'), path.join(root, 'link-file.md'));
      canSymlink = true;
    } catch {
      canSymlink = false;
    }
  });

  after(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('passes for a genuine file inside the root', () => {
    assert.doesNotThrow(() => assertNoSymlinkEscape(root, path.join(root, 'real.md')));
  });

  it('passes for a not-yet-created file in a real directory', () => {
    assert.doesNotThrow(() => assertNoSymlinkEscape(root, path.join(root, 'new.md')));
  });

  it('rejects a file reached through a symlinked directory', (t) => {
    if (!canSymlink) return t.skip('symlink creation not permitted on this host');
    throwsCode(
      () => assertNoSymlinkEscape(root, path.join(root, 'link-dir', 'secret.md')),
      'SYMLINK_ESCAPE',
    );
  });

  it('rejects a symlinked file pointing outside', (t) => {
    if (!canSymlink) return t.skip('symlink creation not permitted on this host');
    throwsCode(
      () => assertNoSymlinkEscape(root, path.join(root, 'link-file.md')),
      'SYMLINK_ESCAPE',
    );
  });
});

describe('validateFileTarget (composed, lexical only)', () => {
  it('passes containment + allowlist for a valid markdown target', () => {
    const r = validateFileTarget({ base: BASE, root: 'ws', relPath: 'note.md' }, false);
    assert.equal(r.targetAbs, path.join(BASE, 'ws', 'note.md'));
  });

  it('rejects a disallowed type even when containment is fine', () => {
    throwsCode(() => validateFileTarget({ base: BASE, root: 'ws', relPath: 'evil.exe' }, false), 'DISALLOWED_TYPE');
  });

  it('rejects an escaping target before checking type', () => {
    throwsCode(() => validateFileTarget({ base: BASE, root: 'ws', relPath: '../x.md' }, false), 'OUTSIDE_ROOT');
  });
});
