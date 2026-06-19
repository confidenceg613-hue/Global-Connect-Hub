import { useEffect, useRef } from "react";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";

const STORAGE_KEY = "phoneLink_seenGrantIds";

function getSeenIds(): Set<number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Set(JSON.parse(raw) as number[]) : new Set();
  } catch {
    return new Set();
  }
}

function saveSeenIds(ids: Set<number>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
}

function requestBrowserNotificationPermission(): void {
  if ("Notification" in window && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

function fireBrowserNotification(title: string, body: string): void {
  if ("Notification" in window && Notification.permission === "granted") {
    try {
      new Notification(title, { body, icon: "/favicon.ico" });
    } catch {
      // silently ignore — some mobile browsers don't support Notification constructor
    }
  }
}

export function useGrantNotifications(userId: number | null) {
  const { toast } = useToast();
  const initialised = useRef(false);

  // Ask for browser notification permission once
  useEffect(() => {
    requestBrowserNotificationPermission();
  }, []);

  const { data: invites } = useListInvites(
    { userId: userId! },
    {
      query: {
        enabled: !!userId,
        queryKey: getListInvitesQueryKey({ userId: userId! }),
        // Poll every 5 seconds
        refetchInterval: 5000,
        refetchIntervalInBackground: true,
      },
    },
  );

  useEffect(() => {
    if (!invites) return;

    const accepted = invites.filter((inv) => inv.status === "accepted");
    const seenIds = getSeenIds();

    if (!initialised.current) {
      // On first load, mark all current grants as already seen — don't re-notify
      accepted.forEach((inv) => seenIds.add(inv.id));
      saveSeenIds(seenIds);
      initialised.current = true;
      return;
    }

    const newGrants = accepted.filter((inv) => !seenIds.has(inv.id));

    for (const grant of newGrants) {
      seenIds.add(grant.id);

      const coordLine =
        grant.grantedLatitude != null && grant.grantedLongitude != null
          ? `${grant.grantedLatitude.toFixed(5)}, ${grant.grantedLongitude.toFixed(5)}`
          : null;

      const addressLine = grant.grantedAddress ?? null;
      const recipientLabel = grant.toName ? `${grant.toName} (${grant.toPhone})` : grant.toPhone;

      // Browser notification
      fireBrowserNotification(
        `Location Granted — Invite #${grant.id}`,
        `${recipientLabel} granted access${coordLine ? ` · ${coordLine}` : ""}`,
      );

      // In-app toast — prominent, long duration
      toast({
        title: `Location Granted — Invite #${grant.id}`,
        description: [
          `From: ${recipientLabel}`,
          coordLine ? `Coords: ${coordLine}` : null,
          addressLine ? `Address: ${addressLine}` : null,
        ]
          .filter(Boolean)
          .join("\n"),
        duration: 12000,
      });
    }

    if (newGrants.length > 0) {
      saveSeenIds(seenIds);
    }
  }, [invites, toast]);
}
