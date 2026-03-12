/**
 * useRadio(stations) — the hook.
 *
 * Creates all Audio elements internally (no DOM audio tags needed).
 * Returns reactive signals + action functions.
 *
 * Usage:
 *   const radio = useRadio(STATIONS);
 *   effect(() => console.log(radio.state.get()));
 *   radio.play(0);
 */

import { signal, computed } from './signals.js';

// ── Constants ────────────────────────────────────────────────────────

const MAX_RETRIES       = 1;
const LOADING_TIMEOUT   = 6000;
const RECOVERY_DELAY    = 10000;
const STALE_PAUSE_MS    = 2000;
const STALLED_GRACE_MS  = 5000;

const LABELS = {
  appName:  'Coji Radio Player',
  loading:  'Se încarcă...',
  error:    'Eroare',
};

// ── Sound helper (creates Audio from URL, preloads as blob) ──────────

function createSound(url) {
  const audio  = new Audio();
  let blobUrl  = null;
  let playing  = false;

  // Eagerly preload as blob for offline
  fetch(url)
    .then(r => r.ok ? r.blob() : null)
    .then(b => { if (b) blobUrl = URL.createObjectURL(b); })
    .catch(() => {});

  return {
    play() {
      if (playing) return;
      audio.src = blobUrl || url;
      audio.currentTime = 0;
      audio.loop = true;
      playing = true;
      audio.play().catch(() => { playing = false; });
    },
    stop() {
      if (!playing) return;
      audio.pause();
      audio.currentTime = 0;
      playing = false;
    },
    /** iOS unlock — call from a user gesture */
    warmUp() {
      if (playing) return;
      audio.src = blobUrl || url;
      audio.play().then(() => { audio.pause(); audio.currentTime = 0; }).catch(() => {});
    },
  };
}

// ── Cloudinary poster helper ─────────────────────────────────────────

function cloudinaryUrl(text, live = false) {
  const bg = live ? 'rhz6yy4btbqicjqhsy7a' : 'nndti4oybhdzggf8epvh';
  const enc = encodeURIComponent(text);
  return `https://res.cloudinary.com/adrianf/image/upload/c_scale,h_480,w_480/w_400,g_south_west,x_50,y_70,c_fit,l_text:arial_90:${enc}/${bg}`;
}

// ── The hook ─────────────────────────────────────────────────────────

/**
 * @param {Array<{name:string, url:string}>} stations
 * @param {{ soundBase?: string }} opts
 */
export function useRadio(stations, opts = {}) {
  const soundBase = opts.soundBase || '../sounds';

  // ── Reactive state ───────────────────────────────────────────────

  const state        = signal('idle');          // idle|loading|playing|paused|retrying|error|recovering
  const stationIndex = signal(restoreIndex());

  // ── Computed / derived ───────────────────────────────────────────

  const stationName = computed(() => stations[stationIndex.get()]?.name ?? LABELS.appName);
  const isLive      = computed(() => state.get() === 'playing');
  const isLoading   = computed(() => state.get() === 'loading' || state.get() === 'retrying');
  const hasError    = computed(() => state.get() === 'error'   || state.get() === 'recovering');
  const isIdle      = computed(() => state.get() === 'idle');
  const isPaused    = computed(() => state.get() === 'paused');

  const visibleButton = computed(() => {
    const s = state.get();
    if (s === 'playing') return 'pause';
    if (s === 'loading' || s === 'retrying' || s === 'error' || s === 'recovering') return 'stop';
    return 'play'; // idle, paused
  });

  const displayText = computed(() => {
    if (isIdle.get())    return restoreIndex() !== null ? stationName.get() : LABELS.appName;
    if (isLoading.get()) return LABELS.loading;
    if (hasError.get())  return LABELS.error;
    return stationName.get();
  });

  const posterUrl = computed(() => cloudinaryUrl(displayText.get(), isLive.get()));

  const loadingText = computed(() => `${LABELS.loading} ${stationName.get()}`);

  const pageTitle = computed(() => {
    const name = stationName.get();
    if (isLoading.get()) return `⏳ ${LABELS.loading} ${name}`;
    if (hasError.get())  return `❤️‍🩹 ${LABELS.error}`;
    if (isLive.get())    return `🔴 ${name}`;
    if (isIdle.get())    return restoreIndex() !== null ? name : LABELS.appName;
    return name;
  });

  // ── Internal audio (player + sounds) ─────────────────────────────

  const player       = new Audio();
  // Headless Chromium needs the element in the DOM for the audio pipeline to work.
  // Hidden — no visible footprint.
  player.hidden = true;
  document.body.appendChild(player);

  const loadingSound = createSound(`${soundBase}/loading-low.mp3`);
  const errorSound   = createSound(`${soundBase}/error-low.mp3`);

  // Pre-fetch status poster images as blob URLs for offline
  const posterBlobUrls = {};
  [LABELS.appName, LABELS.loading, LABELS.error].forEach(text => {
    const url = cloudinaryUrl(text);
    fetch(url)
      .then(r => r.ok ? r.blob() : null)
      .then(b => { if (b) posterBlobUrls[url] = URL.createObjectURL(b); })
      .catch(() => {});
  });

  /** Resolve poster: blob if available, else network Cloudinary URL */
  function resolvedPosterUrl() {
    const url = posterUrl.get();
    return posterBlobUrls[url] || url;
  }

  // ── Timers & internal vars ───────────────────────────────────────

  const timers = { retry: null, loading: null, recovery: null, stalled: null };
  let retryCount    = 0;
  let currentPlayId = 0;
  let lastPauseTime = null;

  // ── Side-effect table (sounds) ────────────────────────────────────

  function applySoundFx(s) {
    const load = ['loading'].includes(s);
    const err  = ['error'].includes(s);
    const keepLoad = s === 'retrying';
    const keepErr  = s === 'recovering';

    if (!load && !keepLoad) loadingSound.stop();
    if (load)               loadingSound.play();

    if (!err && !keepErr)   errorSound.stop();
    if (err)                errorSound.play();
  }

  // Whenever state changes, apply sound effects
  let prevState = null;
  state.subscribe(() => {
    const s = state.peek();
    if (s !== prevState) {
      console.log(`[radio] ${prevState ?? '∅'} → ${s}`);
      prevState = s;
      applySoundFx(s);
    }
  });

  // ── localStorage ─────────────────────────────────────────────────

  function restoreIndex() {
    const v = localStorage.getItem('lastRadioIndex');
    return v !== null ? parseInt(v, 10) : null;
  }

  function saveIndex(i) {
    localStorage.setItem('lastRadioIndex', String(i));
  }

  // Restore
  const restored = restoreIndex();
  if (restored !== null && restored < stations.length) {
    stationIndex.set(restored);
  }

  // ── Core logic ───────────────────────────────────────────────────

  function clearAllTimers() {
    clearTimeout(timers.retry);
    clearTimeout(timers.loading);
    clearTimeout(timers.recovery);
    clearTimeout(timers.stalled);
  }

  function stop() {
    clearAllTimers();
    currentPlayId++;
    retryCount = 0;
    lastPauseTime = null;
    player.pause();
    player.src = '';
    state.set('idle');
  }

  function play(index) {
    warmUp();
    _playInternal(index, false);
  }

  function _playInternal(index, isRetry) {
    if (index == null || index < 0 || index >= stations.length) return;
    stationIndex.set(index);

    clearTimeout(timers.retry);
    clearTimeout(timers.loading);
    clearTimeout(timers.recovery);
    if (!isRetry) retryCount = 0;

    // Offline → skip straight to error + schedule recovery
    if (!navigator.onLine) {
      currentPlayId++;
      player.pause();
      player.src = '';
      state.set('error');
      scheduleRecovery();
      return;
    }

    const playId = ++currentPlayId;
    state.set('loading');

    player.pause();
    player.src = stations[index].url;
    player.load();

    timers.loading = setTimeout(() => {
      if (playId !== currentPlayId) return;
      player.pause();
      player.src = '';
      handleError(playId, index, new Error('Loading timeout'));
    }, LOADING_TIMEOUT);

    player.play().then(() => {
      if (playId !== currentPlayId) return;
      clearTimeout(timers.loading);
      retryCount = 0;
      saveIndex(index);
      state.set('playing');
    }).catch(err => {
      if (err.name === 'AbortError') return;
      if (playId !== currentPlayId) return;
      clearTimeout(timers.loading);
      handleError(playId, index, err);
    });
  }

  function handleError(playId, index, _err) {
    if (retryCount < MAX_RETRIES) {
      retryCount++;
      state.set('retrying');
      timers.retry = setTimeout(() => {
        if (playId !== currentPlayId) return;
        _playInternal(index, true);
      }, 3000);
    } else {
      state.set('error');
      scheduleRecovery();
    }
  }

  function pause() { player.pause(); }

  function resume() { player.play().catch(() => {}); }

  function next() {
    warmUp();
    const idx = stationIndex.peek() ?? 0;
    play(idx >= stations.length - 1 ? 0 : idx + 1);
  }

  function prev() {
    warmUp();
    const idx = stationIndex.peek() ?? 0;
    play(idx <= 0 ? stations.length - 1 : idx - 1);
  }

  function togglePlayPause() {
    if (player.paused) {
      const s = state.peek();
      if (s === 'paused') player.play().catch(() => {});
      else if (s === 'idle' || s === 'error' || s === 'recovering') {
        clearTimeout(timers.recovery);
        play(stationIndex.peek() ?? 0);
      }
    } else {
      player.pause();
    }
  }

  // ── Recovery ─────────────────────────────────────────────────────

  function scheduleRecovery() {
    clearTimeout(timers.recovery);
    timers.recovery = setTimeout(() => retryFromError(), RECOVERY_DELAY);
  }

  function retryFromError() {
    const s = state.peek();
    if (s !== 'error' && s !== 'recovering') return;
    if (!navigator.onLine) { scheduleRecovery(); return; }

    clearTimeout(timers.loading);
    clearTimeout(timers.recovery);

    const index  = stationIndex.peek();
    const playId = ++currentPlayId;

    state.set('recovering');

    player.pause();
    player.src = stations[index].url;
    player.load();

    timers.loading = setTimeout(() => {
      if (playId !== currentPlayId) return;
      currentPlayId++;
      player.pause();
      player.src = '';
      state.set('error');
      scheduleRecovery();
    }, LOADING_TIMEOUT);

    player.play().then(() => {
      if (playId !== currentPlayId) return;
      clearTimeout(timers.loading);
      retryCount = 0;
      saveIndex(index);
      state.set('playing');
    }).catch(err => {
      if (err.name === 'AbortError') return;
      if (playId !== currentPlayId) return;
      clearTimeout(timers.loading);
      state.set('error');
      scheduleRecovery();
    });
  }

  // ── onPlayButtonClick (smart: idle→play, paused→resume, etc) ─────

  function onPlayButtonClick() {
    warmUp();
    const s = state.peek();
    if (s === 'idle' || s === 'error' || s === 'recovering') {
      clearTimeout(timers.recovery);
      play(stationIndex.peek() ?? 0);
    } else if (s === 'paused') {
      resume();
    }
  }

  // ── Native player events ─────────────────────────────────────────

  player.addEventListener('play', () => {
    if (state.peek() === 'paused' && lastPauseTime) {
      const diff = performance.now() - lastPauseTime;
      lastPauseTime = null;
      if (diff > STALE_PAUSE_MS) {
        player.pause();
        player.src = '';
        play(stationIndex.peek() ?? 0);
        return;
      }
      state.set('playing');
      return;
    }
    lastPauseTime = null;
    if (state.peek() === 'paused') state.set('playing');
  });

  player.addEventListener('pause', () => {
    if (state.peek() === 'playing') {
      state.set('paused');
      lastPauseTime = performance.now();
    }
  });

  player.addEventListener('error', () => {
    const s = state.peek();
    if (s === 'playing' || s === 'paused') {
      lastPauseTime = null;
      handleError(currentPlayId, stationIndex.peek(), new Error('Stream error'));
    }
  });

  player.addEventListener('stalled', () => {
    clearTimeout(timers.stalled);
    timers.stalled = setTimeout(() => {
      if (state.peek() === 'playing') {
        handleError(currentPlayId, stationIndex.peek(), new Error('Stalled'));
      }
    }, STALLED_GRACE_MS);
    player.addEventListener('playing', () => clearTimeout(timers.stalled), { once: true });
  });

  // Auto-recovery when network returns
  window.addEventListener('online', () => retryFromError());

  // ── iOS audio unlock helper ──────────────────────────────────────

  function warmUp() {
    loadingSound.warmUp();
    errorSound.warmUp();
  }

  // ── Public API ───────────────────────────────────────────────────

  return {
    // Reactive state (read with .get() inside effect())
    state,
    stationIndex,

    // Computed (read with .get() inside effect())
    stationName,
    isLive,
    isLoading,
    hasError,
    isIdle,
    isPaused,
    visibleButton,
    displayText,
    posterUrl,
    resolvedPosterUrl,
    pageTitle,
    loadingText,

    // Actions
    play,
    stop,
    pause,
    resume,
    next,
    prev,
    togglePlayPause,
    onPlayButtonClick,
    warmUp,

    // Internals for MediaSession etc.
    _player: player,

    // Constants re-exported for anyone who needs them
    LABELS,
  };
}
