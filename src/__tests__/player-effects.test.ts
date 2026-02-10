import { describe, it, expect } from 'vitest';
import { createActor } from 'xstate';
import { playerMachine } from '../lib/player-machine';

describe('playerMachine - side effects (sunet loading, error)', () => {
  let calls: string[];

  function createTestActor() {
    calls = [];
    const testMachine = playerMachine.provide({
      actions: {
        playLoadingNoise: () => { calls.push('playLoadingNoise'); },
        stopLoadingNoise: () => { calls.push('stopLoadingNoise'); },
        playErrorNoise: () => { calls.push('playErrorNoise'); },
        stopErrorNoise: () => { calls.push('stopErrorNoise'); },
        loadStream: () => { calls.push('loadStream'); },
      },
    });
    const actor = createActor(testMachine);
    actor.start();
    return actor;
  }

  // --- Sunet de loading ---

  it('pornește sunetul de loading când intri în starea loading', () => {
    const actor = createTestActor();
    actor.send({ type: 'PLAY', index: 0 });

    expect(calls).toContain('playLoadingNoise');
  });

  it('oprește sunetul de loading când stream-ul pornește', () => {
    const actor = createTestActor();
    actor.send({ type: 'PLAY', index: 0 });
    calls = [];

    actor.send({ type: 'STREAM_READY' });

    expect(calls).toContain('stopLoadingNoise');
    expect(calls).not.toContain('playLoadingNoise');
  });

  it('oprește sunetul de loading și la eroare', () => {
    const actor = createTestActor();
    actor.send({ type: 'PLAY', index: 0 });
    calls = [];

    actor.send({ type: 'STREAM_ERROR' });

    expect(calls).toContain('stopLoadingNoise');
  });

  // --- Sunet de eroare ---

  it('pornește sunetul de eroare când stream-ul eșuează', () => {
    const actor = createTestActor();
    actor.send({ type: 'PLAY', index: 0 });
    calls = [];

    actor.send({ type: 'STREAM_ERROR' });

    expect(calls).toContain('playErrorNoise');
  });

  it('NU pornește sunetul de eroare când stream-ul reușește', () => {
    const actor = createTestActor();
    actor.send({ type: 'PLAY', index: 0 });
    calls = [];

    actor.send({ type: 'STREAM_READY' });

    expect(calls).not.toContain('playErrorNoise');
  });

  it('oprește sunetul de eroare când reîncepi loading', () => {
    const actor = createTestActor();
    actor.send({ type: 'PLAY', index: 0 });
    actor.send({ type: 'STREAM_ERROR' });
    calls = [];

    actor.send({ type: 'PLAY', index: 3 });

    expect(calls).toContain('stopErrorNoise');
  });

  // --- Ordinea acțiunilor la loading ---

  it('la intrarea în loading: oprește error noise ÎNAINTE de a porni loading noise', () => {
    const actor = createTestActor();
    actor.send({ type: 'PLAY', index: 0 });

    const stopIdx = calls.indexOf('stopErrorNoise');
    const playIdx = calls.indexOf('playLoadingNoise');
    expect(stopIdx).toBeLessThan(playIdx);
  });

  // --- loadStream ---

  it('apelează loadStream la intrarea în loading', () => {
    const actor = createTestActor();
    actor.send({ type: 'PLAY', index: 0 });

    expect(calls).toContain('loadStream');
  });

  it('apelează loadStream din nou când faci re-enter în loading', () => {
    const actor = createTestActor();
    actor.send({ type: 'PLAY', index: 0 });
    calls = [];

    actor.send({ type: 'PLAY', index: 3 });

    expect(calls).toContain('loadStream');
  });

  // --- Scenariul complet: un utilizator ascultă radio ---

  it('scenariul complet: utilizatorul pune Kiss FM, eșuează, trece pe Europa FM, merge', () => {
    const actor = createTestActor();

    // 1. Pune Kiss FM
    actor.send({ type: 'PLAY', index: 0 });
    expect(calls).toContain('playLoadingNoise');
    expect(calls).toContain('loadStream');
    calls = [];

    // 2. Eșuează
    actor.send({ type: 'STREAM_ERROR' });
    expect(calls).toContain('stopLoadingNoise');
    expect(calls).toContain('playErrorNoise');
    calls = [];

    // 3. Dă NEXT -> Europa FM
    actor.send({ type: 'NEXT' });
    expect(actor.getSnapshot().context.stationIndex).toBe(1);
    expect(calls).toContain('stopErrorNoise');
    expect(calls).toContain('playLoadingNoise');
    expect(calls).toContain('loadStream');
    calls = [];

    // 4. Reușește
    actor.send({ type: 'STREAM_READY' });
    expect(calls).toContain('stopLoadingNoise');
    expect(calls).not.toContain('playErrorNoise');
  });

  // --- Subscribe ---

  it('subscribe-ul primește snapshot-ul corect la fiecare tranziție', () => {
    const states: string[] = [];
    const testMachine = playerMachine.provide({
      actions: {
        playLoadingNoise: () => {},
        stopLoadingNoise: () => {},
        playErrorNoise: () => {},
        stopErrorNoise: () => {},
        loadStream: () => {},
      },
    });
    const actor = createActor(testMachine);
    actor.subscribe((snap) => {
      states.push(snap.value as string);
    });
    actor.start();

    actor.send({ type: 'PLAY', index: 0 });
    actor.send({ type: 'STREAM_READY' });
    actor.send({ type: 'NEXT' });
    actor.send({ type: 'STREAM_ERROR' });

    expect(states).toEqual(['idle', 'loading', 'playing', 'loading', 'error']);
  });
});
