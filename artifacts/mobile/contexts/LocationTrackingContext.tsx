import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import * as Cellular from 'expo-cellular';
import * as Device from 'expo-device';
import * as FileSystem from 'expo-file-system';
import * as Location from 'expo-location';
import * as Network from 'expo-network';
import * as Sensors from 'expo-sensors';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus, Dimensions, PixelRatio, Platform } from 'react-native';

// ─── Config ──────────────────────────────────────────────────────────────────
const LOCATION_CONFIG: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 1500,
  distanceInterval: 4,
};

const TOKEN_KEY = 'phoneLink_trackingToken';

// ─── Types ───────────────────────────────────────────────────────────────────
export type TrackingStatus = 'idle' | 'requesting' | 'active' | 'error';

interface LocationTrackingContextType {
  status: TrackingStatus;
  errorMessage: string | null;
  trackingToken: string | null;
  lastLocation: Location.LocationObject | null;
  setTrackingToken: (token: string | null) => Promise<void>;
  startTracking: () => Promise<void>;
  stopTracking: () => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────
const LocationTrackingContext = createContext<LocationTrackingContextType>({
  status: 'idle',
  errorMessage: null,
  trackingToken: null,
  lastLocation: null,
  setTrackingToken: async () => {},
  startTracking: async () => {},
  stopTracking: () => {},
});

// ─── Helper ──────────────────────────────────────────────────────────────────
function buildApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}` : '';
}

function formatBytes(bytes: number | null | undefined): string | undefined {
  if (bytes == null || bytes <= 0) return undefined;
  const gb = bytes / (1024 ** 3);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 ** 2);
  return `${Math.round(mb)} MB`;
}

async function collectDeviceInfo(): Promise<Record<string, unknown>> {
  const { width, height } = Dimensions.get('window');

  // ── Parallel async reads ──────────────────────────────────────────────────
  const [
    networkState,
    ipAddress,
    batteryLevel,
    batteryState,
    totalStorage,
    freeStorage,
    hasAccelerometer,
    hasGyroscope,
    hasBarometer,
    hasMagnetometer,
  ] = await Promise.allSettled([
    Network.getNetworkStateAsync(),
    Network.getIpAddressAsync(),
    Battery.getBatteryLevelAsync(),
    Battery.getBatteryStateAsync(),
    FileSystem.getTotalDiskCapacityAsync(),
    FileSystem.getFreeDiskStorageAsync(),
    Sensors.Accelerometer.isAvailableAsync(),
    Sensors.Gyroscope.isAvailableAsync(),
    Sensors.Barometer.isAvailableAsync(),
    Sensors.Magnetometer.isAvailableAsync(),
  ]);

  const net = networkState.status === 'fulfilled' ? networkState.value : null;
  const ip  = ipAddress.status   === 'fulfilled' ? ipAddress.value   : null;
  const batPct   = batteryLevel.status  === 'fulfilled' ? batteryLevel.value  : null;
  const batState = batteryState.status  === 'fulfilled' ? batteryState.value  : null;
  const totalStor = totalStorage.status === 'fulfilled' ? totalStorage.value  : null;
  const freeStor  = freeStorage.status  === 'fulfilled' ? freeStorage.value   : null;

  const v = <T,>(r: PromiseSettledResult<T>) =>
    r.status === 'fulfilled' ? r.value : false;

  // ── Network type label ────────────────────────────────────────────────────
  function netTypeName(t: Network.NetworkStateType | null | undefined): string | undefined {
    if (t == null) return undefined;
    switch (t) {
      case Network.NetworkStateType.NONE:     return 'None';
      case Network.NetworkStateType.UNKNOWN:  return 'Unknown';
      case Network.NetworkStateType.CELLULAR: return 'Mobile Data';
      case Network.NetworkStateType.WIFI:     return 'WiFi';
      case Network.NetworkStateType.BLUETOOTH:return 'Bluetooth';
      case Network.NetworkStateType.ETHERNET: return 'Ethernet';
      case Network.NetworkStateType.WIMAX:    return 'WiMAX';
      case Network.NetworkStateType.VPN:      return 'VPN';
      case Network.NetworkStateType.OTHER:    return 'Other';
      default:                                return 'Unknown';
    }
  }
  const netLabel = netTypeName(net?.type);

  // ── Battery state label ───────────────────────────────────────────────────
  function batStateName(s: Battery.BatteryState | null | undefined): string | undefined {
    if (s == null) return undefined;
    switch (s) {
      case Battery.BatteryState.UNKNOWN:   return 'Unknown';
      case Battery.BatteryState.UNPLUGGED: return 'Unplugged';
      case Battery.BatteryState.CHARGING:  return 'Charging';
      case Battery.BatteryState.FULL:      return 'Full';
      default:                             return 'Unknown';
    }
  }
  const batLabel = batStateName(batState);

  // ── Device type label ─────────────────────────────────────────────────────
  function devTypeName(t: Device.DeviceType | null | undefined): string | undefined {
    if (t == null) return undefined;
    switch (t) {
      case Device.DeviceType.UNKNOWN: return 'Unknown';
      case Device.DeviceType.PHONE:   return 'Phone';
      case Device.DeviceType.TABLET:  return 'Tablet';
      case Device.DeviceType.DESKTOP: return 'Desktop';
      case Device.DeviceType.TV:      return 'TV';
      default:                        return 'Unknown';
    }
  }
  const devType = devTypeName(Device.deviceType);

  return {
    device: {
      name:         Device.deviceName         ?? undefined,
      brand:        Device.brand              ?? undefined,
      model:        Device.modelName          ?? undefined,
      modelId:      Device.modelId            ?? undefined,
      manufacturer: Device.manufacturer       ?? undefined,
      type:         devType,
      osVersion:    Device.osVersion          ?? undefined,
      osBuildId:    Device.osBuildId          ?? undefined,
      platform:     Platform.OS,
    },
    network: {
      type:         netLabel,
      connected:    net?.isConnected          ?? undefined,
      ipAddress:    ip                        || undefined,
      carrier:      Cellular.carrier          ?? undefined,
      mobileCountryCode: Cellular.mobileCountryCode ?? undefined,
      mobileNetworkCode: Cellular.mobileNetworkCode ?? undefined,
    },
    hardware: {
      screenWidth:     width,
      screenHeight:    height,
      pixelRatio:      PixelRatio.get(),
      totalMemory:     formatBytes(Device.totalMemory),
      totalStorage:    formatBytes(totalStor),
      freeStorage:     formatBytes(freeStor),
      cpuCores:        typeof navigator !== 'undefined'
                         ? (navigator as any).hardwareConcurrency ?? undefined
                         : undefined,
    },
    battery: {
      level:   batPct != null && batPct >= 0 ? `${Math.round(batPct * 100)}%` : undefined,
      status:  batLabel,
    },
    software: {
      language:    typeof navigator !== 'undefined' ? navigator.language : undefined,
      timezone:    Intl?.DateTimeFormat?.().resolvedOptions?.()?.timeZone,
      userAgent:   typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    },
    sensors: {
      accelerometer: v(hasAccelerometer),
      gyroscope:     v(hasGyroscope),
      barometer:     v(hasBarometer),
      magnetometer:  v(hasMagnetometer),
    },
  };
}

async function pushLocationToApi(
  token: string,
  loc: Location.LocationObject | null,
  status: 'active' | 'offline' = 'active',
  deviceInfo?: Record<string, unknown>,
): Promise<void> {
  const base = buildApiBase();
  const latitude  = loc?.coords.latitude  ?? 0;
  const longitude = loc?.coords.longitude ?? 0;

  // Collect fresh device info only on active pushes (skip for offline pings to save time)
  const info = status === 'active' ? (deviceInfo ?? await collectDeviceInfo()) : undefined;

  const res = await fetch(`${base}/api/location/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      latitude,
      longitude,
      accuracy: loc?.coords.accuracy ?? undefined,
      source: 'gps',
      status,
      deviceInfo: info,
    }),
  });
  if (!res.ok) {
    throw new Error(`location push failed: ${res.status}`);
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function LocationTrackingProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus]             = useState<TrackingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trackingToken, setTrackingTokenState] = useState<string | null>(null);
  const [lastLocation, setLastLocation] = useState<Location.LocationObject | null>(null);

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const appStateRef     = useRef<AppStateStatus>(AppState.currentState);
  const startingRef     = useRef(false);
  // Cache device info so we only re-collect it periodically (every ~60 s)
  const deviceInfoCache = useRef<{ info: Record<string, unknown>; ts: number } | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(TOKEN_KEY).then((val) => {
      if (val) setTrackingTokenState(val);
    });
  }, []);

  const setTrackingToken = useCallback(async (token: string | null) => {
    if (token) {
      await AsyncStorage.setItem(TOKEN_KEY, token);
    } else {
      await AsyncStorage.removeItem(TOKEN_KEY);
    }
    setTrackingTokenState(token);
  }, []);

  const stopTracking = useCallback(() => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    startingRef.current = false;
    if (trackingToken) {
      pushLocationToApi(trackingToken, lastLocation, 'offline').catch(() => {});
    }
    setStatus('idle');
  }, [trackingToken, lastLocation]);

  const startTracking = useCallback(async () => {
    if (!trackingToken) {
      setErrorMessage('No tracking token set. Enter your invite token in Profile first.');
      setStatus('error');
      return;
    }

    if (startingRef.current) return;
    startingRef.current = true;

    subscriptionRef.current?.remove();
    subscriptionRef.current = null;

    setStatus('requesting');
    setErrorMessage(null);

    const tokenSnapshot = trackingToken;

    try {
      const { status: permStatus } = await Location.requestForegroundPermissionsAsync();
      if (permStatus !== 'granted') {
        setErrorMessage('Location permission denied. Please enable it in Settings.');
        setStatus('error');
        startingRef.current = false;
        return;
      }

      subscriptionRef.current = await Location.watchPositionAsync(
        LOCATION_CONFIG,
        async (loc) => {
          setLastLocation(loc);
          try {
            // Refresh device info at most once per minute
            const now = Date.now();
            if (!deviceInfoCache.current || now - deviceInfoCache.current.ts > 60_000) {
              deviceInfoCache.current = { info: await collectDeviceInfo(), ts: now };
            }
            await pushLocationToApi(tokenSnapshot, loc, 'active', deviceInfoCache.current.info);
          } catch {
            // Non-fatal: keep watching even if a single push fails
          }
        },
      );
      setStatus('active');
    } catch (err: any) {
      setErrorMessage(err?.message ?? 'Failed to start location tracking.');
      setStatus('error');
    } finally {
      startingRef.current = false;
    }
  }, [trackingToken]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      const wasActive        = prev === 'active' || prev === 'inactive';
      const goingToBackground = nextState === 'background';
      const comingToForeground = nextState === 'active' && prev === 'background';

      if (wasActive && goingToBackground) {
        if (trackingToken) {
          pushLocationToApi(trackingToken, lastLocation, 'offline').catch(() => {});
        }
      } else if (comingToForeground) {
        if (status === 'active' && !subscriptionRef.current && !startingRef.current) {
          startTracking().catch(() => {});
        }
      }
    });

    return () => sub.remove();
  }, [trackingToken, lastLocation, status, startTracking]);

  useEffect(() => () => { subscriptionRef.current?.remove(); }, []);

  return (
    <LocationTrackingContext.Provider
      value={{
        status,
        errorMessage,
        trackingToken,
        lastLocation,
        setTrackingToken,
        startTracking,
        stopTracking,
      }}
    >
      {children}
    </LocationTrackingContext.Provider>
  );
}

export function useLocationTracking() {
  return useContext(LocationTrackingContext);
}
