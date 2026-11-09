import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';

import { debounceByKey } from './watcher.ts';

describe('debounceByKey', () => {
  it('reports every key changed within one window', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fn = mock.fn((_k: string) => {});
    const d = debounceByKey(fn, 80);
    d.call('a.md');
    d.call('b.md');
    t.mock.timers.tick(80);
    assert.deepEqual(fn.mock.calls.map((c) => c.arguments[0]).sort(), ['a.md', 'b.md']);
  });

  it('collapses a burst on one key into a single call', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fn = mock.fn((_k: string) => {});
    const d = debounceByKey(fn, 80);
    d.call('a.md');
    t.mock.timers.tick(50);
    d.call('a.md');
    t.mock.timers.tick(50);
    assert.equal(fn.mock.callCount(), 0);
    t.mock.timers.tick(30);
    assert.equal(fn.mock.callCount(), 1);
  });

  it('cancel drops pending calls', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const fn = mock.fn((_k: string) => {});
    const d = debounceByKey(fn, 80);
    d.call('a.md');
    d.cancel();
    t.mock.timers.tick(200);
    assert.equal(fn.mock.callCount(), 0);
  });
});
