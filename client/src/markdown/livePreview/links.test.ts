import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { isExternalUrl, linkAt, toggleTaskAt } from './links.ts';
import { parseWikiLink } from '../remarkWikiLink.ts';
import { stateOf } from './testUtil.ts';

describe('linkAt', () => {
  it('finds a Markdown link url from its text', () => {
    assert.equal(linkAt(stateOf('see [t](a2.md) x'), 5), 'a2.md');
  });

  it('finds a wiki link target', () => {
    assert.equal(linkAt(stateOf('x [[Note|al]] y'), 9), 'Note.md');
  });

  it('finds a bare URL', () => {
    assert.equal(linkAt(stateOf('go https://x.io now'), 6), 'https://x.io');
  });

  it('is null in plain text', () => {
    assert.equal(linkAt(stateOf('plain words'), 3), null);
  });
});

describe('toggleTaskAt', () => {
  const toggled = (doc: string, at: number) => {
    const s = stateOf(doc);
    const spec = toggleTaskAt(s, at);
    assert.ok(spec);
    return s.update(spec).state.doc.toString();
  };

  it('checks an open box with one character', () => {
    assert.equal(toggled('- [ ] a', 2), '- [x] a');
  });

  it('unchecks [x] and [X]', () => {
    assert.equal(toggled('- [x] a', 2), '- [ ] a');
    assert.equal(toggled('- [X] a', 2), '- [ ] a');
  });

  it('is null when there is no box there', () => {
    assert.equal(toggleTaskAt(stateOf('- a'), 2), null);
  });
});

describe('isExternalUrl / parseWikiLink', () => {
  it('treats schemes and protocol-relative as external', () => {
    assert.ok(isExternalUrl('https://x.io'));
    assert.ok(isExternalUrl('mailto:a@b.c'));
    assert.ok(isExternalUrl('//cdn.x'));
    assert.ok(!isExternalUrl('notes/a.md'));
  });

  it('adds .md only when there is no extension', () => {
    assert.deepEqual(parseWikiLink('Note|al'), { url: 'Note.md', label: 'al' });
    assert.deepEqual(parseWikiLink('img.png'), { url: 'img.png', label: 'img.png' });
    assert.deepEqual(parseWikiLink(' a/b '), { url: 'a/b.md', label: 'a/b' });
  });
});
