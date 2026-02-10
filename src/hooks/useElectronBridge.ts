import { useEffect } from 'react';
import { nextRadio, prevRadio } from '../lib/player-actor';

export function useElectronBridge(playerAudio: HTMLAudioElement | null): void {
  useEffect(() => {
    if (!window.electronAPI || !playerAudio) return;

    const onMediaControl = (command: string): void => {
      if (command === 'playpause') {
        if (playerAudio.paused) {
          playerAudio.play();
        } else {
          playerAudio.pause();
        }
      } else if (command === 'next') {
        nextRadio();
      } else if (command === 'previous') {
        prevRadio();
      }
    };

    window.electronAPI.onMediaControl(onMediaControl);

    const updatePlaybackState = (): void => {
      window.electronAPI?.updatePlaybackState(!playerAudio.paused);
    };

    playerAudio.addEventListener('play', updatePlaybackState);
    playerAudio.addEventListener('pause', updatePlaybackState);

    return () => {
      playerAudio.removeEventListener('play', updatePlaybackState);
      playerAudio.removeEventListener('pause', updatePlaybackState);
    };
  }, [playerAudio]);
}
