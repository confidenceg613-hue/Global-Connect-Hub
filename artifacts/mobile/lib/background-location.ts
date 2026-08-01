import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

export const BACKGROUND_LOCATION_TASK = 'phonelink-background-location';
export const TRACKING_TOKEN_STORAGE_KEY = 'phoneLink_trackingToken';
export const ACTIVE_SESSION_TOKEN_STORAGE_KEY = 'phoneLink_activeSessionToken';
export const TRACKING_SESSION_END_STORAGE_KEY = 'phoneLink_trackingSessionEnd';

function getApiBase(): string {
  const domain = process.env.EXPO_PUBLIC_DOMAIN;
  return domain ? `https://${domain}` : '';
}

async function sendBackgroundLocation(token: string, location: Location.LocationObject): Promise<void> {
  const response = await fetch(`${getApiBase()}/api/location/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
      accuracy: location.coords.accuracy ?? undefined,
      source: 'gps',
      status: 'active',
    }),
  });

  if (!response.ok) {
    throw new Error(`background location push failed: ${response.status}`);
  }
}

// Task definitions must run at module scope so Android can start the task even
// after the app's UI process has been reclaimed.
if (!TaskManager.isTaskDefined(BACKGROUND_LOCATION_TASK)) {
  TaskManager.defineTask(BACKGROUND_LOCATION_TASK, async ({ data, error }) => {
    if (error) {
      console.warn('[location] background task error', error.message);
      return;
    }

    const [token, sessionEndValue] = await AsyncStorage.multiGet([
      ACTIVE_SESSION_TOKEN_STORAGE_KEY,
      TRACKING_SESSION_END_STORAGE_KEY,
    ]);
    const sessionEndsAt = Number(sessionEndValue[1] ?? 0);

    if (!token[1] || !sessionEndsAt || Date.now() >= sessionEndsAt) {
      await Location.stopLocationUpdatesAsync(BACKGROUND_LOCATION_TASK).catch(() => {});
      await AsyncStorage.removeItem(TRACKING_SESSION_END_STORAGE_KEY);
      return;
    }

    const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
    const latestLocation = locations[locations.length - 1];
    if (!latestLocation) return;

    try {
      await sendBackgroundLocation(token[1], latestLocation);
    } catch (taskError) {
      // A transient network failure should never stop the 10-minute session.
      console.warn('[location] background update failed', taskError);
    }
  });
}