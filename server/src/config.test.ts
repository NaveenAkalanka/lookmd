import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

import { loadConfig, resolveBase, DEFAULT_PORT, DEFAULT_HOST } from './config.ts';

let tmp: string;

before(() => {
  tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lookmd-cfg-')));
});
after(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('resolveBase', () => {
  it('canonicalizes an existing directory to an absolute path', () => {
    assert.equal(resolveBase(tmp), tmp);
  });

  it('throws for a non-existent directory', () => {
    assert.throws(() => resolveBase(path.join(tmp, 'nope')));
  });

  it('throws when the target is a file', () => {
    const file = path.join(tmp, 'a.md');
    fs.writeFileSync(file, 'x');
    assert.throws(() => resolveBase(file));
  });
});

describe('loadConfig', () => {
  it('takes BASE from a --base flag', () => {
    const cfg = loadConfig(['--base', tmp], {});
    assert.equal(cfg.base, tmp);
    assert.equal(cfg.port, DEFAULT_PORT);
    assert.equal(cfg.host, DEFAULT_HOST);
    assert.equal(cfg.allowWrite, true);
  });

  it('takes BASE from a positional argument', () => {
    assert.equal(loadConfig([tmp], {}).base, tmp);
  });

  it('falls back to the LOOKMD_BASE env var', () => {
    assert.equal(loadConfig([], { LOOKMD_BASE: tmp }).base, tmp);
  });

  it('prefers the flag over the env var', () => {
    const other = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'lookmd-cfg2-')));
    try {
      assert.equal(loadConfig(['--base', tmp], { LOOKMD_BASE: other }).base, tmp);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });

  it('parses port and host', () => {
    const cfg = loadConfig(['--base', tmp, '--port', '5000', '--host', '0.0.0.0'], {});
    assert.equal(cfg.port, 5000);
    assert.equal(cfg.host, '0.0.0.0');
  });

  it('rejects an invalid port', () => {
    assert.throws(() => loadConfig(['--base', tmp, '--port', 'abc'], {}));
  });

  it('disables writes with --read-only', () => {
    assert.equal(loadConfig(['--base', tmp, '--read-only'], {}).allowWrite, false);
  });
});
