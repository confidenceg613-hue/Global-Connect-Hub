import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { useListInvites, getListInvitesQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity as ActivityIcon, Bell, Camera, MapPin, Send, User, Image as ImageIcon } from "lucide-react";
import { useMemo, useState } from "react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface NotificationLog {
  id: number;
  userId: number;
  type: string;
  title: string;
  body: string | null;
  read: boolean;
  createdAt: string;
}

interface GeoPhoto {
  id: number;
  photoData: string;
  latitude: number;
  longitude: number;
  address: string | null;
  takenAt: string;
  inviteToken: string;
  toName: string | null;
  toPhone: string;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString([], {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

type FeedItem =
  | { kind: "notification"; time: string; data: NotificationLog }
  | { kind: "photo"; time: string; data: GeoPhoto };

export default function Activity() {
  const { userId } = useAuth();

  const { data: invites = [], isLoading: invitesLoading } = useListInvites({ userId: userId! }, {
    query: { enabled: !!userId, queryKey: getListInvitesQueryKey({ userId: userId! }) }
  });

  const { data: notifications = [], isLoading: notifLoading } = useQuery<NotificationLog[]>({
    queryKey: ["notifications", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/notifications/${userId}`);
      if (!r.ok) throw new Error("Failed to load notifications");
      return r.json();
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  const { data: geoPhotos = [], isLoading: photosLoading } = useQuery<GeoPhoto[]>({
    queryKey: ["geo-photos-by-user", userId],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/geo-photos/by-user/${userId}`);
      if (!r.ok) throw new Error("Failed to load geo photos");
      return r.json();
    },
    enabled: !!userId,
    refetchInterval: 30_000,
  });

  const [selectedPhoto, setSelectedPhoto] = useState<GeoPhoto | null>(null);

  const isLoading = invitesLoading || notifLoading || photosLoading;

  const feed: FeedItem[] = useMemo(() => {
    const items: FeedItem[] = [
      ...notifications.map((n): FeedItem => ({ kind: "notification", time: n.createdAt, data: n })),
      ...geoPhotos.map((p): FeedItem => ({ kind: "photo", time: p.takenAt, data: p })),
    ];
    return items.sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime()).slice(0, 30);
  }, [notifications, geoPhotos]);

  const contactStats = useMemo(() => {
    return invites.map((invite) => {
      const photos = geoPhotos.filter((p) => p.inviteToken === (invite as any).token);
      return {
        id: invite.id,
        name: invite.toName || invite.toPhone,
        phone: invite.toPhone,
        status: invite.status,
        photoCount: photos.length,
        lastPhotoAt: photos[0]?.takenAt ?? null,
      };
    }).sort((a, b) => b.photoCount - a.photoCount);
  }, [invites, geoPhotos]);

  const acceptedCount = invites.filter((i) => i.status === "accepted").length;
  const unreadCount = notifications.filter((n) => !n.read).length;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded-md"></div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <div key={i} className="h-32 bg-muted animate-pulse rounded-xl"></div>)}
        </div>
      </div>
    );
  }

  const statCards = [
    { title: "Active Contacts", value: acceptedCount, sub: `of ${invites.length} invited`, icon: User, color: "text-blue-500", bg: "bg-blue-50 dark:bg-blue-950" },
    { title: "Notifications", value: notifications.length, sub: `${unreadCount} unread`, icon: Bell, color: "text-purple-500", bg: "bg-purple-50 dark:bg-purple-950" },
    { title: "Photos Captured", value: geoPhotos.length, sub: "via GeoBoard", icon: Camera, color: "text-green-500", bg: "bg-green-50 dark:bg-green-950" },
  ];

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-primary/10">
          <ActivityIcon className="h-5 w-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-foreground">Activity</h1>
          <p className="text-muted-foreground text-sm">A combined view of contact activity — notifications and captured photos.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {statCards.map((card, idx) => (
          <Card key={idx} className="border-border/60 shadow-sm hover:shadow-md transition-shadow">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{card.title}</CardTitle>
              <div className={`${card.bg} ${card.color} p-2 rounded-md`}>
                <card.icon size={16} />
              </div>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{card.value}</div>
              <p className="text-xs text-muted-foreground mt-1">{card.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
            <CardDescription>Latest notifications and captured photos, most recent first</CardDescription>
          </CardHeader>
          <CardContent>
            {feed.length > 0 ? (
              <div className="space-y-4 max-h-[480px] overflow-y-auto pr-1">
                {feed.map((item, idx) => (
                  <div key={`${item.kind}-${item.data.id}-${idx}`} className="flex items-start justify-between gap-3 border-b border-border/50 pb-4 last:border-0 last:pb-0">
                    <div className="flex items-start gap-3 min-w-0">
                      <div className={`p-2 rounded-full flex-shrink-0 ${item.kind === "notification" ? "bg-purple-500/10 text-purple-500" : "bg-green-500/10 text-green-500"}`}>
                        {item.kind === "notification" ? <Bell size={14} /> : <Camera size={14} />}
                      </div>
                      <div className="min-w-0">
                        {item.kind === "notification" ? (
                          <>
                            <p className="font-medium text-sm truncate">{item.data.title}</p>
                            {item.data.body && <p className="text-xs text-muted-foreground truncate">{item.data.body}</p>}
                          </>
                        ) : (
                          <>
                            <p className="font-medium text-sm truncate">Photo captured — {item.data.toName || item.data.toPhone}</p>
                            {item.data.address && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
                                <MapPin size={10} /> {item.data.address}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-1 flex-shrink-0">
                      <span className="text-xs text-muted-foreground whitespace-nowrap">{timeAgo(item.time)}</span>
                      {item.kind === "photo" && (
                        <button
                          onClick={() => setSelectedPhoto(item.data)}
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <ImageIcon size={10} /> View
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <ActivityIcon size={32} className="mx-auto mb-3 opacity-20" />
                <p>No activity yet</p>
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="border-border/60 shadow-sm">
          <CardHeader>
            <CardTitle>Contact Breakdown</CardTitle>
            <CardDescription>Photo activity by contact</CardDescription>
          </CardHeader>
          <CardContent>
            {contactStats.length > 0 ? (
              <div className="space-y-4">
                {contactStats.map((c) => (
                  <div key={c.id} className="flex items-center justify-between border-b border-border/50 pb-4 last:border-0 last:pb-0">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="bg-primary/10 text-primary p-2 rounded-full flex-shrink-0">
                        <Send size={14} />
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{c.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {c.lastPhotoAt ? `Last photo ${timeAgo(c.lastPhotoAt)}` : "No photos yet"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant="outline" className="text-xs gap-1">
                        <Camera size={10} /> {c.photoCount}
                      </Badge>
                      <Badge variant={
                        c.status === "accepted" ? "default" :
                        c.status === "declined" ? "destructive" : "secondary"
                      }>
                        {c.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <User size={32} className="mx-auto mb-3 opacity-20" />
                <p>No contacts yet</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedPhoto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setSelectedPhoto(null)}
        >
          <div className="bg-card rounded-xl max-w-md w-full overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <img src={`data:image/jpeg;base64,${selectedPhoto.photoData}`} alt="Captured" className="w-full h-64 object-cover" />
            <div className="p-4 space-y-1">
              <p className="font-semibold text-sm">{selectedPhoto.toName || selectedPhoto.toPhone}</p>
              <p className="text-xs text-muted-foreground">{formatTime(selectedPhoto.takenAt)}</p>
              {selectedPhoto.address && <p className="text-xs text-muted-foreground">{selectedPhoto.address}</p>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
