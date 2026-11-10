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

describe('zoom per pane and view side', async () => {
  const { getZoomMap, setZoomMap, ZOOM_MIN, ZOOM_MAX } = await import('./settings.ts');

  it('defaults every side to 100%', () => {
    const m = getZoomMap();
    for (const pane of ['primary', 'secondary'] as const) {
      assert.deepEqual(m[pane], { read: 1, source: 1, splitEditor: 1, splitPreview: 1 });
    }
  });

  it('carries an old single zoom level over to every side', () => {
    mem.set('lookmd.zoom', '1.3');
    const m = getZoomMap();
    assert.equal(m.primary.read, 1.3);
    assert.equal(m.secondary.splitPreview, 1.3);
  });

  it('stores each side independently and clamps junk', () => {
    const m = getZoomMap();
    m.primary.read = 1.5;
    m.primary.splitEditor = 0.8;
    setZoomMap(m);
    const back = getZoomMap();
    assert.equal(back.primary.read, 1.5);
    assert.equal(back.primary.splitEditor, 0.8);
    assert.equal(back.primary.source, 1);
    mem.set('lookmd.zoom', JSON.stringify({ primary: { read: 99, source: 'x' } }));
    const j = getZoomMap();
    assert.equal(j.primary.read, ZOOM_MAX);
    assert.equal(j.primary.source, 1);
    assert.ok(ZOOM_MIN < 1);
  });
});

describe('divider sizes', async () => {
  const { getSplitRatio, setSplitRatio, getPanesRatio, setPanesRatio } = await import('./settings.ts');

  it('default to an even split', () => {
    assert.equal(getSplitRatio(), 0.5);
    assert.equal(getPanesRatio(), 0.5);
  });

  it('remember each divider separately, kept between 20% and 80%', () => {
    setSplitRatio(0.35);
    setPanesRatio(0.95);
    assert.equal(getSplitRatio(), 0.35);
    assert.equal(getPanesRatio(), 0.8);
    setSplitRatio(0.01);
    assert.equal(getSplitRatio(), 0.2);
    mem.set('lookmd.splitRatio', 'nonsense');
    assert.equal(getSplitRatio(), 0.5);
  });
});
