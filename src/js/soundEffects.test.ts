import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audioInstance } from './soundEffects';

/**
 * A fake HTMLAudioElement, just enough surface for audioInstance.
 * Mirrors the real element's semantics where they matter:
 * - the src property assignment is reflected into the attribute (what
 *   ensure()/warmUp() inspect);
 * - a DENIED play() (iOS autoplay policy) leaves the element paused;
 * - the 'playing' event (which settles a pending start) fires only when a
 *   test says the audio actually became audible, via emit('playing').
 */
function fakeAudioElement() {
  const el = {
    volume: 1,
    currentTime: 0,
    paused: true,
    playCalls: 0,
    denied: false,
    playResult: Promise.resolve() as Promise<void>,
    dataset: {} as Record<string, string>,
    listeners: {} as Record<string, Array<() => void>>,
    _srcAttr: null as string | null,
    set src(value: string) { this._srcAttr = value; },
    get src(): string { return this._srcAttr ?? ''; },
    getAttribute(name: string) { return name === 'src' ? this._srcAttr : null; },
    addEventListener(type: string, fn: () => void) {
      (this.listeners[type] ??= []).push(fn);
    },
    emit(type: string) { (this.listeners[type] ?? []).forEach(fn => fn()); },
    play() {
      this.playCalls++;
      if (!this.denied) this.paused = false;
      return this.playResult;
    },
    pause() { this.paused = true; },
    /** Backgrounded-iOS mode: every play() is denied, element stays paused. */
    deny(name = 'NotAllowedError') {
      this.denied = true;
      const rejection = Promise.reject<void>(Object.assign(new Error('denied'), { name }));
      rejection.catch(() => {}); // pre-handled — audioInstance attaches its own catch later
      this.playResult = rejection;
    },
    allow() {
      this.denied = false;
      this.playResult = Promise.resolve();
    },
    querySelector: () => ({ src: 'http://sounds.test/tone.mp3' }),
  };
  return el;
}

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('audioInstance', () => {
  let el: ReturnType<typeof fakeAudioElement>;
  let resolveFetch: (r: Response) => void;
  let blobCounter: number;

  beforeEach(() => {
    el = fakeAudioElement();
    blobCounter = 0;
    // No Cache API, and a fetch we control — each blob preload stays pending
    // until the test resolves it. Every created blob URL is distinct.
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:fake-${++blobCounter}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** play() + resolve the blob fetch, so the element actually started. */
  async function playWithBlob(sound: ReturnType<typeof audioInstance>) {
    sound.play();
    await flushPromises();
    resolveFetch(new Response(new Blob(['x'])));
    await flushPromises();
  }

  describe('ensure()', () => {
    it('does not poke the element while the initial play() still waits for the blob', async () => {
      const sound = audioInstance(el as unknown as HTMLAudioElement);

      sound.play();            // blob preload pending — nothing started yet
      await flushPromises();   // let the preload reach the (unresolved) fetch
      expect(el.playCalls).toBe(0);

      // Supervisor tick lands mid-preload. The old bug: ensure() called
      // play() on the empty src, the rejection flipped isPlaying to false,
      // and the pending start bailed — one extra tick of silence.
      sound.ensure();
      expect(el.playCalls).toBe(0);

      // When the blob finally lands, the original play() must still fire.
      resolveFetch(new Response(new Blob(['x'])));
      await flushPromises();
      expect(el.playCalls).toBe(1);
      expect(el.getAttribute('src')).toBe('blob:fake-1');
    });

    it('still restarts a started element the OS paused', async () => {
      const sound = audioInstance(el as unknown as HTMLAudioElement);

      await playWithBlob(sound);
      expect(el.playCalls).toBe(1);

      el.paused = true;        // backgrounded: the OS paused it
      sound.ensure();
      expect(el.playCalls).toBe(2);
    });

    it('restarts from scratch when a play() was rejected outright', async () => {
      const sound = audioInstance(el as unknown as HTMLAudioElement);

      sound.play();
      await flushPromises();
      el.deny();
      resolveFetch(new Response(new Blob(['x'])));
      await flushPromises();   // startPlayback ran, its play() was denied
      expect(el.playCalls).toBe(1);

      el.allow();
      sound.ensure();          // isPlaying flipped false → full play() again
      await flushPromises();
      expect(el.playCalls).toBe(2);
    });
  });

  describe('deferred stop (handoff)', () => {
    it('keeps the old sound playing until the replacement is audible', async () => {
      const oldEl = el;
      const newEl = fakeAudioElement();
      const oldSound = audioInstance(oldEl as unknown as HTMLAudioElement);
      const newSound = audioInstance(newEl as unknown as HTMLAudioElement);
      oldSound.setPartner(newSound);
      newSound.setPartner(oldSound);

      await playWithBlob(oldSound);
      oldEl.emit('playing');           // old sound is audible
      expect(oldSound.isAudiblyPlaying()).toBe(true);

      // The machine's applyFx order: the NEW sound starts BEFORE the old
      // one stops. The new start is pending (its blob is still loading).
      newSound.play();
      expect(newSound.isStartPending()).toBe(true);
      oldSound.stop();

      // Old element must still be playing — no silent gap.
      expect(oldEl.paused).toBe(false);

      // The replacement becomes audible → the deferred stop completes.
      newEl.emit('playing');
      expect(oldEl.paused).toBe(true);
      expect(oldEl.getAttribute('src')).toBe('');
    });

    it('a user stop silences both immediately (settling the pending start)', async () => {
      const oldEl = el;
      const newEl = fakeAudioElement();
      const oldSound = audioInstance(oldEl as unknown as HTMLAudioElement);
      const newSound = audioInstance(newEl as unknown as HTMLAudioElement);
      oldSound.setPartner(newSound);
      newSound.setPartner(oldSound);

      await playWithBlob(oldSound);
      oldEl.emit('playing');
      newSound.play();                 // pending, never becomes audible
      oldSound.stop();                 // deferred, waiting on newSound
      expect(oldEl.paused).toBe(false);

      // applyFx for idle/paused stops BOTH: stopping the pending sound
      // settles it, which releases the partner's deferred stop too.
      newSound.stop();
      expect(oldEl.paused).toBe(true);
      expect(newEl.paused).toBe(true);
    });

    it('play-stop flapping does not fire a stale deferred stop', async () => {
      const elA = el;
      const elB = fakeAudioElement();
      const soundA = audioInstance(elA as unknown as HTMLAudioElement);
      const soundB = audioInstance(elB as unknown as HTMLAudioElement);
      soundA.setPartner(soundB);
      soundB.setPartner(soundA);

      await playWithBlob(soundA);
      elA.emit('playing');

      soundB.play();                   // pending
      soundA.stop();                   // deferred on B
      soundA.play();                   // fresh intent — cancels the deferral
      elB.emit('playing');             // B settles now

      // The stale deferred stop must NOT kill A's fresh play cycle.
      expect(elA.paused).toBe(false);
    });
  });

  describe('carry (iOS denies the fresh start)', () => {
    // Loading is audible; the error sound's own start is denied like
    // backgrounded iOS; loading's stop is deferred (error never audible).
    async function carryScenario() {
      const loadEl = el;
      const errEl = fakeAudioElement();
      const loading = audioInstance(loadEl as unknown as HTMLAudioElement);
      const error = audioInstance(errEl as unknown as HTMLAudioElement);
      loading.setPartner(error);
      error.setPartner(loading);

      await playWithBlob(loading);     // loading's blob = blob:fake-1
      loadEl.emit('playing');

      errEl.deny();
      error.play();
      await flushPromises();
      resolveFetch(new Response(new Blob(['y'])));  // error's blob = blob:fake-2
      await flushPromises();           // startPlayback ran → denied, still paused
      loading.stop();                  // deferred: error never got audible
      expect(loadEl.paused).toBe(false);

      return { loadEl, errEl, loading, error };
    }

    it('the audible partner carries the denied sound (src swap, keeps playing)', async () => {
      const { loadEl, errEl, error } = await carryScenario();
      expect(loadEl.getAttribute('src')).toBe('blob:fake-1');

      // Supervisor tick on the denied sound → escalate to carry.
      error.ensure();
      await flushPromises();

      expect(loadEl.getAttribute('src')).toBe('blob:fake-2'); // carries the error tone
      expect(loadEl.paused).toBe(false);                      // and keeps playing
      expect(errEl.paused).toBe(true);                        // denied element never started
    });

    it('carry is attempted once per denied cycle (no src thrash)', async () => {
      const { loadEl, error } = await carryScenario();

      error.ensure();
      await flushPromises();
      const callsAfterFirst = loadEl.playCalls;

      error.ensure();                  // next tick: already carrying — no re-hijack
      await flushPromises();
      expect(loadEl.playCalls).toBe(callsAfterFirst);
      expect(loadEl.getAttribute('src')).toBe('blob:fake-2');
    });

    it('never trades audible for silent: a denied carry restores the own sound', async () => {
      const { loadEl, error } = await carryScenario();

      loadEl.deny();                   // even the continuation is denied
      error.ensure();
      await flushPromises();

      // src is restored to the carrier's own sound and play retried.
      expect(loadEl.getAttribute('src')).toBe('blob:fake-1');
    });

    it('reclaim: a fresh play() on the carrier restores its own sound', async () => {
      const { loadEl, loading, error } = await carryScenario();

      error.ensure();                  // carry in effect
      await flushPromises();
      expect(loadEl.getAttribute('src')).toBe('blob:fake-2');

      loading.play();                  // fresh intent (e.g. back to loading state)
      await flushPromises();
      expect(loadEl.getAttribute('src')).toBe('blob:fake-1');
      expect(loadEl.paused).toBe(false);
    });
  });

  describe('gesture reconcile (warmUp on a live sound)', () => {
    it('restarts a desired-but-silent sound inside the gesture', async () => {
      const sound = audioInstance(el as unknown as HTMLAudioElement);

      sound.play();
      await flushPromises();
      el.deny();
      resolveFetch(new Response(new Blob(['x'])));
      await flushPromises();           // start denied → element silent

      // The old bug: warmUp() returned early on the intent flag and the
      // user's tap was squandered. Now it re-asserts playback right here.
      el.allow();
      sound.warmUp();
      expect(el.playCalls).toBe(2);
      expect(el.paused).toBe(false);
    });

    it('leaves an audibly playing sound alone', async () => {
      const sound = audioInstance(el as unknown as HTMLAudioElement);

      await playWithBlob(sound);
      el.emit('playing');
      const calls = el.playCalls;

      sound.warmUp();
      expect(el.playCalls).toBe(calls); // no restart glitch
    });

    it('still does the classic bless dance on an idle element', async () => {
      const sound = audioInstance(el as unknown as HTMLAudioElement);

      // First warmUp only kicks off the preload (no blob yet).
      sound.warmUp();
      await flushPromises();
      resolveFetch(new Response(new Blob(['x'])));
      await flushPromises();

      sound.warmUp();                  // blob ready, not playing → bless
      await flushPromises();
      expect(el.playCalls).toBe(1);
      expect(el.paused).toBe(true);    // played then paused back
      expect(el.currentTime).toBe(0);
    });
  });

  describe('stop()', () => {
    it('detaches the element so ensure() has nothing to resurrect', async () => {
      const sound = audioInstance(el as unknown as HTMLAudioElement);

      await playWithBlob(sound);
      expect(el.playCalls).toBe(1);

      sound.stop();
      expect(el.paused).toBe(true);
      expect(el.getAttribute('src')).toBe('');
    });
  });
});
