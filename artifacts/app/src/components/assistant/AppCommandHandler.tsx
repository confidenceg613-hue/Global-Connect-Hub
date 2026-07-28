import { useEffect } from "react";
import { useLocation } from "wouter";
import { onMapCommand } from "@/lib/map-command-bus";

/**
 * Registers handlers for app-level AI commands: navigate, openInviteForm.
 * Must be rendered inside the Wouter Router so useLocation works.
 */
export function AppCommandHandler() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    return onMapCommand((cmd) => {
      if (cmd.type === "navigate") {
        setLocation(cmd.path);
      } else if (cmd.type === "openInviteForm") {
        setLocation("/invites");
        // Give the page a moment to mount then dispatch prefill event
        setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("deepfalcon:prefill-invite", {
              detail: { phone: cmd.phone ?? "", name: cmd.name ?? "" },
            }),
          );
        }, 350);
      }
    });
  }, [setLocation]);

  return null;
}
