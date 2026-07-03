/**
 * Radio Player — thin adapter over the XState machine (radioMachine.ts).
 *
 * Keeps the same public API the DOM layer always used (playRadio, stopRadio,
 * togglePlayPause, onPlayerPause, …) and translates it into machine events.
 * All DOM / browser interaction still comes in through the `deps` object so
 * everything stays testable without a browser.
 */

import { createActor } from 'xstate';
import { createRadioMachine } from './radioMachine';

/** The clock shape xstate actors accept (not exported by the library).
 *  Tests inject a SimulatedClock here to control `after` delays. */
interface ActorClock {
  setTimeout(fn: (...args: unknown[]) => void, timeout: number): unknown;
  clearTimeout(id: unknown): void;
}

export type RadioState =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'retrying'
  | 'error'
  | 'recovering';

type PlaybackButton = 'play' | 'pause' | 'stop';

/** A feedback sound (loading/error noise) the core can drive. */
export interface FeedbackSound {
  play(): void;
  stop(): void;
  /** Re-assert playback: restart if a play() was rejected or the OS paused it. */
  ensure(): void;
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
  setInterval(fn: () => void, ms: number): TimerId;
  clearInterval(id: TimerId | null): void;
  performanceNow(): number;
  isOnline(): boolean;
}

export type RadioCore = ReturnType<typeof createRadioCore>;

export const MAX_RETRIES = 1;
export const LOADING_TIMEOUT_MS = 6000;
export const RETRY_DELAY_MS = 3000;
export const RECOVERY_DELAY_MS = 10000;
export const RECOVERY_DELAY_MAX_MS = 60000;
export const WATCHDOG_INTERVAL_MS = 2000;
export const WATCHDOG_STALL_TICKS = 3; // ≈6s of frozen playback ⇒ stream is dead
export const SOUND_SUPERVISOR_INTERVAL_MS = 2500;
export const USER_PAUSE_INTENT_MS = 2000; // how long a pauseRadio() call explains a native 'pause'
export const LONG_PAUSE_RESTART_MS = 2000; // paused longer than this ⇒ restart the live stream

export function createRadioCore(deps: RadioDeps, options: { clock?: ActorClock } = {}) {
  const actor = createActor(createRadioMachine(deps), options.clock ? { clock: options.clock } : {});

  // Same transition log the old state machine printed.
  let prev: RadioState | null = null;
  actor.subscribe((snapshot) => {
    const next = snapshot.value as RadioState;
    if (prev !== next) console.log(`[radio] ${prev ?? '∅'} → ${next}`);
    prev = next;
  });
  actor.start();

  const getState = (): RadioState => actor.getSnapshot().value as RadioState;

  function playRadio(index: number, _isRetry?: boolean) {
    actor.send({ type: 'PLAY', index, isRetry: _isRetry });
  }

  function stopRadio() {
    actor.send({ type: 'STOP' });
  }

  function prevRadio() {
    const count = deps.getStationCount();
    const idx = deps.getSelectedIndex();
    playRadio(idx === 0 ? count - 1 : idx - 1);
  }

  function nextRadio() {
    const count = deps.getStationCount();
    const idx = deps.getSelectedIndex();
    playRadio(idx === count - 1 ? 0 : idx + 1);
  }

  function pauseRadio() {
    // Remember that this pause was asked for by the user, so the native
    // 'pause' event it triggers isn't mistaken for a dying stream.
    actor.send({ type: 'USER_PAUSE_INTENT' });
    deps.playerPause();
  }

  function handleResumeError(error: unknown) {
    if ((error as { name?: string } | null | undefined)?.name === 'AbortError') return;
    try {
      deps.playerPause();
    } catch (_) {
      // Keep resume error handling focused on restoring state.
    }
    actor.send({ type: 'RESUME_FAILED' });
  }

  function resumePlayer() {
    try {
      const playPromise = deps.playerPlay();
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
    if (deps.playerIsPaused()) {
      const s = getState();
      if (s === 'paused') return resumePlayer();
      else if (s === 'idle' || s === 'error' || s === 'recovering') {
        playRadio(deps.getSelectedIndex());
      }
    } else {
      pauseRadio();
    }
  }

  // Native player events → machine events
  const onPlayerPlay = () => actor.send({ type: 'PLAYER_PLAY' });
  const onPlayerPause = () => actor.send({ type: 'PLAYER_PAUSE' });
  const onPlayerError = () => actor.send({ type: 'PLAYER_ERROR' });
  const retryFromError = () => actor.send({ type: 'RETRY_FROM_ERROR' });

  function onPlayButtonClick() {
    const s = getState();
    if (s === 'idle' || s === 'error' || s === 'recovering') {
      playRadio(deps.getSelectedIndex());
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
    _getRetryCount: () => actor.getSnapshot().context.retryCount,
    _getRecoveryCount: () => actor.getSnapshot().context.recoveryCount,
  };
}
