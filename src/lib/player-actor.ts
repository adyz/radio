import { createActor } from 'xstate';
import type { AudioInstance } from '../types';
import { STATIONS } from '../data/stations';
import { playerMachine } from './player-machine';

function createAudioInstance(src: string): AudioInstance {
  const audio = new Audio(src);
  audio.loop = true;
  audio.preload = 'auto';
  let isPlaying = false;

  return {
    src,
    play() {
      if (!isPlaying) {
        audio.currentTime = 0;
        isPlaying = true;
        audio.play().catch((error: DOMException) => {
          if (error.name !== 'AbortError') {
            console.error('Error playing audio:', error);
          }
          isPlaying = false;
        });
      }
    },
    stop() {
      if (isPlaying) {
        audio.pause();
        audio.currentTime = 0;
        isPlaying = false;
      }
    },
  };
}

const loadingNoise = createAudioInstance('/sounds/loading-low.mp3');
const errorNoise = createAudioInstance('/sounds/error-low.mp3');

let playerAudio: HTMLAudioElement | null = null;

export function setPlayerAudio(el: HTMLAudioElement): void {
  playerAudio = el;
}

export const actor = createActor(
  playerMachine.provide({
    actions: {
      playLoadingNoise: () => loadingNoise.play(),
      stopLoadingNoise: () => loadingNoise.stop(),
      playErrorNoise: () => errorNoise.play(),
      stopErrorNoise: () => errorNoise.stop(),
      loadStream: ({ context }) => {
        if (!playerAudio) return;
        const station = STATIONS[context.stationIndex];
        if (!station) return;

        playerAudio.pause();
        playerAudio.src = station.streamUrl;
        playerAudio.load();

        playerAudio.play().then(() => {
          actor.send({ type: 'STREAM_READY' });
        }).catch((error: DOMException) => {
          if (error.name === 'AbortError') return;
          console.error('Error playing radio:', error);
          actor.send({ type: 'STREAM_ERROR' });
        });
      },
    },
  }),
);

actor.start();

export function playRadio(index: number): void {
  actor.send({ type: 'PLAY', index });
}

export function prevRadio(): void {
  actor.send({ type: 'PREV' });
}

export function nextRadio(): void {
  actor.send({ type: 'NEXT' });
}
