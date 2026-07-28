import { eq } from "drizzle-orm";
import webpush from "web-push";
import { db, pushSubscriptionsTable, notificationsLogTable } from "@workspace/db";
import type { NotificationLog } from "@workspace/db";
import type { Response } from "express";

export type NotifType = NotificationLog["type"];

export interface NotifPayload {
  type: NotifType;
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
  pinned?: boolean;
}

// ── SSE broadcaster ───────────────────────────────────────────────────────────
// In-memory registry: userId → set of open SSE response objects.
// When sendPushAndLog writes a new row it calls broadcastNewNotif so every
// open tab the owner has receives the notification immediately, with no polling.
const notifSseClients = new Map<number, Set<Response>>();

export function addNotifSseClient(userId: number, res: Response): void {
  if (!notifSseClients.has(userId)) notifSseClients.set(userId, new Set());
  notifSseClients.get(userId)!.add(res);
}

export function removeNotifSseClient(userId: number, res: Response): void {
  const set = notifSseClients.get(userId);
  if (!set) return;
  set.delete(res);
  if (set.size === 0) notifSseClients.delete(userId);
}

export function broadcastNewNotif(userId: number, entry: NotificationLog): void {
  const clients = notifSseClients.get(userId);
  if (!clients?.size) return;
  const payload = `data: ${JSON.stringify(entry)}\n\n`;
  for (const res of clients) {
    try { res.write(payload); } catch { /* client gone */ }
  }
}
// ─────────────────────────────────────────────────────────────────────────────

function setupVapid() {
  const pub  = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:app@deepfalcon.local",
    pub,
    priv,
  );
  return true;
}

export async function sendPushAndLog(userId: number, payload: NotifPayload): Promise<void> {
  // Insert and capture the returned row so we can broadcast it over SSE.
  const [entry] = await db
    .insert(notificationsLogTable)
    .values({
      userId,
      type: payload.type,
      title: payload.title,
      body: payload.body,
      data: payload.data ?? null,
      read: false,
      pinned: payload.pinned ?? false,
    })
    .returning();

  // Push the new notification to every open SSE stream for this user immediately.
  if (entry) broadcastNewNotif(userId, entry);

  if (!setupVapid()) return;

  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, userId));

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { auth: sub.keysAuth, p256dh: sub.keysP256dh } },
        JSON.stringify({
          title: payload.title,
          body:  payload.body,
          tag:   payload.tag ?? payload.type,
          data:  { type: payload.type, userId, ...(payload.data ?? {}) },
        }),
      );
    } catch (err: any) {
      if (err?.statusCode === 410 || err?.statusCode === 404) {
        await db
          .delete(pushSubscriptionsTable)
          .where(eq(pushSubscriptionsTable.endpoint, sub.endpoint));
      }
    }
  }
}

export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
