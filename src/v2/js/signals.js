/**
 * Minimal reactive system — signals, computed, effect.
 * No library, no build, ~60 lines.
 *
 * signal(value)   → { get, set, peek, subscribe }
 * computed(fn)    → { get, peek, subscribe }  (lazy, cached, auto-tracked)
 * effect(fn)      → teardown function
 */

let currentEffect = null;

export function signal(initialValue) {
  let value = initialValue;
  const subs = new Set();

  function get() {
    if (currentEffect) subs.add(currentEffect);
    return value;
  }

  function set(next) {
    const v = typeof next === 'function' ? next(value) : next;
    if (v === value) return;
    value = v;
    // snapshot to avoid infinite loops if a subscriber triggers set()
    for (const fn of [...subs]) fn();
  }

  function peek() { return value; }

  function subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  }

  return { get, set, peek, subscribe };
}

export function computed(fn) {
  let cached;
  let dirty = true;
  const subs = new Set();

  // Internal effect that marks dirty + notifies dependents
  const mark = () => { dirty = true; for (const s of [...subs]) s(); };

  // First run to register deps
  const prev = currentEffect;
  currentEffect = mark;
  cached = fn();
  dirty = false;
  currentEffect = prev;

  function get() {
    if (currentEffect) subs.add(currentEffect);
    if (dirty) {
      const prev2 = currentEffect;
      currentEffect = mark;
      cached = fn();
      dirty = false;
      currentEffect = prev2;
    }
    return cached;
  }

  function peek() {
    if (dirty) {
      const prev2 = currentEffect;
      currentEffect = mark;
      cached = fn();
      dirty = false;
      currentEffect = prev2;
    }
    return cached;
  }

  function subscribe(fn2) {
    subs.add(fn2);
    return () => subs.delete(fn2);
  }

  return { get, peek, subscribe };
}

export function effect(fn) {
  function run() {
    const prev = currentEffect;
    currentEffect = run;
    try { fn(); }
    finally { currentEffect = prev; }
  }
  run();
  // Return teardown (no auto-cleanup — caller can unsubscribe manually if needed)
  return run;
}
