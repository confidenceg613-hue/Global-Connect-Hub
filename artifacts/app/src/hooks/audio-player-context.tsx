/**
 * AudioPlayerContext — single shared audio player instance for the whole app.
 *
 * Wrap the app with <AudioPlayerProvider> once; every component that needs
 * the player (AudioPlayerBar, Library page, etc.) calls useSharedAudioPlayer()
 * to get the same HTMLAudioElement-backed instance.
 */
import { createContext, useContext } from "react";
import type { useAudioPlayer } from "./use-audio-player";

type AudioPlayerState = ReturnType<typeof useAudioPlayer>;

const AudioPlayerContext = createContext<AudioPlayerState | null>(null);

export const AudioPlayerProvider = AudioPlayerContext.Provider;

export function useSharedAudioPlayer(): AudioPlayerState {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error("useSharedAudioPlayer must be used inside <AudioPlayerProvider>");
  return ctx;
}
