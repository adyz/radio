import { setup, assign } from 'xstate';
import { STATIONS } from '../data/stations';

export type PlayerEvent =
  | { type: 'PLAY'; index: number }
  | { type: 'NEXT' }
  | { type: 'PREV' }
  | { type: 'STREAM_READY' }
  | { type: 'STREAM_ERROR' };

export interface PlayerContext {
  stationIndex: number;
}

export const playerMachine = setup({
  types: {
    context: {} as PlayerContext,
    events: {} as PlayerEvent,
  },
  actions: {
    playLoadingNoise: () => {},
    stopLoadingNoise: () => {},
    playErrorNoise: () => {},
    stopErrorNoise: () => {},
    disableButtons: () => {},
    enableButtons: () => {},
    showLoadingMsg: () => {},
    hideLoadingMsg: () => {},
    showErrorMsg: () => {},
    hideErrorMsg: () => {},
    loadStream: () => {},
  },
  guards: {
    isValidIndex: ({ event }) => {
      if (event.type !== 'PLAY') return false;
      return event.index >= 0 && event.index < STATIONS.length;
    },
  },
}).createMachine({
  id: 'player',
  initial: 'idle',
  context: { stationIndex: 0 },
  states: {
    idle: {
      on: {
        PLAY: {
          target: 'loading',
          guard: 'isValidIndex',
          actions: assign({ stationIndex: ({ event }) => event.index }),
        },
        NEXT: {
          target: 'loading',
          actions: assign({
            stationIndex: ({ context }) =>
              context.stationIndex === STATIONS.length - 1 ? 0 : context.stationIndex + 1,
          }),
        },
        PREV: {
          target: 'loading',
          actions: assign({
            stationIndex: ({ context }) =>
              context.stationIndex === 0 ? STATIONS.length - 1 : context.stationIndex - 1,
          }),
        },
      },
    },

    loading: {
      entry: [
        'stopErrorNoise',
        'playLoadingNoise',
        'disableButtons',
        'showLoadingMsg',
        'hideErrorMsg',
        'loadStream',
      ],
      on: {
        STREAM_READY: 'playing',
        STREAM_ERROR: 'error',
        PLAY: {
          target: 'loading',
          guard: 'isValidIndex',
          actions: assign({ stationIndex: ({ event }) => event.index }),
          reenter: true,
        },
        NEXT: {
          target: 'loading',
          actions: assign({
            stationIndex: ({ context }) =>
              context.stationIndex === STATIONS.length - 1 ? 0 : context.stationIndex + 1,
          }),
          reenter: true,
        },
        PREV: {
          target: 'loading',
          actions: assign({
            stationIndex: ({ context }) =>
              context.stationIndex === 0 ? STATIONS.length - 1 : context.stationIndex - 1,
          }),
          reenter: true,
        },
      },
    },

    playing: {
      entry: [
        'stopLoadingNoise',
        'enableButtons',
        'hideLoadingMsg',
        'hideErrorMsg',
      ],
      on: {
        PLAY: {
          target: 'loading',
          guard: 'isValidIndex',
          actions: assign({ stationIndex: ({ event }) => event.index }),
        },
        NEXT: {
          target: 'loading',
          actions: assign({
            stationIndex: ({ context }) =>
              context.stationIndex === STATIONS.length - 1 ? 0 : context.stationIndex + 1,
          }),
        },
        PREV: {
          target: 'loading',
          actions: assign({
            stationIndex: ({ context }) =>
              context.stationIndex === 0 ? STATIONS.length - 1 : context.stationIndex - 1,
          }),
        },
      },
    },

    error: {
      entry: [
        'stopLoadingNoise',
        'playErrorNoise',
        'enableButtons',
        'hideLoadingMsg',
        'showErrorMsg',
      ],
      on: {
        PLAY: {
          target: 'loading',
          guard: 'isValidIndex',
          actions: assign({ stationIndex: ({ event }) => event.index }),
        },
        NEXT: {
          target: 'loading',
          actions: assign({
            stationIndex: ({ context }) =>
              context.stationIndex === STATIONS.length - 1 ? 0 : context.stationIndex + 1,
          }),
        },
        PREV: {
          target: 'loading',
          actions: assign({
            stationIndex: ({ context }) =>
              context.stationIndex === 0 ? STATIONS.length - 1 : context.stationIndex - 1,
          }),
        },
      },
    },
  },
});
