/**
 * use-ancient-ambience.ts
 *
 * Plays the DeepFalcon forest soundscape (forest-ambience.mp3) via a standard
 * HTML <audio> element.  The "Play forest sound" button in App.tsx is the
 * sole trigger — there is no competing global gesture listener that could
 * race with the button's onClick and immediately pause the track.
 *
 * Looping and a gentle 3-second fade-in are handled here.
 * The returned { soundOn, toggleSound } interface is unchanged so App.tsx
 * needs no modification.
 */

import { useEffect, useRef, useState } from "react";

const AUDIO_SRC    = "/forest-ambience.mp3";
const TARGET_VOL   = 0.85;   // final volume after fade-in
const FADE_IN_MS   = 3000;   // ramp 0 → TARGET_VOL over 3 s
const FADE_OUT_MS  = 600;    // ramp → 0 over 0.6 s

export function useAncientAmbience() {
  const audioRef   = useRef<HTMLAudioElement | null>(null);
  const fadeRef    = useRef<number | null>(null);
  const [soundOn, setSoundOn] = useState(false);

  // ── Helpers ─────────────────────────────────────────────────────────────────

  function getAudio(): HTMLAudioElement {
    if (!audioRef.current) {
      const el   = new Audio(AUDIO_SRC);
      el.loop    = true;
      el.preload = "auto";
      el.volume  = 0;
      audioRef.current = el;
    }
    return audioRef.current;
  }

  function clearFade() {
    if (fadeRef.current !== null) {
      clearInterval(fadeRef.current);
      fadeRef.current = null;
    }
  }

  function fadeIn(audio: HTMLAudioElement) {
    clearFade();
    audio.volume = 0;
    const steps   = 60;
    const stepMs  = FADE_IN_MS / steps;
    const stepVol = TARGET_VOL / steps;
    fadeRef.current = window.setInterval(() => {
      audio.volume = Math.min(audio.volume + stepVol, TARGET_VOL);
      if (audio.volume >= TARGET_VOL) clearFade();
    }, stepMs);
  }

  function fadeOut(audio: HTMLAudioElement, onDone: () => void) {
    clearFade();
    const steps   = 20;
    const stepMs  = FADE_OUT_MS / steps;
    const drop    = audio.volume / steps;
    fadeRef.current = window.setInterval(() => {
      audio.volume = Math.max(0, audio.volume - drop);
      if (audio.volume <= 0.001) {
        clearFade();
        audio.pause();
        onDone();
      }
    }, stepMs);
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  const startMusic = () => {
    const audio = getAudio();
    audio.play().then(() => {
      fadeIn(audio);
      setSoundOn(true);
    }).catch(() => {
      // Autoplay blocked — user needs to tap again
    });
  };

  const toggleSound = () => {
    if (soundOn) {
      fadeOut(getAudio(), () => setSoundOn(false));
    } else {
      startMusic();
    }
  };

  // ── Pause / resume on tab visibility change ─────────────────────────────────

  useEffect(() => {
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
      document.removeEventListener("visibilitychange", onVisibility);
      clearFade();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, [soundOn]);

  return { soundOn, toggleSound, startMusic };
}
