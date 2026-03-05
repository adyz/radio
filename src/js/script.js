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

function cloudinaryImageUrl(text, live = false) {
  const url_non_live = 'nndti4oybhdzggf8epvh';
  const url_live = 'rhz6yy4btbqicjqhsy7a';
  return `https://res.cloudinary.com/adrianf/image/upload/c_scale,h_480,w_480/w_400,g_south_west,x_50,y_70,c_fit,l_text:arial_90:${text}/${live ? url_live : url_non_live}`;
}

// Pre-cache status images so they're available offline
['Eroare', 'Se încarcă...', 'Coji Radio Player'].forEach(text => {
  const img = new Image();
  img.src = cloudinaryImageUrl(text);
});

// Restore last station before anything reads selectedIndex
const hasRestoredStation = localStorage.getItem('lastRadioIndex') !== null;
if (hasRestoredStation) {
  radioSelect.selectedIndex = parseInt(localStorage.getItem('lastRadioIndex'), 10);
}

// --- Audio instances (blob preload) ---

function audioInstance(htmlElement) {
  let initialSrc = htmlElement.querySelector('source').src;
  let isPlaying = false;
  let blobUrl = null;

  // Defer blob preload to idle time so sounds don't block critical rendering
  const preloadBlob = () => {
    fetch(initialSrc)
      .then(r => r.blob())
      .then(blob => {
        blobUrl = URL.createObjectURL(blob);
      })
      .catch(err => {
        console.warn('Audio blob preload failed, using network src:', initialSrc, err);
      });
  };

  if ('requestIdleCallback' in window) {
    requestIdleCallback(preloadBlob);
  } else {
    setTimeout(preloadBlob, 2000);
  }

  return {
    play() {
      if (!isPlaying) {
        htmlElement.src = blobUrl || initialSrc;
        htmlElement.currentTime = 0;
        isPlaying = true;
        htmlElement.play().catch((error) => {
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
    // iOS requires a user gesture to unlock audio elements.
    // Call this from any click/tap handler to ensure play() works later.
    warmUp() {
      if (!isPlaying) {
        htmlElement.src = blobUrl || initialSrc;
        htmlElement.play().then(() => {
          htmlElement.pause();
          htmlElement.currentTime = 0;
        }).catch(() => {});
      }
    },
  };
}

const loadingNoiseInstance = audioInstance(loadingNoise);
const errorNoiseInstance = audioInstance(errorNoise);

// --- UI helpers ---

const showButton = (which) => {
  playButton.classList.toggle('hidden', which !== 'play');
  pauseButton.classList.toggle('hidden', which !== 'pause');
  stopButton.classList.toggle('hidden', which !== 'stop');
};

const updateMediaSession = (newState) => {
  const title = radioSelect.options[radioSelect.selectedIndex].text;
  const isIdle = newState === 'idle';
  const isLoading = newState === 'loading' || newState === 'retrying';
  const hasError = newState === 'error' || newState === 'recovering';
  const isLive = newState === 'playing';

  const idleText = hasRestoredStation ? title : 'Coji Radio Player';
  const displayText = isIdle ? idleText : isLoading ? 'Se încarcă...' : hasError ? 'Eroare' : title;

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: isLoading ? `Se încarcă...${title}` : hasError ? `Eroare la încărcarea ${title}` : isIdle ? idleText : title,
      artist: `Coji Radio Player${isIdle && !hasRestoredStation ? '' : ` | ${title}`}`,
      artwork: [{ src: cloudinaryImageUrl(displayText, isLive) }]
    });

    // Action handlers are registered once after core init (see below)
    // to avoid TDZ — updateMediaSession is called during createRadioCore()

    navigator.mediaSession.playbackState = (isLive || isLoading) ? 'playing' : newState === 'paused' ? 'paused' : 'none';

    if (isLive || newState === 'paused') {
      navigator.mediaSession.setPositionState();
    }
  }

  posterImage.querySelector('img').src = cloudinaryImageUrl(displayText, isLive);
  document.title = `${isLoading ? "⏳" : ''} ${hasError ? '❤️‍🩹' : ''} ${isLive ? '🔴' : ''} ${isIdle ? idleText : isLoading ? `Se incarca ${title}` : hasError ? 'Eroare' : title}`;
  loadingMsg.innerText = isLoading ? `Se incarca ${title}...` : '';
};

// --- Create core (state machine) ---

const core = createRadioCore({
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

// --- Media Session action handlers (registered once, after core exists) ---
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('previoustrack', () => core.prevRadio());
  navigator.mediaSession.setActionHandler('nexttrack', () => core.nextRadio());
  navigator.mediaSession.setActionHandler('pause', () => core.pauseRadio());
  navigator.mediaSession.setActionHandler('play', () => core.resumeRadio());
}

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
  // Don't signal 'paused' during loading/retrying/recovering — OS would hand over media control to another app
  if ('mediaSession' in navigator && s !== 'loading' && s !== 'retrying' && s !== 'recovering') {
    navigator.mediaSession.playbackState = 'paused';
  }
  core.onPlayerPause();
});

// Stream failure during playback (lost WiFi, server died, etc.)
player.addEventListener('error', () => core.onPlayerError());
player.addEventListener('stalled', () => {
  // 'stalled' fires when data stops arriving — give it a few seconds before treating as error
  const stalledTimeout = setTimeout(() => {
    if (core.getState() === 'playing') core.onPlayerError();
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
