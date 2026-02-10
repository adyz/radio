import type { PlayerStatus } from '../types';
import { getStatusDisplay } from '../lib/media-session';

interface PosterImageProps {
  readonly status: PlayerStatus;
  readonly onClick: () => void;
}

export function PosterImage({ status, onClick }: PosterImageProps) {
  const { artworkUrl, stationName } = getStatusDisplay(status);

  return (
    <div
      className="mx-auto rounded-3xl overflow-hidden w-[128px] h-[128px] bg-Red border border-Border relative z-10 mt-10 cursor-pointer"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      <img
        src={artworkUrl}
        alt={stationName}
        className="w-full h-full object-cover"
      />
    </div>
  );
}
