import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Clock, Plus, X, Settings2 } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface TimeZoneDisplay {
  id: string;
  name: string;
  timezone: string;
  time: string;
  date: string;
  offset: string;
}

const TIMEZONES = [
  { name: 'New York', timezone: 'America/New_York' },
  { name: 'Los Angeles', timezone: 'America/Los_Angeles' },
  { name: 'London', timezone: 'Europe/London' },
  { name: 'Tokyo', timezone: 'Asia/Tokyo' },
  { name: 'Sydney', timezone: 'Australia/Sydney' },
  { name: 'Dubai', timezone: 'Asia/Dubai' },
  { name: 'Singapore', timezone: 'Asia/Singapore' },
  { name: 'Hong Kong', timezone: 'Asia/Hong_Kong' },
  { name: 'Mumbai', timezone: 'Asia/Kolkata' },
  { name: 'Bangkok', timezone: 'Asia/Bangkok' },
  { name: 'Berlin', timezone: 'Europe/Berlin' },
  { name: 'Paris', timezone: 'Europe/Paris' },
  { name: 'Toronto', timezone: 'America/Toronto' },
  { name: 'São Paulo', timezone: 'America/Sao_Paulo' },
  { name: 'Mexico City', timezone: 'America/Mexico_City' },
  { name: 'Istanbul', timezone: 'Europe/Istanbul' },
  { name: 'Bangkok', timezone: 'Asia/Bangkok' },
  { name: 'Auckland', timezone: 'Pacific/Auckland' },
];

function getTimeZoneOffset(timezone: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    timeZoneName: 'longOffset',
  });
  const parts = formatter.formatToParts(now);
  const offset = parts.find(p => p.type === 'timeZoneName');
  return offset?.value || 'UTC';
}

function formatTimeForZone(timezone: string): { time: string; date: string } {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  
  const dateFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: '2-digit',
  });
  
  return {
    time: formatter.format(now),
    date: dateFormatter.format(now),
  };
}

export default function WorldClock() {
  const [displayZones, setDisplayZones] = useState<TimeZoneDisplay[]>([
    TIMEZONES[0], // New York
    TIMEZONES[3], // Tokyo
    TIMEZONES[2], // London
  ]);
  const [searchTerm, setSearchTerm] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [times, setTimes] = useState<Record<string, { time: string; date: string }>>({});

  // Update times every second
  useEffect(() => {
    const updateTimes = () => {
      const newTimes: Record<string, { time: string; date: string }> = {};
      displayZones.forEach(zone => {
        newTimes[zone.timezone] = formatTimeForZone(zone.timezone);
      });
      setTimes(newTimes);
    };

    updateTimes();
    const interval = setInterval(updateTimes, 1000);
    return () => clearInterval(interval);
  }, [displayZones]);

  const handleAddZone = (timezone: any) => {
    if (!displayZones.find(z => z.timezone === timezone.timezone)) {
      setDisplayZones([...displayZones, timezone]);
      setShowAdd(false);
      setSearchTerm('');
    }
  };

  const handleRemoveZone = (timezone: string) => {
    if (displayZones.length > 1) {
      setDisplayZones(displayZones.filter(z => z.timezone !== timezone));
    }
  };

  const filteredZones = TIMEZONES.filter(zone =>
    zone.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    !displayZones.find(z => z.timezone === zone.timezone)
  );

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
            <Clock className="text-primary" size={32} />
            World Clock
          </h1>
          <p className="text-muted-foreground mt-1">Track time across multiple time zones in real-time.</p>
        </div>
        <Button
          onClick={() => setShowAdd(!showAdd)}
          variant="outline"
          className="w-full sm:w-auto"
        >
          <Plus size={18} className="mr-2" />
          Add Time Zone
        </Button>
      </div>

      {/* Add Time Zone Dialog */}
      <AnimatePresence>
        {showAdd && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-3"
          >
            <Card className="border-primary/30 bg-primary/5">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">Add a Time Zone</CardTitle>
                  <button
                    onClick={() => setShowAdd(false)}
                    className="p-1 hover:bg-muted rounded-md transition-colors"
                  >
                    <X size={20} />
                  </button>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <Input
                  placeholder="Search time zones..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="bg-white"
                  autoFocus
                />
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-60 overflow-y-auto">
                  {filteredZones.slice(0, 10).map(zone => (
                    <button
                      key={zone.timezone}
                      onClick={() => handleAddZone(zone)}
                      className="p-3 text-left rounded-lg border border-border hover:bg-muted hover:border-primary/50 transition-all"
                    >
                      <p className="font-medium text-sm">{zone.name}</p>
                      <p className="text-xs text-muted-foreground">{zone.timezone}</p>
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Time Zone Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence>
          {displayZones.map((zone, idx) => {
            const timeData = times[zone.timezone];
            const offset = getTimeZoneOffset(zone.timezone);
            const isNight = parseInt(timeData?.time.split(':')[0] || '0') < 6 || parseInt(timeData?.time.split(':')[0] || '0') >= 18;

            return (
              <motion.div
                key={zone.timezone}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ delay: idx * 0.05 }}
              >
                <Card className={`border-2 transition-all hover:shadow-lg ${
                  isNight
                    ? 'bg-gradient-to-br from-slate-900 to-slate-800 border-slate-700'
                    : 'bg-gradient-to-br from-blue-50 to-cyan-50 border-blue-200 dark:from-blue-950 dark:to-cyan-950 dark:border-blue-800'
                }`}>
                  <CardHeader className="flex flex-row items-start justify-between pb-3">
                    <div>
                      <CardTitle className={isNight ? 'text-white' : 'text-foreground'}>
                        {zone.name}
                      </CardTitle>
                      <CardDescription className={isNight ? 'text-slate-300' : ''}>
                        {offset}
                      </CardDescription>
                    </div>
                    <button
                      onClick={() => handleRemoveZone(zone.timezone)}
                      className={`p-2 rounded-lg hover:bg-red-500/20 transition-colors ${
                        isNight ? 'text-slate-300 hover:text-red-400' : 'text-muted-foreground hover:text-red-600'
                      }`}
                      title="Remove time zone"
                    >
                      <X size={18} />
                    </button>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Digital Clock Display */}
                    <div className="space-y-2">
                      <div className={`text-6xl font-mono font-bold tracking-tighter font-thin transition-all ${
                        isNight ? 'text-white drop-shadow-lg' : 'text-blue-900 dark:text-blue-100'
                      }`}>
                        {timeData?.time || '--:--:--'}
                      </div>
                      <div className={`text-sm font-medium ${
                        isNight ? 'text-slate-300' : 'text-slate-600 dark:text-slate-300'
                      }`}>
                        {timeData?.date || '-- --- --'}
                      </div>
                    </div>

                    {/* Status Badge */}
                    <div className="flex items-center gap-2 pt-2">
                      <div className={`w-3 h-3 rounded-full ${
                        isNight
                          ? 'bg-yellow-400 shadow-lg shadow-yellow-400/50'
                          : 'bg-yellow-300 shadow-lg shadow-yellow-300/50'
                      }`} />
                      <Badge variant={isNight ? 'secondary' : 'default'} className="text-xs">
                        {isNight ? '🌙 Night' : '☀️ Day'}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* UTC Reference */}
      <Card className="border-border/60 bg-muted/30">
        <CardHeader>
          <CardTitle className="text-lg">UTC Reference</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Clock className="text-primary" size={24} />
            <div>
              <p className="text-2xl font-mono font-bold">{formatTimeForZone('UTC').time}</p>
              <p className="text-sm text-muted-foreground">Coordinated Universal Time</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
