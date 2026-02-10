import { useLayoutEffect } from 'react';
import type { PlayerStatus } from '../types';
import { updateMediaSession } from '../lib/media-session';
import { prevRadio, nextRadio } from '../lib/player-actor';

export function useMediaSession(
  status: PlayerStatus,
  playerAudio: HTMLAudioElement | null,
): void {
  useLayoutEffect(() => {
    updateMediaSession(status, {
      onPrevious: prevRadio,
      onNext: nextRadio,
      onPause: () => playerAudio?.pause(),
      onPlay: () => { playerAudio?.play(); },
    });
  }, [status, playerAudio]);
}
