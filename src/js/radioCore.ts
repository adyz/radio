/**
 * Radio Player — pure logic core.
 *
 * All DOM / browser interaction comes in through the `deps` object
 * so this module can be tested without a browser.
 */

import { createStateMachine } from './stateMachine';

export type RadioState =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'retrying'
  | 'error'
  | 'recovering';

type PlaybackButton = 'play' | 'pause' | 'stop';
type SoundFx = 'play' | 'stop' | 'keep';

interface StateFx {
  button: PlaybackButton;
  loading: SoundFx;
  error: SoundFx;
  loadingMsg: boolean;
  errorMsg: boolean;
}

/** A feedback sound (loading/error noise) the core can drive. */
export interface FeedbackSound {
  play(): void;
  stop(): void;
  /** Re-assert playback: restart if a play() was rejected or the OS paused it. */
  ensure(): void;
  /** Keep looping, but silently (keeps the media session alive). */
  mute(): void;
}

type TimerId = number;

/**
 * Everything the core needs from the outside world. The DOM glue layer
 * implements this against real elements; tests implement it with mocks.
 */
export interface RadioDeps {
  getStationUrl(index: number): string;
  getStationCount(): number;
  getSelectedIndex(): number;
  setSelectedIndex(index: number): void;
  playerPlay(): Promise<void>;
  playerPause(): void;
  playerSetSrc(url: string): void;
  playerLoad(): void;
  playerIsPaused(): boolean;
  playerCurrentTime(): number;
  loadingSound: FeedbackSound;
  errorSound: FeedbackSound;
  showButton(which: PlaybackButton): void;
  setLoadingMsg(visible: boolean): void;
  setErrorMsg(visible: boolean): void;
  updateMediaSession(state: RadioState): void;
  saveLastIndex(index: number): void;
  setTimeout(fn: () => void, ms: number): TimerId;
  clearTimeout(id: TimerId | null): void;
  setInterval(fn: () => void, ms: number): TimerId;
  clearInterval(id: TimerId | null): void;
  performanceNow(): number;
  isOnline(): boolean;
}

export type RadioCore = ReturnType<typeof createRadioCore>;

export const MAX_RETRIES = 1;
export const LOADING_TIMEOUT_MS = 6000;
export const RECOVERY_DELAY_MS = 10000;
export const RECOVERY_DELAY_MAX_MS = 60000;
export const WATCHDOG_INTERVAL_MS = 2000;
export const WATCHDOG_STALL_TICKS = 3; // ≈6s of frozen playback ⇒ stream is dead
export const SOUND_SUPERVISOR_INTERVAL_MS = 2500;
export const ERROR_SOUND_AUDIBLE_MS = 60000; // audible error for at least a minute, then muted
export const USER_PAUSE_INTENT_MS = 2000; // how long a pauseRadio() call explains a native 'pause'

const STATE_FX: Record<RadioState, StateFx> = {
  idle:       { button: 'play',  loading: 'stop',  error: 'stop',  loadingMsg: false, errorMsg: false },
  loading:    { button: 'stop',  loading: 'play',  error: 'stop',  loadingMsg: true,  errorMsg: false },
  playing:    { button: 'pause', loading: 'stop',  error: 'stop',  loadingMsg: false, errorMsg: false },
  paused:     { button: 'play',  loading: 'stop',  error: 'stop',  loadingMsg: false, errorMsg: false },
  // 'play' (not 'keep'): a retry can also start from a watchdog stall while
  // playing, where no sound is active — the user must never sit in silence.
  retrying:   { button: 'stop',  loading: 'play',  error: 'stop',  loadingMsg: false, errorMsg: false },
  error:      { button: 'stop',  loading: 'stop',  error: 'play',  loadingMsg: false, errorMsg: true  },
  recovering: { button: 'stop',  loading: 'stop',  error: 'keep',  loadingMsg: false, errorMsg: true  },
};

export function createRadioCore(deps: RadioDeps) {
  const {
    getStationUrl,
    getStationCount,
    getSelectedIndex,
    setSelectedIndex,
    playerPlay,
    playerPause,
    playerSetSrc,
    playerLoad,
    playerIsPaused,
    playerCurrentTime,
    loadingSound,
    errorSound,
    showButton,
    setLoadingMsg,
    setErrorMsg,
    updateMediaSession,
    saveLastIndex,
    setTimeout: _setTimeout,
    clearTimeout: _clearTimeout,
    setInterval: _setInterval,
    clearInterval: _clearInterval,
    performanceNow,
    isOnline,
  } = deps;

  const timers: Record<'retry' | 'loading' | 'recovery' | 'watchdog' | 'soundSupervisor', TimerId | null> =
    { retry: null, loading: null, recovery: null, watchdog: null, soundSupervisor: null };
  let retryCount = 0;
  let recoveryCount = 0;
  let currentPlayId = 0;
  let lastPauseTime: number | null = null;
  let userPauseIntentAt: number | null = null; // performanceNow() of the last pauseRadio() call
  let errorSoundStartedAt: number | null = null; // when the current uninterrupted error cycle began

  // --- State machine (no radio knowledge) ---

  const { getState, setState } = createStateMachine(STATE_FX, (fx, newState) => {
    showButton(fx.button);
    if (fx.loading !== 'keep') loadingSound[fx.loading]();
    if (fx.error !== 'keep') errorSound[fx.error]();
    setLoadingMsg(fx.loadingMsg);
    setErrorMsg(fx.errorMsg);
    updateMediaSession(newState);
    // The watchdog only makes sense while we're supposed to be playing
    if (newState === 'playing') startWatchdog();
    else stopWatchdog();
    // Track how long the user has been listening to the error sound —
    // one uninterrupted error/recovering stretch counts as one cycle.
    if (newState === 'error' || newState === 'recovering') {
      if (errorSoundStartedAt === null) errorSoundStartedAt = performanceNow();
    } else {
      errorSoundStartedAt = null;
    }
    // While a feedback sound is supposed to be audible, supervise it:
    // background restrictions can reject or pause <audio> playback silently.
    if (newState === 'loading' || newState === 'retrying' || newState === 'error' || newState === 'recovering') {
      startSoundSupervisor();
    } else {
      stopSoundSupervisor();
    }
  });

  setState('idle');

  // --- Radio logic ---

  function stopRadio() {
    _clearTimeout(timers.retry);
    _clearTimeout(timers.loading);
    _clearTimeout(timers.recovery);
    currentPlayId++;
    retryCount = 0;
    recoveryCount = 0;
    lastPauseTime = null;
    setState('idle');
    playerPause();
    playerSetSrc('');
  }

  function playRadio(index: number, _isRetry?: boolean) {
    setSelectedIndex(index);

    _clearTimeout(timers.retry);
    _clearTimeout(timers.loading);
    _clearTimeout(timers.recovery);
    if (!_isRetry) {
      retryCount = 0;
      recoveryCount = 0;
    }

    // No point trying if offline — go straight to error and auto-recover later
    if (!isOnline()) {
      currentPlayId++;
      playerPause();
      playerSetSrc('');
      setState('error');
      scheduleRecovery();
      return;
    }

    const playId = ++currentPlayId;

    setState('loading');

    // Pause after setState('loading') so the native 'pause' event is ignored
    // (script.js skips playbackState='paused' when state is loading/retrying)
    playerPause();
    playerSetSrc(getStationUrl(index));
    playerLoad();

    timers.loading = _setTimeout(() => {
      if (playId !== currentPlayId) return;
      playerPause();
      playerSetSrc('');
      handlePlayError(playId, index, new Error('Loading timeout'));
    }, LOADING_TIMEOUT_MS);

    playerPlay().then(() => {
      if (playId !== currentPlayId) return;
      _clearTimeout(timers.loading);
      retryCount = 0;
      saveLastIndex(index);
      setState('playing');
    }).catch(error => {
      if (error.name === 'AbortError') return;
      if (playId !== currentPlayId) return;
      _clearTimeout(timers.loading);
      handlePlayError(playId, index, error);
    });
  }

  function handlePlayError(playId: number, index: number, _error: Error) {
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      setState('retrying');
      timers.retry = _setTimeout(() => {
        if (playId !== currentPlayId) return;
        playRadio(index, true);
      }, 3000);
    } else {
      setState('error');
      scheduleRecovery();
    }
  }

  function prevRadio() {
    const count = getStationCount();
    const idx = getSelectedIndex();
    playRadio(idx === 0 ? count - 1 : idx - 1);
  }

  function nextRadio() {
    const count = getStationCount();
    const idx = getSelectedIndex();
    playRadio(idx === count - 1 ? 0 : idx + 1);
  }

  function pauseRadio() {
    // Remember that this pause was asked for by the user, so the native
    // 'pause' event it triggers isn't mistaken for a dying stream.
    userPauseIntentAt = performanceNow();
    playerPause();
  }

  function handleResumeError(error: unknown) {
    if ((error as { name?: string } | null | undefined)?.name === 'AbortError') return;
    try {
      playerPause();
    } catch (_) {
      // Keep resume error handling focused on restoring state.
    }
    if (getState() === 'paused') setState('paused');
  }

  function resumePlayer() {
    try {
      const playPromise = playerPlay();
      if (!playPromise || typeof playPromise.catch !== 'function') {
        return Promise.resolve(playPromise);
      }
      return playPromise.catch(handleResumeError);
    } catch (error) {
      handleResumeError(error);
      return Promise.resolve();
    }
  }

  function resumeRadio() {
    return resumePlayer();
  }

  function togglePlayPause() {
    if (playerIsPaused()) {
      const s = getState();
      if (s === 'paused') return resumePlayer();
      else if (s === 'idle' || s === 'error' || s === 'recovering') {
        _clearTimeout(timers.recovery);
        playRadio(getSelectedIndex());
      }
    } else {
      pauseRadio();
    }
  }

  // Called from native player 'play' event
  function onPlayerPlay() {
    if (getState() === 'paused' && lastPauseTime) {
      const timeDiff = performanceNow() - lastPauseTime;
      lastPauseTime = null;
      if (timeDiff > 2000) {
        playerPause();
        playerSetSrc('');
        playRadio(getSelectedIndex());
        return;
      }
      setState('playing');
      return;
    }
    lastPauseTime = null;
    if (getState() === 'paused') {
      setState('playing');
    }
  }

  // Called from native player 'pause' event
  function onPlayerPause() {
    if (getState() !== 'playing') return;

    const userAskedForIt =
      userPauseIntentAt !== null &&
      performanceNow() - userPauseIntentAt <= USER_PAUSE_INTENT_MS;
    userPauseIntentAt = null;

    // A 'pause' nobody asked for while the network is down is the OS killing
    // a dead stream, not the user — never leave them in silent 'paused':
    // go through the retry/error pipeline so a feedback sound keeps playing.
    if (!userAskedForIt && !isOnline()) {
      lastPauseTime = null;
      handlePlayError(currentPlayId, getSelectedIndex(), new Error('Network pause'));
      return;
    }

    // User pause, or an online interruption (headphones unplugged, phone
    // call, another app taking audio) — those should stay paused.
    setState('paused');
    lastPauseTime = performanceNow();
  }

  // Called from native player 'error' event (e.g. stream dies mid-playback)
  function onPlayerError() {
    const s = getState();
    if (s === 'playing' || s === 'paused') {
      lastPauseTime = null;
      handlePlayError(currentPlayId, getSelectedIndex(), new Error('Stream error'));
    }
  }

  // --- Playback watchdog ---
  // Stream failures often don't fire any 'error'/'stalled' event — the audio
  // just goes silent while currentTime stops advancing (classic with HLS or
  // flaky wifi). The only reliable signal is playback progress itself: while
  // state is 'playing', currentTime must keep moving.

  let watchdogLastTime: number | null = null;
  let watchdogStallTicks = 0;

  function stopWatchdog() {
    _clearInterval(timers.watchdog);
    timers.watchdog = null;
  }

  function startWatchdog() {
    stopWatchdog();
    watchdogLastTime = null;
    watchdogStallTicks = 0;
    timers.watchdog = _setInterval(() => {
      if (getState() !== 'playing') return;
      const t = playerCurrentTime();
      if (watchdogLastTime === null || t !== watchdogLastTime) {
        watchdogLastTime = t;
        watchdogStallTicks = 0;
        return;
      }
      watchdogStallTicks++;
      if (watchdogStallTicks >= WATCHDOG_STALL_TICKS) {
        stopWatchdog();
        handlePlayError(currentPlayId, getSelectedIndex(), new Error('Playback stalled'));
      }
    }, WATCHDOG_INTERVAL_MS);
  }

  // --- Sound supervisor ---
  // "As long as the user pressed play, something must be audible." Feedback
  // sounds can silently fail to start (autoplay/background restrictions) or
  // get paused by the OS. While a state demands a sound, re-assert it every
  // tick; after ERROR_SOUND_AUDIBLE_MS of uninterrupted error, mute the error
  // loop (it keeps looping silently so background timers/session stay alive
  // and silent recovery can keep trying forever).

  function stopSoundSupervisor() {
    _clearInterval(timers.soundSupervisor);
    timers.soundSupervisor = null;
  }

  function superviseSounds() {
    const s = getState();
    if (s === 'loading' || s === 'retrying') {
      loadingSound.ensure();
    } else if (s === 'error' || s === 'recovering') {
      if (errorSoundStartedAt !== null && performanceNow() - errorSoundStartedAt >= ERROR_SOUND_AUDIBLE_MS) {
        errorSound.mute();
      } else {
        errorSound.ensure();
      }
    }
  }

  function startSoundSupervisor() {
    if (timers.soundSupervisor !== null) return;
    timers.soundSupervisor = _setInterval(superviseSounds, SOUND_SUPERVISOR_INTERVAL_MS);
  }

  // Schedule a silent recovery attempt with exponential backoff
  // (10s → 20s → 40s → capped at RECOVERY_DELAY_MAX_MS), forever — a radio
  // should never give up and strand the user in a dead error state.
  function scheduleRecovery() {
    recoveryCount++;
    const backoff = RECOVERY_DELAY_MS * 2 ** Math.min(recoveryCount - 1, 6);
    _clearTimeout(timers.recovery);
    timers.recovery = _setTimeout(() => {
      retryFromError();
    }, Math.min(backoff, RECOVERY_DELAY_MAX_MS));
  }

  // Silent recovery: uses the state machine ('recovering' state).
  // No loading sounds, error image stays — if it works, go straight to playing.
  function retryFromError() {
    const s = getState();
    if (s !== 'error' && s !== 'recovering') return;

    // Clearly offline (interface down) — re-check on a fixed cadence without
    // escalating the backoff: nothing was attempted, and the 'online' event
    // will trigger an immediate retry anyway. isOnline() can be a false
    // positive (wifi without internet), so when it says true we always try.
    if (!isOnline()) {
      _clearTimeout(timers.recovery);
      timers.recovery = _setTimeout(() => {
        retryFromError();
      }, RECOVERY_DELAY_MS);
      return;
    }

    _clearTimeout(timers.loading);
    _clearTimeout(timers.recovery);

    const index = getSelectedIndex();
    const playId = ++currentPlayId;

    setState('recovering');

    playerPause();
    playerSetSrc(getStationUrl(index));
    playerLoad();

    timers.loading = _setTimeout(() => {
      if (playId !== currentPlayId) return;
      currentPlayId++;  // invalidate late .then()
      playerPause();
      playerSetSrc('');
      setState('error');
      scheduleRecovery();
    }, LOADING_TIMEOUT_MS);

    playerPlay().then(() => {
      if (playId !== currentPlayId) return;
      _clearTimeout(timers.loading);
      retryCount = 0;
      recoveryCount = 0;
      saveLastIndex(index);
      setState('playing');
    }).catch((error) => {
      if (error.name === 'AbortError') return;
      if (playId !== currentPlayId) return;
      _clearTimeout(timers.loading);
      setState('error');
      scheduleRecovery();
    });
  }

  function onPlayButtonClick() {
    const s = getState();
    if (s === 'idle' || s === 'error' || s === 'recovering') {
      _clearTimeout(timers.recovery);
      playRadio(getSelectedIndex());
    } else if (s === 'paused') {
      return resumePlayer();
    }
  }

  return {
    getState,
    stopRadio,
    playRadio,
    pauseRadio,
    resumeRadio,
    togglePlayPause,
    prevRadio,
    nextRadio,
    onPlayerPlay,
    onPlayerPause,
    onPlayerError,
    retryFromError,
    onPlayButtonClick,
    _getPlayId: () => currentPlayId,
    _getRetryCount: () => retryCount,
    _getRecoveryCount: () => recoveryCount,
    _getTimers: () => timers,
  };
}
