import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createAudioInstance } from '../lib/audio';

function createMockAudioElement(src = 'https://example.com/audio.mp3'): HTMLAudioElement {
  const el = document.createElement('audio');
  const source = document.createElement('source');
  source.src = src;
  el.appendChild(source);

  // jsdom nu implementează play() real, mock-uim
  el.play = vi.fn().mockResolvedValue(undefined);
  el.pause = vi.fn();

  return el;
}

describe('createAudioInstance', () => {
  let mockEl: HTMLAudioElement;

  beforeEach(() => {
    mockEl = createMockAudioElement('https://example.com/loading.mp3');
  });

  it('citește src-ul din <source>', () => {
    const instance = createAudioInstance(mockEl);
    expect(instance.src).toBe('https://example.com/loading.mp3');
  });

  it('play() setează src pe element și apelează element.play()', () => {
    const instance = createAudioInstance(mockEl);
    instance.play();

    expect(mockEl.src).toContain('loading.mp3');
    expect(mockEl.play).toHaveBeenCalledOnce();
  });

  it('play() nu apelează de 2 ori dacă deja rulează', () => {
    const instance = createAudioInstance(mockEl);
    instance.play();
    instance.play();

    expect(mockEl.play).toHaveBeenCalledOnce();
  });

  it('stop() apelează pause() și golește src', () => {
    const instance = createAudioInstance(mockEl);
    instance.play();
    instance.stop();

    expect(mockEl.pause).toHaveBeenCalled();
    // jsdom normalizează src="" la base URL, verificăm că nu mai e stream-ul original
    expect(mockEl.src).not.toContain('loading.mp3');
  });

  it('stop() nu face nimic dacă nu rulează', () => {
    const instance = createAudioInstance(mockEl);
    instance.stop();

    expect(mockEl.pause).not.toHaveBeenCalled();
  });

  it('după stop() poți da play() din nou', () => {
    const instance = createAudioInstance(mockEl);
    instance.play();
    instance.stop();
    instance.play();

    expect(mockEl.play).toHaveBeenCalledTimes(2);
  });

  it('dacă play() eșuează cu eroare non-Abort, resetează starea', async () => {
    const error = new DOMException('Network error', 'NetworkError');
    mockEl.play = vi.fn().mockRejectedValue(error);

    const instance = createAudioInstance(mockEl);
    instance.play();

    // Așteptăm microtask-ul pentru catch
    await vi.waitFor(() => {
      // După eroare, isPlaying se resetează, deci play() ar trebui să meargă din nou
      instance.play();
      expect(mockEl.play).toHaveBeenCalledTimes(2);
    });
  });

  it('src-ul e string gol dacă nu există <source>', () => {
    const bareEl = document.createElement('audio');
    bareEl.play = vi.fn().mockResolvedValue(undefined);
    bareEl.pause = vi.fn();

    const instance = createAudioInstance(bareEl);
    expect(instance.src).toBe('');
  });
});
