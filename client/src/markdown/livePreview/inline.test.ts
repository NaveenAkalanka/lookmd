import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildInline } from './inline.ts';
import { revealedLines } from './reveal.ts';
import { stateOf, summarize } from './testUtil.ts';

function build(marked: string) {
  const state = stateOf(marked);
  const result = buildInline(state, revealedLines(state), [{ from: 0, to: state.doc.length }]);
  return { state, ...result };
}
function all(marked: string): string[] {
  const { state, decorations } = build(marked);
  return summarize(decorations, state);
}

describe('buildInline: headings', () => {
  it('hides "# " and styles the text', () => {
    assert.deepEqual(all('# Title\n‸x'), ['hide 0-2', 'mark cm-lp-h1 2-7']);
  });

  it('uses the level class', () => {
    assert.deepEqual(all('### Deep\n‸'), ['hide 0-4', 'mark cm-lp-h3 4-8']);
  });

  it('on the cursor line shows "#" (dimmed) but keeps the heading size', () => {
    assert.deepEqual(all('# Ti‸tle'), ['mark cm-lp-syntax 0-1', 'mark cm-lp-h1 0-7']);
  });

  it('setext heading keeps its underline, dimmed', () => {
    assert.deepEqual(all('Set\n===\n‸'), ['mark cm-lp-h1 0-3', 'mark cm-lp-setext 4-7']);
  });

  it('setext heading is raw when the cursor is on its underline', () => {
    assert.deepEqual(all('Set\n==‸=\n'), []);
  });
});

describe('buildInline: emphasis and code', () => {
  it('hides delimiters of bold, italic, strike and code', () => {
    assert.deepEqual(all('**b** *i* ~~s~~ `c`\n‸'), [
      'hide 0-2', 'mark cm-lp-strong 0-5', 'hide 3-5',
      'hide 6-7', 'mark cm-lp-em 6-9', 'hide 8-9',
      'hide 10-12', 'mark cm-lp-strike 10-15', 'hide 13-15',
      'hide 16-17', 'mark cm-lp-code 16-19', 'hide 18-19',
    ]);
  });

  it('is raw on the cursor line', () => {
    assert.deepEqual(all('**b** ‸x'), []);
  });

  it('unclosed **bold stays raw', () => {
    assert.deepEqual(all('**bold\n‸'), []);
  });
});

describe('buildInline: invariants', () => {
  it('atomic holds only the hidden ranges', () => {
    const { state, atomic } = build('# T **b**\n‸');
    const entries = summarize(atomic, state);
    assert.ok(entries.length > 0);
    assert.ok(entries.every((e) => e.startsWith('hide')), entries.join(', '));
  });

  it('building never changes the document', () => {
    const text = '# T\n\n**b** `c`\n‸';
    const { state } = build(text);
    assert.equal(state.doc.toString(), text.replace('‸', ''));
  });

  it('only decorates inside the given ranges', () => {
    const state = stateOf('# A\n\n# B\n‸');
    const { decorations } = buildInline(state, revealedLines(state), [{ from: 5, to: 8 }]);
    assert.deepEqual(summarize(decorations, state), ['hide 5-7', 'mark cm-lp-h1 7-8']);
  });
});

describe('buildInline: links', () => {
  it('a link shows only its text', () => {
    assert.deepEqual(all('[t](u.md)\n‸'), ['hide 0-1', 'mark cm-lp-link cm-lp-link-internal 1-2', 'hide 2-9']);
  });

  it('an external link is not marked internal', () => {
    assert.deepEqual(all('[t](https://x.io)\n‸'), ['hide 0-1', 'mark cm-lp-link 1-2', 'hide 2-17']);
  });

  it('a link is raw on the cursor line', () => {
    assert.deepEqual(all('[t](u.md) ‸'), []);
  });

  it('brackets without a url are left alone', () => {
    assert.deepEqual(all('[just brackets]\n‸'), []);
  });

  it('a wiki link shows its alias', () => {
    assert.deepEqual(all('[[Note|al]]\n‸'), ['hide 0-7', 'mark cm-lp-link cm-lp-link-internal 7-9', 'hide 9-11']);
  });

  it('a wiki link without alias shows the note name', () => {
    assert.deepEqual(all('[[Note]]\n‸'), ['hide 0-2', 'mark cm-lp-link cm-lp-link-internal 2-6', 'hide 6-8']);
  });

  it('a wiki link inside inline code stays code', () => {
    assert.deepEqual(all('`[[Note]]`\n‸'), ['hide 0-1', 'mark cm-lp-code 0-10', 'hide 9-10']);
  });

  it('a bare URL is link-styled, nothing hidden', () => {
    assert.deepEqual(all('see https://x.io now\n‸'), ['mark cm-lp-link 4-16']);
  });

  it('an <autolink> hides its angle brackets', () => {
    assert.deepEqual(all('<https://x.io>\n‸'), ['hide 0-1', 'mark cm-lp-link 1-13', 'hide 13-14']);
  });
});

describe('buildInline: lists, quotes, rules, HTML', () => {
  it('a bullet marker becomes a bullet widget', () => {
    assert.deepEqual(all('- a\n‸'), ['widget bullet 0-1']);
  });

  it('a bullet is raw on the cursor line', () => {
    assert.deepEqual(all('- a‸'), []);
  });

  it('ordered numbers stay, dimmed', () => {
    assert.deepEqual(all('1. a\n‸'), ['mark cm-lp-ordered 0-2']);
  });

  it('a task replaces marker and box with a checkbox', () => {
    assert.deepEqual(all('- [x] a\n‸'), ['widget task 0-5']);
  });

  it('a blockquote hides "> " and styles the line', () => {
    assert.deepEqual(all('> q\n\n‸'), ['line cm-lp-quote L1', 'hide 0-2']);
  });

  it('a rule becomes a rule widget', () => {
    assert.deepEqual(all('***\n‸'), ['widget rule 0-3']);
  });

  it('raw HTML is dimmed, never hidden', () => {
    assert.deepEqual(all('<b>x</b>\n‸'), ['mark cm-lp-html 0-3', 'mark cm-lp-html 4-8']);
  });

  it('widgets are atomic too', () => {
    const { state, atomic } = build('- [ ] a\n‸');
    assert.deepEqual(summarize(atomic, state), ['widget task 0-5']);
  });
});

describe('buildInline: constructs spanning lines (review #1)', () => {
  /** CodeMirror rejects plugin replacements that cross a line break. */
  function crossing(marked: string): string[] {
    const { state, decorations } = build(marked);
    const bad: string[] = [];
    decorations.between(0, state.doc.length, (from, to, v) => {
      const point = !(v.spec as { class?: string }).class || (v.spec as { widget?: unknown }).widget;
      if (point && to > state.doc.lineAt(from).to) bad.push(`${from}-${to}`);
    });
    return bad;
  }

  it('a multi-line image alt stays raw (cursor on its second line)', () => {
    assert.deepEqual(crossing('![A long caption\nwraps‸](fig.png)'), []);
    assert.deepEqual(all('![A long caption\nwraps](fig.png)\n\n‸'), []);
  });

  it('a link whose url or title is on the next line stays raw', () => {
    assert.deepEqual(crossing('[t](\nu.md)\n\n‸'), []);
    assert.deepEqual(crossing('[t](u.md\n"ti")\n\n‸'), []);
  });

  it('no hidden or widget range ever crosses a line', () => {
    for (const doc of ['**a\nb**\n\n‸', '[a\nb](c.md)\n\n‸', '<span\nclass="x">y</span>\n\n‸', '~~a\nb~~\n\n‸', '`a\nb`\n\n‸']) {
      assert.deepEqual(crossing(doc), [], doc);
    }
  });
});
