import { nextRadio, prevRadio } from './player';

export function initElectronBridge(player: HTMLAudioElement): void {
  if (!window.electronAPI) return;

  window.electronAPI.onMediaControl((command) => {
    if (command === 'playpause') {
      if (player.paused) {
        player.play();
      } else {
        player.pause();
      }
    } else if (command === 'next') {
      nextRadio();
    } else if (command === 'previous') {
      prevRadio();
    }
  });

  const updatePlaybackState = (): void => {
    window.electronAPI?.updatePlaybackState(!player.paused);
  };

  player.addEventListener('play', updatePlaybackState);
  player.addEventListener('pause', updatePlaybackState);
}
