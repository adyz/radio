import { createActor } from 'xstate';
import type { AudioInstance, PlayerElements, PlayerStatus } from '../types';
import { STATIONS } from '../data/stations';
import { createAudioInstance } from './audio';
import { updateMediaSession } from './media-session';
import { playerMachine } from './player-machine';

const PAUSE_RESTART_THRESHOLD_MS = 2000;

let lastPauseTime: number | null = null;
let loadingNoiseInstance: AudioInstance;
let errorNoiseInstance: AudioInstance;
let elements: PlayerElements;

function snapshotToStatus(snap: ReturnType<typeof actor.getSnapshot>): PlayerStatus {
  const idx = snap.context.stationIndex;
  switch (snap.value) {
    case 'loading':
      return { state: 'loading', stationIndex: idx };
    case 'playing':
      return { state: 'playing', stationIndex: idx };
    case 'error':
      return { state: 'error', stationIndex: idx };
    default:
      return { state: 'idle' };
  }
}

export function getStatus(): PlayerStatus {
  return snapshotToStatus(actor.getSnapshot());
}

export function getSelectedIndex(): number {
  return actor.getSnapshot().context.stationIndex;
}

function refreshMediaSession(status: PlayerStatus): void {
  const posterImg = elements.posterImage.querySelector('img') as HTMLImageElement;
  updateMediaSession(status, {
    onPrevious: prevRadio,
    onNext: nextRadio,
    onPause: () => elements.player.pause(),
    onPlay: () => elements.player.play(),
  }, posterImg);

  if (status.state === 'loading') {
    const name = STATIONS[status.stationIndex]?.name ?? '';
    elements.loadingMsg.innerText = `Se incarca ${name}...`;
  } else {
    elements.loadingMsg.innerText = '';
  }
}

// XState actor with real side-effect implementations
export const actor = createActor(
  playerMachine.provide({
    actions: {
      playLoadingNoise: () => loadingNoiseInstance.play(),
      stopLoadingNoise: () => loadingNoiseInstance.stop(),
      playErrorNoise: () => errorNoiseInstance.play(),
      stopErrorNoise: () => errorNoiseInstance.stop(),
      disableButtons: () => {
        [elements.playButton, elements.pauseButton].forEach((btn) =>
          btn.classList.add('opacity-50', 'cursor-not-allowed'),
        );
      },
      enableButtons: () => {
        [elements.playButton, elements.pauseButton].forEach((btn) =>
          btn.classList.remove('opacity-50', 'cursor-not-allowed'),
        );
      },
      showLoadingMsg: () => elements.loadingMsg.classList.remove('invisible'),
      hideLoadingMsg: () => elements.loadingMsg.classList.add('invisible'),
      showErrorMsg: () => elements.errorMsg.classList.remove('invisible'),
      hideErrorMsg: () => elements.errorMsg.classList.add('invisible'),
      loadStream: ({ context }) => {
        const station = STATIONS[context.stationIndex];
        if (!station) return;

        elements.player.pause();
        elements.player.src = station.streamUrl;
        elements.player.load();

        elements.player.play().then(() => {
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

export function initPlayer(els: PlayerElements): void {
  elements = els;
  loadingNoiseInstance = createAudioInstance(els.loadingNoise);
  errorNoiseInstance = createAudioInstance(els.errorNoise);

  els.player.addEventListener('play', handlePlayerPlay);
  els.player.addEventListener('pause', handlePlayerPause);

  // Subscribe to state changes - snapshot is settled here, safe to read
  actor.subscribe((snap) => {
    refreshMediaSession(snapshotToStatus(snap));
  });

  actor.start();
}

export function playRadio(index: number): void {
  actor.send({ type: 'PLAY', index });
}

export function prevRadio(): void {
  actor.send({ type: 'PREV' });
}

export function nextRadio(): void {
  actor.send({ type: 'NEXT' });
}

function handlePlayerPlay(): void {
  elements.playButton.classList.add('hidden');
  elements.pauseButton.classList.remove('hidden');

  const now = performance.now();
  if (lastPauseTime !== null) {
    const timeDiff = now - lastPauseTime;
    if (timeDiff > PAUSE_RESTART_THRESHOLD_MS) {
      elements.player.pause();
      elements.player.src = '';
      playRadio(getSelectedIndex());
    }
  }
  lastPauseTime = null;
}

function handlePlayerPause(): void {
  elements.playButton.classList.remove('hidden');
  elements.pauseButton.classList.add('hidden');
  lastPauseTime = performance.now();
}
