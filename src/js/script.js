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

const posterImage = document.getElementById('posterImage');

// --- Cloudinary ---

// --- All user-facing labels (single source of truth) ---
const LABELS = {
  appName:  'Coji Radio Player',
  loading:  'Se încarcă...',
  error:    'Eroare',
};

function cloudinaryImageUrl(text, live = false) {
  const url_non_live = 'nndti4oybhdzggf8epvh';
  const url_live = 'rhz6yy4btbqicjqhsy7a';
  return `https://res.cloudinary.com/adrianf/image/upload/c_scale,h_480,w_480/w_400,g_south_west,x_50,y_70,c_fit,l_text:arial_90:${text}/${live ? url_live : url_non_live}`;
}

// Pre-cache status images into Cache API so they're reliably available offline
const STATUS_IMAGE_TEXTS = Object.values(LABELS);
if ('caches' in window) {
  caches.open('radio-images').then(cache => {
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
const hasRestoredStation = localStorage.getItem('lastRadioIndex') !== null;
if (hasRestoredStation) {
  radioSelect.selectedIndex = parseInt(localStorage.getItem('lastRadioIndex'), 10);
}

// --- Sound effects via <audio> elements ---
// These play through real <audio> elements to keep the iOS MediaSession alive.
// MediaSession action handlers are re-registered on every state transition to
// prevent iOS from resetting them when a different <audio> element takes over.

let blobsPreloaded = false;

function audioInstance(htmlElement) {
  let initialSrc = htmlElement.querySelector('source').src;
  let isPlaying = false;
  let blobUrl = null;
  let playGeneration = 0;

  const preloadBlob = () => {
    if (blobUrl) return;
    fetch(initialSrc)
      .then(r => r.blob())
      .then(blob => { blobUrl = URL.createObjectURL(blob); })
      .catch(err => console.warn('Audio blob preload failed:', initialSrc, err));
  };

  return {
    play() {
      if (!isPlaying) {
        const gen = ++playGeneration;
        htmlElement.volume = 1;
        htmlElement.src = blobUrl || initialSrc;
        htmlElement.currentTime = 0;
        isPlaying = true;
        htmlElement.play().catch((error) => {
          if (gen !== playGeneration) return;
          if (error.name !== 'AbortError') console.error('Error playing audio:', error);
          isPlaying = false;
        });
      }
    },
    stop() {
      if (isPlaying) {
        htmlElement.pause();
        htmlElement.src = '';
        isPlaying = false;
      }
    },
    warmUp() {
      if (!isPlaying) {
        htmlElement.src = blobUrl || initialSrc;
        htmlElement.play().then(() => {
          htmlElement.pause();
          htmlElement.currentTime = 0;
        }).catch(() => {});
      }
    },
    preloadBlob,
  };
}

const loadingNoiseInstance = audioInstance(loadingNoise);
const errorNoiseInstance = audioInstance(errorNoise);

// Shared helper — registers all MediaSession action handlers.
// Called from both updateMediaSession() (every state transition) and
// reRegisterMediaSessionHandlers() (after sound-effect playback steals focus).
function registerMediaSessionHandlers() {
  navigator.mediaSession.setActionHandler('previoustrack', () => core.prevRadio());
  navigator.mediaSession.setActionHandler('nexttrack',     () => core.nextRadio());
  navigator.mediaSession.setActionHandler('pause',         () => core.pauseRadio());
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
  try { navigator.mediaSession.setPositionState(); } catch (_) {}
}
loadingNoise.addEventListener('play', reRegisterMediaSessionHandlers);
loadingNoise.addEventListener('playing', reRegisterMediaSessionHandlers);
errorNoise.addEventListener('play', reRegisterMediaSessionHandlers);
errorNoise.addEventListener('playing', reRegisterMediaSessionHandlers);

// When a sound effect pauses (e.g. loadingSound.stop() after stream loaded),
// macOS briefly shows "Not Playing" because the active audio source just stopped.
// Re-assert playbackState so the OS doesn't flash "Not Playing" in the gap before
// it picks up audio from the main player.
function reassertPlaybackState() {
  if (!('mediaSession' in navigator) || !core) return;
  const s = core.getState();
  if (s === 'playing' || s === 'loading' || s === 'retrying' || s === 'error' || s === 'recovering') {
    navigator.mediaSession.playbackState = 'playing';
    try { navigator.mediaSession.setPositionState(); } catch (_) {}
  }
}
loadingNoise.addEventListener('pause', reassertPlaybackState);
errorNoise.addEventListener('pause', reassertPlaybackState);

// Preload audio blobs on first user interaction (not at page load)
function preloadAudioBlobs() {
  if (blobsPreloaded) return;
  blobsPreloaded = true;
  loadingNoiseInstance.preloadBlob();
  errorNoiseInstance.preloadBlob();
}

// --- UI helpers ---

const showButton = (which) => {
  playButton.classList.toggle('hidden', which !== 'play');
  pauseButton.classList.toggle('hidden', which !== 'pause');
  stopButton.classList.toggle('hidden', which !== 'stop');
};

// core reference — set after createRadioCore(), used by updateMediaSession
let core = null;

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
      try { navigator.mediaSession.setPositionState(); } catch (_) {}
    }
  }

  posterImage.querySelector('img').src = cloudinaryImageUrl(displayText, isLive);
  document.title = `${isLoading ? "⏳" : ''} ${hasError ? '❤️‍🩹' : ''} ${isLive ? '🔴' : ''} ${isIdle ? idleText : isLoading ? `${LABELS.loading} ${title}` : hasError ? LABELS.error : title}`;
  loadingMsg.innerText = isLoading ? `${LABELS.loading} ${title}` : '';
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
prevButton.addEventListener('click', () => core.prevRadio());
nextButton.addEventListener('click', () => core.nextRadio());

// Keep alive worker
const worker = new Worker("./js/keepAlive.js");
worker.onmessage = () => {};

// Service Worker
if ('serviceWorker' in navigator) {
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

  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
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
radios.forEach((radio, index) => {
  const new_button = new_selector_button_example.cloneNode(true);
  new_button.id = '';
  new_button.classList.remove('hidden');
  new_button.innerText = radio.text;

  new_button.addEventListener('click', () => {
    preloadAudioBlobs();
    loadingNoiseInstance.warmUp();
    errorNoiseInstance.warmUp();
    core.playRadio(index);
    new_selector_content.classList.add('hidden');
  });

  new_selector_content.appendChild(new_button);

  if (radioSelect.selectedIndex === index) {
    new_button.classList.add('bg-Red');
    const previous_selected = new_selector_content.querySelector('.bg-Red');
    if (previous_selected) previous_selected.classList.remove('bg-Red');
  }
});

[new_selector_open_button, posterImage].map(el => el.addEventListener('click', () => {
  new_selector_content.classList.toggle('hidden');
  const new_selector_buttons = new_selector_content.querySelectorAll('button');
  new_selector_buttons.forEach((button, index) => {
    if (radioSelect.selectedIndex === index) {
      button.classList.add('bg-Red');
      button.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } else {
      button.classList.remove('bg-Red');
    }
  });
}));

document.addEventListener('click', (e) => {
  if (!new_selector_content.contains(e.target) && !new_selector_open_button.contains(e.target) && !posterImage.contains(e.target)) {
    new_selector_content.classList.add('hidden');
  }
});
