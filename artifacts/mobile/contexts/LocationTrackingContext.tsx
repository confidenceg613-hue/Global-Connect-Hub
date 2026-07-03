import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { AppState, AppStateStatus } from 'react-native';

// ─── Config ──────────────────────────────────────────────────────────────────
// Super-reliable tracking config as specified
const LOCATION_CONFIG: Location.LocationOptions = {
  accuracy: Location.Accuracy.BestForNavigation,
  timeInterval: 1500,     // ms between updates (balanced)
  distanceInterval: 4,    // meters before a new update is emitted
};

const TOKEN_KEY = 'phoneLink_trackingToken';

// ─── Types ───────────────────────────────────────────────────────────────────
export type TrackingStatus = 'idle' | 'requesting' | 'active' | 'error';

interface LocationTrackingContextType {
  status: TrackingStatus;
  errorMessage: string | null;
  trackingToken: string | null;
  lastLocation: Location.LocationObject | null;
  /** Set the token that identifies this device's invite. Persisted to storage. */
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

async function pushLocationToApi(
  token: string,
  loc: Location.LocationObject | null,
  status: 'active' | 'offline' = 'active',
): Promise<void> {
  const base = buildApiBase();
  // Use placeholder coords for offline pings when no fix exists yet
  const latitude = loc?.coords.latitude ?? 0;
  const longitude = loc?.coords.longitude ?? 0;
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
    }),
  });
  if (!res.ok) {
    throw new Error(`location push failed: ${res.status}`);
  }
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function LocationTrackingProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<TrackingStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [trackingToken, setTrackingTokenState] = useState<string | null>(null);
  const [lastLocation, setLastLocation] = useState<Location.LocationObject | null>(null);

  const subscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const startingRef = useRef(false); // re-entrancy guard

  // Load persisted token on mount
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
    // Send offline ping regardless of whether a GPS fix was received yet
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

    // Re-entrancy guard: prevent duplicate watcher creation if called concurrently
    if (startingRef.current) return;
    startingRef.current = true;

    // Tear down any existing subscription first
    subscriptionRef.current?.remove();
    subscriptionRef.current = null;

    setStatus('requesting');
    setErrorMessage(null);

    // Capture the token at start time so the closure stays consistent
    const tokenSnapshot = trackingToken;

    try {
      // Request foreground permission
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
            await pushLocationToApi(tokenSnapshot, loc, 'active');
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

  // Handle foreground/background transitions
  // iOS can go active → inactive → background, so treat inactive→background as the exit
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prev = appStateRef.current;
      appStateRef.current = nextState;

      const wasActive = prev === 'active' || prev === 'inactive';
      const goingToBackground = nextState === 'background';
      const comingToForeground = nextState === 'active' && prev === 'background';

      if (wasActive && goingToBackground) {
        // Foreground watcher stops delivering in background — send offline ping
        if (trackingToken) {
          pushLocationToApi(trackingToken, lastLocation, 'offline').catch(() => {});
        }
      } else if (comingToForeground) {
        // Resume tracking when returning from background
        if (status === 'active' && !subscriptionRef.current && !startingRef.current) {
          startTracking().catch(() => {});
        }
      }
    });

    return () => sub.remove();
  }, [trackingToken, lastLocation, status, startTracking]);

  // Cleanup on unmount
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
