# Documentatie tehnica

## Stack tehnologic

| Tehnologie | Versiune | Rol |
|---|---|---|
| TypeScript | 5.7+ | Limbaj principal, `strict: true` |
| Vite | 6 | Build tool, dev server, HMR |
| Tailwind CSS | 4 | Styling (via `@tailwindcss/vite` plugin) |
| XState | 5 | State machine pentru player |
| Vitest | 4 | Test runner (70 teste) |
| jsdom | 28 | DOM environment pentru teste |

## Structura proiectului

```
radio/
  index.html                     # Entry point HTML (root, cerinta Vite)
  vite.config.ts                 # Vite + Tailwind plugin + Vitest config
  tsconfig.json                  # TypeScript strict config
  package.json                   # Scripts si dependente
  vercel.json                    # Vercel deployment config

  public/                        # Static assets (copiate direct in dist/)
    manifest.json                # PWA manifest
    sw.js                        # Service Worker (placeholder)
    images/                      # Favicon, logo, PWA icons
    sounds/                      # MP3-uri pentru loading/error feedback

  src/
    main.ts                      # Entry point: imports CSS, init modules, event wiring
    css/app.css                  # Tailwind v4 cu @theme (custom colors, dark mode)

    data/
      stations.ts                # Array-ul de statii radio (as const satisfies)

    types/
      index.ts                   # PlayerStatus, PlayerElements, AudioInstance
      global.d.ts                # Window.electronAPI augmentation

    lib/
      player-machine.ts          # XState state machine definition
      player.ts                  # Actor instance, side effects, subscribe
      audio.ts                   # createAudioInstance() factory
      media-session.ts           # Media Session API wrapper
      cloudinary.ts              # Cloudinary poster URL builder
      selector.ts                # Custom dropdown UI
      theme.ts                   # Dark/light theme-color meta tag
      dom.ts                     # getElement<T>() helper
      electron.ts                # Electron API bridge (conditional)

    workers/
      keep-alive.ts              # Web Worker: postMessage every 5s

    __tests__/                   # 7 fisiere de test, 70 asertii
      player-machine.test.ts     # Tranzitii state machine (21 teste)
      player-effects.test.ts     # Side effects: loading/error noise (14 teste)
      audio.test.ts              # AudioInstance play/stop (8 teste)
      media-session.test.ts      # Titlu, poster, metadata (11 teste)
      cloudinary.test.ts         # URL generation (6 teste)
      stations.test.ts           # Validare date statii (7 teste)
      dom.test.ts                # DOM helper (3 teste)
```

## Arhitectura

### State machine (XState v5)

Player-ul e controlat de o state machine cu 4 stari:

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

**Entry actions per stare:**
- `loading`: stopErrorNoise, playLoadingNoise, disableButtons, showLoadingMsg, hideErrorMsg, loadStream
- `playing`: stopLoadingNoise, enableButtons, hideLoadingMsg, hideErrorMsg
- `error`: stopLoadingNoise, playErrorNoise, enableButtons, hideLoadingMsg, showErrorMsg

**Subscribe:** Media session + document title + poster image se updateaza prin `actor.subscribe()` (nu prin entry actions), pentru ca snapshot-ul e settlat la momentul callback-ului.

### Separarea responsabilitatilor

```
player-machine.ts  →  Definitia pura a masinii (testabila fara DOM)
       │
       v
player.ts          →  Actor instance + .provide() cu side effects reale
       │                + actor.subscribe() pentru media session
       v
main.ts            →  DOM init, event listeners, wire-up
```

Mașina (player-machine.ts) nu are side effects - e o definitie pura cu actiuni stub. `player.ts` creeaza actorul si furnizeaza implementarile reale prin `.provide()`. Asta permite testarea masinii fara DOM.

### Audio management

`createAudioInstance()` in `audio.ts` wraps un `HTMLAudioElement` intr-un obiect cu `play()` si `stop()`. Guard-ul intern `isPlaying` previne double-play si double-stop.

Trei instante audio:
- **player** - stream-ul radio principal
- **loadingNoise** - sunet de background in timpul loading-ului
- **errorNoise** - sunet la eroare

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

### TypeScript features folosite

- `strict: true` + `noUncheckedIndexedAccess: true`
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

Plugin-ul `@tailwindcss/vite` proceseaza CSS-ul automat - detecteaza class-urile din toate fisierele din module graph.

## Comenzi

| Comanda | Ce face |
|---|---|
| `npm run dev` | Dev server cu HMR la `localhost:5173` |
| `npm run build` | `tsc` (type check) + `vite build` (bundle in `dist/`) |
| `npm run preview` | Serveste build-ul de productie local |
| `npm test` | Ruleaza toate 70 testele o data |
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
