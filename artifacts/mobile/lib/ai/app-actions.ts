/**
 * App action dispatcher — executes commands the AI emits in <action>...</action> tags.
 *
 * Called by ChatScreen after each LLM response is parsed.
 */
export type AppAction =
  | { type: 'START_TRACKING' }
  | { type: 'STOP_TRACKING' }
  | { type: 'SHARE_LOCATION' }
  | { type: 'CREATE_NOTE'; text: string; latitude?: number; longitude?: number }
  | { type: 'NAVIGATE'; screen: string }
  | { type: 'UNKNOWN'; raw: unknown };

export interface ActionHandlers {
  startTracking?: () => void | Promise<void>;
  stopTracking?: () => void | Promise<void>;
  shareLocation?: () => void | Promise<void>;
  createNote?: (text: string, lat?: number, lng?: number) => void | Promise<void>;
  navigate?: (screen: string) => void;
}

/** Parse raw JSON from the model output into a typed AppAction. */
export function parseAction(raw: Record<string, unknown>): AppAction {
  const type = String(raw.type ?? '').toUpperCase();
  switch (type) {
    case 'START_TRACKING':  return { type: 'START_TRACKING' };
    case 'STOP_TRACKING':   return { type: 'STOP_TRACKING' };
    case 'SHARE_LOCATION':  return { type: 'SHARE_LOCATION' };
    case 'CREATE_NOTE':
      return {
        type: 'CREATE_NOTE',
        text: String(raw.text ?? ''),
        latitude: typeof raw.latitude === 'number' ? raw.latitude : undefined,
        longitude: typeof raw.longitude === 'number' ? raw.longitude : undefined,
      };
    case 'NAVIGATE':
      return { type: 'NAVIGATE', screen: String(raw.screen ?? '') };
    default:
      return { type: 'UNKNOWN', raw };
  }
}

/** Dispatch an action to the registered handlers. Returns a confirmation string. */
export async function dispatchAction(
  action: AppAction,
  handlers: ActionHandlers,
): Promise<string> {
  switch (action.type) {
    case 'START_TRACKING':
      await handlers.startTracking?.();
      return 'GPS tracking started.';

    case 'STOP_TRACKING':
      await handlers.stopTracking?.();
      return 'GPS tracking stopped.';

    case 'SHARE_LOCATION':
      await handlers.shareLocation?.();
      return 'Sharing your current location.';

    case 'CREATE_NOTE':
      await handlers.createNote?.(action.text, action.latitude, action.longitude);
      return `Note saved: "${action.text}"`;

    case 'NAVIGATE':
      handlers.navigate?.(action.screen);
      return `Navigating to ${action.screen}.`;

    case 'UNKNOWN':
    default:
      return '(Unknown action — ignored)';
  }
}
