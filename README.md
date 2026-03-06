# Coji Radio Player 🔴🇷🇴

PWA de radio românesc, vanilla JS, fără framework.

Deployed la [coji.ro](https://coji.ro).

---

## Arhitectură

```
index.html          ← UI (butoane, poster, selector)
  └─ script.js      ← DOM glue: event listeners, MediaSession, Cloudinary images
       └─ radioCore.js   ← Logică pură (zero DOM), testabilă izolat
            └─ stateMachine.js  ← Mașină de stare generică
```

**Principiu:** `radioCore.js` nu importă nimic din browser. Toate interacțiunile (audio, DOM, timere) vin prin obiectul `deps` — dependency injection manual. Asta permite testarea unitară fără browser real.

---

## Mașina de stare

7 stări, fiecare cu side-effects declarative într-un tabel (`STATE_FX`):

```
                ┌─────────────────────────────────────┐
                │              idle                    │
                │  ▶ play button │ no sounds/messages  │
                └───────┬─────────────────▲───────────┘
                   play │                 │ stop
                        ▼                 │
                ┌───────────────┐         │
                │   loading     │─────────┤
                │  ■ stop btn   │  timeout│
                │  🔊 loading   │  or     │
                │  💬 "Se în…"  │  stop   │
                └──┬─────┬──────┘         │
          success  │     │ fail           │
                   │     ▼                │
                   │  ┌──────────┐        │
                   │  │ retrying │ (max 1)│
                   │  │ 🔊 keeps │        │
                   │  └────┬─────┘        │
                   │       │ fail again   │
                   ▼       ▼              │
          ┌──────────┐  ┌─────────┐       │
          │ playing  │  │  error  │───────┤
          │ ❚❚ pause │  │ ■ stop  │ stop  │
          │ 🔴 live  │  │ 🔊 error│       │
          └────┬──▲──┘  │ ❌ msg  │       │
         pause │  │     └────┬────┘       │
               ▼  │ resume   │ auto       │
          ┌───────┘─┐        ▼            │
          │ paused  │  ┌────────────┐     │
          │ ▶ play  │  │ recovering │─────┘
          └─────────┘  │ 🔊 keeps   │ stop
                       │ ❌ keeps   │
                       └─────┬──────┘
                             │ success
                             ▼
                          playing
```

### Tabelul de side-effects (`STATE_FX`)

| Stare | Buton | Loading sound | Error sound | Loading msg | Error msg |
|---|---|---|---|---|---|
| `idle` | ▶ play | stop | stop | hide | hide |
| `loading` | ■ stop | **play** | stop | **show** | hide |
| `playing` | ❚❚ pause | stop | stop | hide | hide |
| `paused` | ▶ play | stop | stop | hide | hide |
| `retrying` | ■ stop | **keep** | stop | hide | hide |
| `error` | ■ stop | stop | **play** | hide | **show** |
| `recovering` | ■ stop | stop | **keep** | hide | **show** |

`keep` = nu opri/porni sunetul, lasă-l cum e. Tranziția `error → recovering` nu re-pornește sunetul de eroare — continuă neschimbat.

---

## Teste

### Unit tests — `radioCore.test.js` (33 teste, Vitest)

Testează logica pură din `radioCore.js` **fără browser**. Toate dependențele (player, timere, DOM) sunt mock-uite manual prin `makeDeps()`.

```bash
npm test          # vitest run
```

| Grup | Ce testează | Exemple |
|---|---|---|
| **side-effects per state** | Fiecare stare produce exact side-effects-urile din tabel | `idle: play button, no sounds, no messages` |
| **playRadio — happy path** | `idle → loading → playing` | Verifică: src setat, playerPlay apelat, stare finală `playing` |
| **playRadio — error + retry** | `loading → retrying → error` | Retry după 3s, error după `MAX_RETRIES` (1), recovery programat |
| **pause / resume** | `playing ↔ paused` | `onPlayerPause`, `onPlayerPlay`, ignoră pause în alte stări |
| **stopRadio** | Oprește din orice stare | Timere anulate, `playId` incrementat, stare `idle` |
| **onPlayButtonClick** | Pornește din `idle`, `error`, `paused` | Nu face nimic din `loading`, `playing` |
| **prevRadio / nextRadio** | Navigare circulară | `next` din ultima → prima, `prev` din prima → ultima |
| **loading timeout** | Timeout după `LOADING_TIMEOUT_MS` (6s) | Dacă stream-ul nu pornește → retry → error |
| **rapid station switching** | Doar ultimul `playRadio` câștigă | Apeluri rapide: doar ultimul `playId` e valid |
| **retrying keeps loading sound** | `keep` din `STATE_FX` | La `loading → retrying`, sunetul de loading continuă |
| **togglePlayPause** | Un singur buton play/pause | Din `idle` pornește, din `playing` pauzează |
| **restart after long pause** | Pauză > 2s → restart stream | Stream-urile radio nu bufferează, re-play după pauză lungă |

### E2E tests — `e2e/radio.spec.js` (17 teste, Playwright)

Testează aplicația completă în Chromium real. Stream-urile radio sunt interceptate și servite local (`test-tone.mp3`).

```bash
npm run test:e2e  # playwright test
```

| Grup | Test | Ce verifică |
|---|---|---|
| **Page load** | page loads with correct title and idle state | Title, play button vizibil, pause/stop ascunse |
| | all radio station buttons are rendered in selector | 18 butoane în dropdown |
| **Play/Pause/Stop** | clicking play starts loading, then plays | `loading → playing`, poster se schimbă |
| | clicking stop returns to idle | Stop → play button revine |
| **Station switching** | clicking next changes station | Poster se schimbă la stație diferită |
| | clicking prev wraps to last station from first | Prev din Kiss FM → Vanilla Radio Fresh |
| **Selector UI** | selecting a station from dropdown starts playing | Click pe Europa FM → loading/playing |
| | clicking outside closes the selector | Click pe body → dropdown se închide |
| **Error state** | shows error state when stream fails | Stream abortat → error msg vizibil + stop button |
| **Persistence** | saves and restores last played station | localStorage `lastRadioIndex` supraviețuiește reload |
| **Loading msg** | loading message appears during stream connection | Text "Se încarcă... Kiss FM" vizibil |
| **Accessibility** | all control buttons have aria-labels | 6 butoane cu `aria-label` |
| | page has a main landmark | `<main>` prezent |
| **Offline — imagini** | all 3 status images are pre-cached on page load | Cache API conține idle + loading + error |
| | error and idle images render offline via SW cache | Offline → error poster loaded (`naturalWidth > 0`) |
| **Offline — sunete** | error sound plays offline from preloaded blob | Offline → error → `errorNoise.src` = `blob:`, nu e paused |
| | loading sound plays from preloaded blob | Stream blocat → loading → `loadingNoise.src` = `blob:` |

### Cum se leagă

```
                    ┌─────────────────────────┐
                    │   stateMachine.js        │  Generică, zero cunoștințe radio
                    └────────────▲─────────────┘
                                 │ import
                    ┌────────────┴─────────────┐
                    │   radioCore.js            │  Logică radio pură
                    │   (deps = mock objects)   │  ← Unit tests (Vitest)
                    └────────────▲─────────────┘
                                 │ import
                    ┌────────────┴─────────────┐
                    │   script.js               │  DOM, audio, MediaSession
                    │   (deps = real browser)   │
                    └────────────▲─────────────┘
                                 │ served by
                    ┌────────────┴─────────────┐
                    │   index.html + sw.js      │  ← E2E tests (Playwright)
                    │   (Chromium real)          │
                    └──────────────────────────┘
```

- **Unit tests** — testează `radioCore.js` izolat, fără browser, cu mock-uri. Rapide (~200ms). Verifică tranzițiile, side-effects, edge cases (timeout, retry, rapid switching).
- **E2E tests** — testează tot stack-ul în Chromium. Stream-uri interceptate cu `route.fulfill()`, Cloudinary mock-uit cu 1×1 PNG. Verifică UI real, Service Worker, Cache API, blob preload, localStorage.

---

## Dev

```bash
npm run dev       # live-server + tailwind watch
npm test          # unit tests (vitest)
npm run test:e2e  # e2e tests (playwright, pornește singur serverul)
npm run build     # build → public/
```
