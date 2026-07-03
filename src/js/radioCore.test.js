import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createRadioCore,
  RECOVERY_DELAY_MS,
  RECOVERY_DELAY_MAX_MS,
  WATCHDOG_INTERVAL_MS,
  WATCHDOG_STALL_TICKS,
  SOUND_SUPERVISOR_INTERVAL_MS,
  ERROR_SOUND_AUDIBLE_MS,
  USER_PAUSE_INTENT_MS,
} from './radioCore.js';

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
    currentTime: 0,
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
    playerCurrentTime: () => calls.currentTime,
    loadingSound: {
      play: () => calls.loadingSound.push('play'),
      stop: () => calls.loadingSound.push('stop'),
      ensure: () => calls.loadingSound.push('ensure'),
      mute: () => calls.loadingSound.push('mute'),
    },
    errorSound: {
      play: () => calls.errorSound.push('play'),
      stop: () => calls.errorSound.push('stop'),
      ensure: () => calls.errorSound.push('ensure'),
      mute: () => calls.errorSound.push('mute'),
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
    setInterval: vi.fn((fn, ms) => {
      const id = Math.random();
      deps._pendingIntervals.set(id, { fn, ms });
      return id;
    }),
    clearInterval: vi.fn((id) => {
      deps._pendingIntervals.delete(id);
    }),
    _pendingTimers: new Map(),
    _pendingIntervals: new Map(),
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

function tickWatchdog(deps, times = 1) {
  for (let i = 0; i < times; i++) {
    for (const timer of deps._pendingIntervals.values()) {
      if (timer.ms === WATCHDOG_INTERVAL_MS) timer.fn();
    }
  }
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
  it('goes straight to error when starting offline', () => {
    const { deps, calls } = makeDeps({ isOnline: () => false });
    const core = createRadioCore(deps);

    core.playRadio(1);

    expect(core.getState()).toBe('error');
    expect(calls.playerPlay).toEqual([]);
    expect(calls.playerSetSrc.at(-1)).toBe('');
    expect([...deps._pendingTimers.values()].some(t => t.ms === RECOVERY_DELAY_MS)).toBe(true);
  });

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
// NATIVE PLAYER ERRORS
// =============================================

describe('native player errors', () => {
  it('retries when the stream errors while playing', async () => {
    const { deps } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    expect(core.getState()).toBe('playing');

    core.onPlayerError();

    expect(core.getState()).toBe('retrying');
  });

  it('retries when the stream errors while paused', async () => {
    const { deps } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    core.onPlayerPause();
    expect(core.getState()).toBe('paused');

    core.onPlayerError();

    expect(core.getState()).toBe('retrying');
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

    // 'retrying' asserts the loading sound itself (loading: 'play') so a retry
    // reached from a watchdog stall is audible too — never stopped, never silent.
    const loadingAfterRetry = calls.loadingSound.slice(-1)[0];
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

describe('resume failures', () => {
  it('resumeRadio keeps paused when playerPlay rejects', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);
    let rejectResume;

    core.playRadio(0);
    await flushPromises();
    core.onPlayerPause();
    expect(core.getState()).toBe('paused');

    const pauseCallsBeforeResume = calls.playerPause.length;
    deps._setPlayerPlayResult(new Promise((_, reject) => { rejectResume = reject; }));
    const resume = core.resumeRadio();
    rejectResume(new Error('resume blocked'));
    await resume;

    expect(core.getState()).toBe('paused');
    expect(calls.paused).toBe(true);
    expect(calls.playerPause.length).toBe(pauseCallsBeforeResume + 1);
    expect(calls.showButton.at(-1)).toBe('play');
  });

  it('togglePlayPause keeps paused when resume rejects', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);
    let rejectResume;

    core.playRadio(0);
    await flushPromises();
    core.onPlayerPause();
    calls.paused = true;
    expect(core.getState()).toBe('paused');

    const pauseCallsBeforeResume = calls.playerPause.length;
    deps._setPlayerPlayResult(new Promise((_, reject) => { rejectResume = reject; }));
    const resume = core.togglePlayPause();
    rejectResume(new Error('resume blocked'));
    await resume;

    expect(core.getState()).toBe('paused');
    expect(calls.paused).toBe(true);
    expect(calls.playerPause.length).toBe(pauseCallsBeforeResume + 1);
  });

  it('onPlayButtonClick keeps paused when resume rejects', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);
    let rejectResume;

    core.playRadio(0);
    await flushPromises();
    core.onPlayerPause();
    expect(core.getState()).toBe('paused');

    const pauseCallsBeforeResume = calls.playerPause.length;
    deps._setPlayerPlayResult(new Promise((_, reject) => { rejectResume = reject; }));
    const resume = core.onPlayButtonClick();
    rejectResume(new Error('resume blocked'));
    await resume;

    expect(core.getState()).toBe('paused');
    expect(calls.paused).toBe(true);
    expect(calls.playerPause.length).toBe(pauseCallsBeforeResume + 1);
  });

  it('resumeRadio handles playerPlay without a promise', async () => {
    const { deps } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    core.onPlayerPause();
    expect(core.getState()).toBe('paused');

    deps._setPlayerPlayResult(undefined);
    await core.resumeRadio();

    expect(core.getState()).toBe('paused');
  });

  it('resumeRadio keeps paused when playerPlay throws synchronously', async () => {
    let callsRef;
    let playCalls = 0;
    const { deps, calls } = makeDeps({
      playerPlay: () => {
        callsRef.playerPlay.push('play');
        callsRef.paused = false;
        if (playCalls++ === 0) return Promise.resolve();
        throw new Error('resume blocked');
      },
    });
    callsRef = calls;
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    core.onPlayerPause();
    expect(core.getState()).toBe('paused');

    const pauseCallsBeforeResume = calls.playerPause.length;
    await core.resumeRadio();

    expect(core.getState()).toBe('paused');
    expect(calls.paused).toBe(true);
    expect(calls.playerPause.length).toBe(pauseCallsBeforeResume + 1);
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
// RECOVERY — exponential backoff, never gives up
// =============================================

describe('recovery backoff', () => {
  it('keeps scheduling recovery forever, with exponential backoff capped at RECOVERY_DELAY_MAX_MS', async () => {
    const { deps } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    // Get to error state
    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000); // retry
    await flushPromises(); // → error
    expect(core.getState()).toBe('error');

    // Each failed recovery doubles the delay, capped at the max
    const expectedDelays = [
      RECOVERY_DELAY_MS,      // 10s
      RECOVERY_DELAY_MS * 2,  // 20s
      RECOVERY_DELAY_MS * 4,  // 40s
      RECOVERY_DELAY_MAX_MS,  // capped at 60s
      RECOVERY_DELAY_MAX_MS,  // stays capped
    ];
    for (const delay of expectedDelays) {
      expect([...deps._pendingTimers.values()].some(t => t.ms === delay)).toBe(true);
      fireTimer(deps, delay); // retryFromError → recovering
      await flushPromises();  // fails → error + reschedule
      expect(core.getState()).toBe('error');
    }

    // Recovery never gives up — there is always a next attempt scheduled
    expect([...deps._pendingTimers.values()].some(t => t.ms === RECOVERY_DELAY_MAX_MS)).toBe(true);
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

    // Do a few failed recoveries (backoff: 10s, then 20s)
    fireTimer(deps, RECOVERY_DELAY_MS);
    await flushPromises();
    fireTimer(deps, RECOVERY_DELAY_MS * 2);
    await flushPromises();
    // count=3: initial scheduleRecovery(1) + two failed retryFromError re-schedules(2,3)
    expect(core._getRecoveryCount()).toBe(3);

    // Now make recovery succeed
    deps._setPlayerPlayResult(Promise.resolve());
    fireTimer(deps, RECOVERY_DELAY_MS * 4);
    await flushPromises();

    expect(core.getState()).toBe('playing');
    expect(core._getRecoveryCount()).toBe(0);
  });

  it('returns to error when silent recovery times out', async () => {
    const { deps, calls } = makeDeps();
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000);
    await flushPromises();
    expect(core.getState()).toBe('error');

    deps._setPlayerPlayResult(new Promise(() => {}));
    fireTimer(deps, RECOVERY_DELAY_MS);
    expect(core.getState()).toBe('recovering');

    fireTimer(deps, 6000);

    expect(core.getState()).toBe('error');
    expect(calls.playerSetSrc.at(-1)).toBe('');
    // Second failed attempt → backoff doubles to 20s
    expect([...deps._pendingTimers.values()].some(t => t.ms === RECOVERY_DELAY_MS * 2)).toBe(true);
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

  it('offline recovery keeps re-checking indefinitely (no dead end)', async () => {
    let online = true;
    const { deps, calls } = makeDeps({ isOnline: () => online });
    deps._setPlayerPlayResult(Promise.reject(new Error('fail')));
    const core = createRadioCore(deps);

    // Get to error state (online)
    core.playRadio(0);
    await flushPromises();
    fireTimer(deps, 3000);
    await flushPromises();
    expect(core.getState()).toBe('error');

    // Stay offline for a long time — far beyond the old 30-attempt cap
    online = false;
    const playsBefore = calls.playerPlay.length;
    for (let i = 0; i < 100; i++) {
      fireTimer(deps, RECOVERY_DELAY_MS);
      await flushPromises();
    }

    // Still waiting patiently: no stream attempts, but always a next check
    expect(core.getState()).toBe('error');
    expect(calls.playerPlay.length).toBe(playsBefore);
    expect([...deps._pendingTimers.values()].some(t => t.ms === RECOVERY_DELAY_MS)).toBe(true);

    // Net comes back — the very next check recovers playback on its own
    online = true;
    deps._setPlayerPlayResult(Promise.resolve());
    fireTimer(deps, RECOVERY_DELAY_MS);
    await flushPromises();
    expect(core.getState()).toBe('playing');
  });
});

// =============================================
// PLAYBACK WATCHDOG (silent stalls — HLS, flaky wifi)
// =============================================

describe('playback watchdog', () => {
  it('does nothing while playback progresses', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    expect(core.getState()).toBe('playing');

    for (let i = 0; i < 10; i++) {
      calls.currentTime += 2;
      tickWatchdog(deps);
    }
    expect(core.getState()).toBe('playing');
  });

  it('restarts the stream when playback time freezes', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    expect(core.getState()).toBe('playing');

    // Some healthy progress first
    calls.currentTime = 5;
    tickWatchdog(deps);

    // currentTime freezes: after WATCHDOG_STALL_TICKS frozen ticks → retry
    tickWatchdog(deps, WATCHDOG_STALL_TICKS);
    expect(core.getState()).toBe('retrying');

    // The normal retry cycle then recovers playback
    fireTimer(deps, 3000);
    await flushPromises();
    expect(core.getState()).toBe('playing');
  });

  it('a moment of progress resets the stall countdown', async () => {
    const { deps, calls } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();

    calls.currentTime = 5;
    tickWatchdog(deps);
    tickWatchdog(deps, WATCHDOG_STALL_TICKS - 1); // almost stalled…
    calls.currentTime = 6;                        // …but it moves again
    tickWatchdog(deps);
    tickWatchdog(deps, WATCHDOG_STALL_TICKS - 1); // frozen again, not enough
    expect(core.getState()).toBe('playing');

    tickWatchdog(deps); // one more frozen tick crosses the threshold
    expect(core.getState()).toBe('retrying');
  });

  it('stops watching when paused or stopped', async () => {
    const { deps } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    expect(deps._pendingIntervals.size).toBe(1);

    core.onPlayerPause();
    expect(core.getState()).toBe('paused');
    expect(deps._pendingIntervals.size).toBe(0);

    core.onPlayerPlay();
    expect(deps._pendingIntervals.size).toBe(1);

    core.stopRadio();
    expect(deps._pendingIntervals.size).toBe(0);
  });
});

// =============================================
// ALWAYS AUDIBLE — system pause vs user pause
// (the network dying must never leave the app in silent 'paused')
// =============================================

function tickSupervisor(deps, times = 1) {
  for (let i = 0; i < times; i++) {
    for (const timer of deps._pendingIntervals.values()) {
      if (timer.ms === SOUND_SUPERVISOR_INTERVAL_MS) timer.fn();
    }
  }
}

describe('system pause vs user pause', () => {
  it('a pause the user asked for stays paused, even offline', async () => {
    let online = true;
    const { deps, calls } = makeDeps({ isOnline: () => online });
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();
    expect(core.getState()).toBe('playing');

    core.pauseRadio();       // user intent…
    online = false;          // …even if the network dies at the same moment
    core.onPlayerPause();    // native event triggered by our own pause()

    expect(core.getState()).toBe('paused');
  });

  it('an unexpected native pause while offline goes to retrying with the loading sound', async () => {
    let online = true;
    const { deps, calls } = makeDeps({ isOnline: () => online });
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();

    online = false;
    core.onPlayerPause();    // OS killed the dead stream — nobody pressed pause

    expect(core.getState()).toBe('retrying');
    expect(calls.loadingSound.at(-1)).toBe('play');
  });

  it('the offline retry lands in error with the error sound and keeps recovering', async () => {
    let online = true;
    const { deps, calls } = makeDeps({ isOnline: () => online });
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();

    online = false;
    core.onPlayerPause();
    expect(core.getState()).toBe('retrying');

    fireTimer(deps, 3000);   // the scheduled retry runs while still offline
    expect(core.getState()).toBe('error');
    expect(calls.errorSound.at(-1)).toBe('play');
    expect(calls.errorMsg.at(-1)).toBe(true);

    // Silent recovery is scheduled — the radio never gives up
    fireTimer(deps, RECOVERY_DELAY_MS);
    expect(core.getState()).toBe('error'); // still offline: fixed-cadence recheck
    expect([...deps._pendingTimers.values()].some(t => t.ms === RECOVERY_DELAY_MS)).toBe(true);
  });

  it('an unexpected native pause while online still pauses (interruption, unplugged headphones)', async () => {
    const { deps } = makeDeps();
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();

    core.onPlayerPause();    // no user intent, but the network is fine

    expect(core.getState()).toBe('paused');
  });

  it('user pause intent expires after USER_PAUSE_INTENT_MS', async () => {
    let online = true;
    const { deps, calls } = makeDeps({ isOnline: () => online });
    const core = createRadioCore(deps);

    core.playRadio(0);
    await flushPromises();

    core.pauseRadio();
    calls.now += USER_PAUSE_INTENT_MS + 1000; // the native pause arrives much later
    online = false;
    core.onPlayerPause();

    expect(core.getState()).toBe('retrying'); // stale intent no longer explains it
  });
});

// =============================================
// SOUND SUPERVISOR — something must always be audible
// =============================================

describe('sound supervisor', () => {
  it('re-asserts the loading sound while loading', async () => {
    const { deps, calls } = makeDeps();
    deps._setPlayerPlayResult(new Promise(() => {})); // stream never connects
    const core = createRadioCore(deps);

    core.playRadio(0);
    expect(core.getState()).toBe('loading');

    tickSupervisor(deps);
    expect(calls.loadingSound.at(-1)).toBe('ensure');
  });

  it('re-asserts the error sound while in error', async () => {
    const { deps, calls } = makeDeps({ isOnline: () => false });
    const core = createRadioCore(deps);

    core.playRadio(0); // offline → straight to error
    expect(core.getState()).toBe('error');

    tickSupervisor(deps);
    expect(calls.errorSound.at(-1)).toBe('ensure');
  });

  it('mutes the error sound after ERROR_SOUND_AUDIBLE_MS but recovery continues', async () => {
    const { deps, calls } = makeDeps({ isOnline: () => false });
    const core = createRadioCore(deps);

    core.playRadio(0);
    expect(core.getState()).toBe('error');

    tickSupervisor(deps);
    expect(calls.errorSound.at(-1)).toBe('ensure'); // audible within the first minute

    calls.now += ERROR_SOUND_AUDIBLE_MS;
    tickSupervisor(deps);
    expect(calls.errorSound.at(-1)).toBe('mute');   // silent afterwards…

    // …while the silent recovery timer is still armed
    expect([...deps._pendingTimers.values()].some(t => t.ms === RECOVERY_DELAY_MS)).toBe(true);
  });

  it('a new error cycle is audible again from the start', async () => {
    let online = false;
    const { deps, calls } = makeDeps({ isOnline: () => online });
    const core = createRadioCore(deps);

    core.playRadio(0);
    calls.now += ERROR_SOUND_AUDIBLE_MS;
    tickSupervisor(deps);
    expect(calls.errorSound.at(-1)).toBe('mute');

    core.stopRadio();                 // cycle ends (sound stopped + unmuted)
    expect(calls.errorSound.at(-1)).toBe('stop');

    core.playRadio(0);                // user tries again, still offline
    expect(core.getState()).toBe('error');
    tickSupervisor(deps);
    expect(calls.errorSound.at(-1)).toBe('ensure'); // fresh cycle: audible again
  });

  it('recovering keeps the error-cycle clock running (no audible reset mid-cycle)', async () => {
    const { deps, calls } = makeDeps({ isOnline: () => false });
    const core = createRadioCore(deps);

    core.playRadio(0);
    expect(core.getState()).toBe('error');

    calls.now += ERROR_SOUND_AUDIBLE_MS / 2;
    fireTimer(deps, RECOVERY_DELAY_MS);      // offline recheck: error → (recovering skipped) error
    calls.now += ERROR_SOUND_AUDIBLE_MS / 2;
    tickSupervisor(deps);
    expect(calls.errorSound.at(-1)).toBe('mute'); // one uninterrupted cycle: 60s total
  });

  it('the supervisor stops outside sound states', async () => {
    const { deps } = makeDeps({ isOnline: () => false });
    const core = createRadioCore(deps);

    core.playRadio(0);
    expect(core.getState()).toBe('error');
    const supervisorCount = () =>
      [...deps._pendingIntervals.values()].filter(t => t.ms === SOUND_SUPERVISOR_INTERVAL_MS).length;
    expect(supervisorCount()).toBe(1);

    core.stopRadio();
    expect(supervisorCount()).toBe(0);
  });
});
