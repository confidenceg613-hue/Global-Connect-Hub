import { useAuth } from "@/hooks/use-auth";
import { useGrantNotifications } from "@/hooks/use-grant-notifications";

export function GrantNotifier() {
  const { userId } = useAuth();
  useGrantNotifications(userId);
  return null;
}
