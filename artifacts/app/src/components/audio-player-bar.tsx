/**
 * AudioPlayerBar
 *
 * Full mini-player bar fixed to the bottom of the screen.
 * Shows: track name · progress bar (seekable) · current/total time ·
 *        ▶ PLAY / ⏸ PAUSE button · 🎵 library button.
 *
 * AudioLibraryModal is rendered inline so no extra routing is needed.
 */
import { useRef, useState } from "react";
import { Play, Pause, Music2, Upload, Trash2, X } from "lucide-react";
import { useAudioLibrary, fmtBytes, type TrackMeta } from "@/hooks/use-audio-library";

const MAX_MB = 50;

interface Props {
  soundOn:     boolean;
  trackName:   string;
  progress:    number;   // 0-1
  currentTime: string;
  duration:    string;
  onToggle:    () => void;
  onSeek:      (frac: number) => void;
  onPlayTrack: (objectUrl: string, name: string) => void;
}

export function AudioPlayerBar({
  soundOn, trackName, progress, currentTime, duration,
  onToggle, onSeek, onPlayTrack,
}: Props) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const { tracks, usedBytes, maxBytes, loading, addTrack, removeTrack, getObjectUrl } = useAudioLibrary();
  const fileRef  = useRef<HTMLInputElement>(null);
  const barRef   = useRef<HTMLDivElement>(null);
  const [uploadMsg, setUploadMsg] = useState<string | null>(null);
  const [playing, setPlaying]     = useState<string | null>(null); // id of currently playing library track

  // ── Progress bar click → seek ──────────────────────────────────────────
  const handleBarClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    onSeek(frac);
  };

  // ── File upload ────────────────────────────────────────────────────────
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

  // ── Play a library track ───────────────────────────────────────────────
  const handlePlayLibrary = async (track: TrackMeta) => {
    const url = await getObjectUrl(track.id);
    if (!url) return;
    setPlaying(track.id);
    onPlayTrack(url, track.name);
    setLibraryOpen(false);
  };

  const usedPct = Math.min(100, (usedBytes / maxBytes) * 100);

  return (
    <>
      {/* ── Player bar ───────────────────────────────────────────────────── */}
      <div
        className="audio-player-bar"
        style={{
          position: "fixed", bottom: 0, left: 0, right: 0,
          zIndex: 60,
          background: "linear-gradient(90deg,#110900 0%,#1c1005 60%,#110900 100%)",
          borderTop: "1px solid rgba(212,168,67,0.18)",
          backdropFilter: "blur(18px)",
          display: "flex",
          alignItems: "center",
          gap: 0,
          padding: "0 16px",
          height: 64,
          boxShadow: "0 -4px 32px rgba(0,0,0,0.55)",
        }}
      >
        {/* Track name */}
        <div
          className="audio-player-bar__track"
          style={{
          display: "flex", alignItems: "center", gap: 8,
          minWidth: 0, flex: "0 0 auto", maxWidth: 180,
          marginRight: 14,
        }}>
          <Music2 size={15} color="#D4A843" style={{ flexShrink: 0 }} />
          <span style={{
            color: "#D4A843",
            fontSize: 11,
            fontFamily: "'Share Tech Mono', monospace",
            letterSpacing: "0.06em",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}>
            {trackName}
          </span>
        </div>

        {/* Progress bar + time */}
        <div className="audio-player-bar__progress" style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3, minWidth: 0 }}>
          {/* Clickable seek bar */}
          <div
            ref={barRef}
            onClick={handleBarClick}
            style={{
              height: 4, borderRadius: 2,
              background: "rgba(212,168,67,0.15)",
              cursor: "pointer", position: "relative", overflow: "visible",
            }}
          >
            <div style={{
              position: "absolute", left: 0, top: 0, bottom: 0,
              width: `${progress * 100}%`,
              background: soundOn
                ? "linear-gradient(90deg,#D4A843,#F5C842)"
                : "rgba(212,168,67,0.35)",
              borderRadius: 2,
              transition: "background 0.3s",
            }} />
            {/* Thumb */}
            <div style={{
              position: "absolute",
              left: `calc(${progress * 100}% - 5px)`,
              top: -3, width: 10, height: 10, borderRadius: "50%",
              background: soundOn ? "#F5C842" : "#6a5020",
              border: "1.5px solid #1c1005",
              transition: "background 0.3s",
              pointerEvents: "none",
            }} />
          </div>
          {/* Time stamps */}
          <div style={{
            display: "flex", justifyContent: "space-between",
            fontSize: 9, color: "rgba(212,168,67,0.45)",
            fontFamily: "'Share Tech Mono', monospace",
            letterSpacing: "0.08em",
          }}>
            <span>{currentTime}</span>
            <span>{duration}</span>
          </div>
        </div>

        {/* ▶ PLAY / ⏸ PAUSE button */}
        <button
          className="audio-player-bar__toggle"
          onClick={onToggle}
          style={{
            display: "flex", alignItems: "center", gap: 7,
            marginLeft: 16,
            padding: "8px 18px",
            borderRadius: 24,
            border: `1.5px solid ${soundOn ? "#D4A843" : "rgba(212,168,67,0.3)"}`,
            background: soundOn
              ? "linear-gradient(135deg,#3a2206,#241504)"
              : "rgba(20,12,2,0.7)",
            color: soundOn ? "#F5C842" : "#8a6030",
            fontSize: 11,
            fontWeight: 700,
            fontFamily: "'Share Tech Mono', monospace",
            letterSpacing: "0.14em",
            cursor: "pointer",
            transition: "all 0.2s",
            boxShadow: soundOn ? "0 0 18px rgba(212,168,67,0.22)" : "none",
            flexShrink: 0,
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1.05)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
          }}
          aria-label={soundOn ? "Pause music" : "Play music"}
        >
          {soundOn
            ? <><Pause size={13} fill="#F5C842" strokeWidth={0} /> PAUSE</>
            : <><Play  size={13} fill="#8a6030" strokeWidth={0} /> PLAY</>}
        </button>

        {/* Library button */}
        <button
          className="audio-player-bar__library"
          onClick={() => setLibraryOpen(true)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            marginLeft: 10,
            padding: "8px 14px",
            borderRadius: 24,
            border: "1.5px solid rgba(212,168,67,0.2)",
            background: "rgba(20,12,2,0.6)",
            color: "#6a5020",
            fontSize: 10,
            fontWeight: 600,
            fontFamily: "'Share Tech Mono', monospace",
            letterSpacing: "0.12em",
            cursor: "pointer",
            flexShrink: 0,
            transition: "all 0.2s",
          }}
          onMouseEnter={e => {
            (e.currentTarget as HTMLButtonElement).style.color = "#D4A843";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(212,168,67,0.45)";
          }}
          onMouseLeave={e => {
            (e.currentTarget as HTMLButtonElement).style.color = "#6a5020";
            (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(212,168,67,0.2)";
          }}
          aria-label="Open audio library"
          title="Audio library"
        >
          <Upload size={12} /> LIBRARY
        </button>
      </div>

      {/* ── Library modal ─────────────────────────────────────────────────── */}
      {libraryOpen && (
        <div
          style={{
            position: "fixed", inset: 0, zIndex: 200,
            background: "rgba(5,3,1,0.82)",
            backdropFilter: "blur(12px)",
            display: "flex", alignItems: "flex-end", justifyContent: "center",
          }}
          onClick={e => { if (e.target === e.currentTarget) setLibraryOpen(false); }}
        >
          <div style={{
            width: "100%", maxWidth: 560,
            background: "linear-gradient(180deg,#181008 0%,#0e0804 100%)",
            border: "1px solid rgba(212,168,67,0.2)",
            borderRadius: "16px 16px 0 0",
            padding: "0 0 80px",      /* leave space for the player bar */
            maxHeight: "82vh",
            display: "flex", flexDirection: "column",
            boxShadow: "0 -8px 48px rgba(0,0,0,0.7)",
          }}>
            {/* Header */}
            <div style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: "18px 20px 12px",
              borderBottom: "1px solid rgba(212,168,67,0.1)",
            }}>
              <div>
                <div style={{ color: "#D4A843", fontSize: 12, letterSpacing: "0.22em", fontFamily: "'Share Tech Mono', monospace" }}>
                  AUDIO LIBRARY
                </div>
                <div style={{ color: "#5a3a10", fontSize: 10, marginTop: 3, fontFamily: "'Share Tech Mono', monospace" }}>
                  {fmtBytes(usedBytes)} used of {MAX_MB} MB
                </div>
              </div>
              <button onClick={() => setLibraryOpen(false)}
                style={{ background: "none", border: "none", color: "#5a3a10", cursor: "pointer", padding: 4 }}>
                <X size={18} />
              </button>
            </div>

            {/* Storage gauge */}
            <div style={{ padding: "10px 20px" }}>
              <div style={{ height: 4, borderRadius: 2, background: "rgba(212,168,67,0.1)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", borderRadius: 2,
                  width: `${usedPct}%`,
                  background: usedPct > 85
                    ? "linear-gradient(90deg,#a04020,#c05030)"
                    : "linear-gradient(90deg,#3a2206,#D4A843)",
                  transition: "width 0.4s",
                }} />
              </div>
              <div style={{ textAlign: "right", marginTop: 4, fontSize: 9, color: "rgba(212,168,67,0.3)", fontFamily: "monospace" }}>
                {usedPct.toFixed(1)}% of 50 MB
              </div>
            </div>

            {/* Upload button */}
            <div style={{ padding: "4px 20px 12px" }}>
              <input
                ref={fileRef}
                type="file"
                accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
                multiple
                style={{ display: "none" }}
                onChange={e => handleFiles(e.target.files)}
              />
              <button
                onClick={() => fileRef.current?.click()}
                style={{
                  width: "100%",
                  padding: "11px 0",
                  border: "1.5px dashed rgba(212,168,67,0.3)",
                  borderRadius: 8,
                  background: "rgba(212,168,67,0.04)",
                  color: "#8a6030",
                  fontSize: 11,
                  fontFamily: "'Share Tech Mono', monospace",
                  letterSpacing: "0.15em",
                  cursor: "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  transition: "all 0.2s",
                }}
                onMouseEnter={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(212,168,67,0.6)";
                  (e.currentTarget as HTMLButtonElement).style.color = "#D4A843";
                }}
                onMouseLeave={e => {
                  (e.currentTarget as HTMLButtonElement).style.borderColor = "rgba(212,168,67,0.3)";
                  (e.currentTarget as HTMLButtonElement).style.color = "#8a6030";
                }}
              >
                <Upload size={14} /> UPLOAD AUDIO FILE
              </button>
              {uploadMsg && (
                <div style={{
                  marginTop: 8, fontSize: 10, textAlign: "center",
                  color: uploadMsg.startsWith("Upload") ? "#a04020" : "#D4A843",
                  fontFamily: "monospace",
                }}>
                  {uploadMsg}
                </div>
              )}
            </div>

            {/* Track list */}
            <div style={{ flex: 1, overflowY: "auto", padding: "0 20px" }}>
              {/* Built-in track */}
              <TrackRow
                name="Forest Ambience"
                sub="Built-in · 1.1 MB"
                isPlaying={!playing && soundOn}
                onPlay={() => {
                  setPlaying(null);
                  onPlayTrack("/forest-ambience.mp3", "Forest Ambience");
                  setLibraryOpen(false);
                }}
              />

              {loading && (
                <div style={{ color: "#4a3010", fontSize: 11, padding: "12px 0", fontFamily: "monospace" }}>
                  Loading library…
                </div>
              )}

              {tracks.map(t => (
                <TrackRow
                  key={t.id}
                  name={t.name}
                  sub={`${fmtBytes(t.size)} · ${new Date(t.addedAt).toLocaleDateString()}`}
                  isPlaying={playing === t.id && soundOn}
                  onPlay={() => handlePlayLibrary(t)}
                  onDelete={async () => {
                    await removeTrack(t.id);
                    if (playing === t.id) setPlaying(null);
                  }}
                />
              ))}

              {!loading && tracks.length === 0 && (
                <div style={{
                  color: "#3a2010", fontSize: 11,
                  padding: "20px 0", textAlign: "center",
                  fontFamily: "'Share Tech Mono', monospace", letterSpacing: "0.1em",
                }}>
                  NO TRACKS YET — UPLOAD AN MP3, WAV OR OGG
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── TrackRow ─────────────────────────────────────────────────────────────────

function TrackRow({
  name, sub, isPlaying, onPlay, onDelete,
}: {
  name: string; sub: string; isPlaying: boolean;
  onPlay: () => void; onDelete?: () => void;
}) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      padding: "10px 0",
      borderBottom: "1px solid rgba(212,168,67,0.06)",
    }}>
      {/* Play button */}
      <button
        onClick={onPlay}
        style={{
          width: 34, height: 34, borderRadius: "50%",
          border: `1.5px solid ${isPlaying ? "#D4A843" : "rgba(212,168,67,0.25)"}`,
          background: isPlaying ? "rgba(212,168,67,0.15)" : "rgba(20,12,2,0.6)",
          color: isPlaying ? "#D4A843" : "#6a5020",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: "pointer", flexShrink: 0,
          boxShadow: isPlaying ? "0 0 12px rgba(212,168,67,0.2)" : "none",
          transition: "all 0.2s",
        }}
        aria-label={`Play ${name}`}
      >
        {isPlaying
          ? <Pause size={12} fill="#D4A843" strokeWidth={0} />
          : <Play  size={12} fill="#6a5020" strokeWidth={0} />}
      </button>

      {/* Name + meta */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          color: isPlaying ? "#D4A843" : "#8a6030",
          fontSize: 12,
          fontFamily: "'Share Tech Mono', monospace",
          overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          transition: "color 0.2s",
        }}>
          {name}
          {isPlaying && <span style={{ marginLeft: 8, fontSize: 9, color: "#D4A843", letterSpacing: "0.15em" }}>▶ NOW PLAYING</span>}
        </div>
        <div style={{ color: "#3a2010", fontSize: 10, marginTop: 1, fontFamily: "monospace" }}>{sub}</div>
      </div>

      {/* Delete */}
      {onDelete && (
        <button
          onClick={onDelete}
          style={{
            background: "none", border: "none", color: "#3a1a08",
            cursor: "pointer", padding: 6, flexShrink: 0,
            transition: "color 0.2s",
          }}
          onMouseEnter={e => (e.currentTarget as HTMLButtonElement).style.color = "#c04020"}
          onMouseLeave={e => (e.currentTarget as HTMLButtonElement).style.color = "#3a1a08"}
          aria-label={`Delete ${name}`}
        >
          <Trash2 size={14} />
        </button>
      )}
    </div>
  );
}
