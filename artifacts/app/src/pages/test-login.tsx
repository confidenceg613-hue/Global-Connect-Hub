/**
 * Temporary test login page — auto-logs in user id=1 and redirects.
 * Remove after testing.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

export default function TestLogin() {
  const { login } = useAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    login(1, { name: "Test Agent", phone: "+15550001" });
    setTimeout(() => navigate("/behavioral-signatures"), 200);
  }, []);

  return (
    <div style={{
      minHeight: "100vh", background: "#04080F",
      display: "flex", alignItems: "center", justifyContent: "center",
      color: "#F59E0B", fontFamily: "monospace", fontSize: 14,
    }}>
      Logging in as Test Agent…
    </div>
  );
}
