import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildBlocks } from './blocks.ts';
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
