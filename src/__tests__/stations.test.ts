import { describe, it, expect } from 'vitest';
import { STATIONS } from '../data/stations';

describe('stations', () => {
  it('are 18 stații radio', () => {
    expect(STATIONS).toHaveLength(18);
  });

  it('fiecare stație are name și streamUrl', () => {
    for (const station of STATIONS) {
      expect(station.name).toBeTruthy();
      expect(station.streamUrl).toBeTruthy();
    }
  });

  it('toate URL-urile sunt HTTPS', () => {
    for (const station of STATIONS) {
      expect(station.streamUrl).toMatch(/^https:\/\//);
    }
  });

  it('nu are nume duplicate', () => {
    const names = STATIONS.map((s) => s.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('nu are URL-uri duplicate', () => {
    const urls = STATIONS.map((s) => s.streamUrl);
    const unique = new Set(urls);
    expect(unique.size).toBe(urls.length);
  });

  it('prima stație e Kiss FM', () => {
    expect(STATIONS[0]?.name).toBe('Kiss FM');
  });

  it('ultima stație e Vanilla Radio Fresh', () => {
    expect(STATIONS[STATIONS.length - 1]?.name).toBe('Vanilla Radio Fresh');
  });
});
