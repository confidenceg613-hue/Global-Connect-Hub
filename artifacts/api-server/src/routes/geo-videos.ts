import { Router } from "express";
import express from "express";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { db } from "@workspace/db";
import { geoVideosTable, SaveGeoVideoBody, invitesTable, geoPhotosTable } from "@workspace/db/schema";
import { eq, desc, lt } from "drizzle-orm";
import { z } from "zod";

const router = Router();

// ── Temp-dir helpers ──────────────────────────────────────────────────────────

function chunkDir(uploadId: string): string {
  // Basic sanitisation — uploadIds are random alphanumeric strings
  const safe = uploadId.replace(/[^a-zA-Z0-9_-]/g, "");
  return path.join(os.tmpdir(), "geo-video-chunks", safe);
}

/** Clean up stale upload dirs older than 1 hour (fire-and-forget). */
function sweepStaleUploads(): void {
  const root = path.join(os.tmpdir(), "geo-video-chunks");
  const cutoff = Date.now() - 60 * 60 * 1000;
  fs.promises.readdir(root)
    .then(dirs => Promise.all(
      dirs.map(async d => {
        const p = path.join(root, d);
        const stat = await fs.promises.stat(p).catch(() => null);
        if (stat && stat.mtimeMs < cutoff) await fs.promises.rm(p, { recursive: true }).catch(() => {});
      }),
    ))
    .catch(() => {});
}
setInterval(sweepStaleUploads, 30 * 60 * 1000); // every 30 min

// ── 24-hour GeoBoard purge ─────────────────────────────────────────────────────
// Photos and videos are large base64 blobs. Purge anything older than 24 hours
// so storage stays flat no matter how many users log consent sessions.
async function purgeGeoboardAfter24h(): Promise<void> {
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
  try {
    const [deletedPhotos, deletedVideos] = await Promise.all([
      db.delete(geoPhotosTable).where(lt(geoPhotosTable.takenAt, cutoff)).returning({ id: geoPhotosTable.id }),
      db.delete(geoVideosTable).where(lt(geoVideosTable.takenAt, cutoff)).returning({ id: geoVideosTable.id }),
    ]);
    const p = deletedPhotos.length, v = deletedVideos.length;
    if (p + v > 0) {
      console.log(`[geoboard-purge] Removed ${p} photo(s) and ${v} video(s) older than 24 h`);
    }
  } catch (err) {
    console.error("[geoboard-purge] Failed:", err);
  }
}
// Run once at startup (clears any backlog immediately) then every 24 hours.
purgeGeoboardAfter24h();
setInterval(purgeGeoboardAfter24h, 24 * 60 * 60 * 1000);

// ── POST /geo-videos/chunk ────────────────────────────────────────────────────
// Accepts a raw binary chunk (application/octet-stream).
// Query params: uploadId, index (0-based), token (for invite validation)
//
// Chunks are written to individual temp files so they can be reassembled in
// order by /finalize.  No DB write happens here — the hot path stays fast.

const ChunkQuery = z.object({
  uploadId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  index:    z.string().regex(/^\d+$/).transform(Number),
  token:    z.string().min(1),
});

router.post(
  "/geo-videos/chunk",
  express.raw({ type: "application/octet-stream", limit: "20mb" }),
  async (req, res): Promise<void> => {
    const q = ChunkQuery.safeParse(req.query);
    if (!q.success) { res.status(400).json({ error: "Bad query params" }); return; }
    const { uploadId, index, token } = q.data;

    // Validate the invite token exists (lightweight auth)
    const [invite] = await db
      .select({ token: invitesTable.token })
      .from(invitesTable)
      .where(eq(invitesTable.token, token));
    if (!invite) { res.status(404).json({ error: "Invite not found" }); return; }

    const chunk = req.body as Buffer;
    if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
      res.status(400).json({ error: "Empty chunk" }); return;
    }

    const dir = chunkDir(uploadId);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(path.join(dir, `${index}.bin`), chunk);

    res.json({ ok: true, index, bytes: chunk.length });
  },
);

// ── POST /geo-videos/finalize ─────────────────────────────────────────────────
// Called after all chunks have been uploaded.  Concatenates the temp files in
// index order, converts to a base64 data-URL, persists to the DB, then deletes
// the temp directory.

const FinalizeBody = z.object({
  uploadId:    z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  token:       z.string().min(1),
  mimeType:    z.string().optional(),
  durationMs:  z.number().int().positive().optional(),
  latitude:    z.number().optional(),
  longitude:   z.number().optional(),
  address:     z.string().optional(),
  cameraFacing:z.enum(["environment", "user"]).optional(),
});

router.post("/geo-videos/finalize", async (req, res): Promise<void> => {
  const parsed = FinalizeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const { uploadId, token, mimeType, durationMs, latitude, longitude, address, cameraFacing } = parsed.data;

  // Validate invite
  const [invite] = await db
    .select({ token: invitesTable.token })
    .from(invitesTable)
    .where(eq(invitesTable.token, token));
  if (!invite) { res.status(404).json({ error: "Invite not found" }); return; }

  const dir = chunkDir(uploadId);
  let files: string[];
  try {
    files = await fs.promises.readdir(dir);
  } catch {
    res.status(400).json({ error: "No chunks found for this uploadId" }); return;
  }

  // Sort numerically: "0.bin", "1.bin", ... "12.bin"
  files.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  if (files.length === 0) { res.status(400).json({ error: "No chunk files found" }); return; }

  // Read all chunks and concatenate
  const buffers = await Promise.all(
    files.map(f => fs.promises.readFile(path.join(dir, f))),
  );
  const combined = Buffer.concat(buffers);

  // Convert binary buffer → base64 data-URL (fast on Node; avoids slow browser btoa)
  const mime = mimeType ?? "video/webm";
  const videoData = `data:${mime};base64,${combined.toString("base64")}`;

  // Persist
  const [video] = await db
    .insert(geoVideosTable)
    .values({
      inviteToken:  token,
      videoData,
      mimeType:     mime,
      durationMs:   durationMs ?? null,
      latitude:     latitude   ?? null,
      longitude:    longitude  ?? null,
      address:      address    ?? null,
      cameraFacing: cameraFacing ?? "environment",
    })
    .returning();

  // Clean up temp dir (non-blocking)
  fs.promises.rm(dir, { recursive: true }).catch(() => {});

  res.status(201).json({ id: video.id, takenAt: video.takenAt });
});

// ── POST /geo-videos (legacy JSON / back-compat) ──────────────────────────────
// Kept for older clients that still send base64 JSON in one shot.
router.post("/geo-videos", async (req, res): Promise<void> => {
  const parsed = SaveGeoVideoBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { token, videoData, mimeType, durationMs, latitude, longitude, address, cameraFacing } = parsed.data;

  const [invite] = await db
    .select({ token: invitesTable.token })
    .from(invitesTable)
    .where(eq(invitesTable.token, token));

  if (!invite) {
    res.status(404).json({ error: "Invite not found" });
    return;
  }

  const [video] = await db
    .insert(geoVideosTable)
    .values({
      inviteToken: token,
      videoData,
      mimeType: mimeType ?? "video/webm",
      durationMs: durationMs ?? null,
      latitude: latitude ?? null,
      longitude: longitude ?? null,
      address: address ?? null,
      cameraFacing: cameraFacing ?? "environment",
    })
    .returning();

  res.status(201).json({ id: video.id, takenAt: video.takenAt });
});

// ── GET /geo-videos/by-token/:token ──────────────────────────────────────────
router.get("/geo-videos/by-token/:token", async (req, res): Promise<void> => {
  const { token } = req.params;

  const videos = await db
    .select({
      id:           geoVideosTable.id,
      videoData:    geoVideosTable.videoData,
      mimeType:     geoVideosTable.mimeType,
      durationMs:   geoVideosTable.durationMs,
      latitude:     geoVideosTable.latitude,
      longitude:    geoVideosTable.longitude,
      address:      geoVideosTable.address,
      cameraFacing: geoVideosTable.cameraFacing,
      takenAt:      geoVideosTable.takenAt,
    })
    .from(geoVideosTable)
    .where(eq(geoVideosTable.inviteToken, token))
    .orderBy(desc(geoVideosTable.takenAt));

  res.json(videos);
});

// ── GET /geo-videos/by-user/:userId ──────────────────────────────────────────
router.get("/geo-videos/by-user/:userId", async (req, res): Promise<void> => {
  const userId = parseInt(req.params.userId, 10);
  if (Number.isNaN(userId)) {
    res.status(400).json({ error: "Invalid userId" });
    return;
  }

  const rows = await db
    .select({
      id:           geoVideosTable.id,
      videoData:    geoVideosTable.videoData,
      mimeType:     geoVideosTable.mimeType,
      durationMs:   geoVideosTable.durationMs,
      latitude:     geoVideosTable.latitude,
      longitude:    geoVideosTable.longitude,
      address:      geoVideosTable.address,
      cameraFacing: geoVideosTable.cameraFacing,
      takenAt:      geoVideosTable.takenAt,
      inviteToken:  geoVideosTable.inviteToken,
      toName:       invitesTable.toName,
      toPhone:      invitesTable.toPhone,
    })
    .from(geoVideosTable)
    .innerJoin(invitesTable, eq(geoVideosTable.inviteToken, invitesTable.token))
    .where(eq(invitesTable.fromUserId, userId))
    .orderBy(desc(geoVideosTable.takenAt));

  res.json(rows);
});

export default router;
