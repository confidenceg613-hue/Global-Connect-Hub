/**
 * Ancient Ambience Engine
 *
 * Generates a continuous stone-age soundscape entirely via the Web Audio API —
 * no audio files required.  Layers:
 *   1. Deep cave drone  — two detuned oscillators + slow tremolo
 *   2. Wind breath      — shaped noise through a resonant bandpass filter
 *   3. Tribal heartbeat — low-frequency noise bursts with exponential decay
 *   4. Stone chime      — sparse, randomly pitched sine pings
 *
 * Starts on first user interaction (browsers block audio until a gesture).
 * Resumes automatically after tab visibility returns.
 */

import { useEffect, useRef } from "react";

// ── helpers ──────────────────────────────────────────────────────────────────

function ramp(param: AudioParam, ctx: AudioContext, value: number, duration: number) {
  param.setTargetAtTime(value, ctx.currentTime, duration);
}

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

// ── layer builders ───────────────────────────────────────────────────────────

function buildDrone(ctx: AudioContext, master: GainNode): () => void {
  const gainNode = ctx.createGain();
  gainNode.gain.value = 0.18;
  gainNode.connect(master);

  // LFO for slow tremolo
  const lfo = ctx.createOscillator();
  lfo.type = "sine";
  lfo.frequency.value = 0.08;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 0.06;
  lfo.connect(lfoGain);
  lfoGain.connect(gainNode.gain);
  lfo.start();

  // Two slightly detuned oscillators for thickness
  const freqs = [55, 55.4]; // A1 + cent-shifted
  const oscs = freqs.map((f) => {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = f;
    // gentle low-pass to remove harshness
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 320;
    lp.Q.value = 1;
    o.connect(lp);
    lp.connect(gainNode);
    o.start();
    return o;
  });

  // Sub-octave sine for depth
  const sub = ctx.createOscillator();
  sub.type = "sine";
  sub.frequency.value = 27.5; // A0
  const subGain = ctx.createGain();
  subGain.gain.value = 0.22;
  sub.connect(subGain);
  subGain.connect(master);
  sub.start();

  return () => {
    oscs.forEach((o) => o.stop());
    lfo.stop();
    sub.stop();
  };
}

function buildWind(ctx: AudioContext, master: GainNode): () => void {
  const bufferSize = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;

  const bp = ctx.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 800;
  bp.Q.value = 0.4;

  const hp = ctx.createBiquadFilter();
  hp.type = "highpass";
  hp.frequency.value = 300;

  const gain = ctx.createGain();
  gain.gain.value = 0.07;

  source.connect(bp);
  bp.connect(hp);
  hp.connect(gain);
  gain.connect(master);
  source.start();

  // Slowly breathe the wind in and out
  let stopped = false;
  const breathe = () => {
    if (stopped) return;
    const next = rand(0.04, 0.12);
    const dur = rand(4, 9);
    gain.gain.setTargetAtTime(next, ctx.currentTime, dur / 3);
    setTimeout(breathe, dur * 1000);
  };
  breathe();

  return () => {
    stopped = true;
    source.stop();
  };
}

function buildDrum(ctx: AudioContext, master: GainNode): () => void {
  let stopped = false;

  const hit = () => {
    if (stopped) return;

    // Noise burst
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const src = ctx.createBufferSource();
    src.buffer = buf;

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 180;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

    src.connect(lp);
    lp.connect(g);
    g.connect(master);
    src.start();

    // Schedule next beat — slightly irregular for organic feel
    const interval = rand(1600, 2600);
    setTimeout(hit, interval);
  };

  // Start after a short delay so it doesn't clash with initial drone attack
  const tid = setTimeout(hit, 1200);
  return () => {
    stopped = true;
    clearTimeout(tid);
  };
}

function buildChimes(ctx: AudioContext, master: GainNode): () => void {
  let stopped = false;

  // Pentatonic scale in the 3rd octave — sounds ancient/meditative
  const notes = [130.81, 146.83, 164.81, 196.0, 220.0]; // C3 D3 E3 G3 A3

  const ping = () => {
    if (stopped) return;

    const freq = notes[Math.floor(Math.random() * notes.length)] * rand(0.98, 1.02);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = freq;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.8);

    osc.connect(g);
    g.connect(master);
    osc.start();
    osc.stop(ctx.currentTime + 3.0);

    const nextIn = rand(6000, 18000);
    setTimeout(ping, nextIn);
  };

  const tid = setTimeout(ping, 3000);
  return () => {
    stopped = true;
    clearTimeout(tid);
  };
}

// ── hook ─────────────────────────────────────────────────────────────────────

export function useAncientAmbience() {
  const ctxRef = useRef<AudioContext | null>(null);
  const startedRef = useRef(false);
  const cleanupFnsRef = useRef<Array<() => void>>([]);

  const start = () => {
    if (startedRef.current) return;
    startedRef.current = true;

    const ctx = new AudioContext();
    ctxRef.current = ctx;

    // Master output with slight reverb (convolver)
    const master = ctx.createGain();
    master.gain.value = 0.82;
    master.connect(ctx.destination);

    // Simple reverb via delay feedback
    const delay = ctx.createDelay(3);
    delay.delayTime.value = 0.38;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.28;
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = 0.22;
    delay.connect(feedback);
    feedback.connect(delay);
    master.connect(reverbGain);
    reverbGain.connect(delay);
    delay.connect(ctx.destination);

    cleanupFnsRef.current = [
      buildDrone(ctx, master),
      buildWind(ctx, master),
      buildDrum(ctx, master),
      buildChimes(ctx, master),
    ];
  };

  const suspend = () => ctxRef.current?.suspend();
  const resume = () => ctxRef.current?.resume();

  useEffect(() => {
    const onGesture = () => {
      start();
      // Keep listeners for future gestures that resume a suspended context
      document.removeEventListener("click", onGesture);
      document.removeEventListener("touchstart", onGesture);
      document.removeEventListener("keydown", onGesture);
    };

    document.addEventListener("click", onGesture, { once: true });
    document.addEventListener("touchstart", onGesture, { once: true });
    document.addEventListener("keydown", onGesture, { once: true });

    const onVisibility = () => {
      if (!ctxRef.current) return;
      if (document.visibilityState === "hidden") suspend();
      else resume();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("click", onGesture);
      document.removeEventListener("touchstart", onGesture);
      document.removeEventListener("keydown", onGesture);
      document.removeEventListener("visibilitychange", onVisibility);
      cleanupFnsRef.current.forEach((fn) => fn());
      ctxRef.current?.close();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
}
