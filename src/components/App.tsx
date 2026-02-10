import { useState, useRef, useCallback, useEffect } from 'react';
import { useSelector } from '@xstate/react';
import { actor, playRadio, prevRadio, nextRadio, setPlayerAudio } from '../lib/player-actor';
import type { PlayerStatus } from '../types';
import { Logo } from './Logo';
import { Footer } from './Footer';
import { PosterImage } from './PosterImage';
import { StationSelector } from './StationSelector';
import { PlayerControls } from './PlayerControls';
import { StatusMessage } from './StatusMessage';
import { useMediaSession } from '../hooks/useMediaSession';
import { useElectronBridge } from '../hooks/useElectronBridge';
import { useKeepAlive } from '../hooks/useKeepAlive';
import { useTheme } from '../hooks/useTheme';
import { useServiceWorker } from '../hooks/useServiceWorker';

const PAUSE_RESTART_THRESHOLD_MS = 2000;

function snapshotToStatus(snap: { value: string; context: { stationIndex: number } }): PlayerStatus {
  const idx = snap.context.stationIndex;
  switch (snap.value) {
    case 'loading':
      return { state: 'loading', stationIndex: idx };
    case 'playing':
      return { state: 'playing', stationIndex: idx };
    case 'error':
      return { state: 'error', stationIndex: idx };
    default:
      return { state: 'idle' };
  }
}

export function App() {
  const playerRef = useRef<HTMLAudioElement>(null);
  const lastPauseTimeRef = useRef<number | null>(null);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const state = useSelector(actor, (snap) => snap.value as string);
  const stationIndex = useSelector(actor, (snap) => snap.context.stationIndex);
  const status = useSelector(actor, (snap) => snapshotToStatus(snap));

  // Register player audio element with the actor
  useEffect(() => {
    if (playerRef.current) {
      setPlayerAudio(playerRef.current);
    }
  }, []);

  // Clear lastPauseTimeRef when entering loading to prevent restart logic
  // from interfering with loadStream's programmatic pause() + play()
  useEffect(() => {
    if (state === 'loading') {
      lastPauseTimeRef.current = null;
    }
  }, [state]);

  // Audio play/pause event handlers
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;

    const handlePlay = (): void => {
      setIsAudioPlaying(true);

      const now = performance.now();
      if (lastPauseTimeRef.current !== null) {
        const timeDiff = now - lastPauseTimeRef.current;
        if (timeDiff > PAUSE_RESTART_THRESHOLD_MS) {
          player.pause();
          player.src = '';
          playRadio(stationIndex);
        }
      }
      lastPauseTimeRef.current = null;
    };

    const handlePause = (): void => {
      setIsAudioPlaying(false);
      lastPauseTimeRef.current = performance.now();
    };

    player.addEventListener('play', handlePlay);
    player.addEventListener('pause', handlePause);

    return () => {
      player.removeEventListener('play', handlePlay);
      player.removeEventListener('pause', handlePause);
    };
  }, [stationIndex]);

  // iOS Safari touch fix
  useEffect(() => {
    const noop = (): void => {};
    document.addEventListener('touchstart', noop, true);
    return () => document.removeEventListener('touchstart', noop, true);
  }, []);

  // Hooks
  useMediaSession(status, playerRef.current);
  useElectronBridge(playerRef.current);
  useKeepAlive();
  useTheme();
  useServiceWorker();

  const handlePlay = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;

    if (player.paused) {
      if (state === 'idle') {
        playRadio(0);
      } else {
        player.play();
      }
    }
  }, [state]);

  const handlePause = useCallback(() => {
    playerRef.current?.pause();
  }, []);

  const toggleSelector = useCallback(() => {
    console.log('Toggling selector open state');
    setSelectorOpen((prev) => !prev);
  }, []);

  const closeSelector = useCallback(() => {
    console.log('Closing selector');
    setSelectorOpen(false);
  }, []);

  return (
    <>
      <Logo />

      <div className="rounded-3xl shadow-xl w-full max-w-[540px] bg-gradient-to-t from-White to-bg text-white min-h-[calc(100dvh-180px)] flex flex-col align-center justify-end relative">
        {/* Gradient overlay */}
        <div className="absolute top-0 left-0 w-[104%] h-[100%] -m-[2%] bg-gradient-to-b from-Bg to-transparent pointer-events-none"></div>

        <div>
          <StationSelector
            selectedIndex={stationIndex}
            onSelect={playRadio}
            isOpen={selectorOpen}
            onToggle={toggleSelector}
            onClose={closeSelector}
          />

          <PosterImage status={status} onClick={toggleSelector} />

          <PlayerControls
            state={state}
            isAudioPlaying={isAudioPlaying}
            onPlay={handlePlay}
            onPause={handlePause}
            onPrev={prevRadio}
            onNext={nextRadio}
          />

          <StatusMessage status={status} />
        </div>
      </div>

      <audio ref={playerRef}>
        Browser-ul tău nu suportă tag-ul audio.
      </audio>

      <Footer />
    </>
  );
}
