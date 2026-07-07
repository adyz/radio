/**
 * Shared DOM references.
 *
 * The markup is ours (src/index.html), so a missing id is a build-time bug —
 * fail loudly instead of null-checking every use site.
 */

export function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element: #${id}`);
  return node as T;
}

export const radioSelect = el<HTMLSelectElement>('radioSelect');
export const player = el<HTMLAudioElement>('player');
export const loadingNoise = el<HTMLAudioElement>('loadingNoise');
export const errorNoise = el<HTMLAudioElement>('errorNoise');
export const loadingMsg = el<HTMLElement>('loadingMsg');
export const errorMsg = el<HTMLElement>('errorMsg');
export const visualizer = el<HTMLElement>('visualizer');

export const prevButton = el<HTMLButtonElement>('prevButton');
export const playButton = el<HTMLButtonElement>('playButton');
export const pauseButton = el<HTMLButtonElement>('pauseButton');
export const stopButton = el<HTMLButtonElement>('stopButton');
export const nextButton = el<HTMLButtonElement>('nextButton');

export const logoButton = el<HTMLButtonElement>('logoButton');
export const posterImage = el<HTMLButtonElement>('posterImage');
