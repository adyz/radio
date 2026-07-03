/**
 * Radio Player — the XState v5 state machine.
 *
 * Everything that used to be manual orchestration in radioCore (timers,
 * playId invalidation, retry/recovery bookkeeping) is expressed declaratively:
 *
 * - timers are `after` delays — leaving a state cancels them;
 * - playerPlay() is an invoked promise actor — leaving the state discards
 *   a late resolve/reject (this replaces the old playId mechanism entirely);
 * - the playback watchdog and the sound supervisor are invoked callback
 *   actors — they live exactly as long as the states that need them;
 * - side effects stay a declarative table (STATE_FX), applied as a typed
 *   entry action on every state (re-entries re-apply it, like the old
 *   setState did).
 *
 * The machine is created per-instance via a factory that closes over the
 * injected deps, so it stays testable without a browser.
 */

import { setup, fromPromise, fromCallback, assign } from 'xstate';
import type { RadioDeps, RadioState } from './radioCore';
import {
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
} from './radioCore';

type PlaybackButton = 'play' | 'pause' | 'stop';
type SoundFx = 'play' | 'stop' | 'keep';

interface StateFx {
  button: PlaybackButton;
  loading: SoundFx;
  error: SoundFx;
  loadingMsg: boolean;
  errorMsg: boolean;
}

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

export interface RadioContext {
  stationIndex: number;
  retryCount: number;
  recoveryCount: number;
  lastPauseTime: number | null;
  userPauseIntentAt: number | null;
  /** True while the recovery loop is just re-checking a known-offline network
   *  (fixed cadence, no backoff escalation, no recoveryCount increment). */
  offlineRecheck: boolean;
}

export type RadioEvent =
  | { type: 'PLAY'; index: number; isRetry?: boolean }
  | { type: 'STOP' }
  | { type: 'USER_PAUSE_INTENT' }
  | { type: 'RESUME_FAILED' }
  | { type: 'PLAYER_PLAY' }
  | { type: 'PLAYER_PAUSE' }
  | { type: 'PLAYER_ERROR' }
  | { type: 'STALLED' }
  | { type: 'RETRY_FROM_ERROR' };

export function createRadioMachine(deps: RadioDeps) {
  const stopPlayer = () => {
    deps.playerPause();
    deps.playerSetSrc('');
  };

  return setup({
    types: {
      context: {} as RadioContext,
      events: {} as RadioEvent,
    },

    guards: {
      isOnline: () => deps.isOnline(),
      canRetry: ({ context }) => context.retryCount < MAX_RETRIES,
      recentUserPauseIntent: ({ context }) =>
        context.userPauseIntentAt !== null &&
        deps.performanceNow() - context.userPauseIntentAt <= USER_PAUSE_INTENT_MS,
      // A 'pause' nobody asked for while the network is down is the OS killing
      // a dead stream, not the user.
      unexpectedOfflinePause: ({ context }) => {
        const userAskedForIt =
          context.userPauseIntentAt !== null &&
          deps.performanceNow() - context.userPauseIntentAt <= USER_PAUSE_INTENT_MS;
        return !userAskedForIt && !deps.isOnline();
      },
      pausedTooLong: ({ context }) =>
        context.lastPauseTime !== null &&
        deps.performanceNow() - context.lastPauseTime > LONG_PAUSE_RESTART_MS,
      isAbortError: ({ event }) => {
        const error = (event as { error?: unknown }).error;
        return (error as { name?: string } | null | undefined)?.name === 'AbortError';
      },
    },

    delays: {
      LOADING_TIMEOUT: LOADING_TIMEOUT_MS,
      RETRY_DELAY: RETRY_DELAY_MS,
      // Exponential backoff (10s → 20s → … capped), forever — a radio should
      // never give up. While clearly offline, re-check on a fixed cadence
      // without escalating (nothing was attempted).
      RECOVERY_DELAY: ({ context }) =>
        context.offlineRecheck
          ? RECOVERY_DELAY_MS
          : Math.min(
              RECOVERY_DELAY_MS * 2 ** Math.min(context.recoveryCount - 1, 6),
              RECOVERY_DELAY_MAX_MS,
            ),
    },

    actors: {
      attemptPlay: fromPromise(() => deps.playerPlay()),

      // Stream failures often fire no 'error'/'stalled' event — the audio just
      // goes silent while currentTime stops advancing. While playing, playback
      // progress itself is the only reliable signal.
      watchdog: fromCallback(({ sendBack }) => {
        let lastTime: number | null = null;
        let stallTicks = 0;
        const id = deps.setInterval(() => {
          const t = deps.playerCurrentTime();
          if (lastTime === null || t !== lastTime) {
            lastTime = t;
            stallTicks = 0;
            return;
          }
          stallTicks++;
          if (stallTicks >= WATCHDOG_STALL_TICKS) sendBack({ type: 'STALLED' });
        }, WATCHDOG_INTERVAL_MS);
        return () => deps.clearInterval(id);
      }),

      // "As long as the user pressed play, something must always be audible."
      // Feedback sounds can silently fail to start (autoplay/background
      // restrictions) or get paused by the OS — re-assert them every tick.
      soundSupervisor: fromCallback<{ type: string }, { sound: 'loading' | 'error' }>(({ input }) => {
        const sound = input.sound === 'loading' ? deps.loadingSound : deps.errorSound;
        const id = deps.setInterval(() => sound.ensure(), SOUND_SUPERVISOR_INTERVAL_MS);
        return () => deps.clearInterval(id);
      }),
    },

    actions: {
      // The declarative side-effects table, applied on every state entry
      // (re-entries re-apply it). New sounds start BEFORE old ones stop.
      applyFx: (_, params: { state: RadioState }) => {
        const fx = STATE_FX[params.state];
        deps.showButton(fx.button);
        if (fx.loading === 'play') deps.loadingSound.play();
        if (fx.error === 'play') deps.errorSound.play();
        if (fx.loading === 'stop') deps.loadingSound.stop();
        if (fx.error === 'stop') deps.errorSound.stop();
        deps.setLoadingMsg(fx.loadingMsg);
        deps.setErrorMsg(fx.errorMsg);
        deps.updateMediaSession(params.state);
      },

      setStation: assign(({ event }) => ({
        stationIndex: (event as { index: number }).index,
      })),
      syncSelectedIndex: ({ context }) => deps.setSelectedIndex(context.stationIndex),
      resetAttemptCounters: assign(({ event }) =>
        (event as { isRetry?: boolean }).isRetry ? {} : { retryCount: 0, recoveryCount: 0 }),
      incrementRetryCount: assign(({ context }) => ({ retryCount: context.retryCount + 1 })),
      resetRetryCount: assign({ retryCount: 0 }),
      resetRecoveryCount: assign({ recoveryCount: 0 }),
      // Runs on the TRANSITION into error (not on entry) so the RECOVERY_DELAY
      // expression is guaranteed to see the incremented count.
      beginErrorCycle: assign(({ context }) => ({
        offlineRecheck: false,
        recoveryCount: context.recoveryCount + 1,
      })),
      markOfflineRecheck: assign({ offlineRecheck: true }),
      clearOfflineRecheck: assign({ offlineRecheck: false }),
      markUserPauseIntent: assign(() => ({ userPauseIntentAt: deps.performanceNow() })),
      consumeUserPauseIntent: assign({ userPauseIntentAt: null }),
      markPauseTime: assign(() => ({ lastPauseTime: deps.performanceNow() })),
      clearPauseTime: assign({ lastPauseTime: null }),

      stopPlayer: () => stopPlayer(),
      // Order matters: this runs as an ENTRY action after applyFx, so the
      // native 'pause' event it triggers arrives while the state is already
      // loading/recovering and gets ignored (main.ts skips playbackState
      // juggling outside 'playing').
      preparePlayer: ({ context }) => {
        deps.playerPause();
        deps.playerSetSrc(deps.getStationUrl(context.stationIndex));
        deps.playerLoad();
      },
      saveStation: ({ context }) => deps.saveLastIndex(context.stationIndex),
    },
  }).createMachine({
    id: 'radio',
    context: {
      stationIndex: 0,
      retryCount: 0,
      recoveryCount: 0,
      lastPauseTime: null,
      userPauseIntentAt: null,
      offlineRecheck: false,
    },
    initial: 'idle',

    on: {
      // Handled identically in every state (child states may override).
      PLAY: [
        {
          guard: 'isOnline',
          target: '.loading',
          actions: ['setStation', 'syncSelectedIndex', 'resetAttemptCounters', 'clearPauseTime'],
        },
        {
          // No point trying if offline — go straight to error and recover later
          target: '.error',
          actions: ['setStation', 'syncSelectedIndex', 'resetAttemptCounters', 'clearPauseTime', 'stopPlayer', 'beginErrorCycle'],
        },
      ],
      STOP: {
        target: '.idle',
        actions: ['resetRetryCount', 'resetRecoveryCount', 'clearPauseTime', 'stopPlayer'],
      },
      USER_PAUSE_INTENT: { actions: 'markUserPauseIntent' },
      PLAYER_PLAY: { actions: 'clearPauseTime' },
    },

    states: {
      idle: {
        entry: [{ type: 'applyFx', params: { state: 'idle' } }],
      },

      loading: {
        entry: [{ type: 'applyFx', params: { state: 'loading' } }, 'preparePlayer'],
        invoke: [
          {
            src: 'attemptPlay',
            onDone: {
              target: 'playing',
              actions: ['resetRetryCount', 'saveStation'],
            },
            onError: [
              // An AbortError just means our own pause/src change interrupted
              // play() — stay and let the loading timeout decide.
              { guard: 'isAbortError' },
              { guard: 'canRetry', target: 'retrying', actions: 'incrementRetryCount' },
              { target: 'error', actions: 'beginErrorCycle' },
            ],
          },
          { src: 'soundSupervisor', input: { sound: 'loading' } as const },
        ],
        after: {
          LOADING_TIMEOUT: [
            { guard: 'canRetry', target: 'retrying', actions: ['stopPlayer', 'incrementRetryCount'] },
            { target: 'error', actions: ['stopPlayer', 'beginErrorCycle'] },
          ],
        },
      },

      retrying: {
        entry: [{ type: 'applyFx', params: { state: 'retrying' } }],
        invoke: { src: 'soundSupervisor', input: { sound: 'loading' } as const },
        after: {
          RETRY_DELAY: [
            { guard: 'isOnline', target: 'loading' },
            { target: 'error', actions: ['stopPlayer', 'beginErrorCycle'] },
          ],
        },
      },

      playing: {
        entry: [{ type: 'applyFx', params: { state: 'playing' } }],
        invoke: { src: 'watchdog' },
        on: {
          STALLED: [
            { guard: 'canRetry', target: 'retrying', actions: ['incrementRetryCount', 'clearPauseTime'] },
            { target: 'error', actions: ['beginErrorCycle', 'clearPauseTime'] },
          ],
          PLAYER_PAUSE: [
            {
              guard: 'unexpectedOfflinePause',
              target: 'retrying',
              actions: ['consumeUserPauseIntent', 'clearPauseTime', 'incrementRetryCount'],
              // retryCount is always 0 while playing (reset on success), so
              // the retry branch is the only reachable one — kept simple.
            },
            // User pause, or an online interruption (headphones unplugged,
            // phone call, another app taking audio) — stay paused.
            { target: 'paused', actions: ['consumeUserPauseIntent', 'markPauseTime'] },
          ],
          PLAYER_ERROR: [
            { guard: 'canRetry', target: 'retrying', actions: ['incrementRetryCount', 'clearPauseTime'] },
            { target: 'error', actions: ['beginErrorCycle', 'clearPauseTime'] },
          ],
        },
      },

      paused: {
        entry: [{ type: 'applyFx', params: { state: 'paused' } }],
        on: {
          PLAYER_PLAY: [
            {
              // Live streams drift — resuming after a long pause replays stale
              // buffer, so restart the station from scratch instead.
              guard: 'pausedTooLong',
              target: 'loading',
              actions: ['clearPauseTime', 'stopPlayer', 'resetRetryCount', 'resetRecoveryCount'],
            },
            { target: 'playing', actions: 'clearPauseTime' },
          ],
          PLAYER_ERROR: [
            { guard: 'canRetry', target: 'retrying', actions: ['incrementRetryCount', 'clearPauseTime'] },
            { target: 'error', actions: ['beginErrorCycle', 'clearPauseTime'] },
          ],
          // A failed resume keeps us paused; re-enter to re-apply the fx
          // (same as the old setState('paused') re-application).
          RESUME_FAILED: { target: 'paused', reenter: true },
        },
      },

      error: {
        entry: [{ type: 'applyFx', params: { state: 'error' } }],
        invoke: { src: 'soundSupervisor', input: { sound: 'error' } as const },
        after: {
          RECOVERY_DELAY: [
            { guard: 'isOnline', target: 'recovering', actions: 'clearOfflineRecheck' },
            // Still offline: re-check on a fixed cadence without escalating.
            { target: 'error', reenter: true, actions: 'markOfflineRecheck' },
          ],
        },
        on: {
          RETRY_FROM_ERROR: [
            { guard: 'isOnline', target: 'recovering', actions: 'clearOfflineRecheck' },
            { target: 'error', reenter: true, actions: 'markOfflineRecheck' },
          ],
        },
      },

      recovering: {
        // Silent recovery: no loading sound, the error tone keeps playing —
        // if it works, go straight to playing.
        entry: [{ type: 'applyFx', params: { state: 'recovering' } }, 'preparePlayer'],
        invoke: [
          {
            src: 'attemptPlay',
            onDone: {
              target: 'playing',
              actions: ['resetRetryCount', 'resetRecoveryCount', 'saveStation'],
            },
            onError: [
              { guard: 'isAbortError' },
              { target: 'error', actions: 'beginErrorCycle' },
            ],
          },
          { src: 'soundSupervisor', input: { sound: 'error' } as const },
        ],
        after: {
          LOADING_TIMEOUT: { target: 'error', actions: ['stopPlayer', 'beginErrorCycle'] },
        },
        on: {
          RETRY_FROM_ERROR: { guard: 'isOnline', target: 'recovering', reenter: true },
        },
      },
    },
  });
}
