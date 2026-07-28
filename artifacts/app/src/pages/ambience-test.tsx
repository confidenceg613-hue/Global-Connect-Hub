/**
 * Ancient Ambience — internal test & preview page
 * Route: /ambience-test
 *
 * Shows a live oscilloscope + per-layer status indicators.
 * Tap anywhere to start audio.
 */
import { useEffect, useRef, useState } from "react";

// ── Inline audio engine (mirrors use-ancient-ambience.ts) ─────────────────────
function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function buildDrone(ctx: AudioContext, master: GainNode) {
  const g = ctx.createGain(); g.gain.value = 0.18; g.connect(master);
  const lfo = ctx.createOscillator(); lfo.type = "sine"; lfo.frequency.value = 0.08;
  const lg = ctx.createGain(); lg.gain.value = 0.06; lfo.connect(lg); lg.connect(g.gain); lfo.start();
  const freqs = [55, 55.4];
  const oscs = freqs.map(f => {
    const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 320;
    o.connect(lp); lp.connect(g); o.start(); return o;
  });
  const sub = ctx.createOscillator(); sub.type = "sine"; sub.frequency.value = 27.5;
  const sg = ctx.createGain(); sg.gain.value = 0.22; sub.connect(sg); sg.connect(master); sub.start();
  return () => { oscs.forEach(o => o.stop()); lfo.stop(); sub.stop(); };
}

function buildWind(ctx: AudioContext, master: GainNode) {
  const sz = ctx.sampleRate * 2;
  const buf = ctx.createBuffer(1, sz, ctx.sampleRate);
  const d = buf.getChannelData(0); for (let i = 0; i < sz; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 800; bp.Q.value = 0.4;
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 300;
  const g = ctx.createGain(); g.gain.value = 0.07;
  src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(master); src.start();
  let stopped = false;
  const breathe = () => {
    if (stopped) return;
    g.gain.setTargetAtTime(rand(0.04, 0.12), ctx.currentTime, rand(4, 9) / 3);
    setTimeout(breathe, rand(4, 9) * 1000);
  };
  breathe();
  return () => { stopped = true; src.stop(); };
}

function buildDrum(ctx: AudioContext, master: GainNode, onHit: () => void) {
  let stopped = false;
  const hit = () => {
    if (stopped) return;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.18, ctx.sampleRate);
    const d = buf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 180;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.55, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    src.connect(lp); lp.connect(g); g.connect(master); src.start();
    onHit();
    setTimeout(hit, rand(1600, 2600));
  };
  const tid = setTimeout(hit, 1200);
  return () => { stopped = true; clearTimeout(tid); };
}

function buildChimes(ctx: AudioContext, master: GainNode, onPing: (f: number) => void) {
  const notes = [130.81, 146.83, 164.81, 196.0, 220.0];
  let stopped = false;
  const ping = () => {
    if (stopped) return;
    const freq = notes[Math.floor(Math.random() * notes.length)] * rand(0.98, 1.02);
    const osc = ctx.createOscillator(); osc.type = "sine"; osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, ctx.currentTime);
    g.gain.linearRampToValueAtTime(0.12, ctx.currentTime + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.8);
    osc.connect(g); g.connect(master); osc.start(); osc.stop(ctx.currentTime + 3);
    onPing(freq);
    setTimeout(ping, rand(6000, 18000));
  };
  const tid = setTimeout(ping, 3000);
  return () => { stopped = true; clearTimeout(tid); };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function AmbienceTest() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const cleanupRef = useRef<Array<() => void>>([]);

  const [started, setStarted] = useState(false);
  const [drumFlash, setDrumFlash] = useState(false);
  const [lastChime, setLastChime] = useState<number | null>(null);
  const [layers, setLayers] = useState({
    drone: false, wind: false, drum: false, chime: false,
  });

  const start = () => {
    if (ctxRef.current) return;
    const ctx = new AudioContext();
    ctxRef.current = ctx;

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyserRef.current = analyser;

    const master = ctx.createGain();
    master.gain.value = 0.82;
    master.connect(analyser);
    analyser.connect(ctx.destination);

    // Reverb
    const delay = ctx.createDelay(3); delay.delayTime.value = 0.38;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const rg = ctx.createGain(); rg.gain.value = 0.22;
    delay.connect(fb); fb.connect(delay); master.connect(rg); rg.connect(delay); delay.connect(ctx.destination);

    cleanupRef.current = [
      buildDrone(ctx, master),
      buildWind(ctx, master),
      buildDrum(ctx, master, () => { setDrumFlash(true); setTimeout(() => setDrumFlash(false), 180); }),
      buildChimes(ctx, master, (f) => setLastChime(Math.round(f))),
    ];

    setLayers({ drone: true, wind: true, drum: true, chime: true });
    setStarted(true);
  };

  // Oscilloscope draw loop
  useEffect(() => {
    const draw = () => {
      rafRef.current = requestAnimationFrame(draw);
      const canvas = canvasRef.current;
      const analyser = analyserRef.current;
      if (!canvas || !analyser) return;
      const ctx2 = canvas.getContext("2d")!;
      const W = canvas.width; const H = canvas.height;
      const data = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteTimeDomainData(data);

      ctx2.fillStyle = "rgba(10,6,2,0.45)";
      ctx2.fillRect(0, 0, W, H);

      ctx2.beginPath();
      ctx2.strokeStyle = "#D4A843";
      ctx2.lineWidth = 1.8;
      const slice = W / data.length;
      let x = 0;
      for (let i = 0; i < data.length; i++) {
        const v = data[i] / 128;
        const y = (v * H) / 2;
        i === 0 ? ctx2.moveTo(x, y) : ctx2.lineTo(x, y);
        x += slice;
      }
      ctx2.stroke();
    };
    rafRef.current = requestAnimationFrame(draw);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, []);

  useEffect(() => {
    return () => { cleanupRef.current.forEach(fn => fn()); ctxRef.current?.close(); };
  }, []);

  const noteNames: Record<number, string> = {
    131: "C3", 147: "D3", 165: "E3", 196: "G3", 220: "A3",
  };
  const noteName = lastChime ? (noteNames[lastChime] ?? `${lastChime}Hz`) : "—";

  return (
    <div
      onClick={start}
      style={{
        minHeight: "100vh", background: "#0a0602",
        display: "flex", flexDirection: "column", alignItems: "center",
        justifyContent: "center", gap: 28, padding: 24, cursor: started ? "default" : "pointer",
        fontFamily: "'Share Tech Mono', 'Courier New', monospace",
      }}
    >
      {/* Title */}
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#D4A843", fontSize: 11, letterSpacing: "0.25em", marginBottom: 8 }}>
          ANCIENT AMBIENCE ENGINE — INTERNAL TEST
        </div>
        <div style={{ color: "#7a5a20", fontSize: 13, letterSpacing: "0.12em" }}>
          {started ? "AUDIO ACTIVE — ALL LAYERS RUNNING" : "TAP ANYWHERE TO START AUDIO"}
        </div>
      </div>

      {/* Oscilloscope */}
      <div style={{ border: "1px solid #3a2a0a", borderRadius: 4, overflow: "hidden", position: "relative" }}>
        <canvas
          ref={canvasRef}
          width={560}
          height={140}
          style={{ display: "block", background: "#0a0602" }}
        />
        <div style={{
          position: "absolute", top: 6, left: 10,
          color: "#4a3010", fontSize: 10, letterSpacing: "0.15em",
        }}>
          WAVEFORM
        </div>
      </div>

      {/* Layer status grid */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, width: "100%", maxWidth: 560 }}>
        {[
          {
            key: "drone", label: "CAVE DRONE", desc: "Detuned sawtooth + sub-bass sine",
            detail: "55 Hz + 55.4 Hz + 27.5 Hz", active: layers.drone, pulse: layers.drone,
          },
          {
            key: "wind", label: "WIND BREATH", desc: "Bandpass-filtered white noise",
            detail: "Breathing: 4–9 s cycles", active: layers.wind, pulse: layers.wind,
          },
          {
            key: "drum", label: "TRIBAL BEAT", desc: "Low-pass noise burst, exp. decay",
            detail: drumFlash ? "▶ BEAT" : "Interval: 1.6–2.6 s", active: layers.drum, pulse: drumFlash,
          },
          {
            key: "chime", label: "STONE CHIME", desc: "Pentatonic sine ring (C D E G A)",
            detail: lastChime ? `Last ping: ${noteName}` : "Interval: 6–18 s", active: layers.chime, pulse: !!lastChime,
          },
        ].map(({ key, label, desc, detail, active, pulse }) => (
          <div
            key={key}
            style={{
              border: `1px solid ${active ? "#3a2a0a" : "#1a1208"}`,
              borderRadius: 4, padding: "14px 16px",
              background: active ? "rgba(40,24,4,0.6)" : "rgba(16,10,2,0.4)",
              transition: "border-color 0.3s",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{
                width: 8, height: 8, borderRadius: "50%",
                background: active ? (pulse ? "#F5A008" : "#7a5a20") : "#2a1a06",
                boxShadow: pulse && active ? "0 0 8px #F5A008" : "none",
                transition: "background 0.1s, box-shadow 0.1s",
              }} />
              <span style={{ color: active ? "#D4A843" : "#4a3010", fontSize: 10, letterSpacing: "0.18em" }}>
                {label}
              </span>
              <span style={{
                marginLeft: "auto", fontSize: 9, letterSpacing: "0.1em",
                color: active ? "#7a5020" : "#2a1a06",
              }}>
                {active ? "ACTIVE" : "IDLE"}
              </span>
            </div>
            <div style={{ color: "#5a3a10", fontSize: 11, marginBottom: 3 }}>{desc}</div>
            <div style={{ color: active ? "#8a6030" : "#3a2010", fontSize: 10, letterSpacing: "0.08em" }}>
              {detail}
            </div>
          </div>
        ))}
      </div>

      {/* Test results */}
      <div style={{ width: "100%", maxWidth: 560, border: "1px solid #1a1208", borderRadius: 4, padding: "14px 16px" }}>
        <div style={{ color: "#4a3010", fontSize: 10, letterSpacing: "0.18em", marginBottom: 10 }}>TEST RESULTS</div>
        {[
          { label: "Web Audio API", pass: typeof AudioContext !== "undefined" || typeof (window as any).webkitAudioContext !== "undefined" },
          { label: "MediaRecorder", pass: typeof MediaRecorder !== "undefined" },
          { label: "getUserMedia", pass: !!navigator.mediaDevices?.getUserMedia },
          { label: "AudioContext running", pass: ctxRef.current?.state === "running" },
          { label: "Analyser connected", pass: !!analyserRef.current },
          { label: "All 4 layers initialised", pass: Object.values(layers).every(Boolean) },
        ].map(({ label, pass }) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
            <span style={{ color: "#7a5a20", fontSize: 11 }}>{label}</span>
            <span style={{
              fontSize: 11, letterSpacing: "0.1em",
              color: pass ? "#D4A843" : "#6a3010",
            }}>
              {pass ? "PASS" : started ? "FAIL" : "—"}
            </span>
          </div>
        ))}
      </div>

      <div style={{ color: "#3a2a0a", fontSize: 10, letterSpacing: "0.1em", textAlign: "center" }}>
        PROCEDURAL · NO AUDIO FILES · WEB AUDIO API
      </div>
    </div>
  );
}
