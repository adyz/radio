import { describe, it, expect, beforeEach } from 'vitest';
import { createActor } from 'xstate';
import { playerMachine } from '../lib/player-machine';
import { STATIONS } from '../data/stations';

describe('playerMachine - tranziții pure (fără DOM)', () => {
  let actor: ReturnType<typeof createActor<typeof playerMachine>>;

  beforeEach(() => {
    actor = createActor(playerMachine);
    actor.start();
  });

  it('pornește în starea idle', () => {
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('idle');
    expect(snap.context.stationIndex).toBe(0);
  });

  // --- PLAY ---

  it('idle -> loading pe PLAY', () => {
    actor.send({ type: 'PLAY', index: 3 });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.stationIndex).toBe(3);
  });

  it('loading -> playing pe STREAM_READY', () => {
    actor.send({ type: 'PLAY', index: 0 });
    actor.send({ type: 'STREAM_READY' });
    expect(actor.getSnapshot().value).toBe('playing');
  });

  it('loading -> error pe STREAM_ERROR', () => {
    actor.send({ type: 'PLAY', index: 0 });
    actor.send({ type: 'STREAM_ERROR' });
    expect(actor.getSnapshot().value).toBe('error');
  });

  it('playing -> loading pe PLAY cu alt index', () => {
    actor.send({ type: 'PLAY', index: 0 });
    actor.send({ type: 'STREAM_READY' });
    actor.send({ type: 'PLAY', index: 5 });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.stationIndex).toBe(5);
  });

  it('error -> loading pe PLAY', () => {
    actor.send({ type: 'PLAY', index: 2 });
    actor.send({ type: 'STREAM_ERROR' });
    actor.send({ type: 'PLAY', index: 7 });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.stationIndex).toBe(7);
  });

  // --- PLAY guard: index invalid ---

  it('respinge PLAY cu index negativ', () => {
    actor.send({ type: 'PLAY', index: -1 });
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('respinge PLAY cu index prea mare', () => {
    actor.send({ type: 'PLAY', index: STATIONS.length });
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('respinge PLAY cu index prea mare din playing', () => {
    actor.send({ type: 'PLAY', index: 0 });
    actor.send({ type: 'STREAM_READY' });
    actor.send({ type: 'PLAY', index: 999 });
    // Rămâne în playing, nu se mișcă
    expect(actor.getSnapshot().value).toBe('playing');
    expect(actor.getSnapshot().context.stationIndex).toBe(0);
  });

  // --- NEXT ---

  it('idle -> loading pe NEXT (index 0 -> 1)', () => {
    actor.send({ type: 'NEXT' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.stationIndex).toBe(1);
  });

  it('playing -> loading pe NEXT, ciclează circular', () => {
    // Pune pe ultimul și dă next
    actor.send({ type: 'PLAY', index: STATIONS.length - 1 });
    actor.send({ type: 'STREAM_READY' });
    actor.send({ type: 'NEXT' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.stationIndex).toBe(0); // wrap around
  });

  it('error -> loading pe NEXT', () => {
    actor.send({ type: 'PLAY', index: 5 });
    actor.send({ type: 'STREAM_ERROR' });
    actor.send({ type: 'NEXT' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.stationIndex).toBe(6);
  });

  it('loading -> loading pe NEXT (re-enter, schimbă stația)', () => {
    actor.send({ type: 'PLAY', index: 3 });
    expect(actor.getSnapshot().value).toBe('loading');

    actor.send({ type: 'NEXT' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.stationIndex).toBe(4);
  });

  // --- PREV ---

  it('idle -> loading pe PREV (index 0 -> ultimul)', () => {
    actor.send({ type: 'PREV' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.stationIndex).toBe(STATIONS.length - 1);
  });

  it('playing -> loading pe PREV', () => {
    actor.send({ type: 'PLAY', index: 5 });
    actor.send({ type: 'STREAM_READY' });
    actor.send({ type: 'PREV' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.stationIndex).toBe(4);
  });

  it('PREV din index 0 merge la ultimul (wrap)', () => {
    actor.send({ type: 'PLAY', index: 0 });
    actor.send({ type: 'STREAM_READY' });
    actor.send({ type: 'PREV' });
    expect(actor.getSnapshot().context.stationIndex).toBe(STATIONS.length - 1);
  });

  it('loading -> loading pe PREV (re-enter, schimbă stația)', () => {
    actor.send({ type: 'PLAY', index: 5 });
    expect(actor.getSnapshot().value).toBe('loading');

    actor.send({ type: 'PREV' });
    const snap = actor.getSnapshot();
    expect(snap.value).toBe('loading');
    expect(snap.context.stationIndex).toBe(4);
  });

  // --- Secvențe complexe ---

  it('ciclul complet: idle -> loading -> playing -> next -> loading -> error -> next -> loading -> playing', () => {
    actor.send({ type: 'PLAY', index: 0 });
    expect(actor.getSnapshot().value).toBe('loading');

    actor.send({ type: 'STREAM_READY' });
    expect(actor.getSnapshot().value).toBe('playing');

    actor.send({ type: 'NEXT' });
    expect(actor.getSnapshot().value).toBe('loading');
    expect(actor.getSnapshot().context.stationIndex).toBe(1);

    actor.send({ type: 'STREAM_ERROR' });
    expect(actor.getSnapshot().value).toBe('error');

    actor.send({ type: 'NEXT' });
    expect(actor.getSnapshot().value).toBe('loading');
    expect(actor.getSnapshot().context.stationIndex).toBe(2);

    actor.send({ type: 'STREAM_READY' });
    expect(actor.getSnapshot().value).toBe('playing');
    expect(actor.getSnapshot().context.stationIndex).toBe(2);
  });

  it('schimbă stația din loading (re-enter)', () => {
    actor.send({ type: 'PLAY', index: 0 });
    expect(actor.getSnapshot().value).toBe('loading');

    actor.send({ type: 'PLAY', index: 5 });
    expect(actor.getSnapshot().value).toBe('loading');
    expect(actor.getSnapshot().context.stationIndex).toBe(5);
  });

  // --- Evenimente ignorate ---

  it('STREAM_READY din idle nu face nimic', () => {
    actor.send({ type: 'STREAM_READY' });
    expect(actor.getSnapshot().value).toBe('idle');
  });

  it('STREAM_ERROR din playing nu face nimic', () => {
    actor.send({ type: 'PLAY', index: 0 });
    actor.send({ type: 'STREAM_READY' });
    actor.send({ type: 'STREAM_ERROR' });
    expect(actor.getSnapshot().value).toBe('playing');
  });
});
