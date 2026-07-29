/**
 * use-ancient-ambience.ts
 *
 * Plays the DeepFalcon forest soundscape (forest-ambience.mp3) via a standard
 * HTML <audio> element so the real recording is heard, not a synthesised
 * approximation.  Looping and a gentle 3-second fade-in are handled here.
 *
 * Browsers require a user gesture before audio can start, so playback is
 * deferred until the first click/touch/keydown — identical to the old
 * behaviour.  The returned { soundOn, toggleSound } interface is unchanged
 * so App.tsx needs no modification.
 */

import { useEffect, useRef, useState } from "react";

const AUDIO_SRC = "/forest-ambience.mp3";
const TARGET_VOLUME = 0.82;   // final volume after fade-in (0–1)
const FADE_DURATION = 3000;   // ms to ramp from 0 → TARGET_VOLUME

export function useAncientAmbience() {
  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const fadeRef    = useRef<number | null>(null);
  const startedRef = useRef(false);
  const [soundOn, setSoundOn] = useState(false);

  // ── Fade helpers ────────────────────────────────────────────────────────────

  function fadeIn(audio: HTMLAudioElement) {
    audio.volume = 0;
    const steps     = 60;
    const stepMs    = FADE_DURATION / steps;
    const stepVol   = TARGET_VOLUME / steps;
    let   current   = 0;

    if (fadeRef.current) clearInterval(fadeRef.current);
    fadeRef.current = window.setInterval(() => {
      current += stepVol;
      audio.volume = Math.min(current, TARGET_VOLUME);
      if (audio.volume >= TARGET_VOLUME) {
        if (fadeRef.current) clearInterval(fadeRef.current);
        fadeRef.current = null;
      }
    }, stepMs);
  }

  function fadeOut(audio: HTMLAudioElement, onDone?: () => void) {
    if (fadeRef.current) clearInterval(fadeRef.current);
    const steps   = 30;
    const stepMs  = 600 / steps;                  // 0.6s fade-out
    const stepVol = audio.volume / steps;

    fadeRef.current = window.setInterval(() => {
      audio.volume = Math.max(0, audio.volume - stepVol);
      if (audio.volume <= 0.001) {
        audio.pause();
        if (fadeRef.current) clearInterval(fadeRef.current);
        fadeRef.current = null;
        onDone?.();
      }
    }, stepMs);
  }

  // ── Core play / pause ───────────────────────────────────────────────────────

  function ensureAudio(): HTMLAudioElement {
    if (!audioRef.current) {
      const el       = new Audio(AUDIO_SRC);
      el.loop        = true;
      el.preload     = "auto";
      audioRef.current = el;
    }
    return audioRef.current;
  }

  const startMusic = () => {
    const audio = ensureAudio();
    if (!startedRef.current) {
      startedRef.current = true;
    }
    audio.play().catch(() => {
      // Autoplay blocked — will retry on next gesture
      startedRef.current = false;
    });
    fadeIn(audio);
    setSoundOn(true);
  };

  const toggleSound = () => {
    const audio = ensureAudio();
    if (soundOn) {
      fadeOut(audio, () => setSoundOn(false));
    } else {
      startMusic();
    }
  };

  // ── Auto-start on first user gesture ────────────────────────────────────────

  useEffect(() => {
    const onGesture = () => {
      if (!startedRef.current) startMusic();
      document.removeEventListener("click",      onGesture);
      document.removeEventListener("touchstart", onGesture);
      document.removeEventListener("keydown",    onGesture);
    };

    document.addEventListener("click",      onGesture, { once: true });
    document.addEventListener("touchstart", onGesture, { once: true });
    document.addEventListener("keydown",    onGesture, { once: true });

    // Pause when tab is hidden, resume when visible
    const onVisibility = () => {
      const audio = audioRef.current;
      if (!audio) return;
      if (document.visibilityState === "hidden") {
        audio.pause();
      } else if (soundOn) {
        audio.play().catch(() => {});
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      document.removeEventListener("click",            onGesture);
      document.removeEventListener("touchstart",       onGesture);
      document.removeEventListener("keydown",          onGesture);
      document.removeEventListener("visibilitychange", onVisibility);
      if (fadeRef.current) clearInterval(fadeRef.current);
      audioRef.current?.pause();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return { soundOn, toggleSound, startMusic };
}
