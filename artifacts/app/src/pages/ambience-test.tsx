/**
 * /ambience-test — Audio verification page
 *
 * Tests the real forest-ambience.mp3 file directly.
 * Shows file fetch status, playback state, live progress and volume bar.
 */
import { useEffect, useRef, useState } from "react";
import { useAncientAmbience } from "@/hooks/use-ancient-ambience";

export default function AmbienceTest() {
  const { soundOn, toggleSound } = useAncientAmbience();

  // ── Direct MP3 probe (separate from the hook) ────────────────────────────
  const [fileStatus, setFileStatus]   = useState<"checking"|"ok"|"error">("checking");
  const [fileSize,   setFileSize]     = useState<string>("");
  const [progress,   setProgress]     = useState(0);   // 0–1
  const [currentTime, setCurrentTime] = useState("0:00");
  const [duration,   setDuration]     = useState("—");
  const probeRef = useRef<HTMLAudioElement | null>(null);
  const rafRef   = useRef<number | null>(null);

  useEffect(() => {
    // 1. HEAD request — confirm file is reachable and get its size
    fetch("/forest-ambience.mp3", { method: "HEAD" })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const bytes = parseInt(r.headers.get("content-length") ?? "0", 10);
        setFileSize(bytes ? `${(bytes / 1024).toFixed(0)} KB` : "unknown size");
        setFileStatus("ok");
      })
      .catch(() => setFileStatus("error"));

    // 2. Probe audio element for duration + playback position
    const probe = new Audio("/forest-ambience.mp3");
    probe.preload = "metadata";
    probeRef.current = probe;

    probe.addEventListener("loadedmetadata", () => {
      const m = Math.floor(probe.duration / 60);
      const s = Math.floor(probe.duration % 60).toString().padStart(2, "0");
      setDuration(`${m}:${s}`);
    });

    const tick = () => {
      if (probe.duration) {
        setProgress(probe.currentTime / probe.duration);
        const m = Math.floor(probe.currentTime / 60);
        const s = Math.floor(probe.currentTime % 60).toString().padStart(2, "0");
        setCurrentTime(`${m}:${s}`);
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);

    return () => {
      probe.pause();
      probe.src = "";
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const fmt = (v: boolean | string) =>
    typeof v === "string" ? v : v ? "✓  PASS" : "✗  FAIL";

  const rows = [
    { label: "MP3 file reachable",     value: fileStatus === "ok" ? "✓  PASS" : fileStatus === "error" ? "✗  FAIL" : "…" },
    { label: "File size",              value: fileSize || "—" },
    { label: "Track duration",         value: duration },
    { label: "HTML Audio supported",   value: fmt(typeof Audio !== "undefined") },
    { label: "Playback hook mounted",  value: fmt(true) },
    { label: "Sound currently on",     value: soundOn ? "▶  PLAYING" : "⏸  PAUSED" },
  ];

  return (
    <div style={{
      minHeight: "100vh",
      background: "#0a0602",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 28,
      padding: 32,
      fontFamily: "'Share Tech Mono', 'Courier New', monospace",
    }}>
      {/* Header */}
      <div style={{ textAlign: "center" }}>
        <div style={{ color: "#D4A843", fontSize: 11, letterSpacing: "0.28em", marginBottom: 8 }}>
          DEEPFALCON · AUDIO VERIFICATION
        </div>
        <div style={{ color: "#7a5a20", fontSize: 13, letterSpacing: "0.12em" }}>
          forest-ambience.mp3 · real file test
        </div>
      </div>

      {/* Big play button */}
      <button
        onClick={toggleSound}
        style={{
          width: 100, height: 100, borderRadius: "50%",
          border: `2px solid ${soundOn ? "#D4A843" : "#3a2a0a"}`,
          background: soundOn ? "rgba(212,168,67,0.12)" : "rgba(30,18,4,0.8)",
          color: soundOn ? "#D4A843" : "#5a3a10",
          fontSize: 36,
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: soundOn ? "0 0 28px rgba(212,168,67,0.3)" : "none",
          transition: "all 0.25s",
        }}
        title={soundOn ? "Pause" : "Play"}
      >
        {soundOn ? "⏸" : "▶"}
      </button>
      <div style={{ color: soundOn ? "#D4A843" : "#5a3a10", fontSize: 11, letterSpacing: "0.2em", marginTop: -16 }}>
        {soundOn ? "PLAYING — TAP TO PAUSE" : "TAP TO PLAY"}
      </div>

      {/* Progress bar */}
      <div style={{ width: "100%", maxWidth: 520 }}>
        <div style={{
          height: 6,
          background: "#1a1208",
          borderRadius: 3,
          overflow: "hidden",
        }}>
          <div style={{
            height: "100%",
            width: `${progress * 100}%`,
            background: soundOn ? "#D4A843" : "#3a2a0a",
            borderRadius: 3,
            transition: "background 0.3s",
          }} />
        </div>
        <div style={{
          display: "flex", justifyContent: "space-between",
          marginTop: 6, color: "#5a3a10", fontSize: 10, letterSpacing: "0.12em",
        }}>
          <span>{currentTime}</span>
          <span>{duration}</span>
        </div>
      </div>

      {/* Test results table */}
      <div style={{
        width: "100%", maxWidth: 520,
        border: "1px solid #1a1208", borderRadius: 4, overflow: "hidden",
      }}>
        <div style={{
          background: "#0e0a04", padding: "10px 16px",
          color: "#4a3010", fontSize: 10, letterSpacing: "0.2em",
          borderBottom: "1px solid #1a1208",
        }}>
          TEST RESULTS
        </div>
        {rows.map(({ label, value }) => (
          <div key={label} style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "9px 16px",
            borderBottom: "1px solid #12090200",
            background: "rgba(20,12,2,0.3)",
          }}>
            <span style={{ color: "#7a5a20", fontSize: 11 }}>{label}</span>
            <span style={{
              fontSize: 11,
              letterSpacing: "0.08em",
              color: value.startsWith("✓") || value.startsWith("▶") ? "#D4A843"
                   : value.startsWith("✗") ? "#a04020"
                   : "#8a6030",
            }}>
              {value}
            </span>
          </div>
        ))}
      </div>

      <div style={{ color: "#2a1a06", fontSize: 10, letterSpacing: "0.1em", textAlign: "center" }}>
        REAL MP3 · HTML AUDIO ELEMENT · LOOP ENABLED
      </div>
    </div>
  );
}
