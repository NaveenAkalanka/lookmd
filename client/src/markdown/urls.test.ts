import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isOpenableExternalUrl } from './urls.ts';

describe('isOpenableExternalUrl (review #2)', () => {
  it('allows web and mail links', () => {
    for (const u of ['https://x.io', 'http://x.io/a?b', 'mailto:a@b.c', '//cdn.x/y']) assert.ok(isOpenableExternalUrl(u), u);
  });

  it('refuses script and data schemes, whatever the case or padding', () => {
    for (const u of ['javascript:alert(1)', 'JavaScript:alert(1)', ' javascript:x', 'java\tscript:x', 'data:text/html,<b>x', 'vbscript:x', 'file:///etc/passwd']) {
      assert.ok(!isOpenableExternalUrl(u), u);
    }
  });
});
