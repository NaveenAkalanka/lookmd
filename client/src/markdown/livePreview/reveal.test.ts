import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { EditorState } from '@codemirror/state';
import { frontMatterRange, revealField, revealedLines } from './reveal.ts';
import { stateOf } from './testUtil.ts';

describe('revealedLines', () => {
  it('cursor reveals its line only', () => {
    assert.deepEqual([...revealedLines(stateOf('a\nb‸\nc'))], [2]);
  });

  it('a selection reveals every line it spans', () => {
    assert.deepEqual([...revealedLines(stateOf('«a\nb\nc»'))].sort(), [1, 2, 3]);
  });

});

describe('frontMatterRange', () => {
  it('needs a closing fence', () => {
    assert.deepEqual(frontMatterRange(stateOf('---\nt: x\n---\n# H')), { from: 0, to: 12 });
    assert.equal(frontMatterRange(stateOf('---\nt: x\n# H')), null);
  });

  it('accepts "..." as the closing fence', () => {
    assert.deepEqual(frontMatterRange(stateOf('---\nt: x\n...\n')), { from: 0, to: 12 });
  });

  it('only counts when the document starts with it', () => {
    assert.equal(frontMatterRange(stateOf('x\n---\nt: x\n---')), null);
  });
});

describe('revealField', () => {
  const make = (doc: string, at: number) =>
    EditorState.create({ doc, selection: { anchor: at }, extensions: [revealField] });

  it('starts from the selection', () => {
    assert.deepEqual([...make('a\nb\nc', 2).field(revealField)], [2]);
  });

  it('follows selection changes', () => {
    const s = make('a\nb\nc', 0).update({ selection: { anchor: 4 } }).state;
    assert.deepEqual([...s.field(revealField)], [3]);
  });

  it('keeps the same set when nothing relevant changes', () => {
    const s = make('a\nb', 0);
    assert.equal(s.update({}).state.field(revealField), s.field(revealField));
  });
});

describe('revealField identity (review #3)', () => {
  it('moving within the same line keeps the same set (no block rebuild)', () => {
    const s = EditorState.create({ doc: 'abc\ndef', selection: { anchor: 0 }, extensions: [revealField] });
    const moved = s.update({ selection: { anchor: 2 } }).state;
    assert.equal(moved.field(revealField), s.field(revealField));
  });
});
