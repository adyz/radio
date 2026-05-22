# Plan de atac pentru problemele de cod

Branch de lucru: `codex-code-review-plan`

## Context

Review-ul a scos cateva probleme clare:

- `npm test` nu porneste in mediul curent din cauza combinatiei Node 18.9.0 + Vitest 3.2.4 + Vite 7.3.1.
- `npm run build` raporteaza succes chiar daca pasii interni pot esua.
- Build-ul publica si fisiere de test in `public/js`.
- Exista cateva cazuri runtime fragile: `lastRadioIndex` invalid, `player.play()` reject la resume, reload de service worker in mijlocul sesiunii.
- E2E are un test care trece izolat, dar pica uneori in suita completa.

## Status curent

- Faza 1 este gata: proiectul documenteaza si foloseste Node 20.19+.
- Faza 2 este gata: build-ul este fail-fast, curata `public/` si nu mai publica fisiere de test.
- Faza 3 este gata: storage invalid si resume rejection sunt tratate si acoperite de teste.
- Faza 4 este gata: update-ul de Service Worker nu mai forteaza reload in timpul redarii.
- Faza 5 este gata: flaky-ul din zona offline/sound a fost intarit cu preload determinist, blob memory, cache versioning si e2e-uri mai precise, iar testul istoric flaky a trecut repetat.
- CI-ul ruleaza unit tests cu coverage, build si e2e, apoi publica un summary cu rezultatele si eventualele failures.
- Faza 6 este scoasa din scope pentru moment.

## Faza 1: stabilizam toolchain-ul [gata]

Obiectiv: comenzile de baza trebuie sa fie predictibile local si in deploy.

- Fix `npm test`:
  - Varianta preferata: setam explicit Node 20.19+ prin `.nvmrc` si `package.json` `engines`.
  - Alternativa: pin-uim Vite/Vitest la versiuni compatibile cu Node 18.
  - Fisiere: `package.json`, `package-lock.json`, eventual `.nvmrc`.
- Verificari:
  - `node --version`
  - `npm test`
  - `npm run build`

## Faza 2: facem build-ul fail-fast [gata]

Obiectiv: daca un pas de build crapa, deploy-ul trebuie sa crape si el.

- Scoatem `try/catch`-urile care inghit erori sau le transformam in erori propagate.
- Excludem fisierele `*.test.js` din minificarea/copierea JS de productie.
- Optional: curatam `public/` la inceputul build-ului ca sa evitam artifacte vechi.
- Fisiere: `build.mjs`, `.gitignore` doar daca apare nevoie.
- Verificari:
  - `npm run build`
  - confirmare ca `public/js/radioCore.test.js` nu mai apare dupa build.

## Faza 3: intarim runtime-ul audio/state [gata]

Obiectiv: app-ul nu trebuie sa intre in stare invalida cand browserul refuza autoplay/resume sau storage-ul e corupt.

- Validam `lastRadioIndex`:
  - parse sigur;
  - clamp la intervalul valid;
  - fallback la index `0` cand valoarea e invalida.
- Tratam reject-ul de la `player.play()` in `resumeRadio`, `togglePlayPause` si `onPlayButtonClick` cand reia din pauza.
- Decidem comportamentul dorit la reject:
  - fie revenim la `paused`;
  - fie intram in `error` doar pentru erori reale de stream.
- Fisiere: `src/js/radioCore.js`, `src/js/script.js`, `src/js/radioCore.test.js`.
- Verificari:
  - unit tests pentru storage invalid si `player.play()` reject;
  - e2e smoke pentru play/pause/resume.

## Faza 4: service worker fara reload agresiv [gata]

Obiectiv: update-ul PWA sa nu intrerupa redarea sau testele.

- Revizuim `controllerchange => window.location.reload()`.
- Evitam reload automat daca playerul e in `playing`, `loading`, `retrying`, `error` sau `recovering`.
- Posibil model simplu:
  - marcaj intern `pendingReload`;
  - reload doar cand ajungem in `idle`;
  - sau eliminam reload-ul automat si lasam urmatoarea vizita sa ia SW nou.
- Fisiere: `src/js/script.js`, `src/sw.js`.
- Verificari:
  - e2e pentru load/reload;
  - verificare manuala ca redarea nu se opreste la update SW.

## Faza 5: stabilizam E2E [gata]

Obiectiv: testele sa treaca repetabil ca suita, nu doar individual.

- Testul istoric flaky: `error sound plays offline from preloaded blob`.
- Ce am stabilizat:
  - sunetele de loading/error sunt preincarcate in blob memory la page load;
  - `play()` asteapta preload-ul in curs in loc sa cada inapoi imediat pe URL-ul original;
  - testele verifica explicit `audio.src` cu `blob:`;
  - testele blocheaza requesturi tarzii la `/sounds/*.mp3` dupa preload;
  - `loadingNoise.stop()` opreste si warm-up-uri pornite, nu doar playback-ul marcat intern ca activ;
  - preload-ul citeste doar din cache-ul curent `SOUND_CACHE_NAME`, ca bump-ul de versiune sa nu refoloseasca sunete vechi.
- Verificari deja trecute:
  - `npm run test:e2e` trece ca suita completa cu 23/23;
  - e2e dedicat pentru cache versioning trece;
  - e2e dedicat pentru loading sound ramas in fundal trece.
  - testul istoric flaky `error sound plays offline from preloaded blob` a trecut 10/10 cu `--repeat-each=10`.
- Fisiere: `e2e/radio.spec.js`, `playwright.config.js`.
- Verificari:
  - `npm run test:e2e`
  - rulare repetata a testului flaky de 5-10 ori.

## Faza 6: mici polish-uri UI/UX cu impact tehnic [scos din scope]

Obiectiv: imbunatatiri mici, fara redesign.

- Marim hit target-ul pentru butonul selectorului la minimum ~44x44 px.
- Facem posterul accesibil daca ramane trigger pentru selector:
  - `role="button"`;
  - `tabindex="0"`;
  - Enter/Space deschid selectorul.
- Ajustam contrastul pentru starea selectata in dark mode si mesajele mici.
- Fisiere: `src/index.html`, `src/css/input.css`, `src/js/script.js`.
- Verificari:
  - screenshot desktop/mobile light/dark;
  - e2e basic pentru selector.

## Ordine recomandata

1. Nu mai exista puncte tehnice active in plan.
2. UI/a11y polish ramane scos din scope pana cand devine prioritar.

## Definition of done

- `npm test` trece.
- `npm run build` trece si esueaza corect cand un pas intern esueaza.
- `npm run test:e2e` trece ca suita completa.
- Nu se publica fisiere de test in `public/`.
- App-ul porneste corect cu `lastRadioIndex` invalid.
- Resume/play rejection nu lasa UI-ul intr-o stare mincinoasa.
- Sunetele de loading/error pornesc din blob memory dupa preload si nu fac requesturi tarzii la momentul critic.
- Bump-ul de `SOUND_CACHE_NAME` nu refoloseste accidental sunete din cache-uri vechi.
