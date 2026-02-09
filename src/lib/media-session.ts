import type { PlayerStatus } from '../types';
import { cloudinaryImageUrl } from './cloudinary';
import { STATIONS } from '../data/stations';

interface MediaSessionCallbacks {
  onPrevious(): void;
  onNext(): void;
  onPause(): void;
  onPlay(): void;
}

export function updateMediaSession(
  status: PlayerStatus,
  callbacks: MediaSessionCallbacks,
  posterImg: HTMLImageElement,
): void {
  const stationName = status.state === 'idle'
    ? 'Coji Radio Player'
    : STATIONS[status.stationIndex]?.name ?? 'Unknown';

  const isLive = status.state === 'playing';
  const isLoading = status.state === 'loading';
  const isError = status.state === 'error';

  const displayTitle = isLoading
    ? `Se încarcă...${stationName}`
    : isError
      ? `Eroare la încărcarea ${stationName}`
      : stationName;

  const posterText = isLoading ? 'Se încarcă...' : isError ? 'Eroare' : stationName;
  const artworkUrl = cloudinaryImageUrl(posterText, isLive);

  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: displayTitle,
      artist: `Coji Radio Player | ${stationName}`,
      artwork: [{ src: artworkUrl }],
    });

    navigator.mediaSession.setActionHandler('previoustrack', callbacks.onPrevious);
    navigator.mediaSession.setActionHandler('nexttrack', callbacks.onNext);

    if (!isLoading && !isError) {
      navigator.mediaSession.setActionHandler('pause', callbacks.onPause);
      navigator.mediaSession.setActionHandler('play', callbacks.onPlay);
    }
  }

  posterImg.src = artworkUrl;

  const emoji = isLoading ? '⏳' : isError ? '❤️‍🩹' : '🔴';
  const titleText = isLoading ? `Se incarca ${stationName}` : isError ? 'Eroare' : stationName;
  document.title = `${emoji} ${titleText}`;
}
