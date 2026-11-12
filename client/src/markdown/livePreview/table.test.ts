import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { inlineSpans, parseTable } from './table.ts';
import { stateOf } from './testUtil.ts';

const TABLE = '| a | **b** |\n|:-|-:|\n| 1 | `c` |\n';

describe('parseTable', () => {
  it('reads header, rows and alignment', () => {
    const t = parseTable(stateOf(TABLE + '‸'), 0);
    assert.ok(t);
    assert.deepEqual(t.head.map((c) => c.spans), [
      [{ text: 'a', marks: [] }],
      [{ text: 'b', marks: ['strong'] }],
    ]);
    assert.deepEqual(t.rows.map((r) => r.map((c) => c.spans)), [
      [[{ text: '1', marks: [] }], [{ text: 'c', marks: ['code'] }]],
    ]);
    assert.deepEqual(t.align, ['left', 'right']);
  });

  it('cell offsets point at the cell text', () => {
    const state = stateOf(TABLE + '‸');
    const t = parseTable(state, 0);
    assert.ok(t);
    const [a, b] = t.head;
    assert.equal(state.sliceDoc(a!.from, a!.to), 'a');
    assert.equal(state.sliceDoc(b!.from, b!.to), '**b**');
    assert.equal(state.sliceDoc(t.rows[0]![1]!.from, t.rows[0]![1]!.to), '`c`');
  });

  it('keeps empty cells so columns line up', () => {
    const t = parseTable(stateOf('| x | y |\n|---|---|\n|  | 2 |\n‸'), 0);
    assert.ok(t);
    assert.equal(t.rows[0]!.length, 2);
    assert.deepEqual(t.rows[0]![0]!.spans, []);
  });

  it('works without outer pipes', () => {
    const t = parseTable(stateOf('x | y\n--|--\n1 | 2\n‸'), 0);
    assert.ok(t);
    assert.deepEqual(t.head.map((c) => c.spans[0]?.text), ['x', 'y']);
    assert.deepEqual(t.align, [null, null]);
  });

  it('is null where there is no table', () => {
    assert.equal(parseTable(stateOf('just text\n‸'), 0), null);
  });
});

describe('inlineSpans', () => {
  it('splits styled runs and drops their syntax', () => {
    const state = stateOf('x **b** *i* ~~s~~ [l](u) `c` y\n‸');
    assert.deepEqual(inlineSpans(state, 0, state.doc.line(1).to), [
      { text: 'x ', marks: [] },
      { text: 'b', marks: ['strong'] },
      { text: ' ', marks: [] },
      { text: 'i', marks: ['em'] },
      { text: ' ', marks: [] },
      { text: 's', marks: ['strike'] },
      { text: ' ', marks: [] },
      { text: 'l', marks: ['link'] },
      { text: ' ', marks: [] },
      { text: 'c', marks: ['code'] },
      { text: ' y', marks: [] },
    ]);
  });

  it('nests marks', () => {
    const state = stateOf('***bi***\n‸');
    const spans = inlineSpans(state, 0, 8);
    assert.equal(spans.length, 1);
    assert.equal(spans[0]?.text, 'bi');
    assert.deepEqual([...(spans[0]?.marks ?? [])].sort(), ['em', 'strong']);
  });
});
