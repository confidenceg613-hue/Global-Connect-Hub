import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';

interface DangerZone {
  id: number;
  name: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  description?: string;
}

interface DangerZoneWidgetProps {
  latitude: number;
  longitude: number;
  onDangerDetected?: (zones: DangerZone[]) => void;
}

const SEVERITY_COLORS = {
  low: 'bg-blue-100 text-blue-800 border-blue-300',
  medium: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  high: 'bg-orange-100 text-orange-800 border-orange-300',
  critical: 'bg-red-100 text-red-800 border-red-300',
};

export function DangerZoneWidget({ latitude, longitude, onDangerDetected }: DangerZoneWidgetProps) {
  const [dangerZones, setDangerZones] = useState<DangerZone[]>([]);
  const [threatLevel, setThreatLevel] = useState<string>('safe');

  useEffect(() => {
    const checkDanger = async () => {
      try {
        const response = await fetch('/api/danger-zones/check-location', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude, longitude }),
        });
        const data = await response.json();
        
        if (data.isDangerous) {
          setDangerZones(data.zones);
          setThreatLevel(data.threat);
          onDangerDetected?.(data.zones);
        } else {
          setDangerZones([]);
          setThreatLevel('safe');
        }
      } catch (error) {
        console.error('Failed to check danger zones:', error);
      }
    };

    checkDanger();
    const interval = setInterval(checkDanger, 10000); // Check every 10 seconds
    return () => clearInterval(interval);
  }, [latitude, longitude, onDangerDetected]);

  if (threatLevel === 'safe') {
    return (
      <Card className="bg-green-50 dark:bg-green-950 border-green-200 dark:border-green-800">
        <CardContent className="pt-6">
          <p className="text-green-700 dark:text-green-300 font-semibold">✓ No danger zones nearby</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`${
      threatLevel === 'critical'
        ? 'bg-red-50 dark:bg-red-950 border-red-500'
        : threatLevel === 'high'
          ? 'bg-orange-50 dark:bg-orange-950 border-orange-500'
          : threatLevel === 'medium'
            ? 'bg-yellow-50 dark:bg-yellow-950 border-yellow-500'
            : 'bg-blue-50 dark:bg-blue-950 border-blue-500'
    } border-2`}>
      <CardContent className="pt-6 space-y-4">
        <div className="flex items-center gap-2">
          <AlertTriangle
            size={24}
            className={${
              threatLevel === 'critical'
                ? 'text-red-600 dark:text-red-400'
                : threatLevel === 'high'
                  ? 'text-orange-600 dark:text-orange-400'
                  : threatLevel === 'medium'
                    ? 'text-yellow-600 dark:text-yellow-400'
                    : 'text-blue-600 dark:text-blue-400'
            }}
          />
          <p className="font-semibold capitalize">{threatLevel} Threat Level</p>
        </div>
        {dangerZones.map(zone => (
          <div key={zone.id} className="p-2 bg-white dark:bg-slate-900 rounded border">
            <p className="font-medium text-sm">{zone.name}</p>
            <Badge className={`mt-1 ${SEVERITY_COLORS[zone.severity]}`}>
              {zone.severity}
            </Badge>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
