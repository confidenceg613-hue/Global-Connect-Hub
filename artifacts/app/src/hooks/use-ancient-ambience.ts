/**
 * DeepFalcon Theme — "Eyes on the Ancient Sky"
 *
 * A fully composed ambient-folk song built entirely with the Web Audio API.
 * No audio files.  Sample-accurate scheduling so timing never drifts.
 *
 * Structure (loops forever):
 *   Intro  (8 bars) — gentle pad + bass + light percussion
 *   Theme A (8 bars) — main melody over chord progression
 *   Theme B (8 bars) — rising counter-melody, fuller texture
 *   Bridge  (4 bars) — sparse, only melody + deep bass
 *   Theme A (8 bars) — full reprise
 *
 * Key / mode : A Dorian  (A B C D E F# G)
 * Tempo      : 76 BPM  → beat = 789 ms
 * Time sig   : 4/4
 */

import { useEffect, useRef } from "react";

// ─────────────────────────────────────────────────────────────────────────────
//  Music theory helpers
// ─────────────────────────────────────────────────────────────────────────────

const BPM   = 76;
const BEAT  = 60 / BPM;          // seconds per beat
const BAR   = BEAT * 4;

/** Note frequencies.  Index: semitones above A2 (110 Hz). */
const A2 = 110;
function note(semitones: number): number {
  return A2 * Math.pow(2, semitones / 12);
}

// Named notes (semitones above A2)
const N: Record<string, number> = {
  A2:  0,  B2: 2,  C3: 3,  D3: 5,  E3: 7,  Fs3: 9,  G3: 10,
  A3: 12,  B3: 14, C4: 15, D4: 17, E4: 19, Fs4: 21, G4: 22,
  A4: 24,  B4: 26, C5: 27, D5: 29, E5: 31, Fs5: 33, G5: 34,
  A5: 36,
};
const f = (name: string) => note(N[name]);
const R = 0;   // rest

// ─────────────────────────────────────────────────────────────────────────────
//  Song data — [freq (0=rest), durationInBeats]
// ─────────────────────────────────────────────────────────────────────────────

type Step = [number, number];   // [freq, beats]

// Main melody — Theme A (32 beats = 8 bars)
const MELODY_A: Step[] = [
  [f("A4"), 1.5], [f("G4"), 0.5], [f("E4"), 1],   [f("D4"), 1],
  [f("E4"), 2],   [f("A4"), 1],   [f("G4"), 1],
  [f("C4"), 1],   [f("D4"), 1.5], [f("E4"), 0.5], [f("A4"), 2],
  [f("G4"), 1],   [f("E4"), 1],   [f("D4"), 2],
  // bar 5-8
  [f("A4"), 1.5], [f("B4"), 0.5], [f("C5"), 1],   [f("A4"), 1],
  [f("G4"), 2],   [f("E4"), 1],   [f("D4"), 1],
  [f("E4"), 1],   [f("G4"), 1],   [f("A4"), 2],
  [f("A4"), 4],
];

// Theme B — higher, more hopeful (32 beats)
const MELODY_B: Step[] = [
  [f("E5"), 1.5], [f("D5"), 0.5], [f("C5"), 1],   [f("B4"), 1],
  [f("A4"), 2],   [f("C5"), 1],   [f("D5"), 1],
  [f("E5"), 2],   [f("D5"), 1],   [f("C5"), 1],
  [f("B4"), 1],   [f("A4"), 3],
  // bar 5-8
  [f("G4"), 1],   [f("A4"), 1],   [f("C5"), 2],
  [f("B4"), 1.5], [f("A4"), 0.5], [f("G4"), 1],   [f("E4"), 1],
  [f("Fs4"),2],   [f("G4"), 1],   [f("A4"), 1],
  [f("A4"), 4],
];

// Bridge — sparse, descending (16 beats)
const MELODY_BRIDGE: Step[] = [
  [f("A4"), 2],   [R, 1],         [f("G4"), 1],
  [f("E4"), 2],   [f("D4"), 2],
  [f("C4"), 1.5], [f("D4"), 0.5], [f("E4"), 2],
  [f("A3"), 4],
];

// Bass line follows chord roots: Am – F – C – G (repeating per bar)
// Roots per bar (8 bars for themes, 4 for bridge)
const BASS_A     = [f("A2"), f("Fs3"), f("C3"), f("G2"),  f("A2"), f("Fs3"), f("E2"), f("A2")];
const BASS_B     = [f("A2"), f("G2"),  f("C3"), f("E2"),  f("D2"), f("G2"),  f("E2"), f("A2")];
const BASS_INTRO = [f("A2"), f("A2"),  f("E2"), f("E2"),  f("A2"), f("A2"),  f("G2"), f("A2")];
const BASS_BRIDGE= [f("A2"), f("E2"),  f("D2"), f("A2")];

// Chord voicings per bar — played as pad (low+mid+high of chord)
// [root, third, fifth] in Hz
const CHORDS_A: [number, number, number][] = [
  [f("A3"), f("C4"), f("E4")],   // Am
  [f("Fs3"),f("A3"), f("C4")],   // F# dim → colour chord
  [f("C3"), f("E3"), f("G3")],   // C
  [f("G2"), f("B2"), f("D3")],   // G
  [f("A3"), f("C4"), f("E4")],
  [f("D3"), f("Fs3"),f("A3")],   // D
  [f("E3"), f("G3"), f("B3")],   // Em
  [f("A3"), f("E4"), f("A4")],   // Am open
];

const CHORDS_B: [number, number, number][] = [
  [f("A3"), f("E4"), f("A4")],
  [f("G3"), f("B3"), f("D4")],
  [f("C3"), f("E3"), f("G3")],
  [f("E3"), f("G3"), f("B3")],
  [f("D3"), f("A3"), f("D4")],
  [f("G3"), f("B3"), f("D4")],
  [f("E3"), f("G3"), f("B3")],
  [f("A3"), f("C4"), f("E4")],
];

const CHORDS_INTRO = CHORDS_A.map(c => c.map(x => x * 0.5) as [number,number,number]);

// ─────────────────────────────────────────────────────────────────────────────
//  Audio primitives
// ─────────────────────────────────────────────────────────────────────────────

function createReverb(ctx: AudioContext): ConvolverNode {
  const len  = ctx.sampleRate * 2.8;
  const buf  = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

/** Play a single note with a nice sine+triangle blend (warm tone). */
function scheduleNote(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  startTime: number,
  duration: number,  // beats
  volume = 0.22,
  type: OscillatorType = "triangle",
) {
  if (freq === R) return;
  const dur = duration * BEAT;
  const attack  = Math.min(0.06, dur * 0.1);
  const release = Math.min(0.35, dur * 0.4);

  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.value = freq;

  // Slight vibrato for warmth
  const vib = ctx.createOscillator();
  vib.frequency.value = 4.8;
  const vibGain = ctx.createGain();
  vibGain.gain.value = freq * 0.005;
  vib.connect(vibGain);
  vibGain.connect(osc.frequency);

  const g = ctx.createGain();
  g.gain.setValueAtTime(0, startTime);
  g.gain.linearRampToValueAtTime(volume, startTime + attack);
  g.gain.setValueAtTime(volume, startTime + dur - release);
  g.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

  osc.connect(g);
  g.connect(dest);

  vib.start(startTime);
  osc.start(startTime);
  vib.stop(startTime + dur + 0.05);
  osc.stop(startTime + dur + 0.05);
}

/** Pad chord — soft sine waves for each note */
function scheduleChord(
  ctx: AudioContext,
  dest: AudioNode,
  chord: [number, number, number],
  startTime: number,
  bars: number,
  volume = 0.07,
) {
  const dur = bars * BAR;
  const attack  = 0.4;
  const release = 0.8;

  chord.forEach((freq, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;
    // Tiny detuning for richness
    osc.detune.value = [-4, 0, 3][i];

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(volume * [1, 0.7, 0.55][i], startTime + attack);
    g.gain.setValueAtTime(volume * [1, 0.7, 0.55][i], startTime + dur - release);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

    osc.connect(g);
    g.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.05);
  });
}

/** Bass note — warm sine + subtle second harmonic */
function scheduleBass(
  ctx: AudioContext,
  dest: AudioNode,
  freq: number,
  startTime: number,
  bars: number,
  volume = 0.28,
) {
  const dur = bars * BAR;
  [freq, freq * 2].forEach((f, i) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = f;

    const g = ctx.createGain();
    const vol = volume * [1, 0.18][i];
    g.gain.setValueAtTime(0, startTime);
    g.gain.linearRampToValueAtTime(vol, startTime + 0.08);
    g.gain.setValueAtTime(vol, startTime + dur - 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

    osc.connect(g);
    g.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + dur + 0.05);
  });
}

/** Kick drum — pitched sine thump */
function scheduleKick(ctx: AudioContext, dest: AudioNode, startTime: number, vol = 0.5) {
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(150, startTime);
  osc.frequency.exponentialRampToValueAtTime(40, startTime + 0.12);

  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, startTime);
  g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.28);

  osc.connect(g); g.connect(dest);
  osc.start(startTime); osc.stop(startTime + 0.35);
}

/** Hi-hat / shaker — filtered noise burst */
function scheduleHat(ctx: AudioContext, dest: AudioNode, startTime: number, vol = 0.08) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.05, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource(); src.buffer = buf;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 7000;

  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, startTime);
  g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.05);

  src.connect(hp); hp.connect(g); g.connect(dest);
  src.start(startTime);
}

/** Frame drum — low noise thud */
function scheduleFrame(ctx: AudioContext, dest: AudioNode, startTime: number, vol = 0.18) {
  const buf = ctx.createBuffer(1, ctx.sampleRate * 0.12, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

  const src = ctx.createBufferSource(); src.buffer = buf;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 260;

  const g = ctx.createGain();
  g.gain.setValueAtTime(vol, startTime);
  g.gain.exponentialRampToValueAtTime(0.001, startTime + 0.22);

  src.connect(lp); lp.connect(g); g.connect(dest);
  src.start(startTime);
}

// ─────────────────────────────────────────────────────────────────────────────
//  Section schedulers
// ─────────────────────────────────────────────────────────────────────────────

/** Schedule a melody sequence, returns the time after the last note. */
function scheduleMelody(
  ctx: AudioContext, dest: AudioNode,
  steps: Step[], startTime: number, vol = 0.22,
): number {
  let t = startTime;
  for (const [freq, beats] of steps) {
    scheduleNote(ctx, dest, freq, t, beats, vol);
    t += beats * BEAT;
  }
  return t;
}

/** Schedule chords + bass for N bars from a chord/bass array. */
function scheduleHarmony(
  ctx: AudioContext,
  chordDest: AudioNode,
  bassDest: AudioNode,
  chords: [number,number,number][],
  bassNotes: number[],
  startTime: number,
) {
  chords.forEach((chord, i) => {
    scheduleChord(ctx, chordDest, chord, startTime + i * BAR, 1);
    scheduleBass(ctx, bassDest, bassNotes[i], startTime + i * BAR, 1);
  });
}

/** Percussion pattern for N bars.  Pattern: kick on 1+3, hat on every beat, frame on 2+4. */
function schedulePercussion(
  ctx: AudioContext, dest: AudioNode,
  startTime: number, bars: number, vol = 1,
) {
  for (let b = 0; b < bars * 4; b++) {
    const t = startTime + b * BEAT;
    const beat = b % 4;   // 0-based beat within bar
    if (beat === 0 || beat === 2) scheduleKick(ctx, dest, t, 0.5 * vol);
    if (beat === 1 || beat === 3) scheduleFrame(ctx, dest, t, 0.18 * vol);
    scheduleHat(ctx, dest, t, 0.06 * vol);
    scheduleHat(ctx, dest, t + BEAT * 0.5, 0.035 * vol);  // off-beat hat
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  Song scheduler — schedules one full pass; call again with new startTime to loop
// ─────────────────────────────────────────────────────────────────────────────

function scheduleSong(
  ctx: AudioContext,
  melodyDest: AudioNode,
  chordDest: AudioNode,
  bassDest: AudioNode,
  percDest: AudioNode,
  startTime: number,
): number {
  let t = startTime;

  // ── Intro (8 bars) — no melody, just pads + bass + soft perc ──────────────
  scheduleHarmony(ctx, chordDest, bassDest, CHORDS_INTRO, BASS_INTRO, t);
  schedulePercussion(ctx, percDest, t, 8, 0.45);
  t += 8 * BAR;

  // ── Theme A (8 bars) ───────────────────────────────────────────────────────
  scheduleMelody(ctx, melodyDest, MELODY_A, t);
  scheduleHarmony(ctx, chordDest, bassDest, CHORDS_A, BASS_A, t);
  schedulePercussion(ctx, percDest, t, 8, 0.85);
  t += 8 * BAR;

  // ── Theme B (8 bars) ───────────────────────────────────────────────────────
  scheduleMelody(ctx, melodyDest, MELODY_B, t, 0.2);
  scheduleHarmony(ctx, chordDest, bassDest, CHORDS_B, BASS_B, t);
  schedulePercussion(ctx, percDest, t, 8, 1.0);
  t += 8 * BAR;

  // ── Bridge (4 bars) ────────────────────────────────────────────────────────
  scheduleMelody(ctx, melodyDest, MELODY_BRIDGE, t, 0.25);
  // Only bass (no chords, very sparse)
  BASS_BRIDGE.forEach((b, i) => scheduleBass(ctx, bassDest, b, t + i * BAR, 1, 0.22));
  schedulePercussion(ctx, percDest, t, 4, 0.35);
  t += 4 * BAR;

  // ── Theme A reprise (8 bars, slightly louder) ──────────────────────────────
  scheduleMelody(ctx, melodyDest, MELODY_A, t, 0.26);
  scheduleHarmony(ctx, chordDest, bassDest, CHORDS_A, BASS_A, t);
  schedulePercussion(ctx, percDest, t, 8, 1.0);
  t += 8 * BAR;

  return t;  // time when this pass ends
}

// ─────────────────────────────────────────────────────────────────────────────
//  Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useAncientAmbience() {
  const ctxRef      = useRef<AudioContext | null>(null);
  const startedRef  = useRef(false);
  const loopTimerRef= useRef<ReturnType<typeof setTimeout> | null>(null);

  const startMusic = () => {
    if (startedRef.current) return;
    startedRef.current = true;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    // ── Signal chain ──────────────────────────────────────────────────────
    // Each layer has its own gain so we can balance them independently.
    const masterGain = ctx.createGain();
    masterGain.gain.value = 0.88;

    const reverb = createReverb(ctx);
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.28;

    masterGain.connect(ctx.destination);
    masterGain.connect(reverbGain);
    reverbGain.connect(reverb);
    reverb.connect(ctx.destination);

    const melodyGain = ctx.createGain(); melodyGain.gain.value = 1.0;  melodyGain.connect(masterGain);
    const chordGain  = ctx.createGain(); chordGain.gain.value  = 0.9;  chordGain.connect(masterGain);
    const bassGain   = ctx.createGain(); bassGain.gain.value   = 1.1;  bassGain.connect(masterGain);
    const percGain   = ctx.createGain(); percGain.gain.value   = 0.75; percGain.connect(masterGain);

    // ── Scheduling loop ───────────────────────────────────────────────────
    // Schedule the next pass ~2 bars before the current one ends so there is
    // no gap.  Uses ctx.currentTime (wall clock) for drift-free scheduling.
    const LOOKAHEAD_S = 2 * BAR;

    let nextStart = ctx.currentTime + 0.25;  // small startup delay

    const scheduleNext = () => {
      const passEnd = scheduleSong(ctx, melodyGain, chordGain, bassGain, percGain, nextStart);
      nextStart = passEnd;
      // Re-schedule LOOKAHEAD_S before this pass ends
      const delayMs = (passEnd - ctx.currentTime - LOOKAHEAD_S) * 1000;
      loopTimerRef.current = setTimeout(scheduleNext, Math.max(0, delayMs));
    };

    scheduleNext();
  };

  useEffect(() => {
    const onGesture = () => {
      startMusic();
      document.removeEventListener("click",      onGesture);
      document.removeEventListener("touchstart", onGesture);
      document.removeEventListener("keydown",    onGesture);
    };

    document.addEventListener("click",      onGesture, { once: true });
    document.addEventListener("touchstart", onGesture, { once: true });
    document.addEventListener("keydown",    onGesture, { once: true });

    const onVisibility = () => {
      if (!ctxRef.current) return;
      if (document.visibilityState === "hidden") ctxRef.current.suspend();
      else                                        ctxRef.current.resume();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("click",            onGesture);
      document.removeEventListener("touchstart",       onGesture);
      document.removeEventListener("keydown",          onGesture);
      document.removeEventListener("visibilitychange", onVisibility);
      if (loopTimerRef.current) clearTimeout(loopTimerRef.current);
      ctxRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
