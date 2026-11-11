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
