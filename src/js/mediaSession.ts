/**
 * MediaSession integration (lock screen / Now Playing widget) + the state
 * presentation that travels with it (poster image, document title, loading
 * message text).
 *
 * iOS hands the media session to whichever <audio> element is audible and
 * resets the action handlers when that changes — so handlers are
 * re-registered on every state transition AND whenever a feedback sound
 * starts (see git history: d798cc9).
 */

import type { RadioCore, RadioState } from './radioCore';
import { isLoadingLike, isErrorLike, playbackStateFor } from './radioCore';
import { LABELS } from './labels';
import { cloudinaryImageUrl } from './cloudinary';
import { radioSelect, posterImage, loadingMsg, loadingNoise, errorNoise } from './dom';

// core reference — connected after createRadioCore(); updateMediaSession runs
// once during creation itself (initial setState('idle')), before the
// connection lands, and the `if (core)` runtime guards cover that window.
let core: RadioCore | null = null;
let hasRestoredStation = false;

/** Called before createRadioCore() so the initial 'idle' render is correct. */
export function initMediaSession(options: { hasRestoredStation: boolean }): void {
  hasRestoredStation = options.hasRestoredStation;
}

/** Called right after createRadioCore() — wires the core into the handlers. */
export function connectMediaSessionCore(radioCore: RadioCore): void {
  core = radioCore;
}

// Shared helper — registers all MediaSession action handlers.
// Called from both updateMediaSession() (every state transition) and
// reRegisterMediaSessionHandlers() (after sound-effect playback steals focus).
function registerMediaSessionHandlers() {
  navigator.mediaSession.setActionHandler('previoustrack', () => core?.prevRadio());
  navigator.mediaSession.setActionHandler('nexttrack',     () => core?.nextRadio());
  // Whether "pause" means pause or a full stop (while a feedback sound is
  // what's audible) is the machine's per-state decision, not ours.
  navigator.mediaSession.setActionHandler('pause', () => core?.pauseRadio());
  navigator.mediaSession.setActionHandler('play',          () => core?.resumeRadio());
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
  clearPositionState();
}
loadingNoise.addEventListener('play', reRegisterMediaSessionHandlers);
loadingNoise.addEventListener('playing', reRegisterMediaSessionHandlers);
errorNoise.addEventListener('play', reRegisterMediaSessionHandlers);
errorNoise.addEventListener('playing', reRegisterMediaSessionHandlers);

// Tells the OS there's no seekable timeline (mobile browsers otherwise show
// the sound effect's finite duration as a countdown timer).
// Feature-detected once to avoid repeated exceptions on unsupported browsers.
let canClearPositionState = true;
function clearPositionState() {
  if (canClearPositionState) {
    try { navigator.mediaSession.setPositionState({}); } catch (_) { canClearPositionState = false; }
  }
}
clearPositionState();
// Mobile browsers re-read duration from the active <audio> element after the
// initial clear — re-clear on every timeupdate tick.
loadingNoise.addEventListener('timeupdate', clearPositionState);
errorNoise.addEventListener('timeupdate', clearPositionState);

// When a sound effect pauses (e.g. loadingSound.stop() after stream loaded),
// macOS briefly shows "Not Playing" because the active audio source just stopped.
// Re-assert playbackState so the OS doesn't flash "Not Playing" in the gap before
// it picks up audio from the main player.
function reassertPlaybackState() {
  if (!('mediaSession' in navigator) || !core) return;
  if (playbackStateFor(core.getState()) === 'playing') {
    navigator.mediaSession.playbackState = 'playing';
    clearPositionState();
  }
}
loadingNoise.addEventListener('pause', reassertPlaybackState);
errorNoise.addEventListener('pause', reassertPlaybackState);

// The presentation (metadata, poster, document title) is a pure function of
// (state, station title) — re-rendering it when neither changed is wasted
// work (and on iOS it re-fetches lock-screen artwork). Memoize on that key.
// Handler re-registration and playbackState are deliberately NOT memoized:
// iOS resets them out from under us (d798cc9), so they re-assert every call.
let lastRender: { state: RadioState; title: string } | null = null;

export const updateMediaSession = (newState: RadioState) => {
  const title = radioSelect.options[radioSelect.selectedIndex].text;
  const isIdle = newState === 'idle';
  const isLoading = isLoadingLike(newState);
  const hasError = isErrorLike(newState);
  const isLive = newState === 'playing';

  const idleText = hasRestoredStation ? title : LABELS.appName;
  const displayText = isIdle ? idleText : isLoading ? LABELS.loading : hasError ? LABELS.error : title;
  const changed = lastRender?.state !== newState || lastRender?.title !== title;
  const artworkUrl = changed ? cloudinaryImageUrl(displayText, isLive) : '';

  if ('mediaSession' in navigator) {
    if (changed) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: isLoading ? `${LABELS.loading}${title}` : hasError ? `${LABELS.error} la încărcarea ${title}` : isIdle ? idleText : title,
        artist: `${LABELS.appName}${isIdle && !hasRestoredStation ? '' : ` | ${title}`}`,
        artwork: [{ src: artworkUrl }]
      });
    }

    // Re-register ALL action handlers on every state transition.
    // iOS resets them when a different <audio> element (loading/error sound)
    // becomes the active "now playing" source.
    if (core) {
      registerMediaSessionHandlers();
    }

    // Keep session alive during loading/error (sounds are playing via <audio>)
    navigator.mediaSession.playbackState = playbackStateFor(newState);

    // Clear position state for active/paused states — tells the OS there's no
    // seekable timeline, so it won't show a finite progress bar.
    if (playbackStateFor(newState) !== 'none') {
      clearPositionState();
    }
  }

  if (changed) {
    posterImage.querySelector('img')!.src = artworkUrl;
    document.title = `${isLoading ? "⏳" : ''} ${hasError ? '❤️‍🩹' : ''} ${isLive ? '🔴' : ''} ${isIdle ? idleText : isLoading ? `${LABELS.loading} ${title}` : hasError ? LABELS.error : title}`;
    loadingMsg.innerText = isLoading ? `${LABELS.loading} ${title}` : '';
  }
  lastRender = { state: newState, title };
};
