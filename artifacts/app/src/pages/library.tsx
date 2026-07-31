/**
 * Library page — full-screen audio library accessible from the main nav.
 * Mirrors the library modal from the AudioPlayerBar but as a proper page.
 */
import { useRef, useState } from "react";
import { Play, Pause, Upload, Trash2, Music2, HardDrive } from "lucide-react";
import { useAudioLibrary, fmtBytes, type TrackMeta } from "@/hooks/use-audio-library";
import { useAudioPlayer } from "@/hooks/use-audio-player";
import { AppLayout } from "@/components/layout/app-layout";

const MAX_MB = 50;

export default function LibraryPage() {
  const { tracks, usedBytes, maxBytes, loading, error, addTrack, removeTrack, getObjectUrl } =
    useAudioLibrary();
  const { playTrack, soundOn, trackName } = useAudioPlayer();
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  const usedPct = Math.min(100, (usedBytes / maxBytes) * 100);

  const handleFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploadMsg(null);
    for (const f of Array.from(files)) {
      const res = await addTrack(f);
      if (!res.ok) { setUploadMsg(res.reason ?? "Upload failed"); return; }
    }
    setUploadMsg("Uploaded successfully.");
    setTimeout(() => setUploadMsg(null), 3000);
  };

  const handlePlay = async (track: TrackMeta) => {
    const url = await getObjectUrl(track.id);
    if (!url) return;
    setActiveId(track.id);
    playTrack(url, track.name);
  };

  const handlePlayBuiltIn = () => {
    setActiveId(null);
    playTrack("/forest-ambience.mp3", "Forest Ambience");
  };

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Music2 size={20} className="text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-foreground" style={{ fontFamily: "Syne, system-ui, sans-serif" }}>
              Audio Library
            </h1>
            <p className="text-xs text-muted-foreground font-mono tracking-wide">
              LOCAL STORAGE · UP TO {MAX_MB} MB · WORKS OFFLINE
            </p>
          </div>
        </div>

        {/* Storage gauge */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-2">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              <HardDrive size={12} /> Storage Used
            </span>
            <span className={usedPct > 85 ? "text-red-400" : "text-amber-400"}>
              {fmtBytes(usedBytes)} / {MAX_MB} MB
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-amber-500/10 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-500"
              style={{
                width: `${usedPct}%`,
                background:
                  usedPct > 85
                    ? "linear-gradient(90deg,#a04020,#c05030)"
                    : "linear-gradient(90deg,#92400e,#D4A843)",
              }}
            />
          </div>
        </div>

        {/* Upload zone */}
        <div>
          <input
            ref={fileRef}
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
            multiple
            className="hidden"
            onChange={e => handleFiles(e.target.files)}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="w-full py-5 rounded-xl border-2 border-dashed border-amber-500/20 bg-amber-500/5
              hover:border-amber-500/50 hover:bg-amber-500/10 transition-all duration-200
              text-amber-700 hover:text-amber-400 font-mono text-xs tracking-widest
              flex flex-col items-center gap-2 group"
          >
            <Upload size={20} className="group-hover:scale-110 transition-transform" />
            UPLOAD AUDIO FILE
            <span className="text-[10px] text-muted-foreground tracking-normal font-sans normal-case">
              MP3, WAV, OGG, M4A, AAC, FLAC supported
            </span>
          </button>
          {uploadMsg && (
            <p className={`mt-2 text-center text-xs font-mono ${
              uploadMsg.startsWith("Up") && !uploadMsg.includes("fail")
                ? "text-amber-400"
                : "text-red-400"
            }`}>
              {uploadMsg}
            </p>
          )}
        </div>

        {/* Track list */}
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="px-4 py-3 border-b border-border/60">
            <h2 className="text-[10px] font-semibold tracking-widest text-muted-foreground/70 font-mono">
              TRACKS
            </h2>
          </div>

          {error && (
            <div className="p-4 text-xs text-red-400 font-mono">{error}</div>
          )}

          {/* Built-in track */}
          <TrackRow
            name="Forest Ambience"
            sub="Built-in · 1.1 MB"
            isPlaying={activeId === null && soundOn && trackName === "Forest Ambience"}
            onPlay={handlePlayBuiltIn}
          />

          {loading ? (
            <div className="px-4 py-6 text-center text-xs text-muted-foreground font-mono tracking-wider">
              LOADING LIBRARY…
            </div>
          ) : tracks.length === 0 ? (
            <div className="px-4 py-8 text-center space-y-1">
              <p className="text-xs text-muted-foreground font-mono tracking-widest">
                NO CUSTOM TRACKS YET
              </p>
              <p className="text-[11px] text-muted-foreground/50">
                Upload an audio file above to add it to your library
              </p>
            </div>
          ) : (
            tracks.map(t => (
              <TrackRow
                key={t.id}
                name={t.name}
                sub={`${fmtBytes(t.size)} · ${new Date(t.addedAt).toLocaleDateString()}`}
                isPlaying={activeId === t.id && soundOn}
                onPlay={() => handlePlay(t)}
                onDelete={async () => {
                  await removeTrack(t.id);
                  if (activeId === t.id) setActiveId(null);
                }}
              />
            ))
          )}
        </div>
      </div>
    </AppLayout>
  );
}

function TrackRow({
  name, sub, isPlaying, onPlay, onDelete,
}: {
  name: string; sub: string; isPlaying: boolean;
  onPlay: () => void; onDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border/40 last:border-b-0 hover:bg-secondary/30 transition-colors group">
      <button
        onClick={onPlay}
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 transition-all duration-200"
        style={{
          border: `1.5px solid ${isPlaying ? "#D4A843" : "rgba(212,168,67,0.25)"}`,
          background: isPlaying ? "rgba(212,168,67,0.15)" : "rgba(20,12,2,0.4)",
          color: isPlaying ? "#D4A843" : "#6a5020",
          boxShadow: isPlaying ? "0 0 14px rgba(212,168,67,0.25)" : "none",
        }}
        aria-label={`Play ${name}`}
      >
        {isPlaying
          ? <Pause size={13} fill="#D4A843" strokeWidth={0} />
          : <Play  size={13} fill="#6a5020" strokeWidth={0} />}
      </button>

      <div className="flex-1 min-w-0">
        <div
          className="text-sm font-medium truncate transition-colors"
          style={{ color: isPlaying ? "#D4A843" : undefined }}
        >
          {name}
          {isPlaying && (
            <span className="ml-2 text-[9px] font-mono tracking-widest text-amber-400 align-middle">
              ▶ NOW PLAYING
            </span>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground/60 font-mono mt-0.5">{sub}</div>
      </div>

      {onDelete && (
        <button
          onClick={onDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground/40 hover:text-red-400"
          aria-label={`Delete ${name}`}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
