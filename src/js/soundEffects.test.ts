import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audioInstance } from './soundEffects';

/**
 * A fake HTMLAudioElement, just enough surface for audioInstance.
 * Mirrors the real element's src semantics: the property assignment is
 * reflected into the attribute, which is what ensure() inspects.
 */
function fakeAudioElement() {
  const el = {
    volume: 1,
    currentTime: 0,
    paused: true,
    playCalls: 0,
    playResult: Promise.resolve() as Promise<void>,
    dataset: {} as Record<string, string>,
    _srcAttr: null as string | null,
    set src(value: string) { this._srcAttr = value; },
    get src(): string { return this._srcAttr ?? ''; },
    getAttribute(name: string) { return name === 'src' ? this._srcAttr : null; },
    play() {
      this.playCalls++;
      this.paused = false;
      return this.playResult;
    },
    pause() { this.paused = true; },
    querySelector: () => ({ src: 'http://sounds.test/tone.mp3' }),
  };
  return el;
}

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

describe('audioInstance ensure()', () => {
  let el: ReturnType<typeof fakeAudioElement>;
  let resolveFetch: (r: Response) => void;

  beforeEach(() => {
    el = fakeAudioElement();
    // No Cache API, and a fetch we control — the blob preload stays pending
    // until the test resolves it.
    vi.stubGlobal('window', {});
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => {
      resolveFetch = resolve;
    })));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:fake'),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

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
    expect(el.getAttribute('src')).toBe('blob:fake');
  });

  it('still restarts a started element the OS paused', async () => {
    const sound = audioInstance(el as unknown as HTMLAudioElement);

    sound.play();
    await flushPromises();
    resolveFetch(new Response(new Blob(['x'])));
    await flushPromises();
    expect(el.playCalls).toBe(1);

    el.paused = true;        // backgrounded: the OS paused it
    sound.ensure();
    expect(el.playCalls).toBe(2);
  });

  it('restarts from scratch when a play() was rejected outright', async () => {
    const sound = audioInstance(el as unknown as HTMLAudioElement);

    sound.play();
    await flushPromises();
    const denied = Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    denied.catch(() => {}); // pre-handle: audioInstance attaches its own catch later
    el.playResult = denied;
    resolveFetch(new Response(new Blob(['x'])));
    await flushPromises();   // startPlayback ran, its play() was denied
    expect(el.playCalls).toBe(1);

    el.playResult = Promise.resolve();
    sound.ensure();          // isPlaying flipped false → full play() again
    await flushPromises();
    expect(el.playCalls).toBe(2);
  });

  it('stop() detaches the element so ensure() has nothing to resurrect', async () => {
    const sound = audioInstance(el as unknown as HTMLAudioElement);

    sound.play();
    await flushPromises();
    resolveFetch(new Response(new Blob(['x'])));
    await flushPromises();
    expect(el.playCalls).toBe(1);

    sound.stop();
    expect(el.paused).toBe(true);
    expect(el.getAttribute('src')).toBe('');
  });
});
