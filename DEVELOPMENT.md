# Documentatie tehnica

## Stack tehnologic

| Tehnologie | Versiune | Rol |
|---|---|---|
| React | 19 | UI framework, componente declarative |
| TypeScript | 5.7+ | Limbaj principal, `strict: true` |
| Vite | 6 | Build tool, dev server, HMR |
| XState | 5 | State machine pentru player (audio-only actions) |
| @xstate/react | 5 | `useSelector` pentru reactive state in componente |
| Tailwind CSS | 4 | Styling (via `@tailwindcss/vite` plugin) |
| Vitest | 4 | Test runner (73 teste) |
| @testing-library/react | 16 | Component tests |
| jsdom | 28 | DOM environment pentru teste |

## Structura proiectului

```
radio/
  index.html                     # Entry point HTML (root, doar <div id="root">)
  vite.config.ts                 # Vite + React + Tailwind plugin + Vitest config
  tsconfig.json                  # TypeScript strict config + jsx: react-jsx
  package.json                   # Scripts si dependente
  vercel.json                    # Vercel deployment config

  public/                        # Static assets (copiate direct in dist/)
    manifest.json                # PWA manifest
    sw.js                        # Service Worker (placeholder)
    images/                      # Favicon, logo, PWA icons
    sounds/                      # MP3-uri pentru loading/error feedback

  src/
    main.tsx                     # Entry point React: createRoot + <App />
    css/app.css                  # Tailwind v4 cu @theme (custom colors, dark mode)

    components/
      App.tsx                    # Root component, XState actor, hooks wiring
      Logo.tsx                   # SVG logo + titlu
      PlayerControls.tsx         # Prev/Play/Pause/Next buttons
      StationSelector.tsx        # Custom dropdown cu lista de statii
      PosterImage.tsx            # Imagine Cloudinary cu statia curenta
      StatusMessage.tsx          # Mesaje loading/error (declarativ)
      Footer.tsx                 # Copyright info

    hooks/
      useMediaSession.ts         # Media Session API + document title
      useElectronBridge.ts       # Electron API bridge (conditional)
      useKeepAlive.ts            # Web Worker lifecycle
      useTheme.ts                # Dark/light theme-color meta tag
      useServiceWorker.ts        # SW registration

    data/
      stations.ts                # Array-ul de statii radio (as const satisfies)

    types/
      index.ts                   # PlayerStatus, AudioInstance
      global.d.ts                # Window.electronAPI augmentation

    lib/
      player-machine.ts          # XState state machine (5 audio actions only)
      player-actor.ts            # Actor instance cu .provide() audio actions
      media-session.ts           # getStatusDisplay() + updateMediaSession()
      cloudinary.ts              # Cloudinary poster URL builder

    workers/
      keep-alive.ts              # Web Worker: postMessage every 5s

    __tests__/                   # 8 fisiere de test, 73 asertii
      player-machine.test.ts     # Tranzitii state machine (21 teste)
      player-effects.test.ts     # Side effects: loading/error noise (11 teste)
      media-session.test.ts      # Titlu, poster, metadata (11 teste)
      cloudinary.test.ts         # URL generation (6 teste)
      stations.test.ts           # Validare date statii (7 teste)
      components/
        StatusMessage.test.tsx   # Mesaje per stare (5 teste)
        PlayerControls.test.tsx  # Butoane: disabled, play/pause toggle (7 teste)
        StationSelector.test.tsx # Lista statii, selectie, bg-Red (5 teste)
```

## Arhitectura

### State machine (XState v5) — Audio-only

Player-ul e controlat de o state machine cu 4 stari. Dupa migrarea pe React, masina gestioneaza **doar side effects audio** — UI-ul se deriveaza declarativ din stare in componente.

```
         PLAY(index)
  idle ───────────> loading
                     │   ↺ NEXT/PREV/PLAY (reenter)
                     │
         STREAM_READY│        STREAM_ERROR
                     ├──────────────────> error
                     v                      │
                  playing                   │
                     │                      │
         NEXT/PREV   │      NEXT/PREV/PLAY  │
                     └──> loading <─────────┘
```

**Stari:**
- `idle` - nimic selectat, aplicatia asteapta input
- `loading` - stream-ul se incarca, loading noise activ
- `playing` - stream activ, muzica se aude
- `error` - stream-ul a esuat, error noise activ

**Context:** `{ stationIndex: number }` - indexul statiei curente in array-ul STATIONS.

**Guard:** `isValidIndex` - respinge PLAY cu index in afara range-ului `[0, STATIONS.length)`.

**Entry actions (doar audio):**
- `loading`: stopErrorNoise, playLoadingNoise, loadStream
- `playing`: stopLoadingNoise
- `error`: stopLoadingNoise, playErrorNoise

**Ce s-a eliminat din masina:** 6 DOM actions (disableButtons, enableButtons, showLoadingMsg, hideLoadingMsg, showErrorMsg, hideErrorMsg) — React le inlocuieste cu rendering declarativ.

### Separarea responsabilitatilor

```
player-machine.ts  →  Definitia pura a masinii (testabila fara DOM/React)
       │
       v
player-actor.ts    →  Actor instance + .provide() cu audio side effects
       │                (loadingNoise, errorNoise via new Audio())
       v
App.tsx            →  useSelector(actor) → stare reactiva → UI declarativ
       │
       v
hooks/             →  Side effects (Media Session, Electron, theme, SW, Worker)
```

Masina (player-machine.ts) nu are side effects — e o definitie pura cu actiuni stub. `player-actor.ts` creeaza actorul si furnizeaza implementarile audio reale prin `.provide()`. Componentele React citesc starea cu `useSelector()` si rendereaza declarativ.

### React + XState integration

```tsx
// In App.tsx
const state = useSelector(actor, snap => snap.value);           // 'idle' | 'loading' | ...
const stationIndex = useSelector(actor, snap => snap.context.stationIndex);

// UI-ul e o functie de stare — fara classList.add/remove
<PlayerControls state={state} ... />      // disabled derivat din state === 'loading'
<StatusMessage status={status} />          // null cand idle/playing, mesaj cand loading/error
<PosterImage status={status} ... />        // artworkUrl derivat din getStatusDisplay()
```

### Audio management

`player-actor.ts` creeaza loading/error noise ca `new Audio()` programatic (nu mai depind de HTML elements):

```typescript
const loadingNoise = createAudioInstance('/sounds/loading-low.mp3');
const errorNoise = createAudioInstance('/sounds/error-low.mp3');
```

Stream-ul radio principal e un `<audio ref={playerRef}>` in `App.tsx`, conectat la actor prin `setPlayerAudio()`.

### Cloudinary integration

Posterul fiecarei statii e generat dinamic prin Cloudinary Image Transformations API:
```
https://res.cloudinary.com/adrianf/image/upload/
  c_scale,h_480,w_480/
  w_400,g_south_west,x_50,y_70,c_fit,
  l_text:arial_90:{text}/
  {imageId}
```

Doua imagini de baza:
- `nndti4oybhdzggf8epvh` - imaginea default (loading, error, idle)
- `rhz6yy4btbqicjqhsy7a` - imaginea live (playing)

Functia `getStatusDisplay()` din `media-session.ts` calculeaza URL-ul si e reutilizata atat in componenta `PosterImage` cat si in `updateMediaSession()`.

### TypeScript features folosite

- `strict: true` + `noUncheckedIndexedAccess: true`
- `jsx: "react-jsx"` (automatic JSX transform, fara import React)
- `as const satisfies readonly RadioStation[]` pe array-ul de statii
- Discriminated union `PlayerStatus` (state: 'idle' | 'loading' | 'playing' | 'error')
- `import type` pentru imports type-only
- `declare global` pentru Window.electronAPI augmentation
- Module resolution `"bundler"` (specific Vite)

### Tailwind CSS v4

CSS-ul foloseste Tailwind v4 native config (fara `tailwind.config.js`):

```css
@import "tailwindcss";

@theme {
  --color-Border: #eeebd8;
  --color-Brown: #543416;
  --color-Bg: #fffdef;
  --color-Red: #e95d5d;
  /* ... */
}

@media (prefers-color-scheme: dark) {
  :root {
    --color-Border: #3a3a30;
    --color-Brown: #F5EFB9;
    --color-Bg: #434238;
    /* ... */
  }
}
```

Plugin-ul `@tailwindcss/vite` proceseaza CSS-ul automat — detecteaza class-urile din toate fisierele din module graph (inclusiv .tsx).

## Comenzi

| Comanda | Ce face |
|---|---|
| `npm run dev` | Dev server cu HMR la `localhost:5173` |
| `npm run build` | `tsc` (type check) + `vite build` (bundle in `dist/`) |
| `npm run preview` | Serveste build-ul de productie local |
| `npm test` | Ruleaza toate 73 testele o data |
| `npm run test:watch` | Teste in mod watch (rerun la save) |

## Adaugarea unei statii noi

Editeaza `src/data/stations.ts`:

```typescript
export const STATIONS = [
  // ... statiile existente
  { name: 'Noua Statie', streamUrl: 'https://stream.example.com/live' },
] as const satisfies readonly RadioStation[];
```

Atat. Selectorul UI, media session si poster-ul se genereaza automat din acest array.

## Deployment

Vercel detecteaza Vite automat. Config-ul din `vercel.json`:

```json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist"
}
```

Cerinta: Node.js >= 18 (configureaza in Vercel dashboard daca e nevoie).
