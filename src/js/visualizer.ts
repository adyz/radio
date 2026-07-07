/**
 * Sound visualizer — five bars that move on the ACTUAL audio signal.
 *
 * The signal is read through element.captureStream() + AnalyserNode. Unlike
 * createMediaElementSource (the Web Audio approach reverted in 69a58f2),
 * capturing does NOT reroute playback through the AudioContext — the <audio>
 * elements keep playing natively, so the iOS media session and background
 * playback stay untouched. The analyser only watches a copy of the signal.
 *
 * All three app sounds (stream, loading tone, error tone) feed one analyser:
 * whatever is audible is what the bars show, no per-source switching.
 *
 * Where the real signal is unavailable the bars fall back to the declarative
 * CSS animation (input.css, gated by :not(.viz-live)):
 *   - browsers without captureStream (Safari/iOS, Firefox);
 *   - stations that don't send CORS headers (opaque data captures as
 *     silence — marked data-no-cors on their <option>);
 *   - before the first user gesture (AudioContext still suspended).
 * The live/CSS switch is a short zero-signal watchdog, same spirit as the
 * playback watchdog in radioMachine.
 */

import { visualizer, player, loadingNoise, errorNoise } from './dom';
import type { VizMode } from './radioCore';

const BAR_SCALE_MIN = 0.12;
// ~0.75s of exact digital silence at 60fps ⇒ no usable signal, use CSS
const SILENT_FRAMES_TO_FALLBACK = 45;
// While silent, periodically re-capture: a src swap ends the captured track
const RECONNECT_EVERY_FRAMES = 60;

// One frequency band per bar, bass → highs (bin ranges for fftSize 512
// at 44.1/48kHz ≈ 86–94Hz per bin), roughly log-spaced like an equalizer.
const BANDS: ReadonlyArray<readonly [number, number]> = [
  [0, 2], [3, 7], [8, 20], [21, 55], [56, 140],
];
// Radio streams are loudness-compressed: absolute levels sit near the top and
// barely move. Each band is therefore normalized against its own recent peak
// (a slowly decaying AGC), so the bars ride the beat, not the loudness war.
const PEAK_DECAY = 0.995; // per frame ≈ halves in ~2.3s
// Keep quiet-but-real sounds visible (the low loading tone reads ~0.02-0.06)
// while exact digital silence still shows as resting bars.
const PEAK_FLOOR = 0.02;
const bandPeaks = BANDS.map(() => PEAK_FLOOR);

const elements: HTMLMediaElement[] = [player, loadingNoise, errorNoise];
const bars = [...visualizer.querySelectorAll<HTMLElement>('.viz-bar')];

let ctx: AudioContext | null = null;
let analyser: AnalyserNode | null = null;
let freqData: Uint8Array<ArrayBuffer> | null = null;
const sources = new Map<HTMLMediaElement, MediaStreamAudioSourceNode>();

let rafId: number | null = null;
let silentFrames = 0;

const isSupported = () =>
  typeof AudioContext !== 'undefined' &&
  typeof (HTMLMediaElement.prototype as { captureStream?: unknown }).captureStream === 'function';

const prefersReducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const captureStreamOf = (el: HTMLMediaElement): MediaStream =>
  (el as HTMLMediaElement & { captureStream(): MediaStream }).captureStream();

/** (Re)tap one element. A new capture is needed after src changes: the old
 *  captured track ends and would read as permanent silence. */
function connect(el: HTMLMediaElement) {
  if (!ctx || !analyser) return;
  const stream = captureStreamOf(el);
  if (stream.getAudioTracks().length === 0) return; // nothing to tap yet
  sources.get(el)?.disconnect();
  const node = ctx.createMediaStreamSource(stream);
  node.connect(analyser);
  sources.set(el, node);
}

function connectAll() {
  for (const el of elements) connect(el);
}

/** Real data drives the bars ⇔ .viz-live; otherwise CSS animations do. */
function setLive(live: boolean) {
  if (visualizer.classList.contains('viz-live') === live) return;
  visualizer.classList.toggle('viz-live', live);
  if (!live) for (const bar of bars) bar.style.transform = '';
}

function tick() {
  rafId = requestAnimationFrame(tick);
  if (!analyser || !freqData) return;
  analyser.getByteFrequencyData(freqData);

  let total = 0;
  const scales: number[] = [];
  BANDS.forEach(([lo, hi], i) => {
    let sum = 0;
    for (let bin = lo; bin <= hi; bin++) sum += freqData![bin];
    const value = sum / ((hi - lo + 1) * 255);
    total += value;
    bandPeaks[i] = Math.max(value, bandPeaks[i] * PEAK_DECAY, PEAK_FLOOR);
    const norm = Math.min(1, value / bandPeaks[i]) ** 1.5; // punchier beats
    scales.push(BAR_SCALE_MIN + norm * (1 - BAR_SCALE_MIN));
  });

  if (total === 0) {
    silentFrames++;
    if (silentFrames % RECONNECT_EVERY_FRAMES === 30) connectAll();
    if (silentFrames >= SILENT_FRAMES_TO_FALLBACK) setLive(false);
    return;
  }

  silentFrames = 0;
  setLive(true);
  bars.forEach((bar, i) => { bar.style.transform = `scaleY(${scales[i].toFixed(3)})`; });
}

function stopLoop() {
  if (rafId !== null) cancelAnimationFrame(rafId);
  rafId = null;
  silentFrames = 0;
  setLive(false);
}

/** Called from user gestures — the only place an AudioContext may start. */
export function warmUpVisualizer() {
  if (!isSupported() || prefersReducedMotion()) return;
  if (!ctx) {
    ctx = new AudioContext();
    analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    // Snappy enough to show the beat, smooth enough not to flicker; the wide
    // dB window keeps compressed radio audio from clipping at the top.
    analyser.smoothingTimeConstant = 0.6;
    analyser.minDecibels = -70;
    analyser.maxDecibels = -10;
    freqData = new Uint8Array(analyser.frequencyBinCount);
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => { /* stays CSS */ });
  connectAll();
}

/** The state machine's declarative visualizer effect (applyFx). */
export function setVisualizerMode(mode: VizMode) {
  visualizer.dataset.viz = mode;
  if (mode === 'off') {
    stopLoop();
    return;
  }
  if (!ctx || prefersReducedMotion()) return; // CSS animation handles it
  connectAll(); // fresh capture: station/tone src may have just changed
  if (rafId === null) tick();
}
