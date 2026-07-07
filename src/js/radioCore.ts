/**
 * Radio Player — thin adapter over the XState machine (radioMachine.ts).
 *
 * Keeps the same public API the DOM layer always used (playRadio, stopRadio,
 * togglePlayPause, onPlayerPause, …) and translates it into machine events.
 * Pure forwarding: every user gesture and player event is one send(); all
 * playback policy (what resume/toggle/pause mean per state) lives in the
 * machine. All DOM / browser interaction still comes in through the `deps`
 * object so everything stays testable without a browser.
 */

import { createActor } from 'xstate';
import { createRadioMachine } from './radioMachine';
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
export type { RadioState, FeedbackSound, RadioDeps, VizMode } from './radioMachine';
export {
  isLoadingLike,
  isErrorLike,
  isFeedbackAudible,
  playbackStateFor,
  vizModeFor,
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

  // 'paused' is a compound state (its resume attempt lives in a substate);
  // the public RadioState stays the flat top-level name.
  const stateOf = (value: unknown): RadioState =>
    (typeof value === 'string' ? value : Object.keys(value as Record<string, unknown>)[0]) as RadioState;

  // Same transition log the old state machine printed.
  let prev: RadioState | null = null;
  actor.subscribe((snapshot) => {
    const next = stateOf(snapshot.value);
    if (prev !== next) console.log(`[radio] ${prev ?? '∅'} → ${next}`);
    prev = next;
  });
  actor.start();

  const getState = (): RadioState => stateOf(actor.getSnapshot().value);

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
    actor.send({ type: 'PAUSE_REQUESTED' });
  }

  function resumeRadio() {
    actor.send({ type: 'RESUME' });
  }

  function togglePlayPause() {
    actor.send({ type: 'TOGGLE' });
  }

  // Native player events → machine events
  const onPlayerPlay = () => actor.send({ type: 'PLAYER_PLAY' });
  const onPlayerPause = () => actor.send({ type: 'PLAYER_PAUSE' });
  const onPlayerError = () => actor.send({ type: 'PLAYER_ERROR' });
  const retryFromError = () => actor.send({ type: 'RETRY_FROM_ERROR' });

  // The on-screen play button and the lock-screen play control are the same
  // gesture — the machine decides per state what it means.
  const onPlayButtonClick = resumeRadio;

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
