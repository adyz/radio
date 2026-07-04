# Plan de migrare: Vite + TypeScript + XState (fara React)

Branch de lucru: `migrate-vite-ts-xstate`

Planul anterior (stabilizare toolchain, build fail-fast, SW reload, flaky e2e)
este complet incheiat — vezi istoricul git al acestui fisier.

STATUS FINAL (2026-07-03): Fazele 1, 2, 3, 4a, 5 — COMPLETE si in master.
Stack: Vite + TypeScript strict + module + XState v5 (+ Stately Inspector in
dev via /?inspect). Ramas: Faza 4b (redesign audioInstance + canal de feedback
cu tone in STATE_FX) — separat, cere re-validare pe device.

URMEAZA: Plan de refactor post-review (2026-07-04) — vezi sectiunea de la
finalul fisierului. Fazele R1-R6, pornite din review-ul multi-agent al
intervalului 3e36147..HEAD.

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

## Interludiu (inainte de Faza 2): fix "always audible" la offline [gata]

Bug raportat: pe mobil, cand pica reteaua in timpul redarii, sunetul de
loading/eroare uneori nu se aude, iar UI-ul arata "paused" desi userul nu a
dat pauza. Cauze gasite si fixate (branch `fix/always-audible-offline`):

1. Pauza nativa data de OS la moartea stream-ului era tratata ca pauza de la
   user -> starea 'paused' oprea watchdog-ul si nu programa nicio recuperare.
   Fix: pauseRadio() marcheaza intentia userului (USER_PAUSE_INTENT_MS);
   un pause neasteptat + offline intra pe pipeline-ul retry/error cu sunete.
   Pause neasteptat + online ramane 'paused' (casti scoase, telefon, alta
   aplicatie) — gap cunoscut: wifi fara internet + pause nativ.
2. Sunetele porneau o singura data, fara retry la reject (tipic in background).
   Fix: sound supervisor — interval (SOUND_SUPERVISOR_INTERVAL_MS) care
   re-aserteaza sunetul cerut de stare via ensure() cat timp starea e
   loading/retrying/error/recovering.
3. 'retrying' avea loading:'keep' -> venind din watchdog stall, 3s de tacere.
   Fix: loading:'play'.
4. RETRAS (branch `bump-cache-versions`): mute-ul erorii dupa 1 minut. Cerinta
   finala a userului: NICIODATA liniste cat timp intentia de play e activa —
   stream, loading sau eroare, la nesfarsit; liniste doar in idle/paused/stop.
   Sunetul de eroare ramane audibil pana la recuperare sau stop/pauza.
5. Ordinea efectelor la schimbarea sunetelor: play INAINTE de stop (scurta
   suprapunere) — golul de tacere dintre stop si play era exact locul unde
   iOS refuza play() in background/lock screen. (banuit vinovat pentru
   "eroarea nu se aude pe lock screen desi loading da")

Teste: 63 unit (incl. 'error sound stays audible indefinitely' si testul de
ordine play-inainte-de-stop), 37 e2e — cele 35 vechi neatinse si verzi.
Comportamentul e specificat executabil in describe-ul e2e
'Offline mid-playback — always audible'.

Nota pentru Faza 4 (XState): aceste comportamente (intentie pauza, supervisor,
ordinea play/stop) se porteaza ca events/guards/actori — testele raman dovada.

Diagnostic cache productie (2026-07-03): www.coji.ro verificat sanatos —
sw.js v2 servit cu no-cache, sunete byte-identice cu repo, referinte corecte.
SW-urile NU raman "pe viata": no-cache + reg.update() + skipWaiting/claim +
stergerea cache-urilor radio-* vechi la activate. Forcarea invalidarii la
useri = bump la cele 3 constante de versiune (facut: app-v3/images-v3/sounds-v2).

## Episodul handoff/carry (PR #41 — REVERTAT integral, decizia lui Adrian)

S-a construit si VERIFICAT PE IPHONE un mecanism care facea sunetul de eroare
audibil din prima pe lock screen (handoff cu stop amanat + "carry": elementul
de loading isi schimba src-ul la tonul de eroare). Revertat pentru ca
contrazice filozofia proiectului: state machine = precizie, fara sunete
suprapuse, fara coordonare event-driven estimata in stratul DOM.

Cunostinte castigate (valabile, de refolosit):
- iOS in background REFUZA orice pornire proaspata de element audio, dar
  PERMITE unui element care deja canta sa-si schimbe src si sa continue.
- Web Audio API a fost deja incercat si revertat istoric (69a58f2): iOS
  pierde sesiunea fara un <audio> activ. Elementele separate loading/error
  si re-inregistrarea handler-elor MediaSession (d798cc9) sunt deliberate.
- Evenimentul window 'offline' poate porni pipeline-ul instant (fara ~6s de
  watchdog) — idee buna, de reintrodus curat candva.
- Widget-ul Now Playing pe macOS ramane gol la eroare offline (3 fix-uri
  incercate si revertate) — limitare cunoscuta.

Directia agreata daca se reia: UN SINGUR element <audio> de feedback ("canal")
cu `tone: 'loading'|'error'|'none'` in STATE_FX — overlap imposibil prin
constructie, schimbarea de ton = swap de src pe elementul care deja canta
(exact continuarea permisa de iOS). De facut eventual in Faza 4 (XState),
cu re-validare completa pe device.
[DEPASIT 2026-07-04 — ideea "un singur element" a fost retrasa; vezi
CORECTIA DE DIRECTIE din sectiunea 4b: fara element partener nu exista
plasa "never trade audible for silent", iar golul de swap ramane fatal
pe iPhone blocat (a0aec46).]

## Faza 2: TypeScript [gata]

Obiectiv: type safety pe contractul core <-> DOM, fara nicio schimbare de logica.

Note de implementare (branch `faza2-typescript`):
- Importuri fara extensie (`./radioCore`) — compatibile si cu tsc si cu Vite.
- `script.ts` foloseste un helper `el<T>(id)` care arunca la id lipsa — markup-ul
  e al nostru, deci null-check-uri pe fiecare utilizare ar fi zgomot.
- `core` e declarat cu definite assignment (`let core!: RadioCore`) — e atribuit
  imediat sub declaratie, iar fereastra initiala e acoperita de guard-uri runtime.
- Testul care da `undefined` din `playerPlay()` pastreaza incalcarea de contract
  intentionat (cast explicit) — verifica robustetea runtime a lui resumePlayer.
- Typecheck rulat in CI inainte de unit tests, cu log in summary + gate final.

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

## Faza 3: modularizare script.ts [gata]

Obiectiv: spargem glue-ul DOM de 700+ linii in module cu responsabilitate unica.
Zero schimbare de comportament — doar mutare de cod si import/export.

Note de implementare (branch `faza3-modularizare`):
- In plus fata de planul initial: `src/js/dom.ts` (helper-ul el<T> + toate
  referintele DOM partajate) — mediaSession/selector au nevoie de aceleasi
  elemente ca main, iar importul dintr-un singur loc pastreaza comportamentul
  (lookup la load) fara parametri plimbati peste tot.
- `updateMediaSession` NU mai apeleaza maybeReloadForPendingServiceWorkerUpdate
  (dependenta mediaSession -> serviceWorker taiata): main compune cele doua in
  deps.updateMediaSession, in aceeasi ordine ca inainte.
- Ciclul core <-> mediaSession rezolvat prin initMediaSession (inainte de
  createRadioCore, pentru hasRestoredStation) + connectMediaSessionCore (dupa).
- Bundle-ul ramane un singur chunk `js/index.js` (importuri statice) — APP_SHELL
  din sw.js neschimbat, fara bump de cache.
- Verificat: typecheck curat, 63/63 unit, build identic ca structura, 37/37 e2e
  NEATINSE, smoke complet pe vite preview.

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

### 4a: masina + adaptorul [gata — branch `faza4-xstate`]

Implementat conform planului de mai jos. Note:
- `applyFx` e entry action parametrizata per stare (nu subscribe) — reenter
  (RESUME_FAILED, recheck offline) re-aplica fx exact ca vechiul setState.
- `beginErrorCycle` (increment recoveryCount + clear offlineRecheck) ruleaza
  pe TRANZITIILE spre error, nu pe entry — garanteaza ca RECOVERY_DELAY vede
  contextul incrementat. Recheck-ul offline e self-transition cu reenter +
  `offlineRecheck: true` (cadenta fixa, fara escaladare).
- pauseRadio/resumePlayer/toggle/onPlayButtonClick raman in adaptor (citesc
  playerIsPaused/getState live, ca inainte); restul devine events.
- deps.setTimeout/clearTimeout au DISPARUT din contract (after-delays traiesc
  in clock-ul actorului); testele injecteaza SimulatedClock impachetat cu
  vizibilitate pe delay-urile programate (clock.hasScheduled).
- CAPCANA gasita de e2e (nu de unit): browserul arunca "Illegal invocation"
  cand masina apeleaza deps.setInterval ca metoda — global timer functions
  cer this=window; fix: wrapper arrow in main.ts. Unit testele n-o puteau
  prinde (mock-uri); inca un argument pentru e2e-ul neatins ca dovada.
- Cost bundle: 16KB -> 60KB raw (5.7 -> 19.3KB gzip) — pretul xstate.
- Verificat: typecheck curat, 63/63 unit portate (SimulatedClock, playId ->
  asertiuni comportamentale), 37/37 e2e NEATINSE, coverage 99% pe masina,
  smoke complet pe vite preview.

### 4b: redesign audioInstance + canal de feedback [de facut]

Ramane separat (vezi sectiunea de mai jos "Redesign audioInstance") — cere
re-validare pe device (lock screen, prev/next, offline).

CERINTA EXPLICITA (Adrian, 2026-07-04): sunetul de eroare TREBUIE sa se auda
pe lock screen DIN PRIMA — nu doar dupa ce aplicatia a trecut o data prin
eroare cu ecranul deschis. Repro-ul de mai jos e deci un BUG de cerinta, nu
o limitare acceptata. PR #41 a demonstrat pe iPhone ca e realizabil (carry);
4b il reconstruieste curat si devine URMATOAREA FAZA dupa R4 (inaintea
R5/R6 — vezi ordinea actualizata in planul de refactor).

Repro observat pe iPhone (Adrian, 2026-07-04) — cazul exact pe care
mecanismul handoff/carry il rezolva:
- Flux OK: play din app, folosire normala, lock -> wifi off -> loading sound
  + imagine loading -> apoi eroare cu sunet -> wifi on -> revine singur.
- Caveat: play din app si LOCK IMEDIAT -> wifi off -> loading-ul se aude,
  dar la trecerea in error audio se opreste complet (liniste pe lock screen).
- Daca aplicatia a trecut O DATA prin eroare cu ecranul deschis (iOS a auzit
  efectiv elementul de eroare), ciclurile urmatoare din lock merg corect.
- Interpretare: warmUp-ul de o fractiune de secunda la gestul de play nu e
  suficient ca iOS sa "binecuvanteze" elementul de eroare daca lock-ul vine
  imediat; loading-ul merge pentru ca porneste chiar in call stack-ul
  gestului, cu aplicatia in fata. Supervisor-ul care reincearca la 2.5s e
  refuzat la nesfarsit din acelasi motiv (pornire proaspata in background).

CORECTIE DE DIRECTIE (2026-07-04, dupa recitirea istoricului cu Adrian):
NU "un singur element de feedback". Istoria branch-ului PR #41 arata de ce:
- a0aec46: play() doar INITIAZA redarea (decode/buffer async) — orice gol
  real de liniste pe iPhone blocat omoara sesiunea si play()-ul pendinte e
  refuzat. De aceea sunetul vechi trebuie sa cante PANA CAND cel nou e
  efectiv audibil ('playing') — deferred stop intre DOUA elemente.
- 31d684a: carry-ul (elementul care deja canta isi schimba src-ul pe tonul
  partenerului refuzat) e LAST RESORT, cu regula "never trade audible for
  silent": o singura tentativa, si daca si continuarea e refuzata, revine
  la sunetul propriu. Un element unic face din swap singura cale, fara
  plasa de siguranta — un swap esuat inseamna liniste totala.
- Handoff-ul feedback <-> player principal ramane oricum intre doua
  elemente; "un singur element" nu-l elimina.
Directia 4b devine: re-implementarea semanticii VERIFICATE PE DEVICE din
PR #41 (deferred stop + carry last-resort + reclaim + never-trade-audible-
for-silent), dar condusa din masina/reconciler — precisa si testabila unit,
nu coordonare event-driven ad-hoc in stratul DOM (motivul revertului a fost
CUM era scrisa, nu CA nu mergea).

Repro suplimentar (Adrian, 2026-07-04) — gestul irosit, diagnoza defectului
"isPlaying = intentie, nu realitate":
- play → lock → wifi off → loading porneste, apoi liniste la eroare (stiut).
- Deblocat cu aplicatia in fata: ecranul de eroare se vede, NIMIC nu se
  aude — deblocarea nu e gest in pagina, iar dupa moartea sesiunii iOS
  refuza si in foreground play()-urile programatice (supervisor).
- next/prev: ecranul ramane, tot fara sunet. Gestul userului e IROSIT:
  la click, isPlaying e adesea true (incercare programatica refuzata inca
  in zbor), asa ca warmUp() si play() fac early-return pe intentie si
  niciun element.play() nu ruleaza in call stack-ul gestului.
- stop + play: se aude — stop() reseteaza fortat intentia (gen++, src=''),
  deci play-ul urmator chiar executa element.play() inauntrul gestului.
Regula noua pentru reconciler: ORICE gest de user reconciliaza realitatea —
daca elementul cerut de stare nu canta EFECTIV (element.paused), play() se
executa atunci, in stack-ul gestului, indiferent de flag-ul de intentie.
Ideal si reconciliere pe visibilitychange la revenirea in aplicatie.

Criterii de acceptare R4b (pe iPhone, toate cu wifi off la momentul potrivit):
1. play → lock IMEDIAT → wifi off → eroarea se aude DIN PRIMA (carry).
2. In starea muta istorica: deblocare + next/prev → sunetul revine din
   gestul ala (reconcile-on-gesture).
3. stop + play continua sa mearga ca azi.
4. Fluxul normal (eroare auzita cu app deschisa, apoi lock) ramane intact.

Rezultat device-test (Adrian, 2026-07-04, PR #49): sunetul de eroare pe
lock screen MERGE. Observatie noua: IMAGINEA de eroare nu apare pe lock
screen offline — sistemul isi descarca singur artwork-ul (fetch in afara
paginii, ocoleste SW-ul si cache-ul), deci offline ramane fara imagine.
Aceeasi radacina ca widget-ul macOS gol (limitare documentata, 3 fix-uri
revertate in PR #41). Acceptat ca OK deocamdata. Idee neincercata, separat:
cand navigator.onLine e false, artwork ca data: URI (imagine embedata,
zero retea) — de verificat daca iOS o accepta in MediaMetadata.

### Planul initial (referinta)

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
- Redesign `audioInstance` (soundEffects.ts) — punctul cel mai slab actual:
  - `isPlaying` e INTENTIE, nu realitate (adevarul e in element: paused,
    rejected play); ensure() re-impaca periodic cele doua = eventual
    consistency. warmUp() se bazeaza pe curse cu playGeneration. Netestat
    direct, desi are cea mai delicata logica async din stratul DOM.
  - Modelul corect: instanta tine o singura stare de dorinta
    (`desired: 'playing' | 'stopped'`), elementul e singura sursa de realitate,
    si UN reconcile() le aliniaza — play/stop/ensure devin declansatoare.
    Testabil unit cu un element fals injectat.
  - Se leaga natural de ideea "canal de feedback": `tone: 'loading'|'error'|
    'none'` in STATE_FX + un singur element <audio> real (NU Web Audio — vezi
    episodul handoff si 69a58f2) — overlap imposibil prin constructie, iar
    schimbarea de ton = swap de src pe elementul care deja canta (continuarea
    permisa de iOS in background). Rezolva si lock screen-ul iOS, curat.
  - Orice schimbare aici cere re-validare completa pe device (lock screen,
    prev/next, offline) — zona cea mai empirica a aplicatiei.
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

## Faza 5: curatenie si documentare [gata]

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

---

# Plan de refactor post-review (2026-07-04)

Sursa: review multi-agent pe intervalul `3e36147..HEAD` (ultimele 2 zile) —
7 finderi independenti + verificare adversariala. 10 constatari confirmate:
6 de corectitudine (majoritatea pre-existente migrarii, una singura regresie),
4 de curatenie/eficienta. Migrarea in sine a iesit curata.

## Invarianti (identici cu migrarea)

- Suita e2e existenta NU se modifica; teste NOI se pot ADAUGA (ca la
  always-audible). E2e-ul vechi verde = dovada ca refactorul nu a stricat nimic.
- "Always audible" ramane lege: play apasat => mereu un sunet; liniste doar
  in idle/paused.
- Fiecare faza = un PR separat, CI verde (typecheck + unit + build + e2e)
  inainte de merge. Fazele care ating zona MediaSession/iOS cer smoke pe
  device real inainte de merge (lock screen: play/pause/prev/next, offline).
- Constantele de timing raman neschimbate.

## Ce NU facem in acest plan

- (Actualizat 2026-07-04) Faza 4b NU mai e amanata: cerinta explicita a lui
  Adrian — sunetul de eroare audibil pe lock screen DIN PRIMA — o face
  obligatorie. Intra in ordine imediat dupa R4, ca faza R4b (handoff/carry
  condus din masina, vezi CORECTIA DE DIRECTIE din sectiunea 4b). Cere
  re-validare completa pe device inainte de merge.
- NU consolidam cele 3 hook-uri de re-asertare din mediaSession.ts
  (play/playing, timeupdate, pause) — empirism iOS/macOS calit pe device
  (d798cc9, 2933d78, 5106a92). Le atingem doar prin predicate partajate (R2),
  fara sa schimbam timing-ul apelurilor.

STATUS (2026-07-04): R1 (PR #45), R2 (PR #46), R3 (PR #47) — MERGED.
R3 verificat pe device de Adrian inainte de merge. Urmeaza R4.

## Faza R1: curatenie mecanica — zero schimbare de comportament [gata]

Numai stersaturi si extrageri; bundle-ul si comportamentul identice.

- radioCore.ts: dispare `_isRetry` din playRadio si `isRetry` din event-ul
  PLAY; `resetAttemptCounters` devine `assign({ retryCount: 0, recoveryCount: 0 })`
  (ramura isRetry e cod mort — verificat prin grep: niciun apelant).
- radioCore.ts: sterge `_getRetryCount` (zero utilizari); unifica
  `resumeRadio`/`resumePlayer` sub un singur nume (`resumeRadio`); simplifica
  la `deps.playerPlay().catch(handleResumeError)` si sterge testul
  'resumeRadio handles playerPlay without a promise' + ramura defensiva
  non-promise (contrazice tipul `RadioDeps.playerPlay(): Promise<void>`).
- radioMachine.ts: exporta `isAbortError(error: unknown)` ca functie si
  foloseste-o in guard + radioCore (handleResumeError). soundEffects.ts o
  poate refolosi la randul lui (2 situri).
- radioMachine.ts: scarile de tranzitii duplicate devin constante numite:
  array-ul identic din `error.after.RECOVERY_DELAY` / `error.on.RETRY_FROM_ERROR`
  extras o singura data; scara {canRetry→retrying, altfel→error} (5 aparitii)
  extrasa intr-un helper `streamFailure(extraActions)`.
- mediaSession.ts: un singur helper `clearPositionState()` (feature-detectat)
  inlocuieste cele 5 try/catch inline pe setPositionState.
- stationSelector.ts: o functie `scrollOptionIntoView(index)` partajata
  intre focusOption si openSelector.

Verificare: typecheck, 63→~62 unit (unul sters), build, e2e integral neatins.

## Faza R2: sursa unica pentru clasificarea starilor [gata]

Clasificarea "ce e audibil / cum se raporteaza playbackState" exista azi in
4 liste de mana (main.ts:183, mediaSession.ts:44, :94, :105-106) care au
divergat deja o data (a667b7f).

- radioMachine.ts: exporta predicate derivate/adiacente STATE_FX:
  `isLoadingLike(s)` (loading|retrying|recovering), `isErrorLike(s)`
  (error|recovering), si un `playbackStateFor(s)` pentru mediaSession.
- Inlocuieste cele 4 situri pastrand comportamentul actual EXACT, inclusiv
  divergenta din main.ts:183 (omite 'error') — acolo pastram lista actuala
  printr-un predicat separat sau explicit, cu comentariu; decizia daca
  divergenta e bug sau intentie se ia in R3/R5, nu aici.
- Zero schimbare de comportament: doar mutare de adevar intr-un singur loc.

Verificare: typecheck, unit, e2e neatins. Diff-ul de bundle trebuie sa fie
doar renamings.

## Faza R3: resume si intentiile userului intra in masina [gata]

Cea mai valoroasa faza — inchide 2 bug-uri confirmate si goleste adaptorul.

- Event nou `RESUME` in radioMachine:
  - in `paused` + pausedTooLong → restart complet, DAR prin aceeasi logica
    ca PLAY (cu guard-ul isOnline → altfel direct error) — inchide regresia
    "resume offline dupa pauza lunga = 9s de loading in loc de fast-fail".
  - in `paused` altfel → incercare de play in masina (invoked `attemptPlay`
    intr-un sub-state/copil al lui paused cu fx identice cu paused; onDone →
    playing, onError non-abort → paused reenter). Inlocuieste complet
    resumePlayer + RESUME_FAILED din adaptor.
  - in `idle`/`error`/`recovering` → echivalent cu PLAY(selectedIndex) —
    inchide bug-ul "Play pe lock screen e no-op in error" si elimina
    asimetria cu butonul de pe ecran.
- Event nou `TOGGLE` in masina: `playing` → pauza (cu intentie marcata);
  `paused`/`idle`/`error`/`recovering` → ca RESUME; `loading`/`retrying` →
  STOP (decizie noua, aliniata cu handler-ul de pause de pe lock screen care
  deja face stop in aceste stari) — inchide bug-ul "toggle in loading
  reporneste redarea dupa ce userul a dat pauza". Test unit nou explicit.
- mediaSession.ts: handler-ul 'play' trimite RESUME; handler-ul 'pause'
  poate trimite un singur event (PAUSE_REQUESTED) cu politica stop-vs-pause
  mutata in masina — dispare inca o lista de stari din stratul DOM.
- radioCore.ts ramane adaptor pur de forwarding (playRadio/stopRadio/
  toggle/resume = un send fiecare); pauseRadio pastreaza marcarea intentiei.
- ATENTIE: fara stari RadioState noi vizibile in STATE_FX daca se poate
  (sub-state-ul de resume mosteneste fx de paused); log-urile de tranzitie
  raman lizibile.

Verificare: unit noi pentru fiecare ramura RESUME/TOGGLE; e2e vechi neatins;
e2e NOU pentru lock-screen-play-din-error e greu (mediaSession nu e
scriptabil in Playwright) — acoperim unit + smoke manual. SMOKE PE DEVICE
obligatoriu: lock screen play/pause/prev/next, resume dupa pauza lunga,
offline.

## Faza R4: fix-uri mici de comportament, fiecare cu testul lui

- radioMachine.ts: `stopPlayer` pe tranzitiile STALLED si PLAYER_ERROR din
  `playing` → `retrying` (simetric cu calea LOADING_TIMEOUT) — inchide
  fereastra de 3s in care stream-ul reinviat canta sub tonul de loading.
- soundEffects.ts: fix minim pentru race-ul ensure() vs preload in zbor:
  ensure() nu mai apeleaza element.play() cand elementul nu are src valid
  (dupa stop() src=''); in loc de asta reintra pe play() complet. Nu
  anticipam reconcile() (4b) — doar eliminam fereastra de liniste de ~2.5s.
- Ambele au teste unit dedicate (SimulatedClock pentru supervisor).

Verificare: typecheck, unit (cu teste noi), e2e neatins.

## Faza R5: recheck offline fara reenter + memoizare updateMediaSession

Zona sensibila iOS — ultima faza de logica, cu smoke pe device.

- radioMachine.ts: recheck-ul offline nu mai face reenter pe `error` (azi:
  applyFx + teardown/recreate supervisor + MediaMetadata + img.src la fiecare
  10s, la nesfarsit). Varianta preferata: sub-stari in error
  (`error.waiting` cu after → self, guard isOnline → recovering) astfel incat
  entry-ul starii `error` (fx + supervisor) ruleaza O DATA; alternativ
  short-circuit in applyFx pe context.offlineRecheck. Contextul
  `offlineRecheck` poate disparea complet daca sub-starile rezolva cadenta.
- mediaSession.ts: updateMediaSession memoizeaza pe (state, displayText):
  sare peste MediaMetadata/artwork/img.src/title cand nimic nu s-a schimbat.
  ATENTIE: re-inregistrarea handler-elor si playbackState raman NEmemoizate
  (empirism iOS — d798cc9); doar partea de metadata/DOM se scurteaza.
  cloudinaryImageUrl se calculeaza o singura data (azi de 2 ori).

Verificare: unit pentru cadenta recheck (nicio re-aplicare de fx intre
tick-uri), e2e neatins, SMOKE PE DEVICE: telefon offline in error 5+ min cu
ecranul blocat — widget-ul nu mai palpaie, bateria nu se scurge; revenire
online → recovering → playing.

## Faza R6: startup mai usor (cloudinary precache)

- cloudinary.ts/main.ts: amana precacheStatusImages la `requestIdleCallback`
  (fallback setTimeout) si redu la labels + statia curenta (azi: 22 de
  imagini eager care concureaza cu stream-ul si sunetele la startup si ocupa
  22/30 sloturi din trimCache).
- Pagina nu mai face cache.put propriu (SW-ul deja cache-uieste toate
  GET-urile cloudinary; azi aceiasi bytes se scriu de 2 ori).
- Optional, acelasi PR: in sw.js, cache.put pentru app-shell trece pe
  event.waitUntil (ca la cloudinary) si exclude /downloads/ (APK-ul de
  2.4MB ajunge azi in APP_CACHE).

Verificare: build, e2e neatins, smoke offline pe vite preview (posterele
statiilor raman disponibile offline dupa prima redare).

## Ordine si estimare

R1 → R2 → R3 → R4 → R4b → R5 → R6. R1-R2 sunt mecanice (o sesiune). R3 e
miezul (masina + adaptor + mediaSession, cu device smoke). R4 marunt.
R4b (handoff/carry din masina) e cerinta lock-screen a lui Adrian — cea mai
empirica faza, cu re-validare completa pe iPhone (play→lock imediat→wifi
off→eroarea se aude DIN PRIMA). R5 cere atentie la empirismul iOS. R6
independent (poate fi facut oricand dupa R1).

## Definition of done

- Toate cele 10 constatari din review inchise sau explicit amanate (4b).
- CI verde cap-coada in fiecare faza; e2e-ul vechi identic si verde.
- radioCore.ts = forwarding pur (fara logica de playback in adaptor).
- O singura sursa de adevar pentru clasificarea starilor si politica de
  pause/resume — in masina, nu in stratul DOM.
- Smoke pe device dupa R3 si R5 (lock screen + offline).
