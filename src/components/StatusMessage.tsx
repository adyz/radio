import type { PlayerStatus } from '../types';
import { STATIONS } from '../data/stations';

interface StatusMessageProps {
  readonly status: PlayerStatus;
}

export function StatusMessage({ status }: StatusMessageProps) {
  if (status.state === 'loading') {
    const name = STATIONS[status.stationIndex]?.name ?? '';
    return (
      <div className="absolute z-10 bottom-42 w-full text-center text-xs">
        <div className="text-Brown absolute top-0 w-full text-center">Se încarcă {name}...</div>
      </div>
    );
  }

  if (status.state === 'error') {
    return (
      <div className="absolute z-10 bottom-42 w-full text-center text-xs">
        <div className="text-Red absolute top-0 w-full text-center">Eroare la încărcarea postului radio.</div>
      </div>
    );
  }

  return null;
}
