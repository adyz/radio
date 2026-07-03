/**
 * Radio Player — DOM glue layer (uses the radioCore state machine)
 */

import { createRadioCore, type RadioCore, type RadioState } from './radioCore';

declare global {
  interface Window {
    electronAPI?: {
      onMediaControl(callback: (command: string) => void): void;
      updatePlaybackState(isPlaying: boolean): void;
    };
  }
}

document.addEventListener("touchstart", function () { }, true);

// --- DOM refs ---

// The markup is ours (src/index.html), so a missing id is a build-time bug —
// fail loudly instead of null-checking every use site.
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: #${id}`);
  return node as T;
}

const radioSelect = el<HTMLSelectElement>('radioSelect');
const player = el<HTMLAudioElement>('player');
const loadingNoise = el<HTMLAudioElement>('loadingNoise');
const errorNoise = el<HTMLAudioElement>('errorNoise');
const loadingMsg = el<HTMLElement>('loadingMsg');
const errorMsg = el<HTMLElement>('errorMsg');

const prevButton = el<HTMLButtonElement>('prevButton');
const playButton = el<HTMLButtonElement>('playButton');
const pauseButton = el<HTMLButtonElement>('pauseButton');
const stopButton = el<HTMLButtonElement>('stopButton');
const nextButton = el<HTMLButtonElement>('nextButton');

const logoButton = el<HTMLButtonElement>('logoButton');
const posterImage = el<HTMLButtonElement>('posterImage');

// --- Cloudinary ---

// --- All user-facing labels (single source of truth) ---
const LABELS = {
  appName:  'Coji Radio Player',
  loading:  'Se încarcă...',
  error:    'Eroare',
};

// Keep in sync with src/sw.js so page-level preloads and SW precache share
// the same durable sound cache.
const SOUND_CACHE_NAME = 'radio-sounds-v2';

function cloudinaryImageUrl(text: string, live = false) {
  const url_non_live = 'nndti4oybhdzggf8epvh';
  const url_live = 'rhz6yy4btbqicjqhsy7a';
  const encoded = encodeURIComponent(text);
  return `https://res.cloudinary.com/adrianf/image/upload/c_scale,h_480,w_480/w_400,g_south_west,x_50,y_70,c_fit,l_text:arial_90:${encoded}/${live ? url_live : url_non_live}`;
}

// Pre-cache status images + station name images into Cache API for offline use
const STATUS_IMAGE_TEXTS = [
  ...Object.values(LABELS),
  ...Array.from(radioSelect.options).map(o => o.text),
];
if ('caches' in window) {
  caches.open('radio-images-v3').then(cache => {
    STATUS_IMAGE_TEXTS.forEach(text => {
      const url = cloudinaryImageUrl(text);
      cache.match(url)
        .then(hit => {
          if (!hit) {
            return fetch(url, { mode: 'no-cors' }).then(res => {
              if (res.ok || res.type === 'opaque') return cache.put(url, res);
            });
          }
        })
        .catch(() => { /* offline or CORS — ignore, SW will cache on next online visit */ });
    });
  }).catch(() => { /* cache API unavailable */ });
}

// Restore last station before anything reads selectedIndex
function getStoredStationIndex() {
  const parsed = Number.parseInt(localStorage.getItem('lastRadioIndex') ?? '', 10);
  if (!Number.isInteger(parsed)) return null;
  if (parsed < 0 || parsed >= radioSelect.options.length) return null;
  return parsed;
}

const restoredStationIndex = getStoredStationIndex();
const hasRestoredStation = restoredStationIndex !== null;
if (hasRestoredStation) {
  radioSelect.selectedIndex = restoredStationIndex;
}

// --- Sound effects via <audio> elements ---
// These play through real <audio> elements to keep the iOS MediaSession alive.
// MediaSession action handlers are re-registered on every state transition to
// prevent iOS from resetting them when a different <audio> element takes over.

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

interface SfxInstance {
  play(): void;
  stop(): void;
  ensure(): void;
  warmUp(): void;
  preloadBlob(): Promise<string | null>;
  isStartPending(): boolean;
  onStartSettled(callback: () => void): void;
  setPartner(partner: SfxInstance): void;
}

function audioInstance(htmlElement: HTMLAudioElement): SfxInstance {
  let initialSrc = htmlElement.querySelector('source')!.src;
  let isPlaying = false;
  let blobUrl: string | null = null;
  let playGeneration = 0;
  let preloadPromise: Promise<string | null> | null = null;
  htmlElement.dataset.blobReady = 'false';

  // --- Graceful handoff state ---
  // iOS kills the app's audio session in any gap of silence and then denies
  // the next play(). When this sound replaces its partner (loading <-> error),
  // the partner keeps playing until THIS element actually produces audio
  // ('playing' event) — only then does the partner's deferred stop run.
  let partner: SfxInstance | null = null;
  let startPending = false;
  let stopDeferGeneration = 0;
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
      if (error.name !== 'AbortError') console.error('Error playing audio:', error);
      isPlaying = false;
    });
  };

  const play = () => {
    // Any play intent cancels a deferred stop queued for this instance
    // (e.g. error → loading → error flapping while the partner never started).
    stopDeferGeneration++;
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
  };

  return {
    play,
    stop() {
      // This sound will never start now — release anyone waiting on it
      // (the partner's own deferred stop), so a user stop silences BOTH.
      startPending = false;
      settleStart();

      // Handoff: if the replacement sound was asked to play but hasn't
      // produced audio yet, keep this one playing until it does — a gap of
      // silence here is where iOS would deny the replacement's play().
      if (partner?.isStartPending()) {
        const deferGen = ++stopDeferGeneration;
        partner.onStartSettled(() => {
          if (deferGen === stopDeferGeneration) doStop();
        });
        return;
      }
      doStop();
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
          if (error.name !== 'AbortError') isPlaying = false; // retried next tick
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
    isStartPending: () => startPending,
    onStartSettled(callback: () => void) {
      startSettlers.push(callback);
    },
    setPartner(p: SfxInstance) {
      partner = p;
    },
  };
}

const loadingNoiseInstance = audioInstance(loadingNoise);
const errorNoiseInstance = audioInstance(errorNoise);
// Each sound hands off gracefully to the other (see audioInstance.stop()).
loadingNoiseInstance.setPartner(errorNoiseInstance);
errorNoiseInstance.setPartner(loadingNoiseInstance);

// Eagerly preload sound blobs so loading/error feedback can start from memory.
// fetch() doesn't need a user gesture — only playback does.
preloadAudioBlobs();

// Shared helper — registers all MediaSession action handlers.
// Called from both updateMediaSession() (every state transition) and
// reRegisterMediaSessionHandlers() (after sound-effect playback steals focus).
function registerMediaSessionHandlers() {
  navigator.mediaSession.setActionHandler('previoustrack', () => core.prevRadio());
  navigator.mediaSession.setActionHandler('nexttrack',     () => core.nextRadio());
  navigator.mediaSession.setActionHandler('pause', () => {
    const s = core.getState();
    // During loading/error the sound effects are playing, not the stream.
    // "Pause" should cancel everything (same as the on-screen stop button).
    if (s === 'loading' || s === 'retrying' || s === 'error' || s === 'recovering') {
      core.stopRadio();
    } else {
      core.pauseRadio();
    }
  });
  navigator.mediaSession.setActionHandler('play',          () => core.resumeRadio());
  navigator.mediaSession.setActionHandler('seekbackward', null);
  navigator.mediaSession.setActionHandler('seekforward',  null);
}

// When loading/error sounds start playing, iOS hands media session to that
// <audio> element and resets all action handlers.  Re-register them here so
// the lock-screen shows prev/next instead of skip ±10 s.
// Also force playbackState='playing' so macOS doesn't briefly show "Not Playing"
// in the gap between pausing the main player and the sound effect producing audio.
function reRegisterMediaSessionHandlers() {
  if (!('mediaSession' in navigator) || !core) return;
  navigator.mediaSession.playbackState = 'playing';
  registerMediaSessionHandlers();
  // iOS picks up the sound effect's duration as "now playing" — clear it.
  try { navigator.mediaSession.setPositionState({}); } catch (_) {}
}
loadingNoise.addEventListener('play', reRegisterMediaSessionHandlers);
loadingNoise.addEventListener('playing', reRegisterMediaSessionHandlers);
errorNoise.addEventListener('play', reRegisterMediaSessionHandlers);
errorNoise.addEventListener('playing', reRegisterMediaSessionHandlers);

// Mobile browsers re-read duration from the active <audio> element after our
// initial setPositionState() clear, causing a countdown timer to appear.
// Repeatedly clear it on every timeupdate tick so the OS never shows the
// sound effect's finite duration.
// Feature-detect once to avoid repeated exceptions on unsupported browsers.
let canClearPositionState = true;
try { navigator.mediaSession.setPositionState({}); } catch (_) { canClearPositionState = false; }
function clearSfxPositionState() {
  if (canClearPositionState) {
    try { navigator.mediaSession.setPositionState({}); } catch (_) { canClearPositionState = false; }
  }
}
loadingNoise.addEventListener('timeupdate', clearSfxPositionState);
errorNoise.addEventListener('timeupdate', clearSfxPositionState);

// When a sound effect pauses (e.g. loadingSound.stop() after stream loaded),
// macOS briefly shows "Not Playing" because the active audio source just stopped.
// Re-assert playbackState so the OS doesn't flash "Not Playing" in the gap before
// it picks up audio from the main player.
function reassertPlaybackState() {
  if (!('mediaSession' in navigator) || !core) return;
  const s = core.getState();
  if (s === 'playing' || s === 'loading' || s === 'retrying' || s === 'error' || s === 'recovering') {
    navigator.mediaSession.playbackState = 'playing';
    try { navigator.mediaSession.setPositionState({}); } catch (_) {}
  }
}
loadingNoise.addEventListener('pause', reassertPlaybackState);
errorNoise.addEventListener('pause', reassertPlaybackState);

// Preload audio blobs once per page. Re-called from user interactions as a retry
// if the eager page-load preload failed.
function preloadAudioBlobs() {
  loadingNoiseInstance.preloadBlob();
  errorNoiseInstance.preloadBlob();
}

// --- UI helpers ---

function isPlaybackControl(element: Element | null) {
  return element === playButton || element === pauseButton || element === stopButton;
}

function focusInitialPlaybackControl() {
  if (document.activeElement && document.activeElement !== document.body) return;
  playButton.focus();
}

const showButton = (which: 'play' | 'pause' | 'stop') => {
  const shouldPreserveFocus = isPlaybackControl(document.activeElement);
  const nextButton = which === 'play' ? playButton : which === 'pause' ? pauseButton : stopButton;

  playButton.classList.toggle('hidden', which !== 'play');
  pauseButton.classList.toggle('hidden', which !== 'pause');
  stopButton.classList.toggle('hidden', which !== 'stop');

  if (shouldPreserveFocus) nextButton.focus();
};

// core reference — assigned right below, but updateMediaSession runs once
// during createRadioCore() itself (initial setState('idle')), before the
// assignment lands; the `if (core)` runtime guards cover that window.
let core!: RadioCore;

let pendingServiceWorkerReload = false;
let serviceWorkerReloaded = false;

function reloadForServiceWorkerUpdate() {
  if (serviceWorkerReloaded) return;
  serviceWorkerReloaded = true;
  pendingServiceWorkerReload = false;
  window.location.reload();
}

function maybeReloadForPendingServiceWorkerUpdate(newState: RadioState) {
  if (pendingServiceWorkerReload && newState === 'idle') reloadForServiceWorkerUpdate();
}

function requestServiceWorkerReload() {
  if (serviceWorkerReloaded) return;
  if (core?.getState() === 'idle') {
    reloadForServiceWorkerUpdate();
    return;
  }
  pendingServiceWorkerReload = true;
}

const updateMediaSession = (newState: RadioState) => {
  const title = radioSelect.options[radioSelect.selectedIndex].text;
  const isIdle = newState === 'idle';
  const isLoading = newState === 'loading' || newState === 'retrying';
  const hasError = newState === 'error' || newState === 'recovering';
  const isLive = newState === 'playing';

  const idleText = hasRestoredStation ? title : LABELS.appName;
  const displayText = isIdle ? idleText : isLoading ? LABELS.loading : hasError ? LABELS.error : title;

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: isLoading ? `${LABELS.loading}${title}` : hasError ? `${LABELS.error} la încărcarea ${title}` : isIdle ? idleText : title,
      artist: `${LABELS.appName}${isIdle && !hasRestoredStation ? '' : ` | ${title}`}`,
      artwork: [{ src: cloudinaryImageUrl(displayText, isLive) }]
    });

    // Re-register ALL action handlers on every state transition.
    // iOS resets them when a different <audio> element (loading/error sound)
    // becomes the active "now playing" source.
    if (core) {
      registerMediaSessionHandlers();
    }

    // Keep session alive during loading/error (sounds are playing via <audio>)
    navigator.mediaSession.playbackState = (isLive || isLoading || hasError) ? 'playing' : newState === 'paused' ? 'paused' : 'none';

    // Clear position state for active/paused states — tells the OS there's no
    // seekable timeline, so it won't show a finite progress bar.
    if (isLive || isLoading || hasError || newState === 'paused') {
      try { navigator.mediaSession.setPositionState({}); } catch (_) {}
    }
  }

  posterImage.querySelector('img')!.src = cloudinaryImageUrl(displayText, isLive);
  document.title = `${isLoading ? "⏳" : ''} ${hasError ? '❤️‍🩹' : ''} ${isLive ? '🔴' : ''} ${isIdle ? idleText : isLoading ? `${LABELS.loading} ${title}` : hasError ? LABELS.error : title}`;
  loadingMsg.innerText = isLoading ? `${LABELS.loading} ${title}` : '';
  maybeReloadForPendingServiceWorkerUpdate(newState);
};

core = createRadioCore({
  getStationUrl:    (i) => radioSelect.options[i].value,
  getStationCount:  () => radioSelect.options.length,
  getSelectedIndex: () => radioSelect.selectedIndex,
  setSelectedIndex: (i) => { radioSelect.selectedIndex = i; },
  playerPlay:       () => player.play(),
  playerPause:      () => player.pause(),
  playerSetSrc:     (url) => { player.src = url; },
  playerLoad:       () => player.load(),
  playerIsPaused:   () => player.paused,
  playerCurrentTime: () => player.currentTime,
  loadingSound:     loadingNoiseInstance,
  errorSound:       errorNoiseInstance,
  showButton,
  setLoadingMsg:    (v) => loadingMsg.classList.toggle('invisible', !v),
  setErrorMsg:      (v) => errorMsg.classList.toggle('invisible', !v),
  updateMediaSession,
  saveLastIndex:    (i) => localStorage.setItem('lastRadioIndex', String(i)),
  setTimeout,
  clearTimeout:  (id) => clearTimeout(id ?? undefined),
  setInterval,
  clearInterval: (id) => clearInterval(id ?? undefined),
  performanceNow:   () => performance.now(),
  isOnline:          () => navigator.onLine,
});
focusInitialPlaybackControl();

// --- Event listeners ---

radioSelect.addEventListener('change', () => {
  if (radioSelect.value) {
    core.playRadio(radioSelect.selectedIndex);
  } else {
    core.stopRadio();
  }
});

// Electron
const electronAPI = window.electronAPI;
if (electronAPI) {
  electronAPI.onMediaControl((command) => {
    if (command === "playpause") {
      core.togglePlayPause();
    } else if (command === "next") {
      core.nextRadio();
    } else if (command === "previous") {
      core.prevRadio();
    }
  });

  document.addEventListener("DOMContentLoaded", () => {
    const updatePlaybackState = () =>
      electronAPI.updatePlaybackState(core.getState() === 'playing');
    player.addEventListener("play", updatePlaybackState);
    player.addEventListener("pause", updatePlaybackState);
  });
}

// Buttons
playButton.addEventListener('click', () => {
  preloadAudioBlobs();
  loadingNoiseInstance.warmUp();
  errorNoiseInstance.warmUp();
  core.onPlayButtonClick();
});
pauseButton.addEventListener('click', () => core.pauseRadio());
stopButton.addEventListener('click', () => core.stopRadio());

// Native audio events → core (iOS needs the mediaSession.playbackState override)
player.addEventListener('play', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
  core.onPlayerPlay();
});

player.addEventListener('pause', () => {
  const s = core.getState();
  // During loading/retrying/recovering the main player pauses while the loading
  // sound takes over.  Actively re-assert 'playing' so macOS doesn't flash
  // "Not Playing" in the gap.  Only signal 'paused' in normal playback states.
  if ('mediaSession' in navigator) {
    if (s === 'loading' || s === 'retrying' || s === 'recovering') {
      navigator.mediaSession.playbackState = 'playing';
    } else if (s === 'playing') {
      navigator.mediaSession.playbackState = 'paused';
    }
  }
  core.onPlayerPause();
});

// Stream failure during playback (lost WiFi, server died, etc.)
// Silent failures (no 'error' event, audio just stops — common on HLS and
// flaky wifi) are caught by the core's playback-progress watchdog instead of
// the unreliable 'stalled' event.
player.addEventListener('error', () => core.onPlayerError());

// Auto-recovery when network comes back
window.addEventListener('online', () => core.retryFromError());

// Prev / Next
prevButton.addEventListener('click', () => {
  preloadAudioBlobs();
  loadingNoiseInstance.warmUp();
  errorNoiseInstance.warmUp();
  core.prevRadio();
});
nextButton.addEventListener('click', () => {
  preloadAudioBlobs();
  loadingNoiseInstance.warmUp();
  errorNoiseInstance.warmUp();
  core.nextRadio();
});

// Keep alive worker
const worker = new Worker("./js/keepAlive.js");
worker.onmessage = () => {};

// Service Worker
if ('serviceWorker' in navigator) {
  let hasServiceWorkerController = Boolean(navigator.serviceWorker.controller);

  (async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(reg => {
        const swUrl = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
        if (!swUrl.endsWith('/sw.js') || swUrl.endsWith('/js/sw.js')) {
          return reg.unregister();
        }
        return Promise.resolve(false);
      }));
      const reg = await navigator.serviceWorker.register('./sw.js');
      reg.update();
    } catch (err) {
      console.error('Service Worker registration failed:', err);
    }
  })();

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hasServiceWorkerController) {
      hasServiceWorkerController = true;
      return;
    }
    requestServiceWorkerReload();
  });
}

// Theme color
function updateThemeColor() {
  const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const themeColor = isDarkMode ? '#434238' : '#fffdef';
  let metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (!metaThemeColor) {
    metaThemeColor = document.createElement('meta');
    metaThemeColor.setAttribute('name', 'theme-color');
    document.head.appendChild(metaThemeColor);
  }
  metaThemeColor.setAttribute('content', themeColor);
}
updateThemeColor();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColor);

// Custom selector UI
const new_selector_open_button = el<HTMLButtonElement>('new_selector__button');
const new_selector_content = el<HTMLElement>('new_selector__content');
const new_selector_button_example = el<HTMLButtonElement>('new_selector__button_example');
const new_selector_parent = el<HTMLElement>('new_selector__parent');

const radios = radioSelect.querySelectorAll('option');
const selectorOptionButtons: HTMLButtonElement[] = [];
let selectorFocusedIndex = radioSelect.selectedIndex;
let selectorReturnFocusElement: HTMLElement = new_selector_open_button;
const selectorTriggerButtons: HTMLElement[] = [new_selector_open_button, posterImage];

logoButton.addEventListener('click', () => {
  window.location.reload();
});

function isSelectorOpen() {
  return !new_selector_content.classList.contains('hidden');
}

function syncSelectorSelection() {
  selectorOptionButtons.forEach((button, index) => {
    const isSelected = radioSelect.selectedIndex === index;
    const isFocused = selectorFocusedIndex === index;
    button.classList.toggle('bg-Red', isSelected);
    button.setAttribute('aria-selected', String(isSelected));
    button.tabIndex = isSelectorOpen() && isFocused ? 0 : -1;
  });
}

function focusOption(index: number) {
  if (!selectorOptionButtons.length) return;

  const lastIndex = selectorOptionButtons.length - 1;
  const nextIndex = Math.max(0, Math.min(index, lastIndex));

  selectorFocusedIndex = nextIndex;
  syncSelectorSelection();

  const button = selectorOptionButtons[selectorFocusedIndex];

  button.focus({
    preventScroll: true,
  });

  button.scrollIntoView({
    behavior: "auto",
    block: "nearest",
    inline: "nearest",
  });
}

function setSelectorExpanded(isExpanded: boolean) {
  selectorTriggerButtons.forEach(el => {
    el.setAttribute('aria-expanded', String(isExpanded));
  });
}

function getCurrentSelectorIndex() {
  const index = radioSelect.selectedIndex;
  return index >= 0 && index < selectorOptionButtons.length ? index : 0;
}

function openSelector({ focusSelected = false, trigger = document.activeElement }: { focusSelected?: boolean; trigger?: Element | null } = {}) {
  if (trigger instanceof HTMLElement && selectorTriggerButtons.includes(trigger)) {
    selectorReturnFocusElement = trigger;
  }
  selectorFocusedIndex = getCurrentSelectorIndex();
  new_selector_content.classList.remove('hidden');
  setSelectorExpanded(true);
  syncSelectorSelection();
  if (focusSelected) {
    focusOption(selectorFocusedIndex);
  } else {
    selectorOptionButtons[selectorFocusedIndex]?.scrollIntoView({
      behavior: "auto",
      block: "nearest",
      inline: "nearest",
    });
  }
}

function closeSelector({ returnFocus = false, blurHiddenFocus = false }: { returnFocus?: boolean; blurHiddenFocus?: boolean } = {}) {
  const activeElement = document.activeElement;
  const shouldBlurHiddenFocus = blurHiddenFocus && activeElement instanceof HTMLElement && new_selector_parent.contains(activeElement);
  new_selector_content.classList.add('hidden');
  setSelectorExpanded(false);
  syncSelectorSelection();
  if (returnFocus) selectorReturnFocusElement.focus();
  else if (shouldBlurHiddenFocus) activeElement.blur();
}

function toggleSelector(trigger: Element) {
  if (isSelectorOpen()) closeSelector();
  else openSelector({ focusSelected: true, trigger });
}

function selectOption(index: number) {
  preloadAudioBlobs();
  loadingNoiseInstance.warmUp();
  errorNoiseInstance.warmUp();
  core.playRadio(index);
  selectorFocusedIndex = index;
  syncSelectorSelection();
  closeSelector({ returnFocus: true });
}

radios.forEach((radio, index) => {
  const new_button = new_selector_button_example.cloneNode(true) as HTMLButtonElement;
  new_button.id = `new_selector__option_${index}`;
  new_button.setAttribute('role', 'option');
  new_button.setAttribute('aria-selected', 'false');
  new_button.tabIndex = -1;
  new_button.classList.remove('hidden');
  new_button.innerText = radio.text;

  new_button.addEventListener('click', () => {
    selectOption(index);
  });

  new_selector_content.appendChild(new_button);
  selectorOptionButtons.push(new_button);
});
syncSelectorSelection();

selectorTriggerButtons.forEach(el => el.addEventListener('click', () => toggleSelector(el)));

function handleSelectorTriggerKeydown(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' && isSelectorOpen()) {
    e.preventDefault();
    focusOption(selectorFocusedIndex + 1);
    return;
  }

  if (e.key === 'ArrowUp' && isSelectorOpen()) {
    e.preventDefault();
    focusOption(selectorFocusedIndex - 1);
    return;
  }

  if (!['Enter', ' '].includes(e.key)) return;
  e.preventDefault();
  openSelector({ focusSelected: true, trigger: e.currentTarget as Element });
}

selectorTriggerButtons.forEach(el => el.addEventListener('keydown', handleSelectorTriggerKeydown));

new_selector_content.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') {
    e.preventDefault();
    focusOption(selectorFocusedIndex + 1);
  } else if (e.key === 'ArrowUp') {
    e.preventDefault();
    focusOption(selectorFocusedIndex - 1);
  } else if (e.key === 'Home') {
    e.preventDefault();
    focusOption(0);
  } else if (e.key === 'End') {
    e.preventDefault();
    focusOption(selectorOptionButtons.length - 1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    selectOption(selectorFocusedIndex);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    closeSelector({ returnFocus: true });
  } else if (e.key === 'Escape') {
    e.preventDefault();
    closeSelector({ returnFocus: true });
  }
});

new_selector_parent.addEventListener('focusout', (e) => {
  if (!new_selector_parent.contains(e.relatedTarget as Node | null)) closeSelector();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !isSelectorOpen()) return;
  e.preventDefault();
  closeSelector({ returnFocus: true });
});

document.addEventListener('click', (e) => {
  const target = e.target as Node | null;
  if (!new_selector_content.contains(target) && !selectorTriggerButtons.some(el => el.contains(target))) {
    closeSelector({ blurHiddenFocus: true });
  }
});
