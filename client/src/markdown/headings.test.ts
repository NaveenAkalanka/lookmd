import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { extractHeadings } from './headings.ts';

describe('extractHeadings', () => {
  it('gives level, text, slug and 1-based line', () => {
    assert.deepEqual(extractHeadings('# One\n\ntext\n\n## Two `x`\n'), [
      { level: 1, text: 'One', slug: 'one', line: 1 },
      { level: 2, text: 'Two x', slug: 'two-x', line: 5 },
    ]);
  });

  it('skips headings inside fenced code', () => {
    assert.deepEqual(extractHeadings('```\n# not\n```\n# yes').map((h) => h.line), [4]);
  });

  it('counts CRLF lines the same', () => {
    assert.deepEqual(extractHeadings('a\r\n\r\n# H\r\n').map((h) => h.line), [3]);
  });

  it('dedupes slugs like rehype-slug', () => {
    assert.deepEqual(extractHeadings('# A\n# A').map((h) => h.slug), ['a', 'a-1']);
  });
});
