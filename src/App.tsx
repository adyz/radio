import { useEffect, useRef, useState } from 'preact/hooks';
import { radioStations } from './types';
import { audioInstance, cloudinaryImageUrl } from './utils';
import type { AudioInstanceType } from './types';
import './css/input.css';

export function App() {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [selectorOpen, setSelectorOpen] = useState(false);

  const playerRef = useRef<HTMLAudioElement>(null);
  const loadingNoiseRef = useRef<HTMLAudioElement>(null);
  const errorNoiseRef = useRef<HTMLAudioElement>(null);
  const loadingNoiseInstanceRef = useRef<AudioInstanceType | null>(null);
  const errorNoiseInstanceRef = useRef<AudioInstanceType | null>(null);
  const lastPauseTimeRef = useRef<number | null>(null);

  // Enable touch events
  useEffect(() => {
    const handler = () => {};
    document.addEventListener('touchstart', handler, true);
    return () => document.removeEventListener('touchstart', handler, true);
  }, []);

  // Initialize audio instances
  useEffect(() => {
    if (loadingNoiseRef.current && errorNoiseRef.current) {
      loadingNoiseInstanceRef.current = audioInstance(loadingNoiseRef.current);
      errorNoiseInstanceRef.current = audioInstance(errorNoiseRef.current);
    }
  }, []);

  // Update theme color
  useEffect(() => {
    function updateThemeColor() {
      const isDarkMode = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const themeColor = isDarkMode ? '#434238' : '#fffdef';
      
      let metaThemeColor = document.querySelector('meta[name="theme-color"]');
      if (!metaThemeColor) {
        metaThemeColor = document.createElement('meta');
        metaThemeColor.setAttribute('name', 'theme-color');
        document.head.appendChild(metaThemeColor);
      }
      metaThemeColor.setAttribute('content', themeColor);
    }
    
    updateThemeColor();
    
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', updateThemeColor);
    
    return () => mediaQuery.removeEventListener('change', updateThemeColor);
  }, []);

  // Update media session and UI
  useEffect(() => {
    const station = radioStations[selectedIndex];
    const title = station.name;
    
    if ('mediaSession' in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: isLoading ? `Se încarcă...${title}` : hasError ? `Eroare la încărcarea ${title}` : title,
        artist: `Coji Radio Player | ${title}`,
        artwork: [{ src: cloudinaryImageUrl(isLoading ? 'Se încarcă...' : hasError ? 'Eroare' : title, title && !isLoading && !hasError) }]
      });
      
      navigator.mediaSession.setActionHandler('previoustrack', () => {
        console.log('prev by media session');
        prevRadio();
      });
      navigator.mediaSession.setActionHandler('nexttrack', () => {
        console.log('next by media session');
        nextRadio();
      });

      if (!isLoading && !hasError) {
        navigator.mediaSession.setActionHandler('pause', () => {
          console.log('paused by media session');
          if (playerRef.current) playerRef.current.pause();
        });
        navigator.mediaSession.setActionHandler('play', () => {
          console.log('played by media session');
          if (playerRef.current) playerRef.current.play();
        });
      }
    }

    // Update document title
    document.title = `${isLoading ? "⏳" : ''} ${hasError ? '❤️‍🩹' : ''} ${!isLoading && !hasError ? '🔴' : ''} ${isLoading ? `Se incarca ${title}` : hasError ? 'Eroare' : title}`;
  }, [selectedIndex, isLoading, hasError]);

  // Electron API integration
  useEffect(() => {
    if (window.electronAPI && playerRef.current) {
      const player = playerRef.current;
      
      window.electronAPI.onMediaControl((command: string) => {
        console.log('Comandă media primită:', command);
        
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

      const updatePlaybackState = () => {
        window.electronAPI!.updatePlaybackState(!player.paused);
      };

      player.addEventListener('play', updatePlaybackState);
      player.addEventListener('pause', updatePlaybackState);

      return () => {
        player.removeEventListener('play', updatePlaybackState);
        player.removeEventListener('pause', updatePlaybackState);
      };
    }
  }, []);

  const playRadio = (index: number) => {
    console.log('playRadio', { index, value: radioStations[index].url });
    setSelectedIndex(index);
    setIsLoading(true);
    setHasError(false);

    if (errorNoiseInstanceRef.current) errorNoiseInstanceRef.current.stop();
    if (loadingNoiseInstanceRef.current) loadingNoiseInstanceRef.current.play();

    if (!playerRef.current) return;

    const player = playerRef.current;
    player.pause();
    player.src = radioStations[index].url;
    player.load();

    player.play().then(() => {
      setIsLoading(false);
      setHasError(false);
      if (loadingNoiseInstanceRef.current) loadingNoiseInstanceRef.current.stop();
    }).catch((error) => {
      if (error.name === 'AbortError') {
        return;
      }

      console.log('Error playing radio:', error);
      setIsLoading(false);
      setHasError(true);
      
      if (loadingNoiseInstanceRef.current) loadingNoiseInstanceRef.current.stop();
      if (errorNoiseInstanceRef.current) errorNoiseInstanceRef.current.play();
    });
  };

  const prevRadio = () => {
    console.log('prevRadio', selectedIndex);
    playRadio(selectedIndex === 0 ? radioStations.length - 1 : selectedIndex - 1);
  };

  const nextRadio = () => {
    console.log('nextRadio', selectedIndex);
    playRadio(selectedIndex === radioStations.length - 1 ? 0 : selectedIndex + 1);
  };

  const handlePlay = () => {
    if (!playerRef.current) return;
    
    if (playerRef.current.paused) {
      if (selectedIndex === 0 && !playerRef.current.src) {
        playRadio(0);
      } else {
        playerRef.current.play();
      }
    }
  };

  const handlePause = () => {
    if (playerRef.current) {
      playerRef.current.pause();
    }
  };

  const handlePlayerPlay = () => {
    console.log('Event play');
    setIsPlaying(true);
    
    const now = performance.now();
    const timeDiff = lastPauseTimeRef.current ? now - lastPauseTimeRef.current : 0;
    
    if (lastPauseTimeRef.current && timeDiff > 2000 && playerRef.current) {
      console.log('Restart radio after pause', { timeDiff });
      playerRef.current.pause();
      playerRef.current.src = '';
      playRadio(selectedIndex);
    }
    
    lastPauseTimeRef.current = null;
  };

  const handlePlayerPause = () => {
    console.log('Event pause');
    setIsPlaying(false);
    lastPauseTimeRef.current = performance.now();
  };

  const handleSelectorToggle = () => {
    setSelectorOpen(!selectorOpen);
  };

  const handleStationSelect = (index: number) => {
    playRadio(index);
    setSelectorOpen(false);
  };

  const handleOutsideClick = (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const selectorContent = document.getElementById('new_selector__content');
    const selectorButton = document.getElementById('new_selector__button');
    const posterImage = document.getElementById('posterImage');
    
    if (
      selectorContent &&
      !selectorContent.contains(target) &&
      selectorButton &&
      !selectorButton.contains(target) &&
      posterImage &&
      !posterImage.contains(target)
    ) {
      setSelectorOpen(false);
    }
  };

  useEffect(() => {
    document.addEventListener('click', handleOutsideClick);
    return () => document.removeEventListener('click', handleOutsideClick);
  }, []);

  const station = radioStations[selectedIndex];
  const title = station.name;
  const posterImageUrl = cloudinaryImageUrl(
    isLoading ? 'Se încarcă...' : hasError ? 'Eroare' : title,
    title && !isLoading && !hasError
  );

  return (
    <>
      <div id="logo" className="text-center flex justify-center flex-col relative z-10">
        <svg className="h-20 fill-Logo mt-2" version="1.0" xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 970.000000 979.000000" preserveAspectRatio="xMidYMid meet">
          <g transform="translate(0.000000,979.000000) scale(0.100000,-0.100000)" stroke="none">
            <path d="M5705 9270 c-641 -33 -1137 -233 -1650 -665 -273 -231 -617 -611
-717 -792 -22 -40 -42 -73 -45 -73 -3 0 -44 24 -91 53 -340 209 -759 371 -957
371 -145 -1 -235 -55 -397 -239 -545 -619 -884 -1537 -979 -2650 -46 -537 105
-1380 371 -2075 102 -268 279 -636 371 -772 305 -452 666 -765 1019 -882 172
-57 259 -69 455 -63 199 6 297 26 530 107 122 42 161 52 208 50 33 -1 83 6
113 16 32 10 58 13 63 8 4 -5 34 -42 66 -83 71 -88 189 -192 303 -268 85 -56
293 -167 368 -196 23 -9 52 -30 64 -46 32 -46 101 -89 167 -105 44 -10 96 -37
203 -106 230 -149 380 -217 575 -263 135 -31 381 -30 525 2 351 78 706 272
1053 575 198 174 518 577 739 931 343 551 609 1188 687 1645 127 738 123 1392
-10 2005 -47 212 -98 291 -229 354 -47 22 -69 26 -145 26 -134 -1 -160 -16
-559 -340 -186 -151 -340 -275 -341 -275 -1 0 61 190 138 423 l140 422 1 100
c1 89 -2 107 -26 157 -33 70 -106 146 -173 178 -56 27 -193 40 -243 22 l-29
-10 -12 179 c-47 692 -225 1229 -552 1665 -147 197 -499 530 -619 587 -75 36
-130 40 -385 27z m207 -820 c335 -313 523 -697 598 -1226 23 -165 45 -543 35
-619 l-6 -54 -117 -62 c-417 -220 -737 -434 -1092 -729 -253 -210 -451 -440
-706 -817 -48 -70 -97 -139 -110 -153 -41 -45 -223 -361 -310 -537 -47 -95
-87 -173 -89 -173 -2 0 -16 5 -31 10 -15 6 -102 33 -193 61 -194 59 -283 99
-367 162 -138 105 -226 278 -270 532 -25 146 -30 436 -10 590 52 394 158 799
313 1195 75 193 263 577 360 738 124 205 422 536 643 714 372 299 762 453
1160 457 l95 1 97 -90z" />
          </g>
        </svg>
        <h1 className="uppercase text-sm text-Brown mt-6">Radio Player Romania
          <span className="inline-flex items-center" title="Steagul României">
            <span className="sr-only">🇷🇴</span>
            <span className="w-[.5em] h-[0.75em] bg-blue-600 inline-block"></span>
            <span className="w-[.7em] h-[0.75em] bg-yellow-400 inline-block"></span>
            <span className="w-[.5em] h-[0.75em] bg-red-600 inline-block"></span>
          </span>
        </h1>
      </div>

      <div className="rounded-3xl shadow-xl w-full max-w-[540px] bg-gradient-to-t from-White to-bg text-white min-h-[calc(100dvh-180px)] flex flex-col align-center justify-end relative">
        {/* Gradient overlay */}
        <div className="absolute top-0 left-0 w-[104%] h-[100%] -m-[2%] bg-gradient-to-b from-Bg to-transparent"></div>

        <div>
          {/* Radio selector */}
          <div id="new_selector__parent" className="relative z-20 top-0 left-[11%] w-[78%] h-full">
            <button
              id="new_selector__button"
              onClick={handleSelectorToggle}
              className="position absolute top-22 right-[50%] -mr-19 text-SuperLighterBrown bg-StaticWhite border-[.5px] boder-Broder py-2 rounded-lg scale-75"
            >
              <svg fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" shapeRendering="geometricPrecision" viewBox="0 0 24 24" height="24" width="24" style="color: currentcolor;">
                <path d="M17 8.517L12 3 7 8.517m0 6.963l5 5.517 5-5.517"></path>
              </svg>
            </button>

            <div 
              id="new_selector__content"
              className={`${selectorOpen ? 'flex' : 'hidden'} overflow-auto flex-col absolute top-0 left-0 w-full h-82 shadow-2xl border border-Border bg-White overscroll-contain rounded-3xl [scrollbar-width:thin]`}
            >
              {radioStations.map((station, index) => (
                <button
                  key={index}
                  onClick={() => handleStationSelect(index)}
                  className={`w-full text-Brown py-4 text-md hover:bg-Red/20 active:bg-Red/20 border-0 border-b border-Border/50 ${selectedIndex === index ? 'bg-Red' : ''}`}
                >
                  {station.name}
                </button>
              ))}
            </div>
          </div>

          {/* Poster Image */}
          <div 
            id="posterImage"
            onClick={handleSelectorToggle}
            className="mx-auto rounded-3xl overflow-hidden w-[128px] h-[128px] bg-Red border border-Border relative z-10 mt-10 cursor-pointer"
          >
            <img
              src={posterImageUrl}
              alt={title}
              className="w-full h-full object-cover"
            />
          </div>

          {/* Player Controls */}
          <div className="flex items-center justify-center mt-10 relative z-10">
            <button
              onClick={prevRadio}
              className="stroke-Red hover:stroke-Brown active:stroke-Brown w-1/3 flex justify-center bg-gradient-to-b hover:from-transparent hover:to-Red/10 active:from-transparent active:to-Red/15 pb-10 pt-10 rounded-bl-3xl"
            >
              <svg className="h-20 max-w-[20%]" viewBox="0 0 65 107" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M61.8923 103.771L3 53.4709" strokeWidth="6" strokeLinecap="round" />
                <path d="M3 53.3854L61.8923 3.08551" strokeWidth="6" strokeLinecap="round" />
              </svg>
            </button>

            {!isPlaying ? (
              <button
                onClick={handlePlay}
                className={`stroke-Red hover:stroke-Brown active:stroke-Brown w-1/3 flex justify-center bg-gradient-to-b hover:from-transparent hover:to-Red/10 active:from-transparent active:to-Red/15 pb-10 pt-10 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg className="h-20 max-w-[50%]" viewBox="0 0 129 129" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="64.5" cy="64.5" r="62" strokeWidth="6" strokeLinecap="round" />
                  <path d="M51.8684 36.2605L90.4966 64.1943L51.8684 92.1281L51.8684 36.2605Z" strokeWidth="5" strokeLinecap="round" />
                </svg>
              </button>
            ) : (
              <button
                onClick={handlePause}
                className={`stroke-Red hover:stroke-Brown active:stroke-Brown w-1/3 justify-center flex bg-gradient-to-b hover:from-transparent hover:to-Red/10 active:from-transparent active:to-Red/15 pb-10 pt-10 ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
              >
                <svg className="h-20 max-w-[50%]" viewBox="0 0 129 129" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <circle cx="64.5" cy="64.5" r="62" strokeWidth="6" strokeLinecap="round" />
                  <path d="M51 38L51 96" strokeWidth="6" strokeLinecap="round" />
                  <path d="M78 38L78 96" strokeWidth="6" strokeLinecap="round" />
                </svg>
              </button>
            )}

            <button
              onClick={nextRadio}
              className="stroke-Red hover:stroke-Brown active:stroke-Brown w-1/3 flex justify-center bg-gradient-to-b hover:from-transparent hover:to-Red/10 active:from-transparent active:to-Red/15 pb-10 pt-10 rounded-br-3xl"
            >
              <svg className="h-20 max-w-[20%]" viewBox="0 0 65 106" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M3.2146 3L62.1069 53.2999" strokeWidth="6" strokeLinecap="round" />
                <path d="M62.1069 53.3854L3.21459 103.685" strokeWidth="6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div className="absolute z-10 bottom-42 w-full text-center text-xs">
            <div className={`text-Brown absolute top-0 w-full text-center ${isLoading ? 'visible' : 'invisible'}`}>
              Se incarca {title}...
            </div>
            <div className={`text-Red absolute top-0 w-full text-center ${hasError ? 'visible' : 'invisible'}`}>
              Eroare la încărcarea postului radio.
            </div>
          </div>
        </div>
      </div>

      {/* Audio elements */}
      <audio 
        ref={playerRef}
        id="player" 
        className="w-full"
        onPlay={handlePlayerPlay}
        onPause={handlePlayerPause}
      >
        Browser-ul tău nu suportă tag-ul audio.
      </audio>

      <audio ref={loadingNoiseRef} id="loadingNoise" loop>
        <source src="/sounds/loading-low.mp3" type="audio/mpeg" />
      </audio>

      <audio ref={errorNoiseRef} id="errorNoise" loop>
        <source src="/sounds/error-low.mp3" type="audio/mpeg" />
      </audio>

      {/* Footer */}
      <footer className="text-center text-xs text-Brown mt-8">
        <p>Coji Radio Player</p>
        <p>© 2025 Adrian Florescu | <a href="https://adrianf.com" target="_blank" rel="noopener">adrianf.com</a></p>
      </footer>
    </>
  );
}
