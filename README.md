# Radio Player Romania

Un player de radio online pentru posturile de radio din Romania. Asculta Kiss FM, Europa FM, Digi FM, Rock FM si alte 14 posturi direct din browser.

## Caracteristici

- **18 posturi de radio romanesti** - Kiss FM, Europa FM, Digi FM, Magic FM, Virgin Radio, ProFM, Rock FM, Radio Guerrilla, National FM, Dance FM, Vibe FM, Radio Romania Actualitati, Radio Romania Cultural, Radio Romania Muzical, Radio Pro-B, Vanilla Radio (Deep, Smooth, Fresh)
- **Progressive Web App (PWA)** - se poate instala pe telefon ca o aplicatie nativa
- **Media Session API** - controlezi playback-ul de pe lock screen, castile Bluetooth sau media keys
- **Dark mode** - detecteaza automat tema sistemului
- **Feedback audio** - sunet de loading cand se incarca stream-ul, sunet de eroare la esec
- **Poster dinamic** - imagine generata cu Cloudinary care arata statia curenta

## Utilizare

Deschide aplicatia, alege un post de radio din selector si apasa play. Poti naviga intre posturi cu butoanele prev/next. Selectorul se deschide si prin click pe imaginea postului.

### Instalare ca aplicatie

- **Android Chrome**: Menu > "Add to Home screen"
- **iOS Safari**: Share > "Add to Home Screen"
- **Desktop Chrome**: Iconita de instalare din bara de adrese

## Dezvoltare locala

```bash
# Cerinte: Node.js >= 18
npm install
npm run dev
```

Aplicatia porneste la `http://localhost:5173`.

## Build de productie

```bash
npm run build    # compileaza TS + bundleaza cu Vite -> dist/
npm run preview  # serveste build-ul local pentru verificare
```

## Teste

```bash
npm test         # ruleaza toate testele o data
npm run test:watch  # ruleaza testele in mod watch
```

## Deployment

Proiectul e configurat pentru Vercel. La push pe `master`, Vercel ruleaza `npm run build` si serveste din `dist/`.

## Autor

Adrian Florescu - [adrianf.com](https://adrianf.com)
