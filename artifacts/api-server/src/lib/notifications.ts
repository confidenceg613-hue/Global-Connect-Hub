import { eq } from "drizzle-orm";
import webpush from "web-push";
import { db, pushSubscriptionsTable, notificationsLogTable } from "@workspace/db";
import type { NotificationLog } from "@workspace/db";

export type NotifType = NotificationLog["type"];

export interface NotifPayload {
  type: NotifType;
  title: string;
  body: string;
  tag?: string;
  data?: Record<string, unknown>;
}

function setupVapid() {
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) return false;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ?? "mailto:app@phonelink.local",
    pub,
    priv,
  );
  return true;
}

export async function sendPushAndLog(userId: number, payload: NotifPayload): Promise<void> {
  await db.insert(notificationsLogTable).values({
    userId,
    type: payload.type,
    title: payload.title,
    body: payload.body,
    data: payload.data ?? null,
    read: false,
  });

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
          body: payload.body,
          tag: payload.tag ?? payload.type,
          data: { type: payload.type, userId, ...(payload.data ?? {}) },
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
