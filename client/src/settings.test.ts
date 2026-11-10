import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> }).localStorage = {
  getItem: (k) => mem.get(k) ?? null,
  setItem: (k, v) => void mem.set(k, String(v)),
  removeItem: (k) => void mem.delete(k),
};

const { getSidebar, setSidebar, DEFAULT_SIDEBAR } = await import('./settings.ts');

beforeEach(() => mem.clear());

describe('sidebar pref: active view', () => {
  it('defaults to the Files view', () => {
    assert.equal(getSidebar().view, 'files');
    assert.equal(DEFAULT_SIDEBAR.view, 'files');
  });

  it('remembers the chosen view with the other sidebar settings', () => {
    setSidebar({ collapsed: true, autoHide: false, view: 'search' });
    assert.deepEqual(getSidebar(), { collapsed: true, autoHide: false, view: 'search' });
    setSidebar({ collapsed: false, autoHide: true, view: 'outline' });
    assert.equal(getSidebar().view, 'outline');
  });

  it('falls back to Files for records saved before views existed, or junk', () => {
    mem.set('lookmd.sidebar', JSON.stringify({ collapsed: true, autoHide: false }));
    assert.deepEqual(getSidebar(), { collapsed: true, autoHide: false, view: 'files' });
    mem.set('lookmd.sidebar', JSON.stringify({ collapsed: false, autoHide: false, view: 'nope' }));
    assert.equal(getSidebar().view, 'files');
  });
});
