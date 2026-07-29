/**
 * use-audio-library.ts
 *
 * Manages a 50 MB IndexedDB audio library.
 * Tracks are stored as ArrayBuffers with metadata.
 * Works offline — no server required.
 */
import { useEffect, useState, useCallback } from "react";

const DB_NAME    = "deepfalcon-audio";
const DB_VERSION = 1;
const STORE      = "tracks";
const MAX_BYTES  = 50 * 1024 * 1024; // 50 MB

export interface AudioTrack {
  id: string;          // uuid
  name: string;        // display name (filename without extension)
  filename: string;    // original filename
  mimeType: string;
  size: number;        // bytes
  addedAt: number;     // Date.now()
  data: ArrayBuffer;
}

export interface TrackMeta extends Omit<AudioTrack, "data"> {}

// ── IndexedDB helpers ────────────────────────────────────────────────────────

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE, { keyPath: "id" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function dbGetAll(): Promise<AudioTrack[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx  = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result as AudioTrack[]);
    req.onerror   = () => reject(req.error);
  });
}

async function dbPut(track: AudioTrack): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(track);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

async function dbDelete(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export function fmtBytes(b: number): string {
  if (b < 1024)       return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useAudioLibrary() {
  const [tracks,    setTracks]    = useState<TrackMeta[]>([]);
  const [usedBytes, setUsedBytes] = useState(0);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const all = await dbGetAll();
      const meta: TrackMeta[] = all.map(({ data: _d, ...m }) => m);
      meta.sort((a, b) => b.addedAt - a.addedAt);
      setTracks(meta);
      setUsedBytes(all.reduce((s, t) => s + t.size, 0));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load library");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { reload(); }, [reload]);

  /** Returns an object-URL for playback. Caller must revoke when done. */
  const getObjectUrl = useCallback(async (id: string): Promise<string | null> => {
    const all = await dbGetAll();
    const t   = all.find(x => x.id === id);
    if (!t) return null;
    const blob = new Blob([t.data], { type: t.mimeType });
    return URL.createObjectURL(blob);
  }, []);

  const addTrack = useCallback(async (file: File): Promise<{ ok: boolean; reason?: string }> => {
    if (!file.type.startsWith("audio/") && !file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i)) {
      return { ok: false, reason: "Not a recognised audio file." };
    }
    if (usedBytes + file.size > MAX_BYTES) {
      return { ok: false, reason: `Library full — only ${fmtBytes(MAX_BYTES - usedBytes)} remaining.` };
    }
    const buf  = await file.arrayBuffer();
    const name = file.name.replace(/\.[^.]+$/, "");
    const track: AudioTrack = {
      id: uid(), name, filename: file.name,
      mimeType: file.type || "audio/mpeg",
      size: file.size, addedAt: Date.now(), data: buf,
    };
    await dbPut(track);
    await reload();
    return { ok: true };
  }, [usedBytes, reload]);

  const removeTrack = useCallback(async (id: string) => {
    await dbDelete(id);
    await reload();
  }, [reload]);

  return {
    tracks, usedBytes, maxBytes: MAX_BYTES,
    loading, error,
    addTrack, removeTrack, getObjectUrl,
  };
}
