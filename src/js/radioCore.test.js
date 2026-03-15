import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createRadioCore, MAX_RECOVERY_ATTEMPTS, RECOVERY_DELAY_MS } from './radioCore.js';

// --- Helpers ---

function makeDeps(overrides = {}) {
  const calls = {
    showButton: [],
    loadingSound: [],
    errorSound: [],
    loadingMsg: [],
    errorMsg: [],
    mediaSession: [],
    playerPlay: [],
    playerPause: [],
    playerSetSrc: [],
    playerLoad: [],
    savedIndex: [],
    selectedIndex: 0,
    paused: true,
    now: 0,
  };

  // By default playerPlay resolves (stream connects instantly)
  let playerPlayResult = Promise.resolve();

  const deps = {
    getStationUrl: (i) => `http://stream${i}.mp3`,
    getStationCount: () => 5,
    getSelectedIndex: () => calls.selectedIndex,
    setSelectedIndex: (i) => { calls.selectedIndex = i; },
    playerPlay: () => {
      calls.playerPlay.push('play');
      calls.paused = false;
      return playerPlayResult;
    },
    playerPause: () => { calls.playerPause.push('pause'); calls.paused = true; },
    playerSetSrc: (url) => { calls.playerSetSrc.push(url); },
    playerLoad: () => { calls.playerLoad.push('load'); },
    playerIsPaused: () => calls.paused,
    loadingSound: {
      play: () => calls.loadingSound.push('play'),
      stop: () => calls.loadingSound.push('stop'),
    },
    errorSound: {
      play: () => calls.errorSound.push('play'),
      stop: () => calls.errorSound.push('stop'),
    },
    showButton: (which) => calls.showButton.push(which),
    setLoadingMsg: (v) => calls.loadingMsg.push(v),
    setErrorMsg: (v) => calls.errorMsg.push(v),
    updateMediaSession: (s) => calls.mediaSession.push(s),
    saveLastIndex: (i) => calls.savedIndex.push(i),
    setTimeout: vi.fn((fn, ms) => {
      const id = Math.random();
      deps._pendingTimers.set(id, { fn, ms });
      return id;
    }),
    clearTimeout: vi.fn((id) => {
      deps._pendingTimers.delete(id);
    }),
    _pendingTimers: new Map(),
    // test helpers
    _setPlayerPlayResult: (p) => { playerPlayResult = p; },
    performanceNow: () => calls.now,
    isOnline: () => true,
    ...overrides,
  };

  return { deps, calls };
}

function flushPromises() {
  return new Promise(resolve => setTimeout(resolve, 0));
}

function fireTimer(deps, delayMs) {
  for (const [id, timer] of deps._pendingTimers) {
    if (timer.ms === delayMs) {
      deps._pendingTimers.delete(id);
      timer.fn();
      return true;
    }
  }
  return false;
}

// =============================================
// SIDE-EFFECTS PER STATE (tested via business actions)
// =============================================

describe('side-effects per state', () => {
  it('idle: play button, no sounds, no messages', () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    // starts idle
    expect(core.getState()).toBe('idle');
    expect(calls.showButton.at(-1)).toBe('play');
    expect(calls.loadingMsg.at(-1)).toBe(false);
    expect(calls.errorMsg.at(-1)).toBe(false);
  });

  it('loading: stop button, loading sound, loading message', () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    expect(core.getState()).toBe('loading');
    expect(calls.showButton.at(-1)).toBe('stop');
    expect(calls.loadingSound).toContain('play');
    expect(calls.loadingMsg.at(-1)).toBe(true);
    expect(calls.errorMsg.at(-1)).toBe(false);
  });

  it('playing: pause button, sounds stopped, no messages', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();

    expect(core.getState()).toBe('playing');
    expect(calls.showButton.at(-1)).toBe('pause');
    expect(calls.loadingSound.at(-1)).toBe('stop');
    expect(calls.errorSound.at(-1)).toBe('stop');
    expect(calls.loadingMsg.at(-1)).toBe(false);
    expect(calls.errorMsg.at(-1)).toBe(false);
  });

  it('paused: play button, sounds stopped', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    core.onPlayerPause();

    expect(core.getState()).toBe('paused');
    expect(calls.showButton.at(-1)).toBe('play');
    expect(calls.loadingMsg.at(-1)).toBe(false);
  });

  it('retrying: stop button, loading sound keeps playing', async () => {
    const { deps, calls } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();

    expect(core.getState()).toBe('retrying');
    expect(calls.showButton.at(-1)).toBe('stop');
    // loading sound was NOT stopped — last loading action is 'play' from loading state
    expect(calls.loadingSound.at(-1)).toBe('play');
    expect(calls.errorMsg.at(-1)).toBe(false);
  });

  it('error: stop button, error sound, error message', async () => {
    const { deps, calls } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000);
    await flushPromises();

    expect(core.getState()).toBe('error');
    expect(calls.showButton.at(-1)).toBe('stop');
    expect(calls.loadingSound.at(-1)).toBe('stop');
    expect(calls.errorSound.at(-1)).toBe('play');
    expect(calls.errorMsg.at(-1)).toBe(true);
    expect(calls.loadingMsg.at(-1)).toBe(false);
  });

  it('stopRadio → idle: play button, all sounds stopped', () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    core.stopRadio();

    expect(core.getState()).toBe('idle');
    expect(calls.showButton.at(-1)).toBe('play');
    expect(calls.loadingSound.at(-1)).toBe('stop');
    expect(calls.errorSound.at(-1)).toBe('stop');
    expect(calls.loadingMsg.at(-1)).toBe(false);
    expect(calls.errorMsg.at(-1)).toBe(false);
  });
});

// =============================================
// HAPPY PATH: idle → loading → playing
// =============================================

describe('playRadio — happy path', () => {
  it('idle → loading → playing', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    expect(core.getState()).toBe('idle');

    core.playRadio(2);
    expect(core.getState()).toBe('loading');
    expect(calls.selectedIndex).toBe(2);
    expect(calls.playerSetSrc.at(-1)).toBe('http://stream2.mp3');
    expect(calls.loadingSound).toContain('play');
    expect(calls.showButton).toContain('stop');

    await flushPromises();

    expect(core.getState()).toBe('playing');
    expect(calls.showButton.at(-1)).toBe('pause');
    expect(calls.loadingSound.at(-1)).toBe('stop');
    expect(calls.savedIndex).toContain(2);
  });
});

// =============================================
// ERROR PATH: idle → loading → retrying → loading → error
// =============================================

describe('playRadio — error with retry', () => {
  it('retries then errors after MAX_RETRIES', async () => {
    const { deps, calls } = makeDeps();
    const playError = new Error('Network error');
    deps._setPlayerPlayResult(Promise.reject(playError));
    const core = createRadioCore(deps);

    core.playRadio(1);
    await flushPromises();

    // First failure → retrying (retry #1)
    expect(core.getState()).toBe('retrying');
    expect(calls.showButton.at(-1)).toBe('stop');
    // Loading sound should NOT have been stopped (keep)
    // The last loading sound action should be 'play' from setState('loading')
    const loadingActionsBeforeRetry = [...calls.loadingSound];
    expect(loadingActionsBeforeRetry.filter(a => a === 'stop').length).toBeLessThanOrEqual(
      loadingActionsBeforeRetry.filter(a => a === 'play').length
    );

    // Fire retry timer (3000ms)
    fireTimer(deps, 3000);
    await flushPromises();

    // After MAX_RETRIES (1), second failure → error
    expect(core.getState()).toBe('error');
    expect(calls.showButton.at(-1)).toBe('stop');
    expect(calls.errorSound.at(-1)).toBe('play');
    expect(calls.loadingSound.at(-1)).toBe('stop');
    expect(calls.errorMsg.at(-1)).toBe(true);
  });
});

// =============================================
// PAUSE / RESUME
// =============================================

describe('pause and resume', () => {
  it('playing → paused → playing', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    expect(core.getState()).toBe('playing');

    core.onPlayerPause();
    expect(core.getState()).toBe('paused');
    expect(calls.showButton.at(-1)).toBe('play');

    core.onPlayerPlay();
    expect(core.getState()).toBe('playing');
    expect(calls.showButton.at(-1)).toBe('pause');
  });

  it('onPlayerPause does nothing when not playing', () => {
    const { deps } = makeDeps();
    const core = createRadioCore(deps);

    core.onPlayerPause();
    expect(core.getState()).toBe('idle'); // unchanged
  });

  it('onPlayerPlay does nothing when not paused', async () => {
    const { deps } = makeDeps();
    const core = createRadioCore(deps);

    // in loading state
    core.playRadio(0);
    expect(core.getState()).toBe('loading');

    core.onPlayerPlay();
    expect(core.getState()).toBe('loading'); // unchanged
  });
});

// =============================================
// STOP
// =============================================

describe('stopRadio', () => {
  it('stops from loading', () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    expect(core.getState()).toBe('loading');

    core.stopRadio();
    expect(core.getState()).toBe('idle');
    expect(calls.showButton.at(-1)).toBe('play');
    expect(calls.loadingSound.at(-1)).toBe('stop');
    expect(calls.errorSound.at(-1)).toBe('stop');
    expect(calls.playerSetSrc.at(-1)).toBe('');
  });

  it('stops from playing', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    expect(core.getState()).toBe('playing');

    core.stopRadio();
    expect(core.getState()).toBe('idle');
  });

  it('stops from error', async () => {
    const { deps, calls } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000); // retry
    await flushPromises(); // second failure → error

    expect(core.getState()).toBe('error');

    core.stopRadio();
    expect(core.getState()).toBe('idle');
    expect(calls.errorSound.at(-1)).toBe('stop');
  });

  it('invalidates pending callbacks (playId)', async () => {
    const { deps, calls } = makeDeps();

    let resolvePlay;
    deps._setPlayerPlayResult(new Promise(r => { resolvePlay = r; }));
    const core = createRadioCore(deps);

    core.playRadio(0);
    const idBefore = core._getPlayId();

    core.stopRadio();
    expect(core._getPlayId()).not.toBe(idBefore);

    // Now resolve the old play promise — should be ignored
    resolvePlay();
    await flushPromises();
    expect(core.getState()).toBe('idle'); // not 'playing'
  });
});

// =============================================
// PLAY BUTTON
// =============================================

describe('onPlayButtonClick', () => {
  it('plays from idle', () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);
    calls.selectedIndex = 3;

    core.onPlayButtonClick();
    expect(core.getState()).toBe('loading');
  });

  it('plays from error', async () => {
    const { deps, calls } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000);
    await flushPromises();
    expect(core.getState()).toBe('error');

    deps._setPlayerPlayResult(Promise.resolve());
    core.onPlayButtonClick();
    expect(core.getState()).toBe('loading');
  });

  it('resumes from paused', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    core.onPlayerPause();
    expect(core.getState()).toBe('paused');

    core.onPlayButtonClick();
    // Should call playerPlay (resume), not playRadio
    expect(calls.playerPlay.length).toBeGreaterThan(1);
  });

  it('does nothing during loading', () => {
    const { deps } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    expect(core.getState()).toBe('loading');

    core.onPlayButtonClick();
    expect(core.getState()).toBe('loading'); // no change
  });
});

// =============================================
// PREV / NEXT
// =============================================

describe('prevRadio / nextRadio', () => {
  it('nextRadio wraps around', () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);
    calls.selectedIndex = 4; // last station (count = 5)

    core.nextRadio();
    expect(calls.selectedIndex).toBe(0);
  });

  it('prevRadio wraps around', () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);
    calls.selectedIndex = 0;

    core.prevRadio();
    expect(calls.selectedIndex).toBe(4);
  });

  it('nextRadio advances normally', () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);
    calls.selectedIndex = 2;

    core.nextRadio();
    expect(calls.selectedIndex).toBe(3);
  });
});

// =============================================
// LOADING TIMEOUT
// =============================================

describe('loading timeout', () => {
  it('triggers error after LOADING_TIMEOUT_MS', async () => {
    const { deps, calls } = makeDeps();
    // playerPlay never resolves (simulates stuck stream)
    deps._setPlayerPlayResult(new Promise(() => {}));
    const core = createRadioCore(deps);

    core.playRadio(0);
    expect(core.getState()).toBe('loading');

    // Fire the loading timeout (6000ms)
    fireTimer(deps, 6000);
    // First timeout → retry
    expect(core.getState()).toBe('retrying');

    // Fire retry timer
    fireTimer(deps, 3000);
    expect(core.getState()).toBe('loading');

    // Fire loading timeout again
    fireTimer(deps, 6000);
    // Now MAX_RETRIES exhausted → error
    expect(core.getState()).toBe('error');
  });
});

// =============================================
// RAPID STATION SWITCHING (race condition)
// =============================================

describe('rapid station switching', () => {
  it('only the last playRadio call wins', async () => {
    const { deps, calls } = makeDeps();
    let resolvers = [];
    deps.playerPlay = () => {
      calls.playerPlay.push('play');
      return new Promise(r => resolvers.push(r));
    };
    const core = createRadioCore(deps);

    core.playRadio(0);
    core.playRadio(1);
    core.playRadio(2);

    // Resolve all three — only the last should take effect
    resolvers.forEach(r => r());
    await flushPromises();

    expect(core.getState()).toBe('playing');
    expect(calls.selectedIndex).toBe(2);
    expect(calls.savedIndex).toEqual([2]); // only station 2 saved
  });
});

// =============================================
// RETRYING keeps loading sound
// =============================================

describe('retrying keeps loading sound', () => {
  it('loading sound is not stopped during retrying', async () => {
    const { deps, calls } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();

    expect(core.getState()).toBe('retrying');

    // Find the loading sound calls after setState('retrying')
    // 'retrying' has loading: 'keep' — so no stop should happen for retrying specifically
    // The last loading action from setState('loading') was 'play'
    // setState('retrying') should NOT add 'stop'
    const loadingAfterRetry = calls.loadingSound.slice(-1)[0];
    // Last action should still be 'play' (from the loading state, not stopped by retrying)
    expect(loadingAfterRetry).toBe('play');
  });
});

// =============================================
// pauseRadio / resumeRadio / togglePlayPause
// =============================================

describe('pauseRadio / resumeRadio', () => {
  it('pauseRadio calls playerPause', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    const pausesBefore = calls.playerPause.length;

    core.pauseRadio();
    expect(calls.playerPause.length).toBe(pausesBefore + 1);
  });

  it('resumeRadio calls playerPlay', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    const playsBefore = calls.playerPlay.length;

    core.resumeRadio();
    expect(calls.playerPlay.length).toBe(playsBefore + 1);
  });
});

describe('togglePlayPause', () => {
  it('pauses when playing', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    calls.paused = false; // player is playing

    const pausesBefore = calls.playerPause.length;
    core.togglePlayPause();
    expect(calls.playerPause.length).toBe(pausesBefore + 1);
  });

  it('resumes from paused', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    core.onPlayerPause(); // state → paused
    calls.paused = true;

    const playsBefore = calls.playerPlay.length;
    core.togglePlayPause();
    expect(calls.playerPlay.length).toBe(playsBefore + 1);
  });

  it('plays from idle when paused', () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);
    calls.paused = true;

    core.togglePlayPause();
    expect(core.getState()).toBe('loading');
  });
});

// =============================================
// RESTART AFTER LONG PAUSE
// =============================================

describe('restart after long pause', () => {
  it('restarts radio if paused > 2 seconds', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    expect(core.getState()).toBe('playing');

    // Simulate pause at time 1000
    calls.now = 1000;
    core.onPlayerPause();
    expect(core.getState()).toBe('paused');

    // Simulate play at time 4000 (3 seconds later)
    calls.now = 4000;
    core.onPlayerPlay();

    // Should restart (go through loading), not just resume
    expect(core.getState()).toBe('loading');
  });

  it('resumes normally if paused < 2 seconds', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();

    calls.now = 1000;
    core.onPlayerPause();

    calls.now = 2500; // 1.5 seconds later
    core.onPlayerPlay();

    expect(core.getState()).toBe('playing'); // normal resume
  });
});

// =============================================
// MAX RECOVERY ATTEMPTS
// =============================================

describe('max recovery attempts', () => {
  it('stops scheduling recovery after MAX_RECOVERY_ATTEMPTS', async () => {
    const { deps } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    // Get to error state
    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000); // retry
    await flushPromises(); // → error
    expect(core.getState()).toBe('error');

    // Exhaust all recovery attempts
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) {
      fireTimer(deps, RECOVERY_DELAY_MS); // scheduleRecovery fires retryFromError
      await flushPromises(); // recovery .catch → error + scheduleRecovery
    }

    expect(core.getState()).toBe('error');
    expect(core._getRecoveryCount()).toBe(MAX_RECOVERY_ATTEMPTS);

    // No more timers should be pending for recovery
    const hasRecoveryTimer = [...deps._pendingTimers.values()].some(t => t.ms === RECOVERY_DELAY_MS);
    expect(hasRecoveryTimer).toBe(false);
  });

  it('resets recovery count on successful playRadio', async () => {
    const { deps } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    // Get to error with some recovery attempts
    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000);
    await flushPromises();
    fireTimer(deps, RECOVERY_DELAY_MS);
    await flushPromises();
    expect(core._getRecoveryCount()).toBeGreaterThan(0);

    // Now play succeeds — should reset recovery count
    deps._setPlayerPlayResult(Promise.resolve());
    core.playRadio(0);
    await flushPromises();
    expect(core._getRecoveryCount()).toBe(0);
  });

  it('resets recovery count on stopRadio', async () => {
    const { deps } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000);
    await flushPromises();
    fireTimer(deps, RECOVERY_DELAY_MS);
    await flushPromises();
    expect(core._getRecoveryCount()).toBeGreaterThan(0);

    core.stopRadio();
    expect(core._getRecoveryCount()).toBe(0);
  });

  it('resets recovery count when silent recovery succeeds', async () => {
    const { deps } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    // Get to error state
    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000);
    await flushPromises();
    expect(core.getState()).toBe('error');

    // Do a few failed recoveries
    fireTimer(deps, RECOVERY_DELAY_MS);
    await flushPromises();
    fireTimer(deps, RECOVERY_DELAY_MS);
    await flushPromises();
    // count=3: initial scheduleRecovery(1) + two failed retryFromError re-schedules(2,3)
    expect(core._getRecoveryCount()).toBe(3);

    // Now make recovery succeed
    deps._setPlayerPlayResult(Promise.resolve());
    fireTimer(deps, RECOVERY_DELAY_MS);
    await flushPromises();

    expect(core.getState()).toBe('playing');
    expect(core._getRecoveryCount()).toBe(0);
  });

  it('offline recovery reschedules without attempting stream', async () => {
    let online = true;
    const { deps, calls } = makeDeps({ isOnline: () => online });
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    // Get to error state
    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000);
    await flushPromises();
    expect(core.getState()).toBe('error');

    // Go offline
    online = false;
    const playsBefore = calls.playerPlay.length;

    // Fire recovery while offline — should reschedule, not attempt stream
    fireTimer(deps, RECOVERY_DELAY_MS);
    await flushPromises();

    expect(core.getState()).toBe('error');
    // No playerPlay attempted while offline
    expect(calls.playerPlay.length).toBe(playsBefore);
    // A new recovery timer was scheduled
    const hasRecoveryTimer = [...deps._pendingTimers.values()].some(t => t.ms === RECOVERY_DELAY_MS);
    expect(hasRecoveryTimer).toBe(true);
  });

  it('onPlayButtonClick from recovering resets recovery count', async () => {
    const { deps } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    // Get to error → recovering
    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000);
    await flushPromises();
    expect(core.getState()).toBe('error');

    fireTimer(deps, RECOVERY_DELAY_MS);
    await flushPromises();
    expect(core._getRecoveryCount()).toBeGreaterThan(0);

    // User presses play manually — should reset and start fresh
    deps._setPlayerPlayResult(Promise.resolve());
    core.onPlayButtonClick();
    await flushPromises();

    expect(core.getState()).toBe('playing');
    expect(core._getRecoveryCount()).toBe(0);
  });

  it('offline recovery loops are also bounded by MAX_RECOVERY_ATTEMPTS', async () => {
    let online = true;
    const { deps } = makeDeps({ isOnline: () => online });
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    // Get to error state (online)
    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000);
    await flushPromises();
    expect(core.getState()).toBe('error');

    // Go offline and exhaust all recovery attempts
    online = false;
    for (let i = 0; i < MAX_RECOVERY_ATTEMPTS; i++) {
      fireTimer(deps, RECOVERY_DELAY_MS);
      await flushPromises();
    }

    expect(core.getState()).toBe('error');
    expect(core._getRecoveryCount()).toBe(MAX_RECOVERY_ATTEMPTS);

    // No more recovery timers — loop is capped even while offline
    const hasRecoveryTimer = [...deps._pendingTimers.values()].some(t => t.ms === RECOVERY_DELAY_MS);
    expect(hasRecoveryTimer).toBe(false);
  });
});
