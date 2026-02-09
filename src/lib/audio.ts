import type { AudioInstance } from '../types';

export function createAudioInstance(htmlElement: HTMLAudioElement): AudioInstance {
  const sourceElement = htmlElement.querySelector('source');
  const initialSrc = sourceElement?.src ?? '';
  let isPlaying = false;

  const instance: AudioInstance = {
    src: initialSrc,

    play(): void {
      if (!isPlaying) {
        htmlElement.src = instance.src;
        isPlaying = true;

        htmlElement.play().catch((error: DOMException) => {
          if (error.name !== 'AbortError') {
            console.error('Error playing audio:', error);
          }
          isPlaying = false;
        });
      }
    },

    stop(): void {
      if (isPlaying) {
        htmlElement.pause();
        htmlElement.src = '';
        isPlaying = false;
      }
    },
  };

  return instance;
}
