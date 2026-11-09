import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Minimal in-memory localStorage so storage.ts runs under Node.
class MemoryStorage {
  private map = new Map<string, string>();
  get length() {
    return this.map.size;
  }
  key(i: number) {
    return [...this.map.keys()][i] ?? null;
  }
  getItem(k: string) {
    return this.map.has(k) ? this.map.get(k)! : null;
  }
  setItem(k: string, v: string) {
    this.map.set(k, String(v));
  }
  removeItem(k: string) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
}
const mem = new MemoryStorage();
(globalThis as unknown as { localStorage: MemoryStorage }).localStorage = mem;

const {
  workspaceFromSearch,
  searchWithWorkspace,
  getSession,
  setSession,
  addRecent,
  removeRecent,
  clearRecents,
} = await import('./storage.ts');

beforeEach(() => mem.clear());

describe('workspace URL param', () => {
  it('parses rest and fsa workspaces', () => {
    assert.deepEqual(workspaceFromSearch('?ws=rest:notes/sub'), { kind: 'rest', root: 'notes/sub' });
    assert.deepEqual(workspaceFromSearch('?ws=fsa:abc-123'), { kind: 'fsa', root: 'abc-123' });
  });

  it('parses the base workspace (empty root)', () => {
    assert.deepEqual(workspaceFromSearch('?ws=rest:'), { kind: 'rest', root: '' });
  });

  it('rejects missing or malformed values', () => {
    assert.equal(workspaceFromSearch(''), null);
    assert.equal(workspaceFromSearch('?other=1'), null);
    assert.equal(workspaceFromSearch('?ws=nope'), null);
    assert.equal(workspaceFromSearch('?ws=ftp:x'), null);
    assert.equal(workspaceFromSearch('?ws=fsa:'), null);
  });

  it('round-trips roots with spaces and unicode', () => {
    const ws = { kind: 'rest' as const, root: 'my notes/été & co' };
    assert.deepEqual(workspaceFromSearch(searchWithWorkspace('', ws)), ws);
  });

  it('keeps other params and stays readable', () => {
    const s = searchWithWorkspace('?x=1', { kind: 'rest', root: 'a/b' });
    assert.equal(s, '?x=1&ws=rest:a/b');
    assert.equal(searchWithWorkspace('?x=1&ws=rest:a', null), '?x=1');
    assert.equal(searchWithWorkspace('?ws=rest:a', null), '');
  });
});

describe('per-workspace sessions', () => {
  const a = { kind: 'rest' as const, root: 'a', openPaths: ['one.md'], activePath: 'one.md', mode: 'read' };
  const b = { kind: 'rest' as const, root: 'b', openPaths: ['two.md'], activePath: 'two.md', mode: 'edit' };

  it('stores each workspace separately', () => {
    setSession(a);
    setSession(b);
    assert.deepEqual(getSession('rest', 'a'), a);
    assert.deepEqual(getSession('rest', 'b'), b);
    assert.equal(getSession('fsa', 'a'), null);
  });

  it('carries over the old single session record for its workspace', () => {
    mem.setItem('lookmd.session', JSON.stringify(a));
    assert.deepEqual(getSession('rest', 'a'), a);
    assert.equal(getSession('rest', 'b'), null);
  });

  it('prefers the per-workspace record over the old one', () => {
    mem.setItem('lookmd.session', JSON.stringify(a));
    const newer = { ...a, openPaths: ['three.md'], activePath: 'three.md' };
    setSession(newer);
    assert.deepEqual(getSession('rest', 'a'), newer);
  });

  it('forgets a session when its recent is removed', () => {
    addRecent({ kind: 'rest', root: 'a', name: 'a' });
    setSession(a);
    setSession(b);
    removeRecent('rest', 'a');
    assert.equal(getSession('rest', 'a'), null);
    assert.deepEqual(getSession('rest', 'b'), b);
  });

  it('clearing recents clears every session', () => {
    setSession(a);
    setSession(b);
    mem.setItem('lookmd.session', JSON.stringify(a));
    clearRecents();
    assert.equal(getSession('rest', 'a'), null);
    assert.equal(getSession('rest', 'b'), null);
  });
});
