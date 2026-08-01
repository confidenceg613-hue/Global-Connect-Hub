import { useState, useCallback } from "react";

const PIN_KEY = "df_app_pin";
const PIN_ENABLED_KEY = "df_pin_enabled";

function encodePin(pin: string): string {
  // Simple reversible encoding — client-side PIN is not a security boundary,
  // just a UX friction layer. Store as base64 so it's not plain text.
  return btoa(`df:${pin}`);
}

export function usePin() {
  const [pinEnabled, setPinEnabled] = useState(
    () => localStorage.getItem(PIN_ENABLED_KEY) === "true"
  );

  const hasPin = useCallback(() => {
    return !!localStorage.getItem(PIN_KEY);
  }, []);

  const verifyPin = useCallback((pin: string): boolean => {
    return localStorage.getItem(PIN_KEY) === encodePin(pin);
  }, []);

  const savePin = useCallback((pin: string) => {
    localStorage.setItem(PIN_KEY, encodePin(pin));
    localStorage.setItem(PIN_ENABLED_KEY, "true");
    setPinEnabled(true);
  }, []);

  const removePin = useCallback(() => {
    localStorage.removeItem(PIN_KEY);
    localStorage.setItem(PIN_ENABLED_KEY, "false");
    setPinEnabled(false);
  }, []);

  return { pinEnabled, hasPin, verifyPin, savePin, removePin };
}
