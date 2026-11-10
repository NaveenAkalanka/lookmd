import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, EditorSelection } from '@codemirror/state';

import { formatCommand, type FormatId } from './format.ts';

/**
 * Run a command on `text` where `[` `]` mark the selection (or `|` a cursor),
 * and return the result with the new selection marked the same way.
 */
function run(id: FormatId, text: string): string {
  let from: number;
  let to: number;
  if (text.includes('|')) {
    from = to = text.indexOf('|');
    text = text.replace('|', '');
  } else {
    from = text.indexOf('[');
    text = text.replace('[', '');
    to = text.indexOf(']');
    text = text.replace(']', '');
  }
  const state = EditorState.create({ doc: text, selection: EditorSelection.single(from, to) });
  const spec = formatCommand(id, state);
  const next = spec ? state.update(spec).state : state;
  const sel = next.selection.main;
  const doc = next.doc.toString();
  if (sel.empty) return doc.slice(0, sel.from) + '|' + doc.slice(sel.from);
  return doc.slice(0, sel.from) + '[' + doc.slice(sel.from, sel.to) + ']' + doc.slice(sel.to);
}

describe('inline marks', () => {
  it('wraps a selection and keeps it selected', () => {
    assert.equal(run('bold', 'a [word] b'), 'a **[word]** b');
    assert.equal(run('italic', 'a [word] b'), 'a *[word]* b');
    assert.equal(run('strike', 'a [word] b'), 'a ~~[word]~~ b');
    assert.equal(run('code', 'a [word] b'), 'a `[word]` b');
  });

  it('unwraps when pressed again (markers outside the selection)', () => {
    assert.equal(run('bold', 'a **[word]** b'), 'a [word] b');
    assert.equal(run('italic', 'a *[word]* b'), 'a [word] b');
    assert.equal(run('strike', 'a ~~[word]~~ b'), 'a [word] b');
    assert.equal(run('code', 'a `[word]` b'), 'a [word] b');
  });

  it('unwraps when the markers are inside the selection', () => {
    assert.equal(run('bold', 'a [**word**] b'), 'a [word] b');
    assert.equal(run('italic', 'a [*word*] b'), 'a [word] b');
  });

  it('tells bold and italic apart', () => {
    assert.equal(run('italic', 'a **[word]** b'), 'a ***[word]*** b');
    assert.equal(run('bold', 'a *[word]* b'), 'a ***[word]*** b');
    assert.equal(run('italic', 'a ***[word]*** b'), 'a **[word]** b');
    assert.equal(run('bold', 'a ***[word]*** b'), 'a *[word]* b');
  });

  it('with no selection, inserts an empty pair with the cursor inside', () => {
    assert.equal(run('bold', 'a | b'), 'a **|** b');
    assert.equal(run('code', 'x|'), 'x`|`');
  });

  it('with the cursor in an empty pair, removes the pair', () => {
    assert.equal(run('bold', 'a **|** b'), 'a | b');
  });
});

describe('line formats', () => {
  it('sets, changes and toggles off headings', () => {
    assert.equal(run('h2', 'Ti|tle'), '## Ti|tle');
    assert.equal(run('h1', '## Ti|tle'), '# Ti|tle');
    assert.equal(run('h1', '# Ti|tle'), 'Ti|tle');
    assert.equal(run('paragraph', '### Ti|tle'), 'Ti|tle');
  });

  it('toggles quotes across every selected line', () => {
    assert.equal(run('quote', '[one\ntwo]'), '> [one\n> two]');
    assert.equal(run('quote', '> [one\n> two]'), '[one\ntwo]');
  });

  it('toggles and switches list kinds, keeping indentation', () => {
    assert.equal(run('bullet', 'it|em'), '- it|em');
    assert.equal(run('bullet', '- it|em'), 'it|em');
    assert.equal(run('numbered', '[a\nb\nc]'), '1. [a\n2. b\n3. c]');
    assert.equal(run('task', '- it|em'), '- [ ] it|em');
    assert.equal(run('bullet', '  1. it|em'), '  - it|em');
    assert.equal(run('task', '- [x] do|ne'), 'do|ne');
  });

  it('skips blank lines inside a multi-line selection', () => {
    assert.equal(run('bullet', '[a\n\nb]'), '- [a\n\n- b]');
  });
});

describe('inserts', () => {
  it('turns a selection into a link and selects the url placeholder', () => {
    assert.equal(run('link', 'see [docs] now'), 'see [docs]([url]) now');
    assert.equal(run('link', 'see | now'), 'see [[text]](url) now');
  });

  it('inserts an image', () => {
    assert.equal(run('image', 'x [cat] y'), 'x ![cat]([url]) y');
  });

  it('puts block inserts on their own lines', () => {
    assert.equal(run('divider', 'para|'), 'para\n\n---\n|');
    assert.equal(run('divider', '|'), '---\n|');
    assert.equal(run('codeblock', '|'), '```\n|\n```');
    assert.equal(run('codeblock', '[a\nb]'), '```\n[a\nb]\n```');
    assert.equal(
      run('table', 'text|'),
      'text\n\n| [Column 1] | Column 2 |\n| --- | --- |\n|  |  |\n',
    );
  });
});

describe('line endings', () => {
  it('formatting a CRLF file changes only the inserted marks', async () => {
    const { detectEol, toFileText } = await import('./eol.ts');
    const file = '# Title\r\n\r\nsome words here\r\n';
    const state = EditorState.create({ doc: file });
    const at = state.doc.toString().indexOf('words');
    const sel = state.update({ selection: EditorSelection.single(at, at + 5) }).state;
    const out = toFileText(sel.update(formatCommand('bold', sel)!).state.doc.toString(), detectEol(file));
    assert.equal(out, '# Title\r\n\r\nsome **words** here\r\n');
  });
});
