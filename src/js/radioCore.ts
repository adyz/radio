/**
 * Radio Player — thin adapter over the XState machine (radioMachine.ts).
 *
 * Keeps the same public API the DOM layer always used (playRadio, stopRadio,
 * togglePlayPause, onPlayerPause, …) and translates it into machine events.
 * All DOM / browser interaction still comes in through the `deps` object so
 * everything stays testable without a browser.
 */

import { createActor } from 'xstate';
import { createRadioMachine, isAbortError } from './radioMachine';
import type { RadioDeps, RadioState } from './radioMachine';

/** The clock shape xstate actors accept (not exported by the library).
 *  Tests inject a SimulatedClock here to control `after` delays. */
interface ActorClock {
  setTimeout(fn: (...args: unknown[]) => void, timeout: number): unknown;
  clearTimeout(id: unknown): void;
}

type ActorOptions = NonNullable<Parameters<typeof createActor>[1]>;

// Shared domain types & timing constants live with the machine; re-exported
// here so the rest of the app keeps a single import surface.
export type { RadioState, FeedbackSound, RadioDeps } from './radioMachine';
export {
  isLoadingLike,
  isErrorLike,
  isFeedbackAudible,
  playbackStateFor,
} from './radioMachine';
export {
  MAX_RETRIES,
  LOADING_TIMEOUT_MS,
  RETRY_DELAY_MS,
  RECOVERY_DELAY_MS,
  RECOVERY_DELAY_MAX_MS,
  WATCHDOG_INTERVAL_MS,
  WATCHDOG_STALL_TICKS,
  SOUND_SUPERVISOR_INTERVAL_MS,
  USER_PAUSE_INTENT_MS,
  LONG_PAUSE_RESTART_MS,
} from './radioMachine';

export type RadioCore = ReturnType<typeof createRadioCore>;

export function createRadioCore(
  deps: RadioDeps,
  options: { clock?: ActorClock; inspect?: ActorOptions['inspect'] } = {},
) {
  const actor = createActor(createRadioMachine(deps), {
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.inspect ? { inspect: options.inspect } : {}),
  });

  // Same transition log the old state machine printed.
  let prev: RadioState | null = null;
  actor.subscribe((snapshot) => {
    const next = snapshot.value as RadioState;
    if (prev !== next) console.log(`[radio] ${prev ?? '∅'} → ${next}`);
    prev = next;
  });
  actor.start();

  const getState = (): RadioState => actor.getSnapshot().value as RadioState;

  function playRadio(index: number) {
    actor.send({ type: 'PLAY', index });
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
    if (isAbortError(error)) return;
    try {
      deps.playerPause();
    } catch (_) {
      // Keep resume error handling focused on restoring state.
    }
    actor.send({ type: 'RESUME_FAILED' });
  }

  function resumeRadio() {
    return deps.playerPlay().catch(handleResumeError);
  }

  function togglePlayPause() {
    if (deps.playerIsPaused()) {
      const s = getState();
      if (s === 'paused') return resumeRadio();
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
      return resumeRadio();
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
    _getRecoveryCount: () => actor.getSnapshot().context.recoveryCount,
  };
}
