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

import { setup, fromPromise, fromCallback, assign, raise, and } from 'xstate';

// --- Shared domain types & timing constants (owned here; radioCore
// re-exports them so the rest of the app keeps importing from one place) ---

export type RadioState =
  | 'idle'
  | 'loading'
  | 'playing'
  | 'paused'
  | 'retrying'
  | 'error'
  | 'recovering';

export type PlaybackButton = 'play' | 'pause' | 'stop';

/** A feedback sound (loading/error noise) the machine can drive. */
export interface FeedbackSound {
  play(): void;
  stop(): void;
  /** Re-assert playback: restart if a play() was rejected or the OS paused it. */
  ensure(): void;
}

type TimerId = number;

/**
 * Everything the machine needs from the outside world. The DOM glue layer
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
type SoundFx = 'play' | 'stop' | 'keep';

/** Our own pause/src change interrupting a pending play() rejects with this. */
export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null | undefined)?.name === 'AbortError';
}

interface StateFx {
  button: PlaybackButton;
  loading: SoundFx;
  error: SoundFx;
  loadingMsg: boolean;
  errorMsg: boolean;
}

// --- State classification: the single source of truth for the DOM layer ---
// Derived from what STATE_FX presents; DOM modules must not hand-maintain
// their own state lists (they drifted before — see plan.md, faza R2).

/** States presenting as "loading": loading tone + loading message. */
export const isLoadingLike = (s: RadioState): boolean =>
  s === 'loading' || s === 'retrying';

/** States presenting as "error": error tone and/or error visuals. */
export const isErrorLike = (s: RadioState): boolean =>
  s === 'error' || s === 'recovering';

/** States where a feedback sound, not the stream, is what's audible. */
export const isFeedbackAudible = (s: RadioState): boolean =>
  isLoadingLike(s) || isErrorLike(s);

/** What the OS lock screen / Now Playing should report for a state —
 *  'playing' whenever ANYTHING is audible (stream or feedback sound). */
export const playbackStateFor = (s: RadioState): 'playing' | 'paused' | 'none' =>
  s === 'playing' || isFeedbackAudible(s) ? 'playing' : s === 'paused' ? 'paused' : 'none';

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
}

export type RadioEvent =
  | { type: 'PLAY'; index: number }
  | { type: 'STOP' }
  /** User asked to pause (on-screen button, lock screen). The machine decides
   *  per state whether that means pause or a full stop. */
  | { type: 'PAUSE_REQUESTED' }
  /** User asked to (re)start playback (play button, lock-screen play,
   *  media-key resume) — the machine decides per state what that means. */
  | { type: 'RESUME' }
  | { type: 'TOGGLE' }
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

  // The one failure policy: retry while attempts remain, otherwise begin a
  // new error cycle. `extra` actions run on both branches.
  const streamFailure = (...extra: Array<'stopPlayer' | 'clearPauseTime'>) => [
    { guard: 'canRetry' as const, target: 'retrying' as const, actions: [...extra, 'incrementRetryCount' as const] },
    { target: 'error' as const, actions: [...extra, 'beginErrorCycle' as const] },
  ];

  // Live streams drift — resuming after a long pause would replay stale
  // buffer, so restart the station instead, honoring the same offline
  // fast-fail as PLAY (no point trying on a dead network).
  const restartAfterLongPause = [
    {
      guard: and(['pausedTooLong', 'isOnline']),
      target: 'loading' as const,
      actions: ['clearPauseTime' as const, 'stopPlayer' as const, 'resetRetryCount' as const, 'resetRecoveryCount' as const],
    },
    {
      guard: 'pausedTooLong' as const,
      target: 'error' as const,
      actions: ['clearPauseTime' as const, 'stopPlayer' as const, 'resetRetryCount' as const, 'resetRecoveryCount' as const, 'beginErrorCycle' as const],
    },
  ];

  // In the states where a user gesture means "(re)start the radio", RESUME
  // and TOGGLE behave identically.
  const startFromSelector = {
    RESUME: { actions: 'raisePlaySelected' as const },
    TOGGLE: { actions: 'raisePlaySelected' as const },
  };

  // In the feedback states, any pause-ish gesture cancels everything —
  // same as the on-screen stop button.
  const pauseMeansStop = {
    TOGGLE: { actions: 'raiseStop' as const },
    PAUSE_REQUESTED: { actions: 'raiseStop' as const },
  };

  return setup({
    types: {
      context: {} as RadioContext,
      events: {} as RadioEvent,
    },

    guards: {
      isOnline: () => deps.isOnline(),
      canRetry: ({ context }) => context.retryCount < MAX_RETRIES,
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
      isAbortError: ({ event }) => isAbortError((event as { error?: unknown }).error),
    },

    delays: {
      LOADING_TIMEOUT: LOADING_TIMEOUT_MS,
      RETRY_DELAY: RETRY_DELAY_MS,
      // Exponential backoff (10s → 20s → … capped), forever — a radio should
      // never give up.
      RECOVERY_DELAY: ({ context }) =>
        Math.min(
          RECOVERY_DELAY_MS * 2 ** Math.min(context.recoveryCount - 1, 6),
          RECOVERY_DELAY_MAX_MS,
        ),
      // While clearly offline, re-check on a fixed cadence without
      // escalating (nothing was attempted).
      OFFLINE_RECHECK: RECOVERY_DELAY_MS,
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
      resetAttemptCounters: assign({ retryCount: 0, recoveryCount: 0 }),
      incrementRetryCount: assign(({ context }) => ({ retryCount: context.retryCount + 1 })),
      resetRetryCount: assign({ retryCount: 0 }),
      resetRecoveryCount: assign({ recoveryCount: 0 }),
      // Runs on the TRANSITION into error (not on entry) so the RECOVERY_DELAY
      // expression is guaranteed to see the incremented count.
      beginErrorCycle: assign(({ context }) => ({
        recoveryCount: context.recoveryCount + 1,
      })),
      markUserPauseIntent: assign(() => ({ userPauseIntentAt: deps.performanceNow() })),
      consumeUserPauseIntent: assign({ userPauseIntentAt: null }),
      markPauseTime: assign(() => ({ lastPauseTime: deps.performanceNow() })),
      clearPauseTime: assign({ lastPauseTime: null }),

      stopPlayer: () => stopPlayer(),
      pausePlayer: () => deps.playerPause(),
      raiseStop: raise({ type: 'STOP' } as const),
      // Every "start playing" affordance (play button, lock screen, media
      // key) starts from whatever station the selector currently shows.
      raisePlaySelected: raise(() => ({ type: 'PLAY' as const, index: deps.getSelectedIndex() })),
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
    },
    initial: 'idle',

    on: {
      // Handled identically in every state (child states may override).
      // consumeUserPauseIntent: PLAY/STOP abandon any pending pause, so a
      // stale intent must not explain away the next unexpected offline pause.
      PLAY: [
        {
          guard: 'isOnline',
          target: '.loading',
          actions: ['setStation', 'syncSelectedIndex', 'resetAttemptCounters', 'clearPauseTime', 'consumeUserPauseIntent'],
        },
        {
          // No point trying if offline — go straight to error and recover later
          target: '.error',
          actions: ['setStation', 'syncSelectedIndex', 'resetAttemptCounters', 'clearPauseTime', 'consumeUserPauseIntent', 'stopPlayer', 'beginErrorCycle'],
        },
      ],
      STOP: {
        target: '.idle',
        actions: ['resetRetryCount', 'resetRecoveryCount', 'clearPauseTime', 'consumeUserPauseIntent', 'stopPlayer'],
      },
      // A user-intent pause: mark it so the native 'pause' event it triggers
      // isn't mistaken for a dying stream. The feedback states override this
      // (and TOGGLE) with a full stop.
      PAUSE_REQUESTED: { actions: ['markUserPauseIntent', 'pausePlayer'] },
      PLAYER_PLAY: { actions: 'clearPauseTime' },
    },

    states: {
      idle: {
        entry: [{ type: 'applyFx', params: { state: 'idle' } }],
        on: { ...startFromSelector },
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
              ...streamFailure(),
            ],
          },
          { src: 'soundSupervisor', input: { sound: 'loading' } as const },
        ],
        after: {
          LOADING_TIMEOUT: streamFailure('stopPlayer'),
        },
        on: { ...pauseMeansStop },
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
        on: { ...pauseMeansStop },
      },

      playing: {
        entry: [{ type: 'applyFx', params: { state: 'playing' } }],
        invoke: { src: 'watchdog' },
        on: {
          TOGGLE: { actions: ['markUserPauseIntent', 'pausePlayer'] },
          // stopPlayer: the stalled/errored stream stays attached otherwise,
          // and a refilled buffer would resume audibly UNDER the loading tone
          // during RETRY_DELAY — the machine never allows overlapping sounds.
          STALLED: streamFailure('stopPlayer', 'clearPauseTime'),
          PLAYER_PAUSE: [
            {
              guard: 'unexpectedOfflinePause',
              target: 'retrying',
              // stopPlayer: detach the dead stream like STALLED/PLAYER_ERROR
              // do — otherwise the old src stays attached through RETRY_DELAY
              // and a refilled buffer could sound under the loading tone.
              actions: ['consumeUserPauseIntent', 'clearPauseTime', 'stopPlayer', 'incrementRetryCount'],
              // retryCount is always 0 while playing (reset on success), so
              // the retry branch is the only reachable one — kept simple.
            },
            // User pause, or an online interruption (headphones unplugged,
            // phone call, another app taking audio) — stay paused.
            { target: 'paused', actions: ['consumeUserPauseIntent', 'markPauseTime'] },
          ],
          PLAYER_ERROR: streamFailure('stopPlayer', 'clearPauseTime'),
        },
      },

      paused: {
        entry: [{ type: 'applyFx', params: { state: 'paused' } }],
        initial: 'still',
        states: {
          still: {},
          // The in-machine resume attempt (replaces the adapter's old
          // resumePlayer + RESUME_FAILED). Presentation stays 'paused' — the
          // substate exists so a failed play() re-applies the paused fx, and
          // leaving it discards a stale resolve/reject like every attemptPlay.
          resuming: {
            invoke: {
              src: 'attemptPlay',
              onDone: { target: '#radio.playing', actions: 'clearPauseTime' },
              onError: [
                // Our own pause/src change interrupted play() — stay paused.
                { guard: 'isAbortError', target: 'still' },
                // Failed resume: pause defensively and re-enter paused to
                // re-apply the fx (the old RESUME_FAILED re-application).
                { target: '#radio.paused', actions: 'pausePlayer' },
              ],
            },
          },
        },
        on: {
          PLAYER_PLAY: [
            ...restartAfterLongPause,
            { target: 'playing', actions: 'clearPauseTime' },
          ],
          RESUME: [...restartAfterLongPause, { target: '.resuming' }],
          TOGGLE: [...restartAfterLongPause, { target: '.resuming' }],
          // PLAYER_ERROR is deliberately NOT handled here: a deliberate pause
          // stays silent even if the still-attached stream errors later. A
          // resume on the broken src fails back into paused; a long-pause
          // resume restarts the station from scratch anyway.
        },
      },

      error: {
        // Entry fx and the sound supervisor run ONCE per error cycle — the
        // wait-for-recovery loop lives in substates so an offline night does
        // not rebuild MediaMetadata / re-register handlers / re-create the
        // supervisor every 10 seconds (it used to, via reenter).
        entry: [{ type: 'applyFx', params: { state: 'error' } }],
        invoke: { src: 'soundSupervisor', input: { sound: 'error' } as const },
        initial: 'backoff',
        states: {
          // One escalating backoff wait after a failed attempt.
          backoff: {
            after: {
              RECOVERY_DELAY: [
                { guard: 'isOnline', target: '#radio.recovering' },
                { target: 'offlineRecheck' },
              ],
            },
            on: {
              RETRY_FROM_ERROR: [
                { guard: 'isOnline', target: '#radio.recovering' },
                { target: 'offlineRecheck' },
              ],
            },
          },
          // Clearly offline: re-check on a fixed cadence. The reenter only
          // re-arms this child's timer — the parent (fx, supervisor) stays.
          offlineRecheck: {
            after: {
              OFFLINE_RECHECK: [
                { guard: 'isOnline', target: '#radio.recovering' },
                { target: 'offlineRecheck', reenter: true },
              ],
            },
            on: {
              RETRY_FROM_ERROR: [
                { guard: 'isOnline', target: '#radio.recovering' },
                { target: 'offlineRecheck', reenter: true },
              ],
            },
          },
        },
        on: {
          ...startFromSelector,
          PAUSE_REQUESTED: { actions: 'raiseStop' },
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
          ...startFromSelector,
          PAUSE_REQUESTED: { actions: 'raiseStop' },
        },
      },
    },
  });
}
