# Radio Player Romania 🇷🇴

A modern radio player application built with Preact, TypeScript, and Vite.

## Features

- 🎵 18 Romanian radio stations
- 🎨 Beautiful UI with dark mode support
- 📱 PWA support (installable on mobile/desktop)
- 🎧 Media Session API (lock screen controls)
- 🔊 Loading and error sound effects
- ⚡ Ultra-fast Vite build system
- 🔒 Type-safe with TypeScript

## Quick Start

```bash
# Install dependencies
npm install

# Development
npm run dev        # Start dev server at http://localhost:5173

# Production
npm run build      # Build for production
npm run preview    # Preview production build
```

## State Machine Documentation

This application's state management is documented using a formal state machine approach. Understanding the state machine helps with:
- **Development**: Clear mental model of app behavior
- **Debugging**: Visualize what state the app is in
- **Testing**: Test each state and transition
- **Maintenance**: Safe refactoring with clear contracts

### Quick Links

📚 **[Complete State Machine Explanation](./STATE_MACHINE.md)**
- Why use state machines?
- Current issues with boolean flags
- Benefits of explicit state management
- Implementation approaches (simple TS vs XState)

📊 **[Visual State Diagram](./STATE_MACHINE_DIAGRAM.md)**
- Interactive Mermaid diagram
- All states, transitions, and events
- Side effects and guard conditions
- Testing strategy

### State Machine at a Glance

The radio player has **5 main states**:

```
IDLE → LOADING → PLAYING → PAUSED
         ↓          ↑
       ERROR -------┘
```

**Events**: PLAY, PAUSE, NEXT, PREV, SELECT_STATION, SUCCESS, FAILURE

See [STATE_MACHINE_DIAGRAM.md](./STATE_MACHINE_DIAGRAM.md) for the full interactive diagram!

## Project Structure

```
/home/runner/work/radio/radio/
├── src/
│   ├── App.tsx          # Main Preact component
│   ├── main.tsx         # Entry point
│   ├── types.ts         # TypeScript types & radio stations
│   ├── utils.ts         # Utility functions
│   └── css/
│       └── input.css    # TailwindCSS styles
├── public/              # Static assets
│   ├── images/          # Logos, icons
│   ├── sounds/          # Loading/error sounds
│   ├── manifest.json    # PWA manifest
│   └── sw.js           # Service worker
├── index.html          # HTML entry point
├── vite.config.ts      # Vite configuration
├── tsconfig.json       # TypeScript configuration
├── tailwind.config.js  # Tailwind configuration
└── STATE_MACHINE.md    # State machine documentation
```

## Technology Stack

- **Framework**: [Preact](https://preactjs.com/) (3KB React alternative)
- **Language**: [TypeScript](https://www.typescriptlang.org/)
- **Build Tool**: [Vite](https://vitejs.dev/) (ultra-fast HMR)
- **Styling**: [TailwindCSS](https://tailwindcss.com/) v4
- **PWA**: Service Worker + Manifest

## Radio Stations

The app includes 18 popular Romanian radio stations:
- Kiss FM, Europa FM, Digi FM, Magic FM
- Virgin Radio, ProFM, Rock FM, Dance FM
- Radio România (Actualități, Cultural, Muzical)
- Radio Guerrilla, National FM, Vibe FM
- Radio Pro-B, Vanilla Radio (Deep, Smooth, Fresh)

## Development

### Hot Module Replacement (HMR)

Vite provides instant HMR during development:
```bash
npm run dev
# Changes to code update instantly in browser
```

### Building

```bash
npm run build
# Creates optimized production build in dist/
# Bundle: ~27KB JS + ~16KB CSS (gzipped: ~11KB + ~4KB)
```

### TypeScript

Full TypeScript coverage with strict mode enabled. The compiler catches errors at build time:
```typescript
// Type-safe radio stations
interface RadioStation {
  name: string;
  url: string;
}

const radioStations: RadioStation[] = [...];
```

## State Management

The app currently uses React hooks for state management:
```typescript
const [selectedIndex, setSelectedIndex] = useState(0);
const [isPlaying, setIsPlaying] = useState(false);
const [isLoading, setIsLoading] = useState(false);
const [hasError, setHasError] = useState(false);
```

However, a **state machine approach would be more robust**. See:
- [STATE_MACHINE.md](./STATE_MACHINE.md) - Comprehensive explanation
- [STATE_MACHINE_DIAGRAM.md](./STATE_MACHINE_DIAGRAM.md) - Visual diagram

### Why State Machines?

Current approach problems:
- ❌ 8 possible state combinations (only 5 valid)
- ❌ Scattered transition logic
- ❌ Possible race conditions
- ❌ Hard to test all combinations

State machine benefits:
- ✅ Only valid states possible
- ✅ Explicit, centralized transitions
- ✅ Race conditions prevented by design
- ✅ Easy to test and visualize

## Testing

Currently no tests. To add tests:

```bash
npm install -D vitest @testing-library/preact
```

With a state machine, you can test transitions:
```typescript
test('loading → playing on success', () => {
  const { result } = renderHook(() => useMachine(radioMachine));
  act(() => result.current.send('PLAY'));
  expect(result.current.state.value).toBe('loading');
  act(() => result.current.send('SUCCESS'));
  expect(result.current.state.value).toBe('playing');
});
```

## Browser Support

- Modern browsers with ES2020 support
- Chrome/Edge 80+
- Firefox 80+
- Safari 14+

## PWA Features

The app can be installed as a Progressive Web App:
- 📱 Add to home screen on mobile
- 💻 Install as desktop app
- 🎨 Custom splash screen and icon
- 🎵 Background audio playback
- 🔐 Service worker for offline capability

## Media Session API

Supports lock screen controls on mobile and desktop:
- ⏯️ Play/Pause
- ⏭️ Next station
- ⏮️ Previous station
- 🖼️ Station artwork display

## License

This project is created by Adrian Florescu (http://adrianf.com)

## Contributing

To contribute:
1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

### Before Contributing

Please read [STATE_MACHINE.md](./STATE_MACHINE.md) to understand the app's state management approach and why a state machine would improve the codebase.

## Roadmap

Potential improvements:
- [ ] Implement XState for robust state management
- [ ] Add unit tests with Vitest
- [ ] Add E2E tests with Playwright
- [ ] Implement favorites/recent stations
- [ ] Add volume controls
- [ ] Support for multiple countries
- [ ] Visualizer during playback
- [ ] Offline mode improvements

## Credits

- **Developer**: Adrian Florescu
- **Framework**: Preact Team
- **Build Tool**: Vite Team
- **Radio Streams**: Various Romanian radio stations

---

Made with ❤️ in Romania 🇷🇴
