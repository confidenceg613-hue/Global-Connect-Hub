import { useState, useCallback } from "react";

export interface AppSettings {
  notifications: {
    geofenceAlerts: boolean;
    locationUpdateAlerts: boolean;
    newConsentAlerts: boolean;
    riskAlerts: boolean;
  };
  privacy: {
    autoRevokeAfterDays: number | null;
    showFullCoordinates: boolean;
  };
  appearance: {
    theme: "light" | "dark" | "system";
    compactView: boolean;
  };
  tracking: {
    defaultInviteExpiry: "1h" | "24h" | "7d" | "never";
    captureGeoPhotos: boolean;
    enableJourneyLines: boolean;
    enableRiskDetection: boolean;
  };
}

const SETTINGS_KEY = "phoneLink_settings";

const DEFAULT_SETTINGS: AppSettings = {
  notifications: {
    geofenceAlerts: true,
    locationUpdateAlerts: true,
    newConsentAlerts: true,
    riskAlerts: true,
  },
  privacy: {
    autoRevokeAfterDays: null,
    showFullCoordinates: true,
  },
  appearance: {
    theme: "system",
    compactView: false,
  },
  tracking: {
    defaultInviteExpiry: "24h",
    captureGeoPhotos: true,
    enableJourneyLines: true,
    enableRiskDetection: true,
  },
};

function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      notifications: { ...DEFAULT_SETTINGS.notifications, ...parsed.notifications },
      privacy: { ...DEFAULT_SETTINGS.privacy, ...parsed.privacy },
      appearance: { ...DEFAULT_SETTINGS.appearance, ...parsed.appearance },
      tracking: { ...DEFAULT_SETTINGS.tracking, ...parsed.tracking },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}

export function useSettings() {
  const [settings, setSettingsState] = useState<AppSettings>(loadSettings);

  const updateSettings = useCallback((updater: (prev: AppSettings) => AppSettings) => {
    setSettingsState((prev) => {
      const next = updater(prev);
      saveSettings(next);
      return next;
    });
  }, []);

  const resetSettings = useCallback(() => {
    saveSettings(DEFAULT_SETTINGS);
    setSettingsState(DEFAULT_SETTINGS);
  }, []);

  return { settings, updateSettings, resetSettings };
}
