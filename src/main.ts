import './css/app.css';

import { getElement } from './lib/dom';
import { cloudinaryImageUrl } from './lib/cloudinary';
import { initPlayer, playRadio, prevRadio, nextRadio, getStatus } from './lib/player';
import { initTheme } from './lib/theme';
import { initSelector } from './lib/selector';
import { initElectronBridge } from './lib/electron';
import type { PlayerElements } from './types';

// Enable touch event handling (iOS Safari fix)
document.addEventListener('touchstart', () => {}, true);

// Gather all required DOM elements
const elements: PlayerElements = {
  player: getElement<HTMLAudioElement>('player'),
  loadingNoise: getElement<HTMLAudioElement>('loadingNoise'),
  errorNoise: getElement<HTMLAudioElement>('errorNoise'),
  loadingMsg: getElement('loadingMsg'),
  errorMsg: getElement('errorMsg'),
  playButton: getElement<HTMLButtonElement>('playButton'),
  pauseButton: getElement<HTMLButtonElement>('pauseButton'),
  prevButton: getElement<HTMLButtonElement>('prevButton'),
  nextButton: getElement<HTMLButtonElement>('nextButton'),
  posterImage: getElement('posterImage'),
  selectorOpenButton: getElement<HTMLButtonElement>('new_selector__button'),
  selectorContent: getElement('new_selector__content'),
  selectorButtonTemplate: getElement<HTMLButtonElement>('new_selector__button_example'),
};

// Set initial poster image
const posterImg = elements.posterImage.querySelector('img') as HTMLImageElement;
posterImg.src = cloudinaryImageUrl('Coji Radio Player');

// Initialize modules
initPlayer(elements);
initTheme();
initSelector(elements);
initElectronBridge(elements.player);

// Play/Pause button handlers
elements.playButton.addEventListener('click', () => {
  if (elements.player.paused) {
    const currentStatus = getStatus();
    if (currentStatus.state === 'idle') {
      playRadio(0);
    } else {
      elements.player.play();
    }
  }
});

elements.pauseButton.addEventListener('click', () => {
  elements.player.pause();
});

// Prev/Next button handlers
elements.prevButton.addEventListener('click', prevRadio);
elements.nextButton.addEventListener('click', nextRadio);

// Register keep-alive Web Worker
const worker = new Worker(
  new URL('./workers/keep-alive.ts', import.meta.url),
  { type: 'module' },
);
worker.onmessage = (): void => {
  console.log('Mențin conexiunea activă...');
};

// Register Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/sw.js')
    .then(() => console.log('Service Worker registered!'))
    .catch((err: unknown) => console.error('Service Worker registration failed:', err));
}
