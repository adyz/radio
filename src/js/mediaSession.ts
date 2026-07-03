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
  navigator.mediaSession.setActionHandler('pause', () => {
    if (!core) return;
    const s = core.getState();
    // During loading/error the sound effects are playing, not the stream.
    // "Pause" should cancel everything (same as the on-screen stop button).
    if (s === 'loading' || s === 'retrying' || s === 'error' || s === 'recovering') {
      core.stopRadio();
    } else {
      core.pauseRadio();
    }
  });
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

export const updateMediaSession = (newState: RadioState) => {
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
};
