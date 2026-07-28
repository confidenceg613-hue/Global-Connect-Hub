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
import {
  BACKGROUND_LOCATION_TASK,
  ACTIVE_SESSION_TOKEN_STORAGE_KEY,
  TRACKING_SESSION_END_STORAGE_KEY,
  TRACKING_TOKEN_STORAGE_KEY,
} from '@/lib/background-location';

// ─── Config ──────────────────────────────────────────────────────────────────
const LOCATION_CONFIG: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 1500,
  distanceInterval: 4,
};
const SHARING_DURATION_MS = 10 * 60 * 1000;
const BACKGROUND_LOCATION_CONFIG: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 3_000,
  distanceInterval: 4,
  foregroundService: {
    notificationTitle: 'PhoneLink location sharing is active',
    notificationBody: 'Sharing your location for up to 10 minutes.',
    notificationColor: '#f59e0b',
  },
  pausesUpdatesAutomatically: false,
};

// ─── Types ───────────────────────────────────────────────────────────────────
export type TrackingStatus = 'idle' | 'requesting' | 'active' | 'error';

interface LocationTrackingContextType {
  status: TrackingStatus;
  errorMessage: string | null;
  trackingToken: string | null;
  lastLocation: Location.LocationObject | null;
  sharingEndsAt: number | null;
  setTrackingToken: (token: string | null) => Promise<void>;
  startTracking: () => Promise<void>;
  stopTracking: () => Promise<void>;
}

// ─── Context ─────────────────────────────────────────────────────────────────
const LocationTrackingContext = createContext<LocationTrackingContextType>({
  status: 'idle',
  errorMessage: null,
  trackingToken: null,
  lastLocation: null,
  sharingEndsAt: null,
  setTrackingToken: async () => {},
  startTracking: async () => {},
  stopTracking: async () => {},
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

async function createTimedSession(
  inviteToken: string,
  location: Location.LocationObject,
): Promise<string> {
  const response = await fetch(`${buildApiBase()}/api/invites/by-token/${encodeURIComponent(inviteToken)}/grant`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    }),
  });
  if (!response.ok) {
    throw new Error('Unable to start a location-sharing session for this invite.');
  }

  const body = await response.json() as { sessionToken?: string };
  if (!body.sessionToken) {
    throw new Error('Location-sharing session was not created.');
  }
  return body.sessionToken;
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function LocationTrackingProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus]             = useState<TrackingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trackingToken, setTrackingTokenState] = useState<string | null>(null);
  const [lastLocation, setLastLocation] = useState<Location.LocationObject | null>(null);
  const [sharingEndsAt, setSharingEndsAt] = useState<number | null>(null);

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const appStateRef     = useRef<AppStateStatus>(AppState.currentState);
  const startingRef     = useRef(false);
  const sharingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cache device info so we only re-collect it periodically (every ~60 s)
  const deviceInfoCache = useRef<{ info: Record<string, unknown>; ts: number } | null>(null);

  useEffect(() => {
    const restoreBackgroundSession = async () => {
      const [token, endValue] = await AsyncStorage.multiGet([
        TRACKING_TOKEN_STORAGE_KEY,
        TRACKING_SESSION_END_STORAGE_KEY,
      ]);
      if (token[1]) setTrackingTokenState(token[1]);

      const restoredEnd = Number(endValue[1] ?? 0);
      if (!restoredEnd || restoredEnd <= Date.now()) {
        await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
        await AsyncStorage.multiRemove([
          ACTIVE_SESSION_TOKEN_STORAGE_KEY,
          TRACKING_SESSION_END_STORAGE_KEY,
        ]);
        return;
      }

      setSharingEndsAt(restoredEnd);
      if (Platform.OS !== 'web' && await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK)) {
        setStatus('active');
      }
    };
    restoreBackgroundSession().catch(() => {});
  }, []);

  const setTrackingToken = useCallback(async (token: string | null) => {
    if (token) {
      await AsyncStorage.setItem(TRACKING_TOKEN_STORAGE_KEY, token);
    } else {
      await AsyncStorage.multiRemove([
        TRACKING_TOKEN_STORAGE_KEY,
        ACTIVE_SESSION_TOKEN_STORAGE_KEY,
        TRACKING_SESSION_END_STORAGE_KEY,
      ]);
    }
    setTrackingTokenState(token);
  }, []);

  const stopTracking = useCallback(async () => {
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;
    startingRef.current = false;
    if (sharingTimerRef.current) {
      clearTimeout(sharingTimerRef.current);
      sharingTimerRef.current = null;
    }
    if (Platform.OS !== 'web') {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
    }
    const [sessionToken, storedSessionEnd] = await AsyncStorage.multiGet([
      ACTIVE_SESSION_TOKEN_STORAGE_KEY,
      TRACKING_SESSION_END_STORAGE_KEY,
    ]);
    const sessionIsStillLive = Number(storedSessionEnd[1] ?? 0) > Date.now();
    await AsyncStorage.multiRemove([
      ACTIVE_SESSION_TOKEN_STORAGE_KEY,
      TRACKING_SESSION_END_STORAGE_KEY,
    ]);
    if (sessionToken[1] && sessionIsStillLive) {
      pushLocationToApi(sessionToken[1], lastLocation, 'offline').catch(() => {});
    }
    setSharingEndsAt(null);
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

      if (Platform.OS !== 'web') {
        const { status: backgroundStatus } = await Location.requestBackgroundPermissionsAsync();
        if (backgroundStatus !== 'granted') {
          setErrorMessage('Allow location access all the time so PhoneLink can share while you use other apps.');
          setStatus('error');
          startingRef.current = false;
          return;
        }
      }

      const initialLocation = await Location.getCurrentPositionAsync(LOCATION_CONFIG);
      setLastLocation(initialLocation);

      const storedSession = await AsyncStorage.getItem(ACTIVE_SESSION_TOKEN_STORAGE_KEY);
      const storedSessionEnd = Number(await AsyncStorage.getItem(TRACKING_SESSION_END_STORAGE_KEY) ?? 0);
      const activeSessionToken = storedSession && storedSessionEnd > Date.now()
        ? storedSession
        : await createTimedSession(tokenSnapshot, initialLocation);

      const sessionEnd = storedSessionEnd > Date.now()
        ? storedSessionEnd
        : Date.now() + SHARING_DURATION_MS;
      await AsyncStorage.setItem(ACTIVE_SESSION_TOKEN_STORAGE_KEY, activeSessionToken);
      await AsyncStorage.setItem(TRACKING_SESSION_END_STORAGE_KEY, String(sessionEnd));
      setSharingEndsAt(sessionEnd);

      if (Platform.OS !== 'web') {
        const alreadyStarted = await Location.hasStartedLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        if (alreadyStarted) {
          await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK);
        }
        await Location.startLocationUpdatesAsync(BACKGROUND_LOCATION_TASK, BACKGROUND_LOCATION_CONFIG);
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
            await pushLocationToApi(activeSessionToken, loc, 'active', deviceInfoCache.current.info);
          } catch {
            // Non-fatal: keep watching even if a single push fails
          }
        },
      );
      if (sharingTimerRef.current) clearTimeout(sharingTimerRef.current);
      sharingTimerRef.current = setTimeout(() => {
        stopTracking().catch(() => {});
      }, SHARING_DURATION_MS);
      setStatus('active');
    } catch (err: any) {
      setErrorMessage(err?.message ?? 'Failed to start location tracking.');
      setStatus('error');
    } finally {
      startingRef.current = false;
    }
  }, [trackingToken, stopTracking]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      const comingToForeground = nextState === 'active' && prev === 'background';

      if (comingToForeground) {
        if (status === 'active' && !subscriptionRef.current && !startingRef.current) {
          startTracking().catch(() => {});
        }
      }
    });

    return () => sub.remove();
  }, [status, startTracking]);

  useEffect(() => () => {
    subscriptionRef.current?.remove();
    if (sharingTimerRef.current) clearTimeout(sharingTimerRef.current);
  }, []);

  return (
    <LocationTrackingContext.Provider
      value={{
        status,
        errorMessage,
        trackingToken,
        lastLocation,
        sharingEndsAt,
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
