import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import {
  KeyRound,
  ShieldCheck,
  Users,
  Wallet,
  Ticket,
  Send,
  Unlock,
  Lock,
  RotateCcw,
  Plus,
  Loader2,
  LogOut,
  ArrowLeft,
  Search,
  History,
  FileCheck,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import {
  useAdmin,
  type AdminUserSummary,
  type AdminConsent,
  type RedemptionHistoryEntry,
  type UserStatus,
} from "@/hooks/use-admin";

function statusBadge(status: UserStatus) {
  const map: Record<UserStatus, { label: string; className: string }> = {
    unlimited: { label: "Unlimited", className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
    subscribed: { label: "Subscribed", className: "bg-indigo-500/15 text-indigo-400 border-indigo-500/30" },
    free: { label: "Free trial", className: "bg-sky-500/15 text-sky-400 border-sky-500/30" },
    expired: { label: "Expired", className: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
    locked: { label: "Locked out", className: "bg-red-500/15 text-red-400 border-red-500/30" },
  };
  const s = map[status];
  return <Badge variant="outline" className={s.className}>{s.label}</Badge>;
}

function LoginGate({ onUnlock }: { onUnlock: (password: string) => Promise<{ ok: boolean; message?: string }> }) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, setLocation] = useLocation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return;
    setSubmitting(true);
    setError(null);
    const result = await onUnlock(password);
    setSubmitting(false);
    if (!result.ok) setError(result.message ?? "Incorrect password.");
  };

  return (
    <div className="min-h-[100dvh] w-full flex items-center justify-center bg-background p-4 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: "radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)",
        backgroundSize: "28px 28px",
      }} />
      <div className="w-full max-w-sm z-10">
        <button
          onClick={() => setLocation("/")}
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft size={14} /> Back to site
        </button>
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center shadow-[0_0_30px_rgba(245,158,11,0.3)] mb-4 ring-1 ring-white/10">
            <KeyRound size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Admin HQ</h1>
          <p className="text-muted-foreground text-xs uppercase tracking-widest mt-2 font-mono">Restricted Access</p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 bg-card border border-border rounded-2xl p-6 shadow-2xl">
          <div className="space-y-2">
            <Label htmlFor="admin-password" className="text-sm font-medium">Admin Password</Label>
            <Input
              id="admin-password"
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(null); }}
              placeholder="••••••••"
              className={error ? "border-destructive focus-visible:ring-destructive" : ""}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
          <Button type="submit" className="w-full h-11 bg-amber-600 hover:bg-amber-500" disabled={submitting || !password}>
            {submitting ? <Loader2 size={16} className="animate-spin mr-2" /> : <KeyRound size={16} className="mr-2" />}
            Unlock
          </Button>
        </form>
      </div>
    </div>
  );
}

function MessageDialog({
  user,
  open,
  onOpenChange,
  onSend,
}: {
  user: AdminUserSummary | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSend: (userId: number, title: string, body: string) => Promise<{ ok: boolean }>;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) { setTitle(""); setBody(""); }
  }, [open]);

  const handleSend = async () => {
    if (!user || !title.trim() || !body.trim()) return;
    setSending(true);
    const result = await onSend(user.id, title.trim(), body.trim());
    setSending(false);
    if (result.ok) {
      toast({ title: "Message sent", description: `Pinned to ${user.name}'s notifications.` });
      onOpenChange(false);
    } else {
      toast({ title: "Failed to send message", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Message {user?.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="msg-title">Title</Label>
            <Input id="msg-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Payment received" maxLength={120} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="msg-body">Message</Label>
            <Textarea id="msg-body" value={body} onChange={(e) => setBody(e.target.value)} placeholder="Your message…" maxLength={1000} rows={4} />
          </div>
          <p className="text-xs text-muted-foreground">This will be pinned to the top of the user's notifications.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSend} disabled={sending || !title.trim() || !body.trim()} className="bg-indigo-600 hover:bg-indigo-500">
            {sending ? <Loader2 size={16} className="animate-spin mr-2" /> : <Send size={16} className="mr-2" />}
            Send & Pin
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function HistoryDialog({
  user,
  open,
  onOpenChange,
  getUserHistory,
}: {
  user: AdminUserSummary | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  getUserHistory: (userId: number) => Promise<RedemptionHistoryEntry[]>;
}) {
  const [history, setHistory] = useState<RedemptionHistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !user) return;
    setLoading(true);
    getUserHistory(user.id).then((h) => { setHistory(h); setLoading(false); });
  }, [open, user, getUserHistory]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payment history — {user?.name}</DialogTitle>
        </DialogHeader>
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
        ) : history.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No code redemptions on record.</p>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {history.map((h) => (
              <div key={h.id} className="flex items-center justify-between border border-border rounded-lg p-3 text-sm">
                <div>
                  <p className="font-medium font-mono">{h.code}</p>
                  <p className="text-xs text-muted-foreground">{h.label ?? "—"} · {format(new Date(h.redeemedAt), "MMM d, yyyy p")}</p>
                </div>
                <p className="font-semibold text-emerald-500">{h.priceNaira ? `₦${h.priceNaira.toLocaleString()}` : "Free"}</p>
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CreateCodeDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreate: (input: { code: string; label?: string; durationDays?: number | null; maxRedemptions?: number | null; priceNaira?: number | null }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [durationDays, setDurationDays] = useState("7");
  const [priceNaira, setPriceNaira] = useState("500");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    if (open) { setCode(""); setLabel(""); setDurationDays("7"); setPriceNaira("500"); setMaxRedemptions(""); }
  }, [open]);

  const handleCreate = async () => {
    if (!code.trim()) return;
    setSubmitting(true);
    const result = await onCreate({
      code: code.trim().toUpperCase(),
      label: label.trim() || undefined,
      durationDays: durationDays === "" ? null : Number(durationDays),
      maxRedemptions: maxRedemptions === "" ? null : Number(maxRedemptions),
      priceNaira: priceNaira === "" ? null : Number(priceNaira),
    });
    setSubmitting(false);
    if (result.ok) {
      toast({ title: "Code created" });
      onOpenChange(false);
    } else {
      toast({ title: "Failed to create code", description: result.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New subscription code</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2 col-span-2">
            <Label>Code</Label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. WEEK12" className="font-mono uppercase" />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Label (internal note)</Label>
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Week 12" />
          </div>
          <div className="space-y-2">
            <Label>Duration (days)</Label>
            <Input type="number" value={durationDays} onChange={(e) => setDurationDays(e.target.value)} placeholder="blank = never expires" />
          </div>
          <div className="space-y-2">
            <Label>Price (₦)</Label>
            <Input type="number" value={priceNaira} onChange={(e) => setPriceNaira(e.target.value)} placeholder="blank = free" />
          </div>
          <div className="space-y-2 col-span-2">
            <Label>Max redemptions</Label>
            <Input type="number" value={maxRedemptions} onChange={(e) => setMaxRedemptions(e.target.value)} placeholder="blank = unlimited" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={submitting || !code.trim()} className="bg-indigo-600 hover:bg-indigo-500">
            {submitting ? <Loader2 size={16} className="animate-spin mr-2" /> : <Plus size={16} className="mr-2" />}
            Create
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function consentTypeBadge(type: AdminConsent["type"]) {
  const map = {
    location: "bg-sky-500/15 text-sky-400 border-sky-500/30",
    notification: "bg-violet-500/15 text-violet-400 border-violet-500/30",
    messaging: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  };
  return <Badge variant="outline" className={map[type]}>{type}</Badge>;
}

function consentStatusBadge(status: AdminConsent["status"]) {
  const map = {
    granted: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
    denied: "bg-red-500/15 text-red-400 border-red-500/30",
    revoked: "bg-zinc-500/15 text-zinc-400 border-zinc-500/30",
  };
  return <Badge variant="outline" className={map[status]}>{status}</Badge>;
}

function Dashboard({ admin }: { admin: ReturnType<typeof useAdmin> }) {
  const { stats, users, codes, consents, loading, error, logout, sendMessage, setUnlimited, revokeAccess, resetFreeTrial, getUserHistory, createCode, revokeCode, revokeConsent, refresh } = admin;
  const [, setLocation] = useLocation();
  const [search, setSearch] = useState("");
  const [messageTarget, setMessageTarget] = useState<AdminUserSummary | null>(null);
  const [historyTarget, setHistoryTarget] = useState<AdminUserSummary | null>(null);
  const [createCodeOpen, setCreateCodeOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (error) toast({ title: error, variant: "destructive" });
  }, [error, toast]);

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) => u.name.toLowerCase().includes(q) || u.phone?.includes(q) || u.googleEmail?.toLowerCase().includes(q),
    );
  }, [users, search]);

  return (
    <div className="min-h-[100dvh] w-full bg-background text-foreground">
      <header className="border-b border-border px-6 py-4 flex items-center justify-between sticky top-0 bg-background/95 backdrop-blur z-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500 to-amber-700 flex items-center justify-center shadow-md">
            <KeyRound size={18} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-lg tracking-tight leading-none">Admin HQ</p>
            <p className="text-[11px] text-muted-foreground font-mono mt-0.5">DeepFalcon command console</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setLocation("/")}>
            <ArrowLeft size={14} className="mr-1.5" /> Site
          </Button>
          <Button variant="outline" size="sm" onClick={logout}>
            <LogOut size={14} className="mr-1.5" /> Lock
          </Button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[
            { icon: Users, label: "Total users", value: stats?.totalUsers ?? "—", color: "text-foreground" },
            { icon: ShieldCheck, label: "Subscribed / unlimited", value: stats ? stats.subscribedCount + stats.unlimitedCount : "—", color: "text-emerald-400" },
            { icon: Unlock, label: "On free trial", value: stats?.freeCount ?? "—", color: "text-sky-400" },
            { icon: Lock, label: "Locked / expired", value: stats?.lockedOrExpiredCount ?? "—", color: "text-red-400" },
          ].map((s, i) => (
            <div key={i} className="rounded-2xl border border-border bg-card p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
                <s.icon size={14} /> {s.label}
              </div>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-4 col-span-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Wallet size={14} /> Total revenue collected
            </div>
            <p className="text-3xl font-bold text-emerald-400 font-mono">₦{(stats?.totalRevenueNaira ?? 0).toLocaleString()}</p>
          </div>
          <div className="rounded-2xl border border-border bg-card p-4 col-span-2 md:col-span-2">
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
              <Ticket size={14} /> Codes issued / active
            </div>
            <p className="text-2xl font-bold">{stats?.totalCodes ?? "—"} <span className="text-sm text-muted-foreground font-normal">({stats?.activeCodes ?? "—"} active, {stats?.totalRedemptions ?? "—"} redeemed)</span></p>
          </div>
        </div>

        <Tabs defaultValue="users">
          <TabsList>
            <TabsTrigger value="users">Users</TabsTrigger>
            <TabsTrigger value="codes">Subscription codes</TabsTrigger>
            <TabsTrigger value="consents">Consents</TabsTrigger>
          </TabsList>

          <TabsContent value="users" className="space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1 max-w-sm">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name, phone, or email" className="pl-9" />
              </div>
              {loading && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
            </div>
            <div className="rounded-xl border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Free trial</TableHead>
                    <TableHead>Access until</TableHead>
                    <TableHead>Joined</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredUsers.map((u) => (
                    <TableRow key={u.id}>
                      <TableCell>
                        <p className="font-medium">{u.name}</p>
                        <p className="text-xs text-muted-foreground">{u.phone ?? u.googleEmail ?? `#${u.id}`}</p>
                      </TableCell>
                      <TableCell>{statusBadge(u.status)}</TableCell>
                      <TableCell className="text-sm">{u.freeAccessesUsed}/{u.freeAccessLimit}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.accessExpiresAt ? format(new Date(u.accessExpiresAt), "MMM d, yyyy") : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{format(new Date(u.createdAt), "MMM d, yyyy")}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1 flex-wrap">
                          <Button variant="ghost" size="icon" title="Message" onClick={() => setMessageTarget(u)}>
                            <Send size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" title="Payment history" onClick={() => setHistoryTarget(u)}>
                            <History size={14} />
                          </Button>
                          <Button variant="ghost" size="icon" title={u.status === "unlimited" ? "Revoke unlimited" : "Grant unlimited access"} onClick={() => setUnlimited(u.id, u.status !== "unlimited")}>
                            {u.status === "unlimited" ? <Lock size={14} className="text-red-400" /> : <Unlock size={14} className="text-emerald-400" />}
                          </Button>
                          <Button variant="ghost" size="icon" title="Reset free trial" onClick={() => resetFreeTrial(u.id)}>
                            <RotateCcw size={14} />
                          </Button>
                          {u.status !== "free" && (
                            <Button variant="ghost" size="icon" title="Revoke access" onClick={() => revokeAccess(u.id)}>
                              <Lock size={14} className="text-red-400" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                  {filteredUsers.length === 0 && !loading && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">No users found.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>

          <TabsContent value="codes" className="space-y-4">
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setCreateCodeOpen(true)} className="bg-indigo-600 hover:bg-indigo-500">
                <Plus size={14} className="mr-1.5" /> New code
              </Button>
            </div>
            <div className="rounded-xl border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Code</TableHead>
                    <TableHead>Label</TableHead>
                    <TableHead>Price</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Redemptions</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {codes.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell className="font-mono font-medium">{c.code}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.label ?? "—"}</TableCell>
                      <TableCell className="text-sm">{c.priceNaira ? `₦${c.priceNaira.toLocaleString()}` : "Free"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{c.durationDays ? `${c.durationDays}d` : "Never expires"}</TableCell>
                      <TableCell className="text-sm">{c.redemptionCount}{c.maxRedemptions ? ` / ${c.maxRedemptions}` : ""}</TableCell>
                      <TableCell>
                        {c.isRevoked
                          ? <Badge variant="outline" className="bg-red-500/15 text-red-400 border-red-500/30">Revoked</Badge>
                          : <Badge variant="outline" className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30">Active</Badge>}
                      </TableCell>
                      <TableCell className="text-right">
                        {!c.isRevoked && (
                          <Button variant="ghost" size="sm" onClick={() => revokeCode(c.id)} className="text-red-400 hover:text-red-300">
                            Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {codes.length === 0 && (
                    <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">No codes yet.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
          <TabsContent value="consents" className="space-y-4">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{consents.length} consent record{consents.length !== 1 ? "s" : ""}</p>
              {loading && <Loader2 size={16} className="animate-spin text-muted-foreground" />}
            </div>
            <div className="rounded-xl border border-border overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>User</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Purpose</TableHead>
                    <TableHead>Granted</TableHead>
                    <TableHead>Revoked</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {consents.map((c) => (
                    <TableRow key={c.id}>
                      <TableCell>
                        <p className="font-medium">{c.userName}</p>
                        <p className="text-xs text-muted-foreground">{c.userPhone ?? `#${c.userId}`}</p>
                      </TableCell>
                      <TableCell>{consentTypeBadge(c.type)}</TableCell>
                      <TableCell>{consentStatusBadge(c.status)}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-[180px] truncate">{c.purpose ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.grantedAt ? format(new Date(c.grantedAt), "MMM d, yyyy p") : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {c.revokedAt ? format(new Date(c.revokedAt), "MMM d, yyyy p") : "—"}
                      </TableCell>
                      <TableCell className="text-right">
                        {c.status === "granted" && (
                          <Button variant="ghost" size="sm" onClick={() => revokeConsent(c.id)} className="text-red-400 hover:text-red-300">
                            <XCircle size={14} className="mr-1" /> Revoke
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                  {consents.length === 0 && !loading && (
                    <TableRow>
                      <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                        <FileCheck size={20} className="mx-auto mb-2 opacity-40" />
                        No consent records yet.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </TabsContent>
        </Tabs>
      </main>

      <MessageDialog user={messageTarget} open={!!messageTarget} onOpenChange={(v) => !v && setMessageTarget(null)} onSend={sendMessage} />
      <HistoryDialog user={historyTarget} open={!!historyTarget} onOpenChange={(v) => !v && setHistoryTarget(null)} getUserHistory={getUserHistory} />
      <CreateCodeDialog open={createCodeOpen} onOpenChange={setCreateCodeOpen} onCreate={createCode} />
    </div>
  );
}

export default function Admin() {
  const admin = useAdmin();
  if (!admin.unlocked) return <LoginGate onUnlock={admin.login} />;
  return <Dashboard admin={admin} />;
}
