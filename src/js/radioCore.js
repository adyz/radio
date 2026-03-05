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
    loadingSound,
    errorSound,
    showButton,
    setLoadingMsg,
    setErrorMsg,
    updateMediaSession,
    saveLastIndex,
    setTimeout: _setTimeout,
    clearTimeout: _clearTimeout,
    performanceNow,
    isOnline,
  } = deps;

  const timers = { retry: null, loading: null, recovery: null };
  let retryCount = 0;
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
  });

  setState('idle');

  // --- Radio logic ---

  function stopRadio() {
    _clearTimeout(timers.retry);
    _clearTimeout(timers.loading);
    _clearTimeout(timers.recovery);
    currentPlayId++;
    retryCount = 0;
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
    if (!_isRetry) retryCount = 0;

    // No point trying if offline — go straight to error and auto-recover later
    if (!isOnline()) {
      currentPlayId++;
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

  function resumeRadio() {
    playerPlay();
  }

  function togglePlayPause() {
    if (playerIsPaused()) {
      const s = getState();
      if (s === 'paused') playerPlay();
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

  // Schedule a silent recovery attempt after RECOVERY_DELAY_MS
  function scheduleRecovery() {
    _clearTimeout(timers.recovery);
    timers.recovery = _setTimeout(() => {
      retryFromError();
    }, RECOVERY_DELAY_MS);
  }

  // Silent recovery: uses the state machine ('recovering' state).
  // No loading sounds, error image stays — if it works, go straight to playing.
  function retryFromError() {
    const s = getState();
    if (s !== 'error' && s !== 'recovering') return;

    // No point trying without connectivity — wait for 'online' event
    if (!isOnline()) {
      scheduleRecovery();
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
      saveLastIndex(index);
      setState('playing');
    }).catch(() => {
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
      playerPlay();
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
    _getTimers: () => timers,
  };
}
