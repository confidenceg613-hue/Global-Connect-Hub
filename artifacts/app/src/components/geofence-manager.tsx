import { useState, useEffect } from "react";
import { Plus, Trash2, MapPin, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Geofence {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  radiusMeters: number;
  createdAt: string;
}

const PRESETS = [
  { label: "Home", emoji: "🏠" },
  { label: "Work", emoji: "🏢" },
  { label: "School", emoji: "🏫" },
  { label: "Gym", emoji: "💪" },
  { label: "Custom", emoji: "📍" },
];

interface Props { userId: number; }

export function GeofenceManager({ userId }: Props) {
  const { toast } = useToast();
  const [fences, setFences] = useState<Geofence[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [locating, setLocating] = useState(false);

  const [form, setForm] = useState({
    name: "",
    latitude: "",
    longitude: "",
    radiusMeters: "200",
  });

  function loadFences() {
    fetch(`${API_BASE}/api/geofences/${userId}`)
      .then((r) => r.json())
      .then((d) => { setFences(d); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { loadFences(); }, [userId]);

  function getCurrentLocation() {
    if (!navigator.geolocation) {
      toast({ title: "Geolocation not supported", variant: "destructive" });
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((f) => ({
          ...f,
          latitude: pos.coords.latitude.toFixed(6),
          longitude: pos.coords.longitude.toFixed(6),
        }));
        setLocating(false);
      },
      () => {
        toast({ title: "Could not get location", variant: "destructive" });
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }

  async function addFence() {
    const lat = parseFloat(form.latitude);
    const lng = parseFloat(form.longitude);
    const radius = parseFloat(form.radiusMeters);

    if (!form.name.trim()) { toast({ title: "Name required", variant: "destructive" }); return; }
    if (isNaN(lat) || isNaN(lng)) { toast({ title: "Valid coordinates required", variant: "destructive" }); return; }

    setAdding(true);
    try {
      const res = await fetch(`${API_BASE}/api/geofences`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, name: form.name.trim(), latitude: lat, longitude: lng, radiusMeters: radius }),
      });
      if (!res.ok) throw new Error();
      toast({ title: "✅ Geofence added", description: `${form.name} (${radius}m radius)` });
      setForm({ name: "", latitude: "", longitude: "", radiusMeters: "200" });
      loadFences();
    } catch {
      toast({ title: "Failed to add geofence", variant: "destructive" });
    } finally {
      setAdding(false);
    }
  }

  async function deleteFence(id: number, name: string) {
    try {
      await fetch(`${API_BASE}/api/geofences/${id}`, { method: "DELETE" });
      toast({ title: `🗑 Removed ${name}` });
      setFences((prev) => prev.filter((f) => f.id !== id));
    } catch {
      toast({ title: "Failed to delete", variant: "destructive" });
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <MapPin size={15} className="text-primary" />
          Add Geofence Alert
        </h3>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p.label}
              onClick={() => setForm((f) => ({ ...f, name: p.label }))}
              className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${
                form.name === p.label
                  ? "bg-primary/20 border-primary/50 text-primary"
                  : "border-border text-muted-foreground hover:border-primary/30"
              }`}
            >
              {p.emoji} {p.label}
            </button>
          ))}
        </div>

        <input
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          placeholder="Location name (e.g. Home)"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />

        <div className="grid grid-cols-2 gap-2">
          <input
            className="rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Latitude"
            value={form.latitude}
            onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
          />
          <input
            className="rounded-md border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            placeholder="Longitude"
            value={form.longitude}
            onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex-1">
            <label className="text-xs text-muted-foreground">Radius: {form.radiusMeters}m</label>
            <input
              type="range" min="50" max="5000" step="50"
              value={form.radiusMeters}
              onChange={(e) => setForm((f) => ({ ...f, radiusMeters: e.target.value }))}
              className="w-full mt-1 accent-primary"
            />
          </div>
        </div>

        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={getCurrentLocation}
            disabled={locating}
            className="flex-1"
          >
            {locating ? <Loader2 size={14} className="animate-spin mr-1" /> : <MapPin size={14} className="mr-1" />}
            Use My Location
          </Button>
          <Button size="sm" onClick={addFence} disabled={adding} className="flex-1">
            {adding ? <Loader2 size={14} className="animate-spin mr-1" /> : <Plus size={14} className="mr-1" />}
            Add Fence
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 size={20} className="animate-spin text-muted-foreground" /></div>
      ) : fences.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">
          No geofences yet. Add one above to get notified when contacts arrive or leave.
        </p>
      ) : (
        <ul className="space-y-2">
          {fences.map((f) => (
            <li key={f.id} className="flex items-center justify-between rounded-lg border border-border bg-card px-4 py-3">
              <div>
                <p className="text-sm font-medium text-foreground">{f.name}</p>
                <p className="text-xs text-muted-foreground">
                  {f.latitude.toFixed(4)}, {f.longitude.toFixed(4)} · {f.radiusMeters}m radius
                </p>
              </div>
              <button
                onClick={() => deleteFence(f.id, f.name)}
                className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-400/10 transition-colors"
                aria-label="Delete geofence"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
