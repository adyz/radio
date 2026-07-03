/**
 * Radio Player — pure logic core.
 *
 * All DOM / browser interaction comes in through the `deps` object
 * so this module can be tested without a browser.
 */

import { createStateMachine } from './stateMachine.js';

export const MAX_RETRIES = 1;
export const LOADING_TIMEOUT_MS = 6000;
export const RECOVERY_DELAY_MS = 10000;
export const RECOVERY_DELAY_MAX_MS = 60000;
export const WATCHDOG_INTERVAL_MS = 2000;
export const WATCHDOG_STALL_TICKS = 3; // ≈6s of frozen playback ⇒ stream is dead

const STATE_FX = {
  idle:       { button: 'play',  loading: 'stop',  error: 'stop',  loadingMsg: false, errorMsg: false },
  loading:    { button: 'stop',  loading: 'play',  error: 'stop',  loadingMsg: true,  errorMsg: false },
  playing:    { button: 'pause', loading: 'stop',  error: 'stop',  loadingMsg: false, errorMsg: false },
  paused:     { button: 'play',  loading: 'stop',  error: 'stop',  loadingMsg: false, errorMsg: false },
  retrying:   { button: 'stop',  loading: 'keep',  error: 'stop',  loadingMsg: false, errorMsg: false },
  error:      { button: 'stop',  loading: 'stop',  error: 'play',  loadingMsg: false, errorMsg: true  },
  recovering: { button: 'stop',  loading: 'stop',  error: 'keep',  loadingMsg: false, errorMsg: true  },
};

export function createRadioCore(deps) {
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

  const timers = { retry: null, loading: null, recovery: null, watchdog: null };
  let retryCount = 0;
  let recoveryCount = 0;
  let currentPlayId = 0;
  let lastPauseTime = null;

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

  function playRadio(index, _isRetry) {
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

  function handlePlayError(playId, index, error) {
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
    playerPause();
  }

  function handleResumeError(error) {
    if (error?.name === 'AbortError') return;
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
      playerPause();
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
    if (getState() === 'playing') {
      setState('paused');
      lastPauseTime = performanceNow();
    }
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

  let watchdogLastTime = null;
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
