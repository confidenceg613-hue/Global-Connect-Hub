import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Clock } from 'lucide-react';

interface WorldClockWidgetProps {
  timezone: string;
  name: string;
  compact?: boolean;
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

export function WorldClockWidget({ timezone, name, compact = false }: WorldClockWidgetProps) {
  const [time, setTime] = useState(() => formatTimeForZone(timezone));

  useEffect(() => {
    const update = () => setTime(formatTimeForZone(timezone));
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [timezone]);

  const hour = parseInt(time.time.split(':')[0]);
  const isNight = hour < 6 || hour >= 18;

  if (compact) {
    return (
      <div className={`p-3 rounded-lg border ${isNight ? 'bg-slate-900 border-slate-700' : 'bg-blue-50 border-blue-200'}`}>
        <p className={`text-xs font-medium ${isNight ? 'text-slate-300' : 'text-slate-600'}`}>{name}</p>
        <p className={`text-2xl font-mono font-bold ${isNight ? 'text-white' : 'text-blue-900'}`}>
          {time.time}
        </p>
      </div>
    );
  }

  return (
    <Card className={isNight ? 'bg-slate-900 border-slate-700' : 'bg-blue-50 border-blue-200'}>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-4">
          <p className={`font-semibold ${isNight ? 'text-white' : 'text-foreground'}`}>{name}</p>
          <Badge variant={isNight ? 'secondary' : 'default'}>
            {isNight ? '🌙' : '☀️'}
          </Badge>
        </div>
        <p className={`text-4xl font-mono font-bold ${isNight ? 'text-white' : 'text-blue-900'}`}>
          {time.time}
        </p>
        <p className={`text-sm mt-2 ${isNight ? 'text-slate-300' : 'text-slate-600'}`}>
          {time.date}
        </p>
      </CardContent>
    </Card>
  );
}
