/**
 * app.js — Static template + targeted reactive effects.
 *
 * ONE mount() renders the page once (logo, selector, poster, controls, footer).
 * Individual effect() calls patch the DOM directly (toggle .hidden, .src, .textContent).
 * Elements are NEVER removed / recreated — only attributes and properties change.
 */

import { signal, effect } from './signals.js';
import { STATIONS } from './stations.js';
import { useRadio } from './useRadio.js';
import { html, mount } from './bind.js';

// ── iOS touch fix ───────────────────────────────────────────────────
document.addEventListener('touchstart', () => {}, true);

// ── Hook ────────────────────────────────────────────────────────────
const radio = useRadio(STATIONS, { soundBase: '../sounds' });

// ── Local UI state ──────────────────────────────────────────────────
const selectorOpen = signal(false);

// ── Labels / aria / text constants ──────────────────────────────────
const L = {
  appName:        'Coji Radio Player',
  title:          'Radio Player Romania',
  play:           'Redare',
  pause:          'Pauză',
  stop:           'Oprește',
  prev:           'Postul anterior',
  next:           'Postul următor',
  pickStation:    'Alege postul de radio',
  flag:           'Steagul României',
  posterAlt:      'Coji Radio Player',
  errorMsg:       'Eroare la încărcarea postului radio.',
  footer:         'Coji Radio Player',
  footerVersion:  'v2 \u2014 signals',
  copyright:      '\u00a9 2025 Adrian Florescu',
  authorUrl:      'https://adrianf.com',
  authorDomain:   'adrianf.com',
};

// ── SVG icons (static constants) ────────────────────────────────────

const LOGO_SVG = /* html */ html`<svg class="h-20 fill-Logo mt-2" version="1.0" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 970.000000 979.000000" preserveAspectRatio="xMidYMid meet"><g transform="translate(0.000000,979.000000) scale(0.100000,-0.100000)" stroke="none"><path d="M5705 9270 c-641 -33 -1137 -233 -1650 -665 -273 -231 -617 -611 -717 -792 -22 -40 -42 -73 -45 -73 -3 0 -44 24 -91 53 -340 209 -759 371 -957 371 -145 -1 -235 -55 -397 -239 -545 -619 -884 -1537 -979 -2650 -46 -537 105 -1380 371 -2075 102 -268 279 -636 371 -772 305 -452 666 -765 1019 -882 172 -57 259 -69 455 -63 199 6 297 26 530 107 122 42 161 52 208 50 33 -1 83 6 113 16 32 10 58 13 63 8 4 -5 34 -42 66 -83 71 -88 189 -192 303 -268 85 -56 293 -167 368 -196 23 -9 52 -30 64 -46 32 -46 101 -89 167 -105 44 -10 96 -37 203 -106 230 -149 380 -217 575 -263 135 -31 381 -30 525 2 351 78 706 272 1053 575 198 174 518 577 739 931 343 551 609 1188 687 1645 127 738 123 1392 -10 2005 -47 212 -98 291 -229 354 -47 22 -69 26 -145 26 -134 -1 -160 -16 -559 -340 -186 -151 -340 -275 -341 -275 -1 0 61 190 138 423 l140 422 1 100 c1 89 -2 107 -26 157 -33 70 -106 146 -173 178 -56 27 -193 40 -243 22 l-29 -10 -12 179 c-47 692 -225 1229 -552 1665 -147 197 -499 530 -619 587 -75 36 -130 40 -385 27z m207 -820 c335 -313 523 -697 598 -1226 23 -165 45 -543 35 -619 l-6 -54 -117 -62 c-417 -220 -737 -434 -1092 -729 -253 -210 -451 -440 -706 -817 -48 -70 -97 -139 -110 -153 -41 -45 -223 -361 -310 -537 -47 -95 -87 -173 -89 -173 -2 0 -16 5 -31 10 -15 6 -102 33 -193 61 -194 59 -283 99 -367 162 -138 105 -226 278 -270 532 -25 146 -30 436 -10 590 52 394 158 799 313 1195 75 193 263 577 360 738 124 205 422 536 643 714 372 299 762 453 1160 457 l95 1 97 -90z"/></g></svg>`;

const PREV_SVG = /* html */ html`<svg class="h-20 max-w-[20%]" viewBox="0 0 65 107" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M61.8923 103.771L3 53.4709" stroke-width="6" stroke-linecap="round"/><path d="M3 53.3854L61.8923 3.08551" stroke-width="6" stroke-linecap="round"/></svg>`;

const NEXT_SVG = /* html */ html`<svg class="h-20 max-w-[20%]" viewBox="0 0 65 106" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M3.2146 3L62.1069 53.2999" stroke-width="6" stroke-linecap="round"/><path d="M62.1069 53.3854L3.21459 103.685" stroke-width="6" stroke-linecap="round"/></svg>`;

const PLAY_SVG = /* html */ html`<svg class="h-20 max-w-[50%]" viewBox="0 0 129 129" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64.5" cy="64.5" r="62" stroke-width="6" stroke-linecap="round"/><path d="M51.8684 36.2605L90.4966 64.1943L51.8684 92.1281L51.8684 36.2605Z" stroke-width="5" stroke-linecap="round"/></svg>`;

const PAUSE_SVG = /* html */ html`<svg class="h-20 max-w-[50%]" viewBox="0 0 129 129" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64.5" cy="64.5" r="62" stroke-width="6" stroke-linecap="round"/><path d="M51 38L51 96" stroke-width="6" stroke-linecap="round"/><path d="M78 38L78 96" stroke-width="6" stroke-linecap="round"/></svg>`;

const STOP_SVG = /* html */ html`<svg class="h-20 max-w-[50%]" viewBox="0 0 129 129" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="64.5" cy="64.5" r="62" stroke-width="6" stroke-linecap="round"/><rect x="40" y="40" width="49" height="49" rx="4" stroke-width="5" stroke-linecap="round"/></svg>`;

const SELECTOR_SVG = /* html */ html`<svg fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" shape-rendering="geometricPrecision" viewBox="0 0 24 24" height="24" width="24" style="color:currentcolor"><path d="M17 8.517L12 3 7 8.517m0 6.963l5 5.517 5-5.517"></path></svg>`;

// Shared button class
const BTN = 'stroke-Red hover:stroke-Brown active:stroke-Brown w-1/3 flex justify-center bg-gradient-to-b hover:from-transparent hover:to-Red/10 active:from-transparent active:to-Red/15 pb-10 pt-10';

// ── Helpers ─────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

// ── Static template (rendered once) ─────────────────────────────────

const initialIdx = radio.stationIndex.peek() ?? 0;

const stationList = STATIONS.map((s, i) => /* html */ html`
  <button data-action="selectStation" data-index="${i}"
    class="w-full text-Brown py-4 text-md hover:bg-Red/20 active:bg-Red/20 border-0 border-b border-Border/50 ${i === initialIdx ? 'bg-Red text-StaticWhite' : ''}">
    ${s.name}
  </button>
`).join('');

mount(
  document.getElementById('app'),
  /* html */ html`
    <!-- Logo -->
    <div class="text-center flex justify-center flex-col relative z-10">
      ${LOGO_SVG}
      <h1 class="uppercase text-sm text-Brown mt-6">${L.title}
        <span class="inline-flex items-center" title="${L.flag}">
          <span class="sr-only">\ud83c\uddf7\ud83c\uddf4</span>
          <span class="w-[.5em] h-[0.75em] bg-blue-600 inline-block"></span>
          <span class="w-[.7em] h-[0.75em] bg-yellow-400 inline-block"></span>
          <span class="w-[.5em] h-[0.75em] bg-red-600 inline-block"></span>
        </span>
      </h1>
    </div>

    <!-- Main card -->
    <main class="rounded-3xl shadow-xl w-full max-w-[540px] bg-gradient-to-t from-White to-bg text-white min-h-[calc(100dvh-180px)] flex flex-col align-center justify-end relative">
      <!-- Gradient overlay -->
      <div class="absolute top-0 left-0 w-[104%] h-[100%] -m-[2%] bg-gradient-to-b from-Bg to-transparent"></div>

      <div>
        <!-- Selector area -->
        <div id="selectorArea" class="relative z-20 top-0 left-[11%] w-[78%] h-full">
          <button id="new_selector__button" data-action="toggleSelector" aria-label="${L.pickStation}"
            class="position absolute top-22 right-[50%] -mr-19 text-SuperLighterBrown bg-StaticWhite border-[.5px] boder-Broder py-2 rounded-lg scale-75">
            ${SELECTOR_SVG}
          </button>

          <div id="selectorBackdrop" data-action="closeSelector" class="fixed inset-0 z-10" hidden></div>
          <div id="new_selector__content" class="flex overflow-auto flex-col absolute top-0 left-0 w-full h-82 shadow-2xl border border-Border bg-White overscroll-contain rounded-3xl [scrollbar-width:thin] z-20" hidden>
            ${stationList}
          </div>
        </div>

        <!-- Poster -->
        <div id="posterImage" data-action="toggleSelector"
          class="mx-auto rounded-3xl overflow-hidden w-[128px] h-[128px] bg-Red border border-Border relative z-10 mt-10 cursor-pointer">
          <img fetchpriority="high" src="${radio.resolvedPosterUrl()}" alt="${L.posterAlt}" class="w-full h-full object-cover">
        </div>

        <!-- Controls -->
        <div class="flex items-center justify-center mt-10 relative z-10">
          <button id="prevButton" data-action="prev" aria-label="${L.prev}" class="${BTN} rounded-bl-3xl">
            ${PREV_SVG}
          </button>
          <button id="playButton"  data-action="play"  aria-label="${L.play}"  class="${BTN}">${PLAY_SVG}</button>
          <button id="pauseButton" data-action="pause" aria-label="${L.pause}" class="${BTN}" hidden>${PAUSE_SVG}</button>
          <button id="stopButton"  data-action="stop"  aria-label="${L.stop}"  class="${BTN}" hidden>${STOP_SVG}</button>
          <button id="nextButton" data-action="next" aria-label="${L.next}" class="${BTN} rounded-br-3xl">
            ${NEXT_SVG}
          </button>
        </div>

        <!-- Status message -->
        <div class="relative z-10 w-full text-center text-xs h-6 mt-2">
          <div id="loadingMsg" class="text-Brown" hidden></div>
          <div id="errorMsg" class="text-Red" hidden>${L.errorMsg}</div>
        </div>
      </div>
    </main>

    <!-- Footer -->
    <footer class="text-center text-xs text-Brown mt-8">
      <p>${L.footer} <span class="opacity-50">(${L.footerVersion})</span></p>
      <p>${L.copyright} | <a href="${L.authorUrl}" target="_blank" rel="noopener">${L.authorDomain}</a></p>
    </footer>
  `,
  {
    toggleSelector: () => {
      const willOpen = !selectorOpen.peek();
      selectorOpen.set(willOpen);
      if (willOpen) {
        const active = document.querySelector(
          `[data-action="selectStation"][data-index="${radio.stationIndex.peek()}"]`
        );
        if (active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    },
    closeSelector: () => selectorOpen.set(false),
    selectStation: (_e, target) => {
      const i = parseInt(target.dataset.index, 10);
      radio.play(i);
      selectorOpen.set(false);
    },
    play:  () => radio.onPlayButtonClick(),
    pause: () => radio.pause(),
    stop:  () => radio.stop(),
    prev:  () => radio.prev(),
    next:  () => radio.next(),
  }
);

// ── Targeted reactive effects (DOM patching) ────────────────────────

// 1. Button visibility
effect(() => {
  const btn = radio.visibleButton.get();
  $('playButton').hidden  = btn !== 'play';
  $('pauseButton').hidden = btn !== 'pause';
  $('stopButton').hidden  = btn !== 'stop';
});

// 2. Poster image
effect(() => {
  $('posterImage').querySelector('img').src = radio.resolvedPosterUrl();
});

// 3. Loading message
effect(() => {
  const loading = radio.isLoading.get();
  const el = $('loadingMsg');
  el.hidden = !loading;
  el.textContent = loading ? radio.loadingText.get() : '';
});

// 4. Error message
effect(() => {
  $('errorMsg').hidden = !radio.hasError.get();
});

// 5. Station list active highlight
effect(() => {
  const idx = radio.stationIndex.get();
  document.querySelectorAll('[data-action="selectStation"]').forEach(btn => {
    const active = parseInt(btn.dataset.index, 10) === idx;
    btn.classList.toggle('bg-Red', active);
    btn.classList.toggle('text-StaticWhite', active);
  });
});

// 6. Selector open / close
effect(() => {
  const open = selectorOpen.get();
  $('selectorBackdrop').hidden = !open;
  $('new_selector__content').hidden = !open;
});

// ── Non-DOM effects ─────────────────────────────────────────────────

// Page title
effect(() => { document.title = radio.pageTitle.get(); });

// MediaSession metadata + playback state
effect(() => {
  if (!('mediaSession' in navigator)) return;

  const name    = radio.stationName.get();
  const loading = radio.isLoading.get();
  const error   = radio.hasError.get();
  const idle    = radio.isIdle.get();
  const live    = radio.isLive.get();
  const paused  = radio.isPaused.get();
  const poster  = radio.posterUrl.get();

  const title = loading ? `${radio.LABELS.loading}${name}`
              : error   ? `${radio.LABELS.error} la \u00eenc\u0103rcarea ${name}`
              : idle    ? radio.LABELS.appName
              : name;

  navigator.mediaSession.metadata = new MediaMetadata({
    title,
    artist: `${radio.LABELS.appName}${idle ? '' : ` | ${name}`}`,
    artwork: [{ src: poster }],
  });

  navigator.mediaSession.playbackState = (live || loading) ? 'playing'
                                        : paused           ? 'paused'
                                        : 'none';

  if (live || paused) navigator.mediaSession.setPositionState();
});

// MediaSession action handlers
if ('mediaSession' in navigator) {
  navigator.mediaSession.setActionHandler('previoustrack', () => radio.prev());
  navigator.mediaSession.setActionHandler('nexttrack',     () => radio.next());
  navigator.mediaSession.setActionHandler('pause',         () => radio.pause());
  navigator.mediaSession.setActionHandler('play',          () => radio.resume());
}

// MediaSession native event sync
radio._player.addEventListener('play', () => {
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing';
});
radio._player.addEventListener('pause', () => {
  const s = radio.state.peek();
  if ('mediaSession' in navigator && s !== 'loading' && s !== 'retrying' && s !== 'recovering') {
    navigator.mediaSession.playbackState = 'paused';
  }
});

// ── Electron ────────────────────────────────────────────────────────
if (window.electronAPI) {
  window.electronAPI.onMediaControl((cmd) => {
    if (cmd === 'playpause') radio.togglePlayPause();
    else if (cmd === 'next') radio.next();
    else if (cmd === 'previous') radio.prev();
  });
  const updateElectron = () =>
    window.electronAPI.updatePlaybackState(radio.state.peek() === 'playing');
  radio._player.addEventListener('play', updateElectron);
  radio._player.addEventListener('pause', updateElectron);
}

// ── Keep-alive worker ───────────────────────────────────────────────
const worker = new Worker('../js/keepAlive.js');
worker.onmessage = () => {};

// ── Service Worker ──────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  (async () => {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => {
        const url = reg.active?.scriptURL || reg.installing?.scriptURL || reg.waiting?.scriptURL || '';
        if (!url.endsWith('/sw.js') || url.endsWith('/js/sw.js')) return reg.unregister();
        return Promise.resolve(false);
      }));
      const reg = await navigator.serviceWorker.register('../sw.js');
      reg.update();
    } catch (err) {
      console.error('SW registration failed:', err);
    }
  })();
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload());
}

// ── Theme color ─────────────────────────────────────────────────────
function updateThemeColor() {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  let meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'theme-color'); document.head.appendChild(meta); }
  meta.setAttribute('content', dark ? '#434238' : '#fffdef');
}
updateThemeColor();
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', updateThemeColor);
