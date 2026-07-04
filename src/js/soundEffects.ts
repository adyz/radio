/**
 * Feedback sounds (loading/error noise) played through real <audio> elements.
 *
 * They MUST be real <audio> elements — a Web Audio attempt was reverted
 * because iOS drops the media session without an active <audio> element
 * (see git history: 69a58f2). Sounds start from an in-memory blob so they
 * work offline and without any network round-trip at the critical moment.
 *
 * =====================================================================
 * The tone-swap rule (iOS behavior verified on a real iPhone; design
 * decision by Adrian, 2026-07-04 — see plan.md, faza R4b):
 *
 *   Backgrounded iOS DENIES any fresh play() start, but ALLOWS an element
 *   that is already playing to swap its src and continue (the playlist
 *   pattern). After the audio session dies, even foreground programmatic
 *   play() is denied — only a play() inside a user-gesture call stack
 *   revives it.
 *
 * So there is ONE mechanism, not a fallback chain:
 *
 *   - At most one feedback element is live at a time. Changing tones
 *     (loading <-> error) NEVER starts the other element — it swaps the
 *     src of the element that is already playing (carry). Gapless by
 *     construction, and exactly the continuation iOS permits.
 *   - A fresh element start happens only from silence (first play, station
 *     change while idle) — always foreground/gesture contexts.
 *   - A denied swap restores the element's own tone: never trade something
 *     audible for silence.
 *   - Every user gesture reconciles reality (warmUp): a desired-but-silent
 *     sound restarts inside the gesture call stack.
 * =====================================================================
 */

import { isAbortError } from './radioMachine';

// Keep in sync with src/public/sw.js so page-level preloads and SW precache
// share the same durable sound cache.
export const SOUND_CACHE_NAME = 'radio-sounds-v2';

async function openSoundCache() {
  if (!('caches' in window)) return;
  try {
    return await caches.open(SOUND_CACHE_NAME);
  } catch (_) {
    return null;
  }
}

async function cacheSoundResponse(src: string, response: Response) {
  try {
    const cache = await openSoundCache();
    if (cache) await cache.put(src, response.clone());
  } catch (_) {
    // Cache writes are best-effort; the in-memory blob still matters most.
  }
}

async function getSoundResponse(src: string): Promise<Response> {
  const cache = await openSoundCache();
  try {
    const cached = await cache?.match(src);
    if (cached) return cached;
  } catch (_) {
    // Cache reads are best-effort; fall back to network.
  }

  const response = await fetch(src);
  if (!response.ok) throw new Error(String(response.status));
  await cacheSoundResponse(src, response);
  return response;
}

export interface SoundInstance {
  /** My tone must sound: swap it onto the live partner element if one is
   *  audible (the only start backgrounded iOS allows), else start fresh. */
  play(): void;
  /** My tone must no longer sound — wherever it currently lives. */
  stop(): void;
  /** Supervisor hook: re-assert playback if a play() was denied or the OS
   *  paused the element carrying this tone. */
  ensure(): void;
  /** User-gesture hook: reconcile reality (restart a denied-but-desired
   *  sound inside the gesture stack) or bless an idle element. */
  warmUp(): void;
  preloadBlob(): Promise<string | null>;
  setPartner(partner: SoundInstance): void;
  isAudiblyPlaying(): boolean;
  /** True while this element is sounding the PARTNER's tone. */
  isCarrying(): boolean;
  /** Swap this (already playing) element's src to the given tone. */
  carrySound(src: string): void;
  /** Stop this element because the tone it carries is no longer wanted. */
  stopCarried(): void;
  /** Re-assert playback if this live element sits paused (denied/OS pause). */
  reassert(): void;
}

export function audioInstance(htmlElement: HTMLAudioElement): SoundInstance {
  let initialSrc = htmlElement.querySelector('source')!.src;
  let isPlaying = false;
  let blobUrl: string | null = null;
  let playGeneration = 0;
  let preloadPromise: Promise<string | null> | null = null;
  htmlElement.dataset.blobReady = 'false';

  let partner: SoundInstance | null = null;
  let carriedSrc: string | null = null; // set while sounding the partner's tone

  const ownSrc = () => blobUrl || initialSrc;

  const preloadBlob = () => {
    if (blobUrl) return Promise.resolve(blobUrl);
    if (preloadPromise) return preloadPromise;

    htmlElement.dataset.blobReady = 'pending';
    preloadPromise = getSoundResponse(initialSrc)
      .then(r => r.blob())
      .then(blob => {
        if (blobUrl) URL.revokeObjectURL(blobUrl);
        blobUrl = URL.createObjectURL(blob);
        htmlElement.dataset.blobReady = 'true';
        return blobUrl;
      })
      .catch(err => {
        htmlElement.dataset.blobReady = 'false';
        console.warn('Audio blob preload failed:', initialSrc, err);
        return null;
      })
      .finally(() => { preloadPromise = null; });

    return preloadPromise;
  };

  const startPlayback = (gen: number) => {
    if (gen !== playGeneration || !isPlaying) return;
    htmlElement.volume = 1;
    htmlElement.src = ownSrc();
    htmlElement.currentTime = 0;
    htmlElement.play().catch((error) => {
      if (gen !== playGeneration) return;
      if (!isAbortError(error)) console.error('Error playing audio:', error);
      isPlaying = false;
    });
  };

  const doStop = () => {
    playGeneration++;
    htmlElement.pause();
    htmlElement.src = '';
    isPlaying = false;
    carriedSrc = null;
  };

  // Re-assert playback on an element that should be audible but sits paused
  // (a denied play() or an OS pause). No src attribute means the initial
  // play() is still waiting for the blob — poking play() would reject on the
  // empty source and cancel that pending start; leave it alone.
  const reassertPlayback = () => {
    if (!htmlElement.paused || !htmlElement.getAttribute('src')) return;
    const gen = playGeneration;
    htmlElement.play().catch((error) => {
      if (gen !== playGeneration) return;
      if (!isAbortError(error)) isPlaying = false; // retried next supervisor tick
    });
  };

  const play = () => {
    // The one rule: never start a second element while one is audible —
    // swap the tone onto the element that already plays.
    if (partner?.isAudiblyPlaying()) {
      if (isPlaying) doStop(); // clean up a dead attempt of our own
      partner.carrySound(ownSrc());
      return;
    }
    if (isPlaying && carriedSrc) {
      // Our element is live but sounding the partner's tone — take it back.
      carriedSrc = null;
      htmlElement.src = ownSrc();
      htmlElement.currentTime = 0;
      const gen = playGeneration;
      htmlElement.play().catch((error) => {
        if (gen !== playGeneration) return;
        if (!isAbortError(error)) isPlaying = false;
      });
      return;
    }
    if (!isPlaying) {
      const gen = ++playGeneration;
      isPlaying = true;
      if (blobUrl) {
        startPlayback(gen);
        return;
      }
      preloadBlob().then(() => startPlayback(gen));
    }
  };

  return {
    play,
    stop() {
      // My tone may be living on the partner element (carry) — stop it there.
      if (partner?.isCarrying()) partner.stopCarried();
      // Stop my own element unless it is busy sounding the partner's tone
      // (then the partner's stop() is the one that releases it).
      if (isPlaying && !carriedSrc) doStop();
    },
    ensure() {
      // My tone lives on the partner element — keep THAT one honest.
      if (partner?.isCarrying()) {
        partner.reassert();
        return;
      }
      if (!isPlaying) {
        play();
        return;
      }
      reassertPlayback();
    },
    // Called from every playback-starting user gesture (play/prev/next/
    // station select). If this element should be audible but sits silent
    // after a denied start, restart it INSIDE the gesture call stack — the
    // one context iOS always honors (the intent flag alone used to squander
    // the gesture). Otherwise the classic warm-up: a split-second play/pause
    // so iOS blesses the element for later programmatic starts.
    warmUp() {
      if (isPlaying) {
        reassertPlayback();
        return;
      }
      if (!blobUrl) {
        preloadBlob();
        return;
      }

      const gen = playGeneration;
      htmlElement.src = blobUrl;
      htmlElement.play().then(() => {
        if (gen === playGeneration && !isPlaying) {
          htmlElement.pause();
          htmlElement.currentTime = 0;
        }
      }).catch(() => {});
    },
    preloadBlob,
    setPartner(p: SoundInstance) {
      partner = p;
    },
    isAudiblyPlaying: () => isPlaying && !htmlElement.paused,
    isCarrying: () => carriedSrc !== null,
    stopCarried: doStop,
    reassert: reassertPlayback,
    carrySound(src: string) {
      if (!isPlaying || htmlElement.paused) return; // nothing audible to lend
      if ((carriedSrc ?? ownSrc()) === src) return; // already sounding this tone
      carriedSrc = src;
      htmlElement.src = src;
      htmlElement.currentTime = 0;
      htmlElement.play().catch(() => {
        // Even the continuation was denied — restore our own sound rather
        // than trade something audible for silence.
        carriedSrc = null;
        htmlElement.src = ownSrc();
        htmlElement.currentTime = 0;
        htmlElement.play().catch(() => {});
      });
    },
  };
}
