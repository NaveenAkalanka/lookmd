import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { blocksFor, buildBlocks } from './blocks.ts';
import { buildInline } from './inline.ts';
import { revealedLines } from './reveal.ts';
import { stateOf, summarize } from './testUtil.ts';
import { ImageWidget } from './widgets.ts';

function blocks(marked: string): string[] {
  const state = stateOf(marked);
  return summarize(buildBlocks(state, revealedLines(state)), state);
}
function inline(marked: string): string[] {
  const state = stateOf(marked);
  return summarize(buildInline(state, revealedLines(state), [{ from: 0, to: state.doc.length }]).decorations, state);
}

describe('images', () => {
  it('an image gets a widget below its line', () => {
    assert.deepEqual(blocks('![a](p.png)\n‸'), ['widget image 11-11']);
  });

  it('the image widget stays while the line is being edited', () => {
    assert.deepEqual(blocks('![a](p.png)‸'), ['widget image 11-11']);
  });

  it('an image-only line hides its syntax and collapses', () => {
    assert.deepEqual(inline('![a](p.png)\n‸'), ['line cm-lp-hidden-line L1', 'hide 0-11']);
  });

  it('an image line is raw on the cursor line', () => {
    assert.deepEqual(inline('![a](p.png)‸'), []);
  });

  it('text beside an image keeps the line', () => {
    assert.deepEqual(inline('see ![a](p.png)\n‸'), ['hide 4-15']);
  });

  it('the widget carries src and alt', () => {
    const state = stateOf('![the alt](img/p.png)\n‸');
    const found: ImageWidget[] = [];
    buildBlocks(state, revealedLines(state)).between(0, state.doc.length, (_f, _t, v) => {
      const w = (v.spec as { widget?: unknown }).widget;
      if (w instanceof ImageWidget) found.push(w);
    });
    assert.equal(found.length, 1);
    assert.equal(found[0]?.src, 'img/p.png');
    assert.equal(found[0]?.alt, 'the alt');
  });

  it('a measured height reaches the widget (so the editor re-measures)', () => {
    const state = stateOf('![a](p.png)\n‸');
    const heights = new Map([['p.png', 240]]);
    let height: number | null | undefined;
    buildBlocks(state, revealedLines(state), heights).between(0, state.doc.length, (_f, _t, v) => {
      const w = (v.spec as { widget?: unknown }).widget;
      if (w instanceof ImageWidget) height = w.height;
    });
    assert.equal(height, 240);
  });

  it('a re-measured image is a different widget, the same image is not', () => {
    assert.ok(!new ImageWidget('p.png', 'a', 240).eq(new ImageWidget('p.png', 'a', null)));
    assert.ok(new ImageWidget('p.png', 'a', 240).eq(new ImageWidget('p.png', 'a', 240)));
  });

  it('two images on a line get two widgets', () => {
    assert.deepEqual(blocks('![a](1.png) ![b](2.png)\n‸'), ['widget image 23-23', 'widget image 23-23']);
  });

  it('an image inside inline code is just code', () => {
    assert.deepEqual(blocks('`![a](p.png)`\n‸'), []);
  });
});

describe('fenced code', () => {
  const CODE = '```js\nlet a = 1\n```\n';

  it('renders: header widget on the opening fence, closing fence hidden, block lines styled', () => {
    assert.deepEqual(blocks(CODE + '\n‸'), [
      'line cm-lp-codeblock cm-lp-codeblock-start L1',
      'widget codehead 0-5',
      'line cm-lp-codeblock L2',
      'line cm-lp-codeblock cm-lp-codeblock-end L3',
      'hide 16-19',
    ]);
  });

  it('is raw as a whole when the cursor is anywhere inside', () => {
    assert.deepEqual(blocks('```js\nlet ‸a = 1\n```\n'), []);
  });

  it('unclosed fence stays raw', () => {
    assert.deepEqual(blocks('```js\nlet a\n‸'), []);
  });

  it('the header carries the language and the code', () => {
    const state = stateOf(CODE + '\n‸');
    let found: { lang?: string; code?: string } | undefined;
    buildBlocks(state, revealedLines(state)).between(0, state.doc.length, (_f, _t, v) => {
      const w = (v.spec as { widget?: { kind?: string; lang?: string; code?: string } }).widget;
      if (w?.kind === 'codehead') found = w;
    });
    assert.equal(found?.lang, 'js');
    assert.equal(found?.code, 'let a = 1');
  });
});

describe('tables', () => {
  const TABLE = '| a | b |\n|---|---|\n| 1 | 2 |\n';

  it('render as one block widget over all their lines', () => {
    assert.deepEqual(blocks(TABLE + '\n‸'), ['widget table 0-29']);
  });

  it('are raw as a whole when the cursor is in any row', () => {
    assert.deepEqual(blocks('| a | b |\n|---|---|\n| 1 | ‸2 |\n'), []);
  });

  it('a revealed table is raw in every row (no inline styling inside)', () => {
    assert.deepEqual(inline('| a | **b** |\n|---|---|\n| 1 | ‸2 |\n'), []);
  });

  it('a rendered table leaves its cells to the widget', () => {
    assert.deepEqual(inline('| a | **b** |\n|---|---|\n| 1 | 2 |\n\n‸'), []);
  });

  it('unclosed table (header only) stays raw', () => {
    assert.deepEqual(blocks('| a | b |\n\n‸'), []);
  });
});

describe('front matter', () => {
  it('is dimmed line by line, nothing hidden', () => {
    assert.deepEqual(blocks('---\nt: x\n---\n# H\n‸'), [
      'line cm-lp-fm L1',
      'line cm-lp-fm L2',
      'line cm-lp-fm L3',
    ]);
  });
});

describe('blocksFor cache (review #3)', () => {
  it('returns the same set when tree, reveal and heights are unchanged', () => {
    const state = stateOf('| a |\n|---|\n| 1 |\n\n‸');
    const reveal = revealedLines(state);
    const heights = new Map<string, number>();
    assert.equal(blocksFor(state, reveal, heights), blocksFor(state, reveal, heights));
  });
});
