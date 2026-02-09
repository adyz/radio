import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PlayerStatus } from '../types';
import { updateMediaSession } from '../lib/media-session';

describe('updateMediaSession', () => {
  let posterImg: HTMLImageElement;

  beforeEach(() => {
    posterImg = document.createElement('img');

    // Mock Media Session API (jsdom nu o are)
    Object.defineProperty(navigator, 'mediaSession', {
      value: {
        metadata: null,
        setActionHandler: vi.fn(),
      },
      writable: true,
      configurable: true,
    });

    // Mock MediaMetadata
    if (typeof globalThis.MediaMetadata === 'undefined') {
      (globalThis as any).MediaMetadata = class {
        title: string;
        artist: string;
        artwork: any[];
        constructor(init: any) {
          this.title = init.title;
          this.artist = init.artist;
          this.artwork = init.artwork;
        }
      };
    }
  });

  it('setează titlul documentului cu emoji și numele stației când playing', () => {
    const status: PlayerStatus = { state: 'playing', stationIndex: 0 };
    updateMediaSession(status, {
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    expect(document.title).toContain('Kiss FM');
  });

  it('setează poster image src cu URL Cloudinary', () => {
    const status: PlayerStatus = { state: 'playing', stationIndex: 0 };
    updateMediaSession(status, {
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    expect(posterImg.src).toContain('cloudinary');
    // jsdom URL-encode spațiile, deci verificăm varianta encoded
    expect(posterImg.src).toContain('Kiss%20FM');
  });

  it('arată "Se încarcă..." în titlu când loading', () => {
    const status: PlayerStatus = { state: 'loading', stationIndex: 3 };
    updateMediaSession(status, {
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    expect(document.title).toContain('Se incarca');
    expect(document.title).toContain('Magic FM');
  });

  it('arată "Eroare" în titlu când error', () => {
    const status: PlayerStatus = { state: 'error', stationIndex: 0 };
    updateMediaSession(status, {
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    expect(document.title).toContain('Eroare');
  });

  it('folosește imaginea live când starea e playing', () => {
    const status: PlayerStatus = { state: 'playing', stationIndex: 0 };
    updateMediaSession(status, {
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    // Imaginea live are alt ID Cloudinary
    expect(posterImg.src).toContain('rhz6yy4btbqicjqhsy7a');
  });

  it('folosește imaginea default când starea e loading', () => {
    const status: PlayerStatus = { state: 'loading', stationIndex: 0 };
    updateMediaSession(status, {
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    expect(posterImg.src).toContain('nndti4oybhdzggf8epvh');
  });

  it('setează Media Session metadata cu artist-ul corect', () => {
    const status: PlayerStatus = { state: 'playing', stationIndex: 7 };
    updateMediaSession(status, {
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    const metadata = navigator.mediaSession.metadata as any;
    expect(metadata.artist).toContain('Rock FM');
    expect(metadata.artist).toContain('Coji Radio Player');
  });

  it('înregistrează action handlers previoustrack și nexttrack', () => {
    const onPrev = vi.fn();
    const onNext = vi.fn();
    const status: PlayerStatus = { state: 'playing', stationIndex: 0 };

    updateMediaSession(status, {
      onPrevious: onPrev,
      onNext: onNext,
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    const setHandler = navigator.mediaSession.setActionHandler as ReturnType<typeof vi.fn>;
    const calls = setHandler.mock.calls;

    expect(calls.some((c: any[]) => c[0] === 'previoustrack')).toBe(true);
    expect(calls.some((c: any[]) => c[0] === 'nexttrack')).toBe(true);
  });

  it('înregistrează play/pause handlers doar când NU e loading sau error', () => {
    const status: PlayerStatus = { state: 'playing', stationIndex: 0 };

    updateMediaSession(status, {
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    const setHandler = navigator.mediaSession.setActionHandler as ReturnType<typeof vi.fn>;
    const calls = setHandler.mock.calls;

    expect(calls.some((c: any[]) => c[0] === 'pause')).toBe(true);
    expect(calls.some((c: any[]) => c[0] === 'play')).toBe(true);
  });

  it('NU înregistrează play/pause handlers când e loading', () => {
    const status: PlayerStatus = { state: 'loading', stationIndex: 0 };

    updateMediaSession(status, {
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    const setHandler = navigator.mediaSession.setActionHandler as ReturnType<typeof vi.fn>;
    const calls = setHandler.mock.calls;

    expect(calls.some((c: any[]) => c[0] === 'pause')).toBe(false);
    expect(calls.some((c: any[]) => c[0] === 'play')).toBe(false);
  });

  it('starea idle folosește "Coji Radio Player" ca nume stație', () => {
    const status: PlayerStatus = { state: 'idle' };
    updateMediaSession(status, {
      onPrevious: vi.fn(),
      onNext: vi.fn(),
      onPause: vi.fn(),
      onPlay: vi.fn(),
    }, posterImg);

    const metadata = navigator.mediaSession.metadata as any;
    expect(metadata.title).toBe('Coji Radio Player');
  });
});
