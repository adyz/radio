import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { audioInstance } from './soundEffects';

/**
 * A fake HTMLAudioElement, just enough surface for audioInstance. Mirrors
 * the real element where it matters: the src property reflects into the
 * attribute, and a DENIED play() (iOS autoplay policy) leaves it paused.
 */
function fakeAudioElement(tone: string) {
  const el = {
    volume: 1,
    currentTime: 0,
    paused: true,
    playCalls: 0,
    denied: false,
    playResult: Promise.resolve() as Promise<void>,
    dataset: {} as Record<string, string>,
    _srcAttr: null as string | null,
    set src(value: string) { this._srcAttr = value; },
    get src(): string { return this._srcAttr ?? ''; },
    getAttribute(name: string) { return name === 'src' ? this._srcAttr : null; },
    addEventListener() {},
    play() {
      this.playCalls++;
      if (!this.denied) this.paused = false;
      return this.playResult;
    },
    pause() { this.paused = true; },
    /** Backgrounded-iOS mode: every play() is denied, element stays paused. */
    deny() {
      this.denied = true;
      const rejection = Promise.reject<void>(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
      rejection.catch(() => {}); // pre-handled — audioInstance attaches its own catch later
      this.playResult = rejection;
    },
    allow() {
      this.denied = false;
      this.playResult = Promise.resolve();
    },
    querySelector: () => ({ src: `http://sounds.test/${tone}.mp3` }),
  };
  return el;
}

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

// The pair, as main.ts wires it: loading + error, partners of each other.
// Blob preloads resolve immediately so tones are distinct blob: URLs.
async function makePair() {
  const loadEl = fakeAudioElement('loading');
  const errEl = fakeAudioElement('error');
  const loading = audioInstance(loadEl as unknown as HTMLAudioElement);
  const error = audioInstance(errEl as unknown as HTMLAudioElement);
  loading.setPartner(error);
  error.setPartner(loading);
  await loading.preloadBlob();
  await error.preloadBlob();
  return { loadEl, errEl, loading, error };
}

describe('feedback sounds — the tone-swap rule', () => {
  beforeEach(() => {
    let counter = 0;
    vi.stubGlobal('window', {});
    // Blob preloads succeed instantly; each instance gets a distinct URL.
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(new Blob(['x'])))));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => `blob:tone-${++counter}`),
      revokeObjectURL: vi.fn(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('from silence, a tone starts on its own element', async () => {
    const { loadEl, loading } = await makePair();

    loading.play();
    expect(loadEl.playCalls).toBe(1);
    expect(loadEl.getAttribute('src')).toBe('blob:tone-1');
    expect(loadEl.paused).toBe(false);
  });

  it('changing tones swaps the src of the playing element — the other element never starts', async () => {
    const { loadEl, errEl, loading, error } = await makePair();

    // loading → error (applyFx order: the new tone plays, then the old stops)
    loading.play();
    error.play();
    loading.stop();

    expect(loadEl.paused).toBe(false);                    // still the live element
    expect(loadEl.getAttribute('src')).toBe('blob:tone-2'); // …now sounding the error tone
    expect(errEl.playCalls).toBe(0);                      // error element untouched
  });

  it('switching back reclaims the element for its own tone — still gapless', async () => {
    const { loadEl, errEl, loading, error } = await makePair();

    loading.play();
    error.play();
    loading.stop();          // loadEl carries the error tone

    // error → loading (user retries a station)
    loading.play();
    error.stop();

    expect(loadEl.paused).toBe(false);
    expect(loadEl.getAttribute('src')).toBe('blob:tone-1'); // own tone again
    expect(errEl.playCalls).toBe(0);
  });

  it('a denied swap keeps the current tone audible — never trade audible for silent', async () => {
    const { loadEl, errEl, loading, error } = await makePair();

    loading.play();
    loadEl.deny();           // locked iPhone: even the continuation is refused
    error.play();
    loading.stop();
    await flushPromises();

    expect(loadEl.getAttribute('src')).toBe('blob:tone-1'); // reverted to its own tone
    expect(errEl.playCalls).toBe(0);
  });

  it('a stop during a pending tone swap must not resurrect the sound', async () => {
    // Device-observed zombie: the swap's play() settles LATE (iOS latency),
    // the stream recovers meanwhile and applyFx('playing') stops the tones —
    // then the late rejection used to revert-and-restart the element, playing
    // the loading tone UNDER the live radio, unstoppable (isPlaying already
    // false, so later stops skipped it).
    const { loadEl, loading, error } = await makePair();

    loading.play();
    let rejectSwap!: (e: unknown) => void;
    loadEl.playResult = new Promise((_, reject) => { rejectSwap = reject; });
    error.play();            // tone swap onto the live element is in flight
    loading.stop();

    // The stream recovers: applyFx('playing') stops both tones.
    loading.stop();
    error.stop();
    expect(loadEl.paused).toBe(true);

    // The swap's rejection lands only now.
    rejectSwap(Object.assign(new Error('denied'), { name: 'NotAllowedError' }));
    await flushPromises();

    expect(loadEl.paused).toBe(true);           // stays dead
    expect(loadEl.getAttribute('src')).toBe(''); // no revert, no restart
  });

  it('a user stop silences everything, including a carrying element', async () => {
    const { loadEl, errEl, loading, error } = await makePair();

    loading.play();
    error.play();
    loading.stop();          // loadEl carries the error tone

    // applyFx for idle/paused: both tones stop.
    loading.stop();
    error.stop();

    expect(loadEl.paused).toBe(true);
    expect(loadEl.getAttribute('src')).toBe('');
    expect(errEl.paused).toBe(true);
  });

  it('a user gesture revives a desired-but-silent sound (the tap is never squandered)', async () => {
    const { errEl, error } = await makePair();

    errEl.deny();            // dead session: the fresh start was denied
    error.play();
    await flushPromises();
    expect(errEl.paused).toBe(true);

    errEl.allow();           // unlock + tap: play works inside a gesture
    error.warmUp();
    expect(errEl.paused).toBe(false);
    expect(errEl.getAttribute('src')).toBe('blob:tone-2');
  });

  it('the supervisor does not disturb a play() still waiting for its blob', async () => {
    // Regression guard for a real silence bug: an ensure() tick landing
    // mid-preload used to reject on the empty src and cancel the pending
    // start, adding a tick of silence right when the sound mattered.
    const loadEl = fakeAudioElement('loading');
    const loading = audioInstance(loadEl as unknown as HTMLAudioElement);
    let resolveFetch!: (r: Response) => void;
    (fetch as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise<Response>((resolve) => { resolveFetch = resolve; }),
    );

    loading.play();          // blob preload pending — nothing started yet
    await flushPromises();
    loading.ensure();
    expect(loadEl.playCalls).toBe(0);

    resolveFetch(new Response(new Blob(['x'])));
    await flushPromises();
    expect(loadEl.playCalls).toBe(1); // the original start still fired
  });
});
