import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, MapPin, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface DangerZone {
  id: number;
  name: string;
  description?: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  coordinates: Coordinate[];
  radius?: number;
  createdBy: number;
  createdAt: string;
}

const SEVERITY_COLORS = {
  low: 'bg-blue-500',
  medium: 'bg-yellow-500',
  high: 'bg-orange-500',
  critical: 'bg-red-500',
};

const SEVERITY_BADGES = {
  low: 'bg-blue-100 text-blue-800 border-blue-300',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  high: 'bg-orange-100 text-orange-800 border-orange-300',
  critical: 'bg-red-100 text-red-800 border-red-300',
};

export default function DangerZoneMap() {
  const { userId } = useAuth();
  const [zones, setZones] = useState<DangerZone[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [dangerAlert, setDangerAlert] = useState<any>(null);
  
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    severity: 'medium' as const,
    latitude: '',
    longitude: '',
    radius: '1',
  });

  // Fetch danger zones
  useEffect(() => {
    const fetchZones = async () => {
      try {
        const response = await fetch('/api/danger-zones');
        const data = await response.json();
        setZones(data);
      } catch (error) {
        console.error('Failed to fetch danger zones:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchZones();
  }, []);

  // Get user location and check for danger
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          setUserLocation({ latitude, longitude });

          // Check if in danger zone
          checkDangerZone(latitude, longitude);
        },
        (error) => {
          console.error('Failed to get location:', error);
        }
      );
    }
  }, [zones]);

  const checkDangerZone = async (latitude: number, longitude: number) => {
    try {
      const response = await fetch('/api/danger-zones/check-location', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ latitude, longitude }),
      });
      const data = await response.json();
      if (data.isDangerous) {
        setDangerAlert(data);
      } else {
        setDangerAlert(null);
      }
    } catch (error) {
      console.error('Failed to check danger zone:', error);
    }
  };

  const handleAddZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name || !formData.latitude || !formData.longitude) {
      alert('Please fill in all required fields');
      return;
    }

    try {
      const response = await fetch('/api/danger-zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: formData.name,
          description: formData.description,
          severity: formData.severity,
          coordinates: [
            {
              latitude: parseFloat(formData.latitude),
              longitude: parseFloat(formData.longitude),
            },
          ],
          radius: formData.radius,
          createdBy: userId,
        }),
      });

      if (response.ok) {
        const newZone = await response.json();
        setZones([...zones, newZone]);
        setFormData({
          name: '',
          description: '',
          severity: 'medium',
          latitude: '',
          longitude: '',
          radius: '1',
        });
        setShowForm(false);
      }
    } catch (error) {
      console.error('Failed to add danger zone:', error);
    }
  };

  const handleDeleteZone = async (id: number) => {
    if (!confirm('Are you sure you want to delete this danger zone?')) return;

    try {
      const response = await fetch(`/api/danger-zones/${id}`, {
        method: 'DELETE',
      });

      if (response.ok) {
        setZones(zones.filter(z => z.id !== id));
      }
    } catch (error) {
      console.error('Failed to delete danger zone:', error);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <AlertTriangle className="text-red-500" size={32} />
            Danger Zone Map
          </h1>
          <p className="text-muted-foreground mt-1">Mark and detect dangerous areas in real-time.</p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} variant="default" className="w-full sm:w-auto">
          <Plus size={18} className="mr-2" />
          Mark Danger Zone
        </Button>
      </div>

      {/* Danger Alert */}
      {dangerAlert && dangerAlert.isDangerous && (
        <Card className="border-red-500 bg-red-50 dark:bg-red-950">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-red-600 dark:text-red-400">
              <AlertCircle size={24} />
              ⚠️ DANGER ZONE DETECTED
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="font-semibold text-red-700 dark:text-red-300">
              Threat Level: <Badge className={`ml-2 ${SEVERITY_BADGES[dangerAlert.threat]}`}>
                {dangerAlert.threat.toUpperCase()}
              </Badge>
            </p>
            <div className="space-y-2">
              {dangerAlert.zones.map((zone: any) => (
                <div key={zone.id} className="p-3 bg-white dark:bg-slate-900 rounded-lg border border-red-200 dark:border-red-800">
                  <p className="font-semibold text-foreground">{zone.name}</p>
                  <p className="text-sm text-muted-foreground">{zone.description || 'No description'}</p>
                  {zone.distance && <p className="text-xs text-red-600 dark:text-red-400 mt-1">Distance: {zone.distance} km</p>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Current Location */}
      {userLocation && (
        <Card className="bg-blue-50 dark:bg-blue-950 border-blue-200 dark:border-blue-800">
          <CardContent className="pt-6">
            <div className="flex items-center gap-3">
              <MapPin className="text-blue-500" size={24} />
              <div>
                <p className="font-semibold">Current Location</p>
                <p className="text-sm text-muted-foreground">
                  {userLocation.latitude.toFixed(4)}, {userLocation.longitude.toFixed(4)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add Zone Form */}
      {showForm && (
        <Card className="border-primary/30 bg-primary/5">
          <CardHeader>
            <CardTitle>Mark New Danger Zone</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAddZone} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Zone Name *</Label>
                  <Input
                    id="name"
                    placeholder="e.g., Construction Site"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="bg-white"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="severity">Severity Level</Label>
                  <select
                    id="severity"
                    value={formData.severity}
                    onChange={(e) => setFormData({ ...formData, severity: e.target.value as any })}
                    className="w-full px-3 py-2 border border-input rounded-md bg-white text-foreground"
                  >
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">Critical</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Description</Label>
                <textarea
                  id="description"
                  placeholder="What makes this area dangerous?"
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  className="w-full px-3 py-2 border border-input rounded-md bg-white text-foreground"
                  rows={3}
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="latitude">Latitude *</Label>
                  <Input
                    id="latitude"
                    type="number"
                    placeholder="40.7128"
                    step="0.0001"
                    value={formData.latitude}
                    onChange={(e) => setFormData({ ...formData, latitude: e.target.value })}
                    className="bg-white"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="longitude">Longitude *</Label>
                  <Input
                    id="longitude"
                    type="number"
                    placeholder="-74.0060"
                    step="0.0001"
                    value={formData.longitude}
                    onChange={(e) => setFormData({ ...formData, longitude: e.target.value })}
                    className="bg-white"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="radius">Radius (km)</Label>
                  <Input
                    id="radius"
                    type="number"
                    placeholder="1"
                    step="0.1"
                    value={formData.radius}
                    onChange={(e) => setFormData({ ...formData, radius: e.target.value })}
                    className="bg-white"
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <Button type="submit" className="flex-1">Save Danger Zone</Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowForm(false)}
                  className="flex-1"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Danger Zones List */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => <div key={i} className="h-48 bg-muted animate-pulse rounded-lg" />)}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {zones.map(zone => (
            <Card key={zone.id} className="border-2 hover:shadow-lg transition-shadow">
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <CardTitle>{zone.name}</CardTitle>
                    <CardDescription>{zone.description || 'No description'}</CardDescription>
                  </div>
                  <Badge className={`ml-2 ${SEVERITY_BADGES[zone.severity]}`}>
                    {zone.severity}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2 text-sm">
                  <p><span className="font-semibold">Location:</span> {zone.coordinates[0].latitude.toFixed(4)}, {zone.coordinates[0].longitude.toFixed(4)}</p>
                  {zone.radius && <p><span className="font-semibold">Radius:</span> {zone.radius} km</p>}
                  <p><span className="font-semibold">Created:</span> {new Date(zone.createdAt).toLocaleDateString()}</p>
                </div>
                <Button
                  onClick={() => handleDeleteZone(zone.id)}
                  variant="destructive"
                  size="sm"
                  className="w-full"
                >
                  <Trash2 size={16} className="mr-2" />
                  Delete Zone
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {zones.length === 0 && !loading && (
        <Card className="text-center py-12 border-dashed">
          <CardContent>
            <AlertTriangle size={48} className="mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground mb-4">No danger zones marked yet</p>
            <Button onClick={() => setShowForm(true)}>Mark Your First Danger Zone</Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
