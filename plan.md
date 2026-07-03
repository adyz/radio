# Plan de migrare: Vite + TypeScript + XState (fara React)

Branch de lucru: `migrate-vite-ts-xstate`

Planul anterior (stabilizare toolchain, build fail-fast, SW reload, flaky e2e)
este complet incheiat — vezi istoricul git al acestui fisier.

## Context si obiectiv

Aplicatia are deja o arhitectura buna: `radioCore.js` e logica pura cu dependency
injection, `stateMachine.js` e un tabel declarativ de efecte, iar `script.js` e
glue-ul DOM. Migram la tooling modern si type safety, apoi inlocuim mini state
machine-ul cu XState v5. Fara React deocamdata — UI-ul ramane DOM direct.

Ordinea fazelor conteaza: TypeScript inainte de XState, ca masina noua sa fie
scrisa typed de la inceput (XState v5 are inferenta excelenta prin `setup()`).

## Regula de aur: e2e-ul este dovada

Suita e2e (`e2e/radio.spec.js`, 35 de teste user-level — roluri, text vizibil,
zero detalii de implementare) NU se modifica in nicio faza. Ea este dovada ca
refactorizarea nu a stricat nimic: daca la finalul unei faze suita nu trece
integral, faza nu e gata. Orice tentatie de a "adapta" un test e2e ca sa treaca
inseamna ca am schimbat comportamentul — deci un bug de migrare, nu un test vechi.
Exceptii admise (infrastructura, nu logica de test): config-ul de webServer din
`playwright.config.js` (live-server -> vite) si calea de pe disc a fixture-ului
`test-tone.mp3` folosit de `route.fulfill` (mutat in `src/public/sounds/` odata
cu restul assets-urilor — nicio asertiune si niciun flow modificat).

## Alti invarianti (valabili in fiecare faza)

- Comportamentul aplicatiei nu se schimba deloc: aceleasi stari, aceleasi sunete,
  acelasi MediaSession, acelasi offline recovery (watchdog + backoff fara limita).
- Constantele raman: `MAX_RETRIES`, `LOADING_TIMEOUT_MS`, `RECOVERY_DELAY_MS`,
  `RECOVERY_DELAY_MAX_MS`, `WATCHDOG_INTERVAL_MS`, `WATCHDOG_STALL_TICKS`.
- Deploy-ul Vercel ramane static: build output servit ca fisiere, `sw.js` la root
  cu `Cache-Control: no-cache`.
- Fiecare faza = un PR separat, CI verde (typecheck + unit + build + e2e)
  inainte de merge.

## Faza 1: Vite ca toolchain (inlocuieste build.mjs + live-server + tailwind CLI) [gata]

Obiectiv: un singur tool pentru dev server, bundling, minificare si Tailwind.

Abateri fata de planul initial, decise la implementare:
- Output-ul e in `dist/`, conform planului initial. O prima tentativa de a-l
  pastra in `public/` (prudenta fata de vercel.json#routes) a picat la deploy:
  odata ce exista vite.config, Vercel auto-detecteaza framework-ul Vite si
  serveste output directory-ul standard (`dist/`), ignorand modelul legacy cu
  `routes` spre `/public/$1`. Fix: `routes` scos din vercel.json (header-ele
  raman), fara `outputDirectory` explicit — default-ul preset-ului Vite e dist.
- Bundle-ul de intrare iese `js/index.js` (Rollup il numeste dupa `index.html`),
  nu `js/script.js` — `APP_SHELL` din sw.js actualizat corespunzator; numele
  ramane stabil si dupa fazele urmatoare.

- Instalam `vite` si `@tailwindcss/vite` (Tailwind v4 e deja in dependencies).
- Config `vite.config.js` (devine `.ts` in Faza 2):
  - `root: 'src'`, entry `src/index.html`.
  - Output: trecem pe `dist/` la root si NU mai comitem build-ul in git
    (azi `public/` cu artefacte de build e tracked). Actualizam `vercel.json`
    (`dest: /dist/$1`) si `.gitignore`.
  - Nume de fisiere STABILE, fara hash: `entryFileNames: 'js/[name].js'`,
    `assetFileNames` fara hash. Motiv: `sw.js` precache-uieste cai fixe
    (`./js/script.js` etc.) si e scris de mana; strategia lui e network-first,
    deci nu avem nevoie de hash pentru cache busting.
  - Plugin mic custom pe `transformIndexHtml` care inlineaza CSS-ul rezultat in
    `<style>` (pastram optimizarea existenta din build.mjs — zero render-blocking).
- Assets statice (sounds, images, downloads, `manifest.json`, `sw.js`) se muta in
  `src/public/` (publicDir-ul Vite), copiate verbatim in output. `sw.js` ramane
  in afara bundle-ului, la root-ul output-ului.
- `keepAlive.js`: ramane worker separat cu cale stabila — fie in publicDir, fie
  `new Worker(new URL('./keepAlive.js', import.meta.url), { type: 'module' })`.
- Actualizam `APP_SHELL` din `sw.js` la noua lista de fisiere emise si facem bump
  la `APP_CACHE_NAME` (`radio-app-v2`).
- Scripts npm: `dev: vite`, `build: vite build`, `preview: vite preview`,
  `start` ramane pentru serving local al build-ului. Dispar `tailwind`, `watch`,
  `dev` cu `concurrently`; scoatem din dependencies `live-server`, `http-server`
  (daca `start` trece pe `vite preview`), `cpx`, `html-minifier-terser`,
  `terser`, `fs-extra`, `concurrently`. Stergem `build.mjs`.
- Playwright `webServer`: `vite --port 3210 --host 127.0.0.1` (acelasi baseURL).
  De verificat ca SW se inregistreaza corect pe dev server; daca nu, rulam e2e
  pe `vite preview` peste build — testele raman neatinse in ambele variante.
- Terser `pure_funcs` pentru `console.log` are echivalent: `esbuild.pure` sau
  `build.minify: 'terser'` cu aceeasi optiune — pastram stripping-ul in prod.

Fisiere: `vite.config.js`, `package.json`, `vercel.json`, `.gitignore`,
`src/sw.js`, `src/index.html` (referinte daca e nevoie), `playwright.config.js`
(doar webServer), stergem `build.mjs`, mutam assets in `src/public/`.

Verificari (efectuate):
- `npm run build` produce `dist/` cu structura asteptata: CSS inline in html
  (zero link-uri stylesheet), `js/index.js` + `js/keepAlive.js`, sw.js la root,
  sounds/, images/, downloads/, manifest.json; console.log eliminat din bundle.
- `npm test` 53/53; `npm run test:e2e` 35/35 fara nicio modificare de logica
  de test. Atentie la serverele orfane pe portul 3210: `reuseExistingServer`
  poate agata un server vechi si testeaza altceva (s-a intamplat la prima rulare
  — un live-server ramas de la o rulare Playwright anterioara).
- Smoke automat pe `vite preview` (build de productie): titlu, CSS aplicat,
  selector cu 19 posturi, playback pe stream mock, SW activ, toate resursele
  cheie 200, zero erori JS in pagina.
- Ramas pentru PR: deploy preview pe Vercel (routes + headers) si smoke
  MediaSession pe device real.

## Faza 2: TypeScript

Obiectiv: type safety pe contractul core <-> DOM, fara nicio schimbare de logica.

- `tsconfig.json` cu `strict: true`, `noEmit` (Vite face transpilarea, `tsc` doar
  verifica). Instalam `typescript`.
- Redenumiri 1:1, fara refactor de logica:
  - `stateMachine.js` -> `stateMachine.ts` (generic pe tipul starilor si al fx).
  - `radioCore.js` -> `radioCore.ts`.
  - `script.js` -> `script.ts` (doar adnotari minime; spargerea in module e Faza 3).
  - `radioCore.test.js` -> `radioCore.test.ts`.
- Tipuri centrale (exportate din `radioCore.ts` sau un `types.ts`):
  - `type RadioState = 'idle' | 'loading' | 'playing' | 'paused' | 'retrying' | 'error' | 'recovering'`
  - `interface RadioDeps { ... }` — cele ~20 de functii injectate, cu semnaturi
    exacte (aici e cel mai mare castig: contractul devine verificat de compilator).
  - `type RadioCore = ReturnType<typeof createRadioCore>`.
- Script npm `typecheck: tsc --noEmit` + pas nou in CI (inainte de unit tests),
  inclus in `write-ci-summary.mjs` si in gate-ul final de fail.
- Actualizam `vitest.config` coverage include la `.ts`.

Fisiere: `tsconfig.json`, `package.json`, redenumirile din `src/js/`,
`.github/workflows/ci.yml`, `scripts/write-ci-summary.mjs`, `vitest.config.js`.

Verificari: `npm run typecheck` curat, `npm test` verde (aceleasi teste),
`npm run build` verde, e2e 23/23 neatins.

## Faza 3: modularizare script.ts

Obiectiv: spargem glue-ul DOM de 700+ linii in module cu responsabilitate unica.
Zero schimbare de comportament — doar mutare de cod si import/export.

- `src/js/main.ts` — entry point: DOM refs, `createRadioCore(deps)`, event
  listeners pe butoane/player/online, wiring intre module.
- `src/js/labels.ts` — `LABELS` (sursa unica pentru textele user-facing).
- `src/js/cloudinary.ts` — `cloudinaryImageUrl` + pre-cache imagini status.
- `src/js/soundEffects.ts` — `audioInstance`, preload/blob/warmUp, cache sounds.
- `src/js/mediaSession.ts` — `updateMediaSession`, `registerMediaSessionHandlers`,
  re-register pe play/playing, `clearSfxPositionState`, `reassertPlaybackState`.
  Modulul primeste `core` si labels ca dependinte, nu variabile globale.
- `src/js/serviceWorker.ts` — inregistrare, cleanup registrari vechi, logica de
  reload amanat (`requestServiceWorkerReload` / reload doar in `idle`).
- `src/js/stationSelector.ts` — selectorul custom (listbox: open/close, focus,
  keyboard, ARIA). Expune `onSelect(index)` ca callback.
- `src/js/storage.ts` — `getStoredStationIndex` / `saveLastIndex`.
- `src/js/theme.ts` — theme color pe prefers-color-scheme.
- Atentie la dependenta circulara `core <-> mediaSession` (azi rezolvata prin
  `let core = null`): o rezolvam explicit prin injectare (`init(core)`) — fara
  variabile globale mutabile.

Fisiere: cele de mai sus, stergem `script.ts` monolitic, `sw.js` APP_SHELL
actualizat daca lista de bundle-uri emise se schimba (+ bump `APP_CACHE_NAME`).

Verificari: e2e 23/23 neatins (testul real al fazei), typecheck, build, smoke
manual pe MediaSession (iOS/macOS daca se poate — e zona cea mai fragila).

## Faza 4: XState v5 in locul stateMachine + orchestrarii din radioCore

Obiectiv: tranzitii declarative si timere/race-uri rezolvate din constructie,
cu paritate 100% de comportament.

- Instalam `xstate` (fara `@xstate/react`).
- `src/js/radioMachine.ts` cu `setup()`:
  - Stari: `idle`, `loading`, `playing`, `paused`, `retrying`, `error`,
    `recovering` — aceleasi nume (log-urile si testele de paritate raman lizibile).
  - Context: `retryCount`, `recoveryCount`, `stationIndex`, `lastPauseTime`.
  - Events: `PLAY {index}`, `STOP`, `TOGGLE`, `PREV`, `NEXT`, `RESUME`,
    `PLAYER_PLAY`, `PLAYER_PAUSE`, `PLAYER_ERROR`, `ONLINE`.
  - Timerele devin `after`-delays cu functii de context:
    - loading timeout (`LOADING_TIMEOUT_MS`) in `loading` si `recovering`;
    - retry delay (3000ms) in `retrying`;
    - recovery backoff: delay calculat din `recoveryCount`
      (`min(RECOVERY_DELAY_MS * 2^min(n-1,6), RECOVERY_DELAY_MAX_MS)`), si cadenta
      fixa `RECOVERY_DELAY_MS` cand `isOnline()` e false.
  - `playerPlay()` devine promise actor invocat in `loading`/`recovering`:
    `onDone -> playing`, `onError -> retrying/error` (cu guard pe AbortError).
    Iesirea din stare anuleaza actorul — inlocuieste complet mecanismul `playId`
    de invalidare manuala.
  - Watchdog-ul devine callback actor invocat doar in starea `playing` (interval
    pe `playerCurrentTime`, trimite `STALLED` dupa `WATCHDOG_STALL_TICKS`).
    Iesirea din `playing` il opreste automat.
- Efectele UI (butoane, sunete, mesaje, MediaSession) raman tabelul `STATE_FX`,
  aplicat dintr-un `actor.subscribe()` — pastram injectarea `deps` ca nucleul sa
  ramana testabil fara browser. `radioCore.ts` devine un adaptor subtire:
  acelasi API public (`playRadio`, `stopRadio`, `togglePlayPause`, `onPlayerPause`
  etc.) tradus in events -> `main.ts` si celelalte module nu se ating.
- Capcane cunoscute de tratat explicit (comportament calit in productie):
  - ordinea `setState('loading')` INAINTE de `playerPause()` (nativul 'pause' e
    ignorat in loading/retrying — vezi comentariul din radioCore si logica din
    mediaSession/main);
  - resume dupa pauza lunga (>2000ms din `lastPauseTime`) => restart complet;
  - `recovering` nu porneste loading sound si pastreaza imaginea de eroare
    (semantica 'keep' din STATE_FX);
  - eroare la resume: `handleResumeError` pastreaza starea `paused`.
- Teste: portam `radioCore.test.ts` pastrand asertiunile de comportament
  (acelasi scenariu -> aceeasi secventa de stari si apeluri deps). Pentru fake
  timers folosim clock-ul injectabil XState (`SimulatedClock` la `createActor`)
  in loc de `vi.useFakeTimers` unde e nevoie.
- La final stergem `stateMachine.ts` si logica de timere/playId din `radioCore.ts`.

Fisiere: `src/js/radioMachine.ts`, `src/js/radioCore.ts` (adaptor),
`src/js/radioCore.test.ts` (portat), stergem `src/js/stateMachine.ts`,
`vitest.config` coverage include `radioMachine.ts`.

Verificari:
- Unit tests portate verzi + coverage comparabil pe noul modul.
- E2E 23/23, NEMODIFICAT — criteriul principal de paritate al intregii faze.
- Checklist manual de paritate: play/stop/pause/resume, prev/next, schimbare
  statie in timpul loading-ului, offline la pornire, offline in timpul redarii
  (watchdog), revenire online (event + backoff), resume dupa pauza lunga,
  lock screen prev/next/pause pe telefon.
- Optional: masina vizualizata in Stately editor, link atasat la PR.

## Faza 5: curatenie si documentare

Obiectiv: repo-ul reflecta noua arhitectura.

- README actualizat: comenzi (`dev`, `build`, `preview`, `typecheck`), arhitectura
  (machine -> adaptor -> module DOM), diagrama starilor (link Stately sau ASCII).
- Stergem `_unused_svgs/` daca tot nu se folosesc si `public/` vechi din git.
- `tailwind.config.js` — eliminat daca v4 + plugin Vite nu-l mai cere.
- Verificare finala: CI verde cap-coada, deploy Vercel de productie, smoke pe
  device real.

## Estimare si riscuri

- Faza 1 e cea mai riscanta operational (build/deploy/SW) — de facut cu deploy
  preview si test offline atent. Fazele 2-3 sunt mecanice. Faza 4 e cea mai mare
  ca efort: rescrie partea cea mai testata a aplicatiei; paritatea e garantata de
  testele unit portate + e2e neatins, nu de review vizual.
- Ordine stricta: 1 -> 2 -> 3 -> 4 -> 5. Nu incepem o faza cu precedenta rosie.

## Definition of done

- `npm run typecheck`, `npm test`, `npm run build`, `npm run test:e2e` — toate
  verzi in CI, cu suita e2e identica cu cea de dinainte de migrare.
- Deploy Vercel functional (inclusiv offline/PWA) din `dist/`.
- Zero JS netipizat in `src/js/`; `build.mjs` si `stateMachine.ts` eliminate.
- Comportament identic confirmat pe checklist-ul manual de paritate.
