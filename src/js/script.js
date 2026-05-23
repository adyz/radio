/**
 * Radio Player — DOM glue layer (uses radioCore.js state machine)
 */

import { createRadioCore } from './radioCore.js';

document.addEventListener("touchstart", function () { }, true);

// --- DOM refs ---

const radioSelect = document.getElementById('radioSelect');
const player = document.getElementById('player');
const loadingNoise = document.getElementById('loadingNoise');
const errorNoise = document.getElementById('errorNoise');
const loadingMsg = document.getElementById('loadingMsg');
const errorMsg = document.getElementById('errorMsg');

const prevButton = document.getElementById('prevButton');
const playButton = document.getElementById('playButton');
const pauseButton = document.getElementById('pauseButton');
const stopButton = document.getElementById('stopButton');
const nextButton = document.getElementById('nextButton');

const logoButton = document.getElementById('logoButton');
const posterImage = document.getElementById('posterImage');

// --- Cloudinary ---

// --- All user-facing labels (single source of truth) ---
const LABELS = {
  appName:  'Coji Radio Player',
  loading:  'Se încarcă...',
  error:    'Eroare',
};

// Keep in sync with src/sw.js so page-level preloads and SW precache share
// the same durable sound cache.
const SOUND_CACHE_NAME = 'radio-sounds-v1';

function cloudinaryImageUrl(text, live = false) {
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
  caches.open('radio-images-v2').then(cache => {
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
  const parsed = Number.parseInt(localStorage.getItem('lastRadioIndex'), 10);
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

async function cacheSoundResponse(src, response) {
  try {
    const cache = await openSoundCache();
    if (cache) await cache.put(src, response.clone());
  } catch (_) {
    // Cache writes are best-effort; the in-memory blob still matters most.
  }
}

async function getSoundResponse(src) {
  const cache = await openSoundCache();
  try {
    const cached = await cache?.match(src);
    if (cached) return cached;
  } catch (_) {
    // Cache reads are best-effort; fall back to network.
  }

  const response = await fetch(src);
  if (!response.ok) throw new Error(response.status);
  await cacheSoundResponse(src, response);
  return response;
}

function audioInstance(htmlElement) {
  let initialSrc = htmlElement.querySelector('source').src;
  let isPlaying = false;
  let blobUrl = null;
  let playGeneration = 0;
  let preloadPromise = null;
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

  const startPlayback = (gen) => {
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

  return {
    play() {
      if (!isPlaying) {
        const gen = ++playGeneration;
        isPlaying = true;
        if (blobUrl) {
          startPlayback(gen);
          return;
        }
        preloadBlob().then(() => startPlayback(gen));
      }
    },
    stop() {
      playGeneration++;
      htmlElement.pause();
      htmlElement.src = '';
      isPlaying = false;
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

const loadingNoiseInstance = audioInstance(loadingNoise);
const errorNoiseInstance = audioInstance(errorNoise);

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

function isPlaybackControl(element) {
  return element === playButton || element === pauseButton || element === stopButton;
}

let shouldFocusPlaybackControl = false;

const showButton = (which) => {
  const shouldPreserveFocus = isPlaybackControl(document.activeElement);
  const shouldMoveFocus = shouldPreserveFocus || shouldFocusPlaybackControl;
  const nextButton = which === 'play' ? playButton : which === 'pause' ? pauseButton : stopButton;

  playButton.classList.toggle('hidden', which !== 'play');
  pauseButton.classList.toggle('hidden', which !== 'pause');
  stopButton.classList.toggle('hidden', which !== 'stop');

  if (shouldMoveFocus) {
    nextButton.focus();
    shouldFocusPlaybackControl = false;
  }
};

// core reference — set after createRadioCore(), used by updateMediaSession
let core = null;

let pendingServiceWorkerReload = false;
let serviceWorkerReloaded = false;

function reloadForServiceWorkerUpdate() {
  if (serviceWorkerReloaded) return;
  serviceWorkerReloaded = true;
  pendingServiceWorkerReload = false;
  window.location.reload();
}

function maybeReloadForPendingServiceWorkerUpdate(newState) {
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

const updateMediaSession = (newState) => {
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

  posterImage.querySelector('img').src = cloudinaryImageUrl(displayText, isLive);
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
  loadingSound:     loadingNoiseInstance,
  errorSound:       errorNoiseInstance,
  showButton,
  setLoadingMsg:    (v) => loadingMsg.classList.toggle('invisible', !v),
  setErrorMsg:      (v) => errorMsg.classList.toggle('invisible', !v),
  updateMediaSession,
  saveLastIndex:    (i) => localStorage.setItem('lastRadioIndex', i),
  setTimeout,
  clearTimeout,
  performanceNow:   () => performance.now(),
  isOnline:          () => navigator.onLine,
});

// --- Event listeners ---

radioSelect.addEventListener('change', (e) => {
  if (e.target.value) {
    core.playRadio(radioSelect.selectedIndex);
  } else {
    core.stopRadio();
  }
});

// Electron
if (window.electronAPI) {
  window.electronAPI.onMediaControl((command) => {
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
      window.electronAPI.updatePlaybackState(core.getState() === 'playing');
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
player.addEventListener('error', () => core.onPlayerError());

player.addEventListener('stalled', () => {
  const playIdAtStall = core._getPlayId();
  const stalledTimeout = setTimeout(() => {
    // Only treat as error if we're still on the same stream
    if (core._getPlayId() === playIdAtStall && core.getState() === 'playing') core.onPlayerError();
  }, 5000);
  player.addEventListener('playing', () => clearTimeout(stalledTimeout), { once: true });
});

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
const new_selector_open_button = document.getElementById('new_selector__button');
const new_selector_content = document.getElementById('new_selector__content');
const new_selector_button_example = document.getElementById('new_selector__button_example');

const radios = radioSelect.querySelectorAll('option');
const selectorOptionButtons = [];
let selectorFocusedIndex = radioSelect.selectedIndex;
let selectorReturnFocusElement = new_selector_open_button;
const selectorTriggerButtons = [new_selector_open_button, posterImage];

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

function focusOption(index) {
  if (!selectorOptionButtons.length) return;
  const optionCount = selectorOptionButtons.length;
  selectorFocusedIndex = (index + optionCount) % optionCount;
  syncSelectorSelection();
  selectorOptionButtons[selectorFocusedIndex].focus();
  selectorOptionButtons[selectorFocusedIndex].scrollIntoView({ behavior: "auto", block: "nearest" });
}

function setSelectorExpanded(isExpanded) {
  selectorTriggerButtons.forEach(el => {
    el.setAttribute('aria-expanded', String(isExpanded));
  });
}

function openSelector({ focusSelected = false, trigger = document.activeElement } = {}) {
  if (selectorTriggerButtons.includes(trigger)) {
    selectorReturnFocusElement = trigger;
  }
  selectorFocusedIndex = radioSelect.selectedIndex;
  new_selector_content.classList.remove('hidden');
  setSelectorExpanded(true);
  syncSelectorSelection();
  if (focusSelected) focusOption(selectorFocusedIndex);
  else selectorOptionButtons[selectorFocusedIndex]?.scrollIntoView({ behavior: "auto", block: "nearest" });
}

function closeSelector({ returnFocus = false, blurHiddenFocus = false } = {}) {
  const activeElement = document.activeElement;
  const shouldBlurHiddenFocus = blurHiddenFocus && activeElement && document.getElementById('new_selector__parent').contains(activeElement);
  new_selector_content.classList.add('hidden');
  setSelectorExpanded(false);
  syncSelectorSelection();
  if (returnFocus) selectorReturnFocusElement.focus();
  else if (shouldBlurHiddenFocus) activeElement.blur();
}

function toggleSelector(trigger) {
  if (isSelectorOpen()) closeSelector();
  else openSelector({ trigger });
}

function selectOption(index) {
  preloadAudioBlobs();
  loadingNoiseInstance.warmUp();
  errorNoiseInstance.warmUp();
  shouldFocusPlaybackControl = true;
  core.playRadio(index);
  selectorFocusedIndex = index;
  syncSelectorSelection();
  closeSelector();
}

radios.forEach((radio, index) => {
  const new_button = new_selector_button_example.cloneNode(true);
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

function handleSelectorTriggerKeydown(e) {
  if (!['Enter', ' '].includes(e.key)) return;
  e.preventDefault();
  openSelector({ focusSelected: true, trigger: e.currentTarget });
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

document.getElementById('new_selector__parent').addEventListener('focusout', (e) => {
  if (!e.currentTarget.contains(e.relatedTarget)) closeSelector();
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !isSelectorOpen()) return;
  e.preventDefault();
  closeSelector({ returnFocus: true });
});

document.addEventListener('click', (e) => {
  if (!new_selector_content.contains(e.target) && !selectorTriggerButtons.some(el => el.contains(e.target))) {
    closeSelector({ blurHiddenFocus: true });
  }
});
