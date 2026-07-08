/**
 * Radio Player — entry point: wires the pure core (radioCore) to the DOM
 * through the feature modules. No business logic lives here, only wiring.
 */

import { createRadioCore, isLoadingLike, isFeedbackAudible } from './radioCore';
import {
  radioSelect, player, loadingNoise, errorNoise, loadingMsg, errorMsg,
  prevButton, playButton, pauseButton, stopButton, nextButton, logoButton,
} from './dom';
import { LABELS } from './labels';
import { precacheStatusImages } from './cloudinary';
import { getStoredStationIndex, saveLastIndex } from './storage';
import { audioInstance } from './soundEffects';
import { initMediaSession, connectMediaSessionCore, updateMediaSession } from './mediaSession';
import { initServiceWorker, maybeReloadForPendingServiceWorkerUpdate } from './serviceWorker';
import { initThemeColor } from './theme';
import { initStationSelector } from './stationSelector';

declare global {
  interface Window {
    electronAPI?: {
      onMediaControl(callback: (command: string) => void): void;
      updatePlaybackState(isPlaying: boolean): void;
    };
  }
}

document.addEventListener("touchstart", function () { }, true);

// Pre-cache status images + station name images for offline use — deferred
// to idle time so the ~22 image fetches don't compete with the stream
// connection and the sound-blob preloads at startup (time-to-audio first).
const runStatusImagePrecache = () => precacheStatusImages([
  ...Object.values(LABELS),
  ...Array.from(radioSelect.options).map(o => o.text),
]);
if ('requestIdleCallback' in window) {
  requestIdleCallback(runStatusImagePrecache, { timeout: 5000 });
} else {
  // Safari has no requestIdleCallback — a plain delay clears startup anyway.
  setTimeout(runStatusImagePrecache, 3000);
}

// Restore last station before anything reads selectedIndex
const restoredStationIndex = getStoredStationIndex(radioSelect.options.length);
const hasRestoredStation = restoredStationIndex !== null;
if (hasRestoredStation) {
  radioSelect.selectedIndex = restoredStationIndex;
}
initMediaSession({ hasRestoredStation });

// --- Feedback sounds ---

const loadingNoiseInstance = audioInstance(loadingNoise);
const errorNoiseInstance = audioInstance(errorNoise);
// Each sound hands off gracefully to the other: deferred stop until the
// replacement is audible, carry when iOS denies the replacement's start
// (see the protocol comment in soundEffects.ts).
loadingNoiseInstance.setPartner(errorNoiseInstance);
errorNoiseInstance.setPartner(loadingNoiseInstance);

// Preload audio blobs once per page. Re-called from user interactions as a
// retry if the eager page-load preload failed — fetch() doesn't need a user
// gesture, only playback does.
function preloadAudioBlobs() {
  loadingNoiseInstance.preloadBlob();
  errorNoiseInstance.preloadBlob();
}
preloadAudioBlobs();

// Every playback-starting interaction also warms the sound elements up
// (plays them for a split second) so iOS blesses them with the user gesture.
function warmUpFeedbackSounds() {
  preloadAudioBlobs();
  loadingNoiseInstance.warmUp();
  errorNoiseInstance.warmUp();
}

// --- Playback control buttons ---

function isPlaybackControl(element: Element | null) {
  return element === playButton || element === pauseButton || element === stopButton;
}

function focusInitialPlaybackControl() {
  if (document.activeElement && document.activeElement !== document.body) return;
  playButton.focus();
}

const showButton = (which: 'play' | 'pause' | 'stop') => {
  const shouldPreserveFocus = isPlaybackControl(document.activeElement);
  const nextControl = which === 'play' ? playButton : which === 'pause' ? pauseButton : stopButton;

  playButton.classList.toggle('hidden', which !== 'play');
  pauseButton.classList.toggle('hidden', which !== 'pause');
  stopButton.classList.toggle('hidden', which !== 'stop');

  if (shouldPreserveFocus) nextControl.focus();
};

// --- Core ---

// Dev-only: live machine diagram via the Stately Inspector.
// Run `npm run dev` and open http://localhost:5173/?inspect — a stately.ai
// window shows the running machine with transitions/events in real time.
// Compile-time dead code in production (import.meta.env.DEV is false), and
// opt-in via the URL param so the e2e runs (dev server!) never open it.
const inspector =
  import.meta.env.DEV && new URLSearchParams(window.location.search).has('inspect')
    ? (await import('@statelyai/inspect')).createBrowserInspector()
    : undefined;

const core = createRadioCore({
  getStationUrl:    (i) => radioSelect.options[i].value,
  getStationCount:  () => radioSelect.options.length,
  getSelectedIndex: () => radioSelect.selectedIndex,
  setSelectedIndex: (i) => { radioSelect.selectedIndex = i; },
  playerPlay:       () => player.play(),
  playerPause:      () => player.pause(),
  playerSetSrc:     (url) => { player.src = url; },
  playerLoad:       () => player.load(),
  playerCurrentTime: () => player.currentTime,
  loadingSound:     loadingNoiseInstance,
  errorSound:       errorNoiseInstance,
  showButton,
  setLoadingMsg:    (v) => loadingMsg.classList.toggle('invisible', !v),
  setErrorMsg:      (v) => errorMsg.classList.toggle('invisible', !v),
  updateMediaSession: (s) => {
    updateMediaSession(s);
    maybeReloadForPendingServiceWorkerUpdate(s);
  },
  saveLastIndex,
  // Wrapped: the machine calls these as methods on deps, and browser timer
  // functions throw "Illegal invocation" when invoked with a foreign `this`.
  setInterval:   (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id ?? undefined),
  performanceNow:   () => performance.now(),
  isOnline:          () => navigator.onLine,
}, inspector ? { inspect: inspector.inspect } : {});
connectMediaSessionCore(core);
focusInitialPlaybackControl();

// --- Tone invariant enforcer ---
// The machine can only COMMAND the tone elements; a late async callback can
// disobey (a play() settling after stop() once resurrected a tone under the
// live radio — unstoppable, since the bookkeeping already said "stopped").
// Enforce the invariant at the element boundary instead of per code path:
// in states where no feedback tone may sound, anything audible is silenced.
// 'playing' catches fresh (re)starts the moment they become audible;
// 'timeupdate' fires continuously during playback (~4x/s), so it also
// catches a tone that never obeyed its stop and just kept going — no
// resurrection path, known or unknown, survives more than ~250ms. In the
// tone states this does nothing — swap/carry behavior is legitimate there.
for (const toneElement of [loadingNoise, errorNoise]) {
  const silenceIfForbidden = () => {
    if (!isFeedbackAudible(core.getState())) toneElement.pause();
  };
  toneElement.addEventListener('playing', silenceIfForbidden);
  toneElement.addEventListener('timeupdate', silenceIfForbidden);
}

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
  warmUpFeedbackSounds();
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
  // NOTE: deliberately narrower than isFeedbackAudible — 'error' is not
  // re-asserted here (pre-existing drift from the other three state lists;
  // whether that's intent or a bug gets decided in faza R3/R5, not silently).
  if ('mediaSession' in navigator) {
    if (isLoadingLike(s) || s === 'recovering') {
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
  warmUpFeedbackSounds();
  core.prevRadio();
});
nextButton.addEventListener('click', () => {
  warmUpFeedbackSounds();
  core.nextRadio();
});

// Logo reloads the page
logoButton.addEventListener('click', () => {
  window.location.reload();
});

// Keep alive worker
const worker = new Worker("./js/keepAlive.js");
worker.onmessage = () => {};

initServiceWorker(core);
initThemeColor();
initStationSelector({
  onSelect(index) {
    warmUpFeedbackSounds();
    core.playRadio(index);
  },
});
