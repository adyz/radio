/**
 * Feedback sounds (loading/error noise) played through real <audio> elements.
 *
 * They MUST be real <audio> elements — a Web Audio attempt was reverted
 * because iOS drops the media session without an active <audio> element
 * (see git history: 69a58f2). Sounds start from an in-memory blob so they
 * work offline and without any network round-trip at the critical moment.
 *
 * =====================================================================
 * Sound handoff protocol (rules verified on a real iPhone, 2026-07-03,
 * re-validated for R4b — see plan.md, faza R4b):
 *
 *   1. Backgrounded iOS DENIES any fresh play() start — even on a warmed-up
 *      element, even while another element of the page is playing.
 *   2. Backgrounded iOS ALLOWS an element that is already playing to swap
 *      its src and continue (the playlist pattern).
 *   3. After the audio session dies, even FOREGROUND programmatic play()
 *      is denied — only a play() inside a user-gesture call stack revives
 *      it (see gesture reconcile in warmUp()).
 *
 * Product invariant: once the user pressed play, something must always be
 * audible. So when one feedback sound replaces the other (loading <-> error):
 *
 *   - deferred stop  — the OLD sound keeps playing until the NEW one actually
 *     produces audio (its 'playing' event); no silent gap ever opens.
 *   - carry          — if the new sound still hasn't started by a supervisor
 *     tick (rule 1 denied it) while the old one is audible, the old ELEMENT
 *     carries the new sound: its src is swapped to the new tone (rule 2).
 *   - reclaim        — play()/stop() on a carrying element automatically
 *     restore its own sound / release the deferral.
 *   - gesture reconcile — every user gesture re-asserts the desired sound
 *     if its element is silent (rule 3): the intent flag must never
 *     squander a gesture.
 *
 * A user stop/pause silences both immediately: stopping a still-pending
 * sound settles it, which releases the partner's deferred stop too.
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
  play(): void;
  stop(): void;
  /** Supervisor hook: re-assert playback if a play() was denied or the OS
   *  paused the element; escalates to carrySound() on the partner. */
  ensure(): void;
  /** User-gesture hook: reconcile reality (restart a denied-but-desired
   *  sound inside the gesture stack) or bless an idle element. */
  warmUp(): void;
  preloadBlob(): Promise<string | null>;
  /** True between play() and the element actually producing audio. */
  isStartPending(): boolean;
  /** Runs callback once this sound starts OR is stopped — whichever first. */
  onStartSettled(callback: () => void): void;
  setPartner(partner: SoundInstance): void;
  isAudiblyPlaying(): boolean;
  /** Carry the partner's sound on this (already playing) element: swap src
   *  and continue — the one playback start backgrounded iOS allows. */
  carrySound(src: string): void;
}

export function audioInstance(htmlElement: HTMLAudioElement): SoundInstance {
  let initialSrc = htmlElement.querySelector('source')!.src;
  let isPlaying = false;
  let blobUrl: string | null = null;
  let playGeneration = 0;
  let preloadPromise: Promise<string | null> | null = null;
  htmlElement.dataset.blobReady = 'false';

  // --- Handoff state (see protocol above) ---
  let partner: SoundInstance | null = null;
  let startPending = false;
  let deferredStopGeneration = 0; // invalidates a queued deferred stop
  let carriedSrc: string | null = null; // set while carrying the partner's sound
  let carryAttempted = false; // ask the partner to carry at most once per play cycle
  const startSettlers: Array<() => void> = [];

  const settleStart = () => {
    startPending = false;
    while (startSettlers.length) startSettlers.shift()!();
  };
  htmlElement.addEventListener('playing', settleStart);

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
    htmlElement.src = blobUrl || initialSrc;
    htmlElement.currentTime = 0;
    htmlElement.play().catch((error) => {
      if (gen !== playGeneration) return;
      if (!isAbortError(error)) console.error('Error playing audio:', error);
      isPlaying = false;
    });
  };

  const play = () => {
    // Fresh play intent: cancel a queued deferred stop for this instance
    // (error → loading → error flapping while the partner never started)
    // and reclaim the element if it was carrying the partner's sound.
    deferredStopGeneration++;
    carryAttempted = false;
    if (carriedSrc) {
      carriedSrc = null;
      isPlaying = false;
    }
    if (!isPlaying) {
      startPending = true;
      const gen = ++playGeneration;
      isPlaying = true;
      if (blobUrl) {
        startPlayback(gen);
        return;
      }
      preloadBlob().then(() => startPlayback(gen));
    }
  };

  const doStop = () => {
    playGeneration++;
    htmlElement.pause();
    htmlElement.src = '';
    isPlaying = false;
    carriedSrc = null;
    carryAttempted = false;
  };

  return {
    play,
    stop() {
      // This sound will never start now — settle it, which also releases a
      // partner waiting on us (so a user stop silences BOTH immediately).
      startPending = false;
      settleStart();

      // Deferred stop: while the replacement sound hasn't produced audio yet,
      // keep this one playing (see protocol rule 1 — the silent gap is where
      // iOS denies the replacement's start).
      if (partner?.isStartPending()) {
        const gen = ++deferredStopGeneration;
        partner.onStartSettled(() => {
          if (gen === deferredStopGeneration) doStop();
        });
        return;
      }
      doStop();
    },
    ensure() {
      if (!isPlaying) {
        play();
      } else if (htmlElement.paused && htmlElement.getAttribute('src')) {
        // (No src attribute means play() is still waiting for the blob —
        // poking play() would reject on the empty source and cancel the
        // pending start; leave that one alone.)
        const gen = playGeneration;
        htmlElement.play().catch((error) => {
          if (gen !== playGeneration) return;
          if (!isAbortError(error)) isPlaying = false; // retried next tick
        });
      }

      // Escalation: our start keeps being denied but the partner element is
      // audible — have IT carry our sound (protocol rule 2).
      if (startPending && htmlElement.paused && !carryAttempted && partner?.isAudiblyPlaying()) {
        carryAttempted = true;
        partner.carrySound(blobUrl || initialSrc);
      }
    },
    // Called from every playback-starting user gesture (play/prev/next/
    // station select). Two jobs:
    // 1. Gesture reconcile (protocol rule 3): if this sound SHOULD be
    //    audible but its element sits silent after a denied start, restart
    //    it INSIDE the gesture call stack — the one context iOS honors.
    //    The intent flag alone used to squander the gesture (plan.md R4b).
    // 2. Otherwise the classic warm-up: a split-second play/pause so iOS
    //    blesses the element for later programmatic starts.
    warmUp() {
      if (isPlaying) {
        if (htmlElement.paused && htmlElement.getAttribute('src')) {
          const gen = playGeneration;
          htmlElement.play().catch((error) => {
            if (gen !== playGeneration) return;
            if (!isAbortError(error)) isPlaying = false; // supervisor retries
          });
        }
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
    isStartPending: () => startPending,
    onStartSettled(callback: () => void) {
      startSettlers.push(callback);
    },
    setPartner(p: SoundInstance) {
      partner = p;
    },
    isAudiblyPlaying: () => isPlaying && !htmlElement.paused,
    carrySound(src: string) {
      if (!isPlaying || htmlElement.paused) return; // nothing audible to lend
      if (carriedSrc === src) return;               // already carrying it
      carriedSrc = src;
      htmlElement.src = src;
      htmlElement.currentTime = 0;
      htmlElement.play().catch(() => {
        // Even the continuation was denied — restore our own sound rather
        // than trade something audible for silence.
        carriedSrc = null;
        htmlElement.src = blobUrl || initialSrc;
        htmlElement.currentTime = 0;
        htmlElement.play().catch(() => {});
      });
    },
  };
}
