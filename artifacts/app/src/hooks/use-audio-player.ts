/**
 * use-audio-player.ts
 *
 * Central audio player hook.  Replaces use-ancient-ambience.
 * - Loads the built-in forest track by default.
 * - Accepts an external objectURL (from the library) via playTrack().
 * - Exposes soundOn, progress (0-1), currentTime, duration, toggleSound, playTrack.
 */
import { useEffect, useRef, useState, useCallback } from "react";

const DEFAULT_SRC  = "/forest-ambience.mp3";
const DEFAULT_NAME = "Forest Ambience";
const TARGET_VOL   = 0.85;
const FADE_IN_MS   = 2500;
const FADE_OUT_MS  = 500;

export function useAudioPlayer() {
  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const fadeRef     = useRef<number | null>(null);
  const objUrlRef   = useRef<string | null>(null);  // currently loaded object URL (to revoke on change)

  const [soundOn,     setSoundOn]     = useState(false);
  const [trackName,   setTrackName]   = useState(DEFAULT_NAME);
  const [progress,    setProgress]    = useState(0);
  const [currentTime, setCurrentTime] = useState("0:00");
  const [duration,    setDuration]    = useState("—");

  const fmtTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60).toString().padStart(2, "0");
    return `${m}:${sec}`;
  };

  // ── Internal ──────────────────────────────────────────────────────────────

  function getAudio(src: string): HTMLAudioElement {
    if (!audioRef.current) {
      const el = new Audio(src);
      el.loop    = true;
      el.preload = "auto";
      el.volume  = 0;
      el.addEventListener("loadedmetadata", () => {
        setDuration(fmtTime(el.duration));
      });
      audioRef.current = el;
    }
    return audioRef.current;
  }

  function clearFade() {
    if (fadeRef.current !== null) { clearInterval(fadeRef.current); fadeRef.current = null; }
  }

  function fadeIn(audio: HTMLAudioElement) {
    clearFade();
    audio.volume = 0;
    const steps = 50, stepMs = FADE_IN_MS / steps, step = TARGET_VOL / steps;
    fadeRef.current = window.setInterval(() => {
      audio.volume = Math.min(audio.volume + step, TARGET_VOL);
      if (audio.volume >= TARGET_VOL) clearFade();
    }, stepMs);
  }

  function fadeOut(audio: HTMLAudioElement, onDone: () => void) {
    clearFade();
    const steps = 20, stepMs = FADE_OUT_MS / steps, drop = audio.volume / steps;
    fadeRef.current = window.setInterval(() => {
      audio.volume = Math.max(0, audio.volume - drop);
      if (audio.volume <= 0.001) { clearFade(); audio.pause(); onDone(); }
    }, stepMs);
  }

  // ── RAF for progress bar ─────────────────────────────────────────────────

  useEffect(() => {
    let raf: number;
    const tick = () => {
      const a = audioRef.current;
      if (a && a.duration) {
        setProgress(a.currentTime / a.duration);
        setCurrentTime(fmtTime(a.currentTime));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // ── Visibility pause / resume ────────────────────────────────────────────

  useEffect(() => {
    const onVis = () => {
      const a = audioRef.current;
      if (!a) return;
      if (document.visibilityState === "hidden") a.pause();
      else if (soundOn) a.play().catch(() => {});
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      clearFade();
      audioRef.current?.pause();
    };
  }, [soundOn]);

  // ── Public API ────────────────────────────────────────────────────────────

  const startMusic = useCallback(() => {
    const audio = getAudio(DEFAULT_SRC);
    audio.play().then(() => {
      fadeIn(audio);
      setSoundOn(true);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSound = useCallback(() => {
    if (soundOn) {
      const a = audioRef.current;
      if (a) fadeOut(a, () => setSoundOn(false));
    } else {
      startMusic();
    }
  }, [soundOn, startMusic]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Play a library track by object-URL and display name. */
  const playTrack = useCallback((objectUrl: string, name: string) => {
    // Tear down the current element
    clearFade();
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    // Revoke previous object URL if any
    if (objUrlRef.current) {
      URL.revokeObjectURL(objUrlRef.current);
    }
    objUrlRef.current = objectUrl;

    setTrackName(name);
    setProgress(0);
    setCurrentTime("0:00");
    setDuration("—");

    const el = new Audio(objectUrl);
    el.loop    = true;
    el.preload = "auto";
    el.volume  = 0;
    el.addEventListener("loadedmetadata", () => setDuration(fmtTime(el.duration)));
    audioRef.current = el;

    el.play().then(() => {
      fadeIn(el);
      setSoundOn(true);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /** Seek to fraction (0-1) */
  const seek = useCallback((frac: number) => {
    const a = audioRef.current;
    if (a && a.duration) a.currentTime = frac * a.duration;
  }, []);

  return { soundOn, trackName, progress, currentTime, duration, toggleSound, startMusic, playTrack, seek };
}
