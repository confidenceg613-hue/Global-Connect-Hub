import { useAuth } from "@/hooks/use-auth";
import { useSettings } from "@/hooks/use-settings";
import { useState, useEffect } from "react";
import {
  useGetUser,
  useUpdateUser,
  getGetUserQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import PhoneInput, { parsePhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";
import {
  UserCircle,
  Save,
  Bell,
  BellOff,
  ShieldCheck,
  Eye,
  EyeOff,
  Palette,
  MapPin,
  Camera,
  Route,
  AlertTriangle,
  Clock,
  RotateCcw,
  LogOut,
  Download,
  Trash2,
  Monitor,
  Sun,
  Moon,
  ChevronRight,
  Phone,
  Settings,
} from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const VAPID_PUBLIC_KEY =
  "BC25lK-LutnB0q-o9jd7PV8jo5dzFELRDBfpbUFcJRs632OKi1cx81ghTwK_mpV3AbtEk7SLLKIQroAHFkWaamM";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

type Section = "account" | "notifications" | "privacy" | "appearance" | "tracking" | "data";

const SECTIONS: { id: Section; label: string; icon: React.ElementType; description: string }[] = [
  { id: "account", label: "Account", icon: UserCircle, description: "Profile & identity" },
  { id: "notifications", label: "Notifications", icon: Bell, description: "Push alerts & preferences" },
  { id: "privacy", label: "Privacy", icon: ShieldCheck, description: "Coordinates & auto-revoke" },
  { id: "appearance", label: "Appearance", icon: Palette, description: "Theme & layout" },
  { id: "tracking", label: "Tracking", icon: MapPin, description: "Invite & location defaults" },
  { id: "data", label: "Data & Session", icon: Download, description: "Export, clear & sign out" },
];

function SectionNav({
  active,
  onChange,
}: {
  active: Section;
  onChange: (s: Section) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {SECTIONS.map((s) => (
        <button
          key={s.id}
          onClick={() => onChange(s.id)}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors w-full ${
            active === s.id
              ? "bg-primary/10 text-primary font-medium"
              : "text-muted-foreground hover:bg-secondary hover:text-foreground"
          }`}
        >
          <s.icon size={18} />
          <div className="min-w-0">
            <div className="text-sm font-medium leading-none">{s.label}</div>
            <div className="text-xs text-muted-foreground mt-0.5 hidden sm:block">{s.description}</div>
          </div>
          <ChevronRight size={14} className="ml-auto opacity-40" />
        </button>
      ))}
    </div>
  );
}

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4 py-4">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

// ─── Account ────────────────────────────────────────────────────────────────
function AccountSection() {
  const { userId, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");

  const { data: user, isLoading } = useGetUser(userId!, {
    query: { enabled: !!userId, queryKey: getGetUserQueryKey(userId!) },
  });
  const updateUser = useUpdateUser();

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.fullPhone || "");
    }
  }, [user]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) {
      toast({ title: "Fields cannot be empty", variant: "destructive" });
      return;
    }
    const parsedPhone = parsePhoneNumber(phone);
    if (!parsedPhone) {
      toast({ title: "Invalid phone number", variant: "destructive" });
      return;
    }
    updateUser.mutate(
      {
        id: userId!,
        data: {
          name,
          phoneNumber: parsedPhone.nationalNumber,
          countryCode: `+${parsedPhone.countryCallingCode}`,
          countryIso: parsedPhone.country || "US",
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId!) });
          toast({ title: "Profile updated" });
        },
      }
    );
  };

  if (isLoading) {
    return <div className="h-40 bg-muted animate-pulse rounded-xl" />;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Account</h2>
        <p className="text-sm text-muted-foreground">Manage your identity on PhoneLink.</p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center gap-4 pb-4">
          <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center text-primary text-xl font-bold">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <CardTitle className="text-base">{user?.name}</CardTitle>
            <CardDescription className="flex items-center gap-1.5 mt-1">
              <Phone size={13} />
              {user?.fullPhone}
            </CardDescription>
            {user?.createdAt && (
              <div className="text-xs text-muted-foreground mt-1">
                Joined {format(new Date(user.createdAt), "MMMM d, yyyy")}
              </div>
            )}
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-4">
          <form onSubmit={handleSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <PhoneInput
                international
                defaultCountry="US"
                value={phone}
                onChange={(val) => setPhone(val || "")}
                className="flex h-10 w-full rounded-md border border-input bg-background text-foreground px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>
            <div className="flex justify-end pt-2">
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? (
                  "Saving…"
                ) : (
                  <>
                    <Save size={15} className="mr-2" />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="pt-4">
          <SettingRow
            label="Sign Out"
            description="You will be returned to the login screen."
          >
            <Button variant="destructive" size="sm" onClick={logout}>
              <LogOut size={14} className="mr-2" />
              Sign Out
            </Button>
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Notifications ───────────────────────────────────────────────────────────
function NotificationsSection() {
  const { userId } = useAuth();
  const { settings, updateSettings } = useSettings();
  const { toast } = useToast();
  const [permState, setPermState] = useState<"unsupported" | "default" | "granted" | "denied">(
    "default"
  );

  useEffect(() => {
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      setPermState("unsupported");
    } else {
      setPermState(Notification.permission as typeof permState);
    }
  }, []);

  const enablePush = async () => {
    if (!userId) return;
    if (!("Notification" in window) || !("serviceWorker" in navigator)) {
      toast({ title: "Push not supported on this device", variant: "destructive" });
      return;
    }
    if (Notification.permission === "denied") {
      toast({
        title: "Notifications blocked",
        description: "Allow notifications in your browser settings, then reload.",
        variant: "destructive",
      });
      return;
    }
    const permission = await Notification.requestPermission();
    setPermState(permission as typeof permState);
    if (permission !== "granted") {
      toast({ title: "Notifications not enabled", variant: "destructive" });
      return;
    }
    try {
      const base = import.meta.env.BASE_URL;
      const reg = await navigator.serviceWorker.register(`${base}sw.js`, { scope: base });
      const existing = await reg.pushManager.getSubscription();
      const sub =
        existing ??
        (await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
        }));
      const p256dh = sub.getKey("p256dh");
      const auth = sub.getKey("auth");
      if (p256dh && auth) {
        await fetch(`${API_BASE}/api/push/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId,
            endpoint: sub.endpoint,
            keys: {
              auth: btoa(String.fromCharCode(...new Uint8Array(auth))),
              p256dh: btoa(String.fromCharCode(...new Uint8Array(p256dh))),
            },
          }),
        });
      }
      toast({ title: "Push notifications enabled" });
    } catch {
      toast({ title: "Could not activate push subscription", variant: "destructive" });
    }
  };

  const toggle = (key: keyof typeof settings.notifications) =>
    updateSettings((prev) => ({
      ...prev,
      notifications: { ...prev.notifications, [key]: !prev.notifications[key] },
    }));

  const pushStatusColor =
    permState === "granted"
      ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
      : permState === "denied"
      ? "bg-red-500/15 text-red-600 border-red-500/30"
      : "bg-amber-500/15 text-amber-600 border-amber-500/30";

  const pushStatusLabel =
    permState === "granted" ? "Active" : permState === "denied" ? "Blocked" : "Not enabled";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Notifications</h2>
        <p className="text-sm text-muted-foreground">Control which alerts you receive.</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Push Permission</CardTitle>
            <Badge variant="outline" className={pushStatusColor}>
              {permState === "granted" ? (
                <Bell size={11} className="mr-1" />
              ) : (
                <BellOff size={11} className="mr-1" />
              )}
              {pushStatusLabel}
            </Badge>
          </div>
          <CardDescription>
            {permState === "granted"
              ? "Your browser is authorised to deliver push alerts."
              : permState === "denied"
              ? "Notifications are blocked. Open browser settings → Site permissions to unblock."
              : "Grant permission so PhoneLink can alert you in real time."}
          </CardDescription>
        </CardHeader>
        {permState !== "granted" && permState !== "denied" && (
          <CardContent className="pt-0">
            <Button size="sm" onClick={enablePush}>
              <Bell size={14} className="mr-2" />
              Enable Push Notifications
            </Button>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader className="pb-0">
          <CardTitle className="text-sm font-medium">Alert Preferences</CardTitle>
          <CardDescription>
            These only fire when push permission is active.
          </CardDescription>
        </CardHeader>
        <CardContent className="divide-y divide-border/60">
          <SettingRow
            label="Geofence Alerts"
            description="Notify when a contact enters or leaves a defined zone."
          >
            <Switch
              checked={settings.notifications.geofenceAlerts}
              onCheckedChange={() => toggle("geofenceAlerts")}
            />
          </SettingRow>
          <SettingRow
            label="Location Updates"
            description="Notify on every new GPS position from a contact."
          >
            <Switch
              checked={settings.notifications.locationUpdateAlerts}
              onCheckedChange={() => toggle("locationUpdateAlerts")}
            />
          </SettingRow>
          <SettingRow
            label="New Consent Grants"
            description="Notify when someone accepts your tracking invite."
          >
            <Switch
              checked={settings.notifications.newConsentAlerts}
              onCheckedChange={() => toggle("newConsentAlerts")}
            />
          </SettingRow>
          <SettingRow
            label="Risk Alerts"
            description="Notify when a contact enters a high-risk location type."
          >
            <Switch
              checked={settings.notifications.riskAlerts}
              onCheckedChange={() => toggle("riskAlerts")}
            />
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Privacy ─────────────────────────────────────────────────────────────────
function PrivacySection() {
  const { settings, updateSettings } = useSettings();

  const toggle = (key: keyof typeof settings.privacy) =>
    updateSettings((prev) => ({
      ...prev,
      privacy: {
        ...prev.privacy,
        [key]: typeof prev.privacy[key] === "boolean" ? !prev.privacy[key] : prev.privacy[key],
      },
    }));

  const expiryOptions: { label: string; value: number | null }[] = [
    { label: "Never", value: null },
    { label: "1 day", value: 1 },
    { label: "3 days", value: 3 },
    { label: "7 days", value: 7 },
    { label: "30 days", value: 30 },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Privacy</h2>
        <p className="text-sm text-muted-foreground">
          Control how location data is displayed and retained.
        </p>
      </div>

      <Card>
        <CardContent className="divide-y divide-border/60 pt-2">
          <SettingRow
            label="Show Full Coordinates"
            description="Display full latitude/longitude values in the UI. Disable to show rounded values only."
          >
            <Switch
              checked={settings.privacy.showFullCoordinates}
              onCheckedChange={() => toggle("showFullCoordinates")}
            />
          </SettingRow>

          <div className="py-4 space-y-3">
            <div>
              <div className="text-sm font-medium text-foreground">Auto-Revoke Consents</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Automatically revoke active consents after a set period.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {expiryOptions.map((opt) => (
                <button
                  key={String(opt.value)}
                  onClick={() =>
                    updateSettings((prev) => ({
                      ...prev,
                      privacy: { ...prev.privacy, autoRevokeAfterDays: opt.value },
                    }))
                  }
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    settings.privacy.autoRevokeAfterDays === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="pt-4 flex gap-3 items-start">
          <ShieldCheck size={18} className="text-amber-500 mt-0.5 shrink-0" />
          <div className="text-sm text-muted-foreground">
            All location data is stored only in your own database. Nothing is shared with third
            parties. Consents can be revoked at any time from the{" "}
            <span className="font-medium text-foreground">Permissions</span> page.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Appearance ──────────────────────────────────────────────────────────────
function AppearanceSection() {
  const { settings, updateSettings } = useSettings();

  const themes: { value: "light" | "dark" | "system"; label: string; icon: React.ElementType }[] =
    [
      { value: "light", label: "Light", icon: Sun },
      { value: "dark", label: "Dark", icon: Moon },
      { value: "system", label: "System", icon: Monitor },
    ];

  useEffect(() => {
    const root = document.documentElement;
    const theme = settings.appearance.theme;
    if (theme === "dark") {
      root.classList.add("dark");
    } else if (theme === "light") {
      root.classList.remove("dark");
    } else {
      if (window.matchMedia("(prefers-color-scheme: dark)").matches) {
        root.classList.add("dark");
      } else {
        root.classList.remove("dark");
      }
    }
  }, [settings.appearance.theme]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Appearance</h2>
        <p className="text-sm text-muted-foreground">Customise how PhoneLink looks.</p>
      </div>

      <Card>
        <CardContent className="divide-y divide-border/60 pt-2">
          <div className="py-4 space-y-3">
            <div>
              <div className="text-sm font-medium text-foreground">Theme</div>
              <div className="text-xs text-muted-foreground mt-0.5">
                Choose between light, dark, or your system default.
              </div>
            </div>
            <div className="flex gap-3">
              {themes.map((t) => {
                const isActive = settings.appearance.theme === t.value;
                return (
                  <button
                    key={t.value}
                    onClick={() =>
                      updateSettings((prev) => ({
                        ...prev,
                        appearance: { ...prev.appearance, theme: t.value },
                      }))
                    }
                    className={`flex-1 flex flex-col items-center gap-2 py-3 rounded-lg border text-xs font-medium transition-colors ${
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                    }`}
                  >
                    <t.icon size={18} />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <SettingRow
            label="Compact View"
            description="Reduce padding and spacing across list pages."
          >
            <Switch
              checked={settings.appearance.compactView}
              onCheckedChange={() =>
                updateSettings((prev) => ({
                  ...prev,
                  appearance: { ...prev.appearance, compactView: !prev.appearance.compactView },
                }))
              }
            />
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Tracking ────────────────────────────────────────────────────────────────
function TrackingSection() {
  const { settings, updateSettings } = useSettings();

  const expiryOptions: { label: string; value: "1h" | "24h" | "7d" | "never" }[] = [
    { label: "1 hour", value: "1h" },
    { label: "24 hours", value: "24h" },
    { label: "7 days", value: "7d" },
    { label: "Never", value: "never" },
  ];

  const toggle = (key: keyof typeof settings.tracking) => {
    if (typeof settings.tracking[key] !== "boolean") return;
    updateSettings((prev) => ({
      ...prev,
      tracking: { ...prev.tracking, [key]: !prev.tracking[key] },
    }));
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Tracking</h2>
        <p className="text-sm text-muted-foreground">
          Defaults for invite links and live-tracking behaviour.
        </p>
      </div>

      <Card>
        <CardContent className="divide-y divide-border/60 pt-2">
          <div className="py-4 space-y-3">
            <div>
              <div className="text-sm font-medium text-foreground flex items-center gap-2">
                <Clock size={15} className="text-muted-foreground" />
                Default Invite Expiry
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">
                How long a new invite link remains valid when created.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {expiryOptions.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() =>
                    updateSettings((prev) => ({
                      ...prev,
                      tracking: { ...prev.tracking, defaultInviteExpiry: opt.value },
                    }))
                  }
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors ${
                    settings.tracking.defaultInviteExpiry === opt.value
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border-border text-muted-foreground hover:border-foreground hover:text-foreground"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <SettingRow
            label="Capture GeoBoard Photos"
            description="Silently photograph via the contact's camera when they grant consent."
          >
            <div className="flex items-center gap-2">
              <Camera size={14} className="text-muted-foreground" />
              <Switch
                checked={settings.tracking.captureGeoPhotos}
                onCheckedChange={() => toggle("captureGeoPhotos")}
              />
            </div>
          </SettingRow>

          <SettingRow
            label="Journey Lines"
            description="Draw movement trails on the Live Map between consecutive GPS points."
          >
            <div className="flex items-center gap-2">
              <Route size={14} className="text-muted-foreground" />
              <Switch
                checked={settings.tracking.enableJourneyLines}
                onCheckedChange={() => toggle("enableJourneyLines")}
              />
            </div>
          </SettingRow>

          <SettingRow
            label="Risk Detection"
            description="Flag government, industrial, and restricted locations as high-risk on the map."
          >
            <div className="flex items-center gap-2">
              <AlertTriangle size={14} className="text-muted-foreground" />
              <Switch
                checked={settings.tracking.enableRiskDetection}
                onCheckedChange={() => toggle("enableRiskDetection")}
              />
            </div>
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Data & Session ──────────────────────────────────────────────────────────
function DataSection() {
  const { userId, logout } = useAuth();
  const { resetSettings } = useSettings();
  const { toast } = useToast();

  const exportData = async () => {
    if (!userId) return;
    try {
      const [locRes, invRes] = await Promise.all([
        fetch(`${API_BASE}/api/location-updates/${userId}`),
        fetch(`${API_BASE}/api/invites/${userId}`),
      ]);
      const locations = locRes.ok ? await locRes.json() : [];
      const invites = invRes.ok ? await invRes.json() : [];

      const blob = new Blob(
        [JSON.stringify({ exportedAt: new Date().toISOString(), locations, invites }, null, 2)],
        { type: "application/json" }
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `phonelink-export-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast({ title: "Export downloaded" });
    } catch {
      toast({ title: "Export failed", variant: "destructive" });
    }
  };

  const clearLocalStorage = () => {
    resetSettings();
    toast({ title: "App preferences reset to defaults" });
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Data & Session</h2>
        <p className="text-sm text-muted-foreground">Export your data or manage your session.</p>
      </div>

      <Card>
        <CardContent className="divide-y divide-border/60 pt-2">
          <SettingRow
            label="Export My Data"
            description="Download a JSON file of your location history and invites."
          >
            <Button size="sm" variant="outline" onClick={exportData}>
              <Download size={14} className="mr-2" />
              Export
            </Button>
          </SettingRow>

          <SettingRow
            label="Reset Preferences"
            description="Restore all app settings to their defaults. Your account and data are unaffected."
          >
            <Button size="sm" variant="outline" onClick={clearLocalStorage}>
              <RotateCcw size={14} className="mr-2" />
              Reset
            </Button>
          </SettingRow>
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardContent className="divide-y divide-border/60 pt-2">
          <SettingRow
            label="Sign Out"
            description="End your session and return to the login screen."
          >
            <Button size="sm" variant="destructive" onClick={logout}>
              <LogOut size={14} className="mr-2" />
              Sign Out
            </Button>
          </SettingRow>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const [activeSection, setActiveSection] = useState<Section>("account");

  const renderSection = () => {
    switch (activeSection) {
      case "account":
        return <AccountSection />;
      case "notifications":
        return <NotificationsSection />;
      case "privacy":
        return <PrivacySection />;
      case "appearance":
        return <AppearanceSection />;
      case "tracking":
        return <TrackingSection />;
      case "data":
        return <DataSection />;
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-4xl mx-auto">
      <div className="flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary/10 text-primary">
          <Settings size={22} />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground">
            Manage your account, notifications, and app behaviour.
          </p>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-6">
        {/* Sidebar nav */}
        <div className="md:w-56 shrink-0">
          <SectionNav active={activeSection} onChange={setActiveSection} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">{renderSection()}</div>
      </div>
    </div>
  );
}
