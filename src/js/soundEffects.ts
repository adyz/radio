/**
 * Feedback sounds (loading/error noise) played through real <audio> elements.
 *
 * They MUST be real <audio> elements — a Web Audio attempt was reverted
 * because iOS drops the media session without an active <audio> element
 * (see git history: 69a58f2). Sounds start from an in-memory blob so they
 * work offline and without any network round-trip at the critical moment.
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

export type SoundInstance = ReturnType<typeof audioInstance>;

export function audioInstance(htmlElement: HTMLAudioElement) {
  let initialSrc = htmlElement.querySelector('source')!.src;
  let isPlaying = false;
  let blobUrl: string | null = null;
  let playGeneration = 0;
  let preloadPromise: Promise<string | null> | null = null;
  htmlElement.dataset.blobReady = 'false';

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
      playGeneration++;
      htmlElement.pause();
      htmlElement.src = '';
      isPlaying = false;
    },
    // Self-healing: called periodically by the core's sound supervisor while
    // this sound is supposed to be audible. Restarts playback if a play()
    // was rejected (background/autoplay policy) or the OS paused the element.
    ensure() {
      if (!isPlaying) {
        play();
        return;
      }
      if (htmlElement.paused) {
        const gen = playGeneration;
        htmlElement.play().catch((error) => {
          if (gen !== playGeneration) return;
          if (!isAbortError(error)) isPlaying = false; // retried next tick
        });
      }
    },
    warmUp() {
      if (isPlaying) return;
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
  };
}
