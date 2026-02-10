interface PlayerControlsProps {
  readonly state: string;
  readonly isAudioPlaying: boolean;
  readonly onPlay: () => void;
  readonly onPause: () => void;
  readonly onPrev: () => void;
  readonly onNext: () => void;
}

export function PlayerControls({ state, isAudioPlaying, onPlay, onPause, onPrev, onNext }: PlayerControlsProps) {
  const isLoading = state === 'loading';
  const playPauseDisabledClass = isLoading ? 'opacity-50 cursor-not-allowed' : '';

  return (
    <div className="flex items-center justify-center mt-10 relative z-10">
      <button
        onClick={onPrev}
        className="stroke-Red hover:stroke-Brown active:stroke-Brown w-1/3 flex justify-center bg-gradient-to-b hover:from-transparent hover:to-Red/10 active:from-transparent active:to-Red/15 pb-10 pt-10 rounded-bl-3xl"
      >
        <svg className="h-20 max-w-[20%]" viewBox="0 0 65 107" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M61.8923 103.771L3 53.4709" strokeWidth="6" strokeLinecap="round" />
          <path d="M3 53.3854L61.8923 3.08551" strokeWidth="6" strokeLinecap="round" />
        </svg>
      </button>

      {isAudioPlaying ? (
        <button
          onClick={onPause}
          disabled={isLoading}
          className={`stroke-Red hover:stroke-Brown active:stroke-Brown w-1/3 justify-center flex bg-gradient-to-b hover:from-transparent hover:to-Red/10 active:from-transparent active:to-Red/15 pb-10 pt-10 ${playPauseDisabledClass}`}
        >
          <svg className="h-20 max-w-[50%]" viewBox="0 0 129 129" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="64.5" cy="64.5" r="62" strokeWidth="6" strokeLinecap="round" />
            <path d="M51 38L51 96" strokeWidth="6" strokeLinecap="round" />
            <path d="M78 38L78 96" strokeWidth="6" strokeLinecap="round" />
          </svg>
        </button>
      ) : (
        <button
          onClick={onPlay}
          disabled={isLoading}
          className={`stroke-Red hover:stroke-Brown active:stroke-Brown w-1/3 flex justify-center bg-gradient-to-b hover:from-transparent hover:to-Red/10 active:from-transparent active:to-Red/15 pb-10 pt-10 ${playPauseDisabledClass}`}
        >
          <svg className="h-20 max-w-[50%]" viewBox="0 0 129 129" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="64.5" cy="64.5" r="62" strokeWidth="6" strokeLinecap="round" />
            <path d="M51.8684 36.2605L90.4966 64.1943L51.8684 92.1281L51.8684 36.2605Z" strokeWidth="5" strokeLinecap="round" />
          </svg>
        </button>
      )}

      <button
        onClick={onNext}
        className="stroke-Red hover:stroke-Brown active:stroke-Brown w-1/3 flex justify-center bg-gradient-to-b hover:from-transparent hover:to-Red/10 active:from-transparent active:to-Red/15 pb-10 pt-10 rounded-br-3xl"
      >
        <svg className="h-20 max-w-[20%]" viewBox="0 0 65 106" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3.2146 3L62.1069 53.2999" strokeWidth="6" strokeLinecap="round" />
          <path d="M62.1069 53.3854L3.21459 103.685" strokeWidth="6" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}
