# Coji Radio Player 🔴🇷🇴

PWA de radio românesc, vanilla JS, fără framework.

Deployed la [coji.ro](https://coji.ro).

---

## Arhitectură

TypeScript strict + Vite + XState v5. Stratul DOM e spart în module cu responsabilitate unică; logica trăiește într-o mașină de stări declarativă.

```
index.html               ← UI (butoane, poster, selector)
  └─ main.ts             ← entry point: doar wiring (deps + event listeners)
       ├─ dom.ts              ← referințele DOM partajate (el<T> aruncă la id lipsă)
       ├─ labels.ts           ← textele user-facing (sursă unică)
       ├─ storage.ts          ← persistența ultimului post
       ├─ cloudinary.ts       ← imagini status + pre-cache offline
       ├─ theme.ts            ← theme color pe prefers-color-scheme
       ├─ soundEffects.ts     ← audioInstance: blob preload, warmUp, ensure
       ├─ mediaSession.ts     ← Now Playing + re-înregistrare handlers (iOS)
       ├─ serviceWorker.ts    ← înregistrare + reload amânat la idle
       ├─ stationSelector.ts  ← listbox accesibil (focus, keyboard, ARIA)
       └─ radioCore.ts        ← adaptor subțire: API imperativ → events
            └─ radioMachine.ts     ← mașina XState v5 (logică pură, zero DOM)
```

**Principiu:** `radioMachine.ts` nu importă nimic din browser. Toate interacțiunile (audio, DOM, timere de interval) vin prin obiectul `deps` (interfața `RadioDeps`, verificată de compilator) — dependency injection. Asta permite testarea unitară fără browser real, cu un `SimulatedClock` injectat pentru delay-uri.

---

## Mașina de stare

XState v5, 7 stări. Tot ce era orchestrare manuală e acum declarativ: timerii sunt `after`-delays (ieșirea din stare le anulează), `player.play()` e promise actor invocat (un rezultat întârziat după ieșirea din stare e aruncat prin construcție — fostul mecanism `playId`), iar watchdog-ul și supervizorul de sunete sunt callback actors care trăiesc exact cât stările lor. Side-effects-urile rămân un tabel declarativ (`STATE_FX`), aplicat ca entry action la fiecare intrare în stare.

> 🔍 **Vizualizare:** `npm run dev` + `http://localhost:5173/?inspect` deschide Stately Inspector cu diagrama LIVE a mașinii (tranziții/evenimente în timp real). Pentru diagrama statică, lipește `src/js/radioMachine.ts` în [stately.ai/editor](https://stately.ai/editor).

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
                   │  │ 🔊 loading│        │
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
| `retrying` | ■ stop | **play** | stop | hide | hide |
| `error` | ■ stop | stop | **play** | hide | **show** |
| `recovering` | ■ stop | stop | **keep** | hide | **show** |

`keep` = nu opri/porni sunetul, lasă-l cum e. Tranziția `error → recovering` nu re-pornește sunetul de eroare — continuă neschimbat. `retrying` pornește explicit sunetul de loading (`play`, nu `keep`): un retry poate veni și dintr-un stall de watchdog în timpul redării, unde niciun sunet nu era activ — iar regula produsului e că **odată ce userul a dat play, ceva trebuie să se audă mereu** (stream, loading sau eroare; liniște doar în idle/paused).

---

## Recovery și offline

Problema clasică pe net intermitent: stream-ul moare **fără niciun eveniment** (`error`/`stalled` nu se emit, mai ales pe HLS) și aplicația rămâne blocată — fie „cântă" liniște, fie stă în error pentru totdeauna. Soluția are patru piese, toate în `radioMachine.ts`:

### 1. Watchdog pe progresul redării

Singurul semnal de încredere e progresul efectiv: cât timp starea e `playing`, `player.currentTime` trebuie să avanseze. Un callback actor invocat doar în `playing` (`WATCHDOG_INTERVAL_MS` = 2s) compară valoarea; după `WATCHDOG_STALL_TICKS` (3) tick-uri înghețate consecutive (≈6s) → evenimentul `STALLED` → ciclul normal de retry/recovery. Zero falsuri pozitive pe HLS (currentTime avansează din buffer și între fetch-uri de segmente).

> De ce nu evenimentul `stalled`? Browserele îl emit **și în timpul redării normale de HLS** (pauzele dintre segmente arată ca „stalled"), ceea ce producea flash-uri false de „Se încarcă..."; iar la înghețuri reale de multe ori nu se emite deloc. A fost eliminat complet.

### 2. Recovery-ul nu renunță niciodată

Backoff exponențial: 10s → 20s → 40s → plafonat la `RECOVERY_DELAY_MAX_MS` (60s), la infinit. (Vechiul plafon de 30 de încercări lăsa aplicația moartă în error după ~5 minute de net căzut — fatal pe net intermitent, unde `navigator.onLine` rămâne `true` și evenimentul `online` nu vine niciodată.)

### 3. Offline explicit vs. „minciuna" lui `navigator.onLine`

- `onLine === false` e de încredere → re-verificare fixă la 10s, fără să atingă rețeaua și fără escaladare de backoff; evenimentul `online` declanșează retry instant.
- `onLine === true` poate fi fals pozitiv (WiFi fără internet) → se încearcă mereu; încercarea stream-ului e cea mai onestă probă de conectivitate.

### 4. Pauza userului vs. pauza sistemului + supervizorul de sunete

Când stream-ul moare, OS-ul (mai ales iOS) dă `pause` nativ pe element — indistinguibil de pauza userului fără context. `pauseRadio()` marchează intenția userului (`USER_PAUSE_INTENT_MS` = 2s); un pause **neașteptat + offline** intră pe pipeline-ul de retry/eroare (cu sunete), nu în `paused`. Un pause neașteptat online rămâne pauză (căști scoase, telefon, altă aplicație).

Iar pentru că sunetele de feedback pot fi refuzate de browser (autoplay/background) sau oprite de OS, un **supervizor** (callback actor în loading/retrying/error/recovering, tick la 2.5s) re-asertează sunetul cerut de stare via `ensure()` — la nesfârșit. Sunetul de eroare nu se oprește niciodată singur: doar recuperarea sau stop/pauză de la user îl tac.

### Known issue: playerul HLS nativ din Chromium spamează request-uri

Măsurat (iulie 2026, Chromium 145/149): un `<audio>` cu `.m3u8` atașat căruia îi tai rețeaua intră într-o buclă internă de retry pe playlist de **~4.700 req/s** (239k de request-uri în 60s), fără să emită vreun `error` și fără să se oprească singur. E comportament Chromium, nu al aplicației.

- Aplicația **îl conține** în scenariul offline: watchdog → error → `playerSetSrc('')` detașează playerul și oprește spin-ul (măsurat: 2 request-uri în 45s de offline).
- Net **lent** (nu tăiat) nu declanșează problema (măsurat: ~15 req/min la 30KB/s).
- Fereastră rămasă: la reconectare, rar (1 din 3 în măsurători), spin-ul poate porni **în timp ce redarea merge normal** — caz invizibil pentru watchdog. Decizie: fără workaround deocamdată; opțiuni documentate — detector de spin cu `PerformanceObserver` pe resurse, sau hls.js lazy-load pe non-Safari.

---

## Teste

### Unit tests — `radioCore.test.ts` (63 de teste, Vitest)

Testează mașina + adaptorul **fără browser**. Toate dependențele (player, sunete, DOM) sunt mock-uite manual prin `makeDeps()`, iar `after`-delay-urile mașinii rulează pe un `SimulatedClock` injectat (avansat manual cu `clock.increment(ms)`).

```bash
npm test          # vitest run
npm run test:coverage  # vitest run --coverage
```

Coverage-ul Vitest este configurat pentru modulele unit-testabile (`radioCore.ts` și `radioMachine.ts`). Codul DOM/browser din `main.ts` și module este acoperit prin Playwright e2e, nu prin raportul de unit coverage.

După `npm run test:coverage`, raportul HTML este generat în `coverage/index.html`, iar sumarul apare direct în terminal.

Notă: dacă sumarul text afișează numere de linii lângă un fișier care are `100% Lines`, acelea sunt linii unde există branches neacoperite, nu linii neexecutate. Raportul HTML le marchează cu `branch not covered`.

| Grup | Ce testează | Exemple |
|---|---|---|
| **side-effects per state** | Fiecare stare produce exact side-effects-urile din tabel | `idle: play button, no sounds, no messages` |
| **playRadio — happy path** | `idle → loading → playing` | Verifică: src setat, playerPlay apelat, stare finală `playing` |
| **playRadio — error + retry** | `loading → retrying → error` | Retry după 3s, error după `MAX_RETRIES` (1), recovery programat |
| **pause / resume** | `playing ↔ paused` | `onPlayerPause`, `onPlayerPlay`, ignoră pause în alte stări |
| **stopRadio** | Oprește din orice stare | `after`-delays anulate la ieșirea din stare, stare `idle` |
| **onPlayButtonClick** | Pornește din `idle`, `error`, `paused` | Nu face nimic din `loading`, `playing` |
| **prevRadio / nextRadio** | Navigare circulară | `next` din ultima → prima, `prev` din prima → ultima |
| **loading timeout** | Timeout după `LOADING_TIMEOUT_MS` (6s) | Dacă stream-ul nu pornește → retry → error |
| **rapid station switching** | Doar ultimul `playRadio` câștigă | Re-intrarea în `loading` aruncă actorul invocat anterior |
| **retrying plays loading sound** | `play` din `STATE_FX` | În `retrying` sunetul de loading e audibil, indiferent de unde s-a venit |
| **togglePlayPause** | Un singur buton play/pause | Din `idle` pornește, din `playing` pauzează |
| **restart after long pause** | Pauză > 2s → restart stream | Stream-urile radio nu bufferează, re-play după pauză lungă |
| **recovery backoff** | Backoff exponențial fără plafon | 10s → 20s → 40s → 60s cap, mereu o încercare programată; offline: re-check fix la 10s |
| **playback watchdog** | `currentTime` înghețat ≈6s → retry | Stall silențios detectat fără evenimente; progresul resetează numărătoarea; se oprește la pause/stop |
| **system pause vs user pause** | Pauza OS ≠ pauza userului | Pause neașteptat + offline → retry cu sunete; pauza userului rămâne pauză (și offline); intenția expiră după 2s |
| **sound supervisor** | Mereu un sunet audibil | `ensure()` re-asertat periodic; eroarea nu tace niciodată singură; play înainte de stop la schimbul de sunete |

### E2E tests — `e2e/radio.spec.js` (37 de teste, Playwright)

Testează aplicația completă în Chromium real. Stream-urile radio sunt interceptate și servite local (`test-tone.mp3`, plus un playlist HLS mock cu segmente `.ts` reale pentru stația FIP — Chromium redă `.m3u8` nativ).

**Principiu: testele văd ce vede utilizatorul.** Toate interacțiunile trec prin roluri accesibile (`getByRole`, helper-ul `ui()`), iar asertările se fac pe text vizibil, titlul paginii (numele stației + ⏳/🔴/❤️‍🩹) și starea butoanelor — niciodată pe id-uri, clase CSS sau stare internă. Excepțiile white-box (ex. versionarea cache-ului de sunete) sunt marcate și justificate în comentarii.

```bash
npm run test:e2e  # playwright test
```

| Grup | Test | Ce verifică |
|---|---|---|
| **Page load** | page loads with correct title and idle state | Title, play button vizibil, pause/stop ascunse |
| | all radio station buttons are rendered in selector | 19 butoane în dropdown (`STATION_COUNT`) |
| **Play/Pause/Stop** | clicking play starts playback | Pause vizibil, mesaj de loading ascuns, titlu 🔴 |
| | clicking stop returns to idle | Stop → play button revine |
| **Station switching** | clicking next changes station | Titlul arată noua stație (Europa FM) |
| | clicking prev wraps to last station from first | Prev din Kiss FM → FIP Radio France (ultima) |
| **HLS** | a transient stall on the HLS station does not interrupt playback | `stalled` sintetic în timpul redării FIP → fără flash de loading/error |
| | recovers by itself after the connection drops and comes back | Rețeaua cade → bufferul se scurge → îngheț silențios → watchdog → reconectare automată, fără click |
| **Selector UI** | selecting a station from dropdown starts playing | Click pe Europa FM → playing, titlul confirmă |
| | clicking outside closes the selector | Click pe body → dropdown se închide |
| **Error state** | shows error state when stream fails | Stream abortat → „Eroare la încărcarea…" vizibil + stop button |
| **Persistence** | saves and restores last played station | După reload, titlul arată stația restaurată |
| **Loading msg** | loading message appears during stream connection | Text „Se încarcă... Kiss FM" vizibil |
| **Accessibility** | all control buttons have aria-labels | 6 butoane cu `aria-label` |
| | page has a main landmark | `main` prezent (rol landmark) |
| **Offline — imagini** | all 3 status images are fetched on page load | Idle + loading + error descărcate pentru offline |
| | error and idle images render offline via SW cache | Offline → poster randat (`naturalWidth > 0`) |
| **Offline — sunete** | error sound plays while offline | Sunetul cântă, zero request-uri de rețea pentru sunete |
| | loading sound plays while the next station is still connecting | Sunetul de loading cântă instant, fără rețea |
| **Offline mid-playback** | going offline while playing keeps a sound on and recovers by itself | Pauza nativă a OS-ului la net căzut → retry/eroare audibile, NU `paused`; revine singur la net |
| | pausing on purpose stays paused — even offline | Pauza deliberată a userului e respectată: liniște, fără retry |

### Cum se leagă

```
                    ┌─────────────────────────┐
                    │   radioMachine.ts        │  Mașina XState v5 (logică pură)
                    └────────────▲─────────────┘
                                 │ import
                    ┌────────────┴─────────────┐
                    │   radioCore.ts            │  Adaptor: API imperativ → events
                    │   (deps = mock objects)   │  ← Unit tests (Vitest + SimulatedClock)
                    └────────────▲─────────────┘
                                 │ import
                    ┌────────────┴─────────────┐
                    │   main.ts + module        │  DOM, audio, MediaSession, SW
                    │   (deps = real browser)   │
                    └────────────▲─────────────┘
                                 │ served by
                    ┌────────────┴─────────────┐
                    │   index.html + sw.js      │  ← E2E tests (Playwright)
                    │   (Chromium real)          │
                    └──────────────────────────┘
```

- **Unit tests** — testează mașina + adaptorul izolat, fără browser, cu mock-uri. Rapide (~250ms). Verifică tranzițiile, side-effects, edge cases (timeout, retry, rapid switching, pauze de sistem).
- **E2E tests** — testează tot stack-ul în Chromium. Stream-uri interceptate cu `route.fulfill()`, Cloudinary mock-uit cu 1×1 PNG. Verifică UI real, Service Worker, Cache API, blob preload, localStorage.

---

## Dev

Node.js 20.19+ is required because the current Vitest/Vite toolchain depends on a Vite version that does not run correctly on older Node 18 builds. Use the committed `.nvmrc` before installing dependencies or running tests:

```bash
nvm install
nvm use
node --version  # should be v20.19.0 or newer
```

```bash
npm run dev       # vite dev server (include tailwind)
                  #   + http://localhost:5173/?inspect → Stately Inspector:
                  #     diagrama LIVE a masinii de stari, cu tranzitii/events
                  #     in timp real (doar dev; zero bytes in productie)
npm test          # unit tests (vitest)
npm run test:coverage  # unit coverage + raport HTML in coverage/index.html
npm run test:e2e  # e2e tests (playwright, pornește singur serverul)
npm run build     # build → dist/
```

## CI

GitHub Actions rulează pe pull request-uri și pe push în `main`. Workflow-ul verifică unit tests cu coverage, build-ul și testele e2e în Chromium.

La final, job-ul scrie un summary cu statusul fiecărui pas: câte unit/e2e tests au trecut, coverage-ul Vitest și detalii despre testele care au picat. Pe pull request-uri, același summary este postat și actualizat ca un comentariu sticky, similar cu mesajul Vercel. Fișierele generate pentru summary (`reports/`) și raportul local de coverage (`coverage/`) sunt artefacte temporare și sunt ignorate de git.
