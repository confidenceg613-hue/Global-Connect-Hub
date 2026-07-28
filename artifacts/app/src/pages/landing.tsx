import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useGoogleAuth } from "@/hooks/use-google-auth";
import { useCreateUser } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, ShieldAlert, CheckCircle, Lock, Globe, Zap, Eye, KeyRound, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GoogleConnectButton } from "@/components/auth/google-connect-button";
import PhoneInput, { parsePhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";

const ACCESS_CODE = "419";
const MAX_ATTEMPTS = 3;
const LOCKOUT_SECONDS = 30;

const FEATURES = [
  { icon: Lock,   label: "Bank-grade consent tracking",      desc: "Every permission is cryptographically logged" },
  { icon: Globe,  label: "International phone registration", desc: "220+ country codes supported" },
  { icon: Zap,    label: "Real-time location intelligence",  desc: "Sub-second GPS tracking via SMS links" },
  { icon: Eye,    label: "GeoBoard surveillance",           desc: "Auto-capture frames on consent grant" },
];

const STATS = [
  { value: "220+", label: "Countries" },
  { value: "<1s",  label: "GPS Latency" },
  { value: "E2E",  label: "Encrypted" },
  { value: "0",    label: "App Required" },
];

export default function Landing() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const { userId, login, isDeviceTrusted } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const createUser = useCreateUser();
  const { signInWithGoogle } = useGoogleAuth();

  const handleGoogleCredential = async (idToken: string) => {
    try {
      const { user, isNewAccount } = await signInWithGoogle(idToken);
      login(user.id, { name: user.name, phone: user.fullPhone ?? user.phoneNumber ?? "" });
      toast({
        title: isNewAccount ? `Welcome, ${user.name}!` : `Welcome back, ${user.name}!`,
        description: isNewAccount ? "Add your phone number in Settings any time to enable invites." : undefined,
      });
      setLocation("/dashboard");
    } catch (err) {
      toast({ title: "Google sign-in failed", description: err instanceof Error ? err.message : undefined, variant: "destructive" });
    }
  };

  useEffect(() => { if (userId) setLocation("/dashboard"); }, [userId, setLocation]);

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) { setLockedUntil(null); setAttempts(0); setCountdown(0); if (timerRef.current) clearInterval(timerRef.current); }
      else setCountdown(remaining);
    };
    tick();
    timerRef.current = setInterval(tick, 500);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [lockedUntil]);

  const isLocked = !!lockedUntil && Date.now() < lockedUntil;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isLocked) return;
    if (!isDeviceTrusted && code.trim() !== "" && code !== ACCESS_CODE) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts); setCodeError(true);
      if (newAttempts >= MAX_ATTEMPTS) {
        setLockedUntil(Date.now() + LOCKOUT_SECONDS * 1000); setCode("");
        toast({ title: "Too many wrong attempts", description: `Locked for ${LOCKOUT_SECONDS} seconds.`, variant: "destructive" });
      } else {
        toast({ title: "Invalid access code", description: `${MAX_ATTEMPTS - newAttempts} attempt${MAX_ATTEMPTS - newAttempts !== 1 ? "s" : ""} remaining.`, variant: "destructive" });
      }
      return;
    }
    setCodeError(false); setAttempts(0);
    if (!name || !phone) { toast({ title: "Please fill in all fields", variant: "destructive" }); return; }
    const parsedPhone = parsePhoneNumber(phone);
    if (!parsedPhone) { toast({ title: "Invalid phone number", variant: "destructive" }); return; }
    createUser.mutate(
      { data: { name, phoneNumber: parsedPhone.nationalNumber, countryCode: `+${parsedPhone.countryCallingCode}`, countryIso: parsedPhone.country || "US" } },
      {
        onSuccess: async (user) => {
          login(user.id, { name: user.name, phone: user.fullPhone ?? user.phoneNumber ?? "" });
          const isReturning = (user as { isExistingUser?: boolean }).isExistingUser === true;
          if (code.trim() === ACCESS_CODE) {
            try { await fetch(`/api/access/${user.id}/redeem`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: ACCESS_CODE }) }); } catch { /* non-critical */ }
          }
          toast({ title: isReturning ? `Welcome back, ${user.name}!` : "Account created successfully" });
          setLocation("/dashboard");
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : undefined;
          toast({ title: "Failed to sign in. Please try again.", description: msg, variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col relative overflow-hidden">
      {/* Background: falcon image glow layer */}
      <div className="pointer-events-none fixed inset-0 z-0">
        <div className="absolute inset-0 bg-background" />
        {/* Dramatic radial glow from upper-right */}
        <div className="absolute -top-40 -right-40 w-[700px] h-[700px] rounded-full opacity-20"
          style={{ background: "radial-gradient(circle, #D4891A 0%, transparent 70%)" }} />
        <div className="absolute top-1/2 left-1/4 w-[500px] h-[500px] rounded-full opacity-8"
          style={{ background: "radial-gradient(circle, #F5C97A 0%, transparent 70%)" }} />
        {/* Subtle scan-line texture */}
        <div className="absolute inset-0 opacity-[0.025]"
          style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(245,201,122,1) 2px, rgba(245,201,122,1) 3px)", backgroundSize: "100% 60px" }} />
      </div>

      {/* ── Header ───────────────────────────────────────────── */}
      <header className="relative z-10 px-6 py-5 flex items-center justify-between border-b border-amber-500/10 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <img src="/falcon-logo.png" alt="DeepFalcon"
            className="w-10 h-10 rounded-xl object-cover ring-1 ring-amber-500/40 shadow-lg shadow-amber-500/20" />
          <div>
            <span className="font-extrabold text-xl tracking-tight text-foreground" style={{ fontFamily: "Syne, system-ui, sans-serif", letterSpacing: "-0.03em" }}>
              Deep<span className="text-amber-400">Falcon</span>
            </span>
            <div className="text-[9px] font-mono text-muted-foreground/60 tracking-widest leading-none">INTELLIGENCE PLATFORM</div>
          </div>
        </div>
        <div className="hidden sm:flex items-center gap-2.5 text-xs text-muted-foreground">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
          </span>
          <span className="font-mono tracking-wide">SYSTEM OPERATIONAL</span>
        </div>
      </header>

      {/* ── Main ─────────────────────────────────────────────── */}
      <main className="relative z-10 flex-1 flex flex-col lg:flex-row items-center justify-center px-6 py-12 gap-12 max-w-7xl mx-auto w-full">

        {/* ── Left: Hero ─────────────────────────────────────── */}
        <div className="flex-1 space-y-10 max-w-xl">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-amber-500/30 bg-amber-500/8 text-amber-400 text-[11px] font-mono font-medium tracking-widest">
            <Zap size={10} className="fill-amber-400" />
            REAL-TIME LOCATION INTELLIGENCE
          </div>

          {/* Headline */}
          <div className="space-y-4">
            <h1 className="text-5xl lg:text-[64px] font-extrabold tracking-tight leading-[0.97]"
              style={{ fontFamily: "Syne, system-ui, sans-serif" }}>
              <span className="text-foreground">Precision.</span><br />
              <span className="text-foreground">Consent.</span><br />
              <span style={{ background: "linear-gradient(135deg, #F5C97A 0%, #D4891A 40%, #E8A020 100%)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Control.
              </span>
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed max-w-md">
              Surveillance-grade location sharing — built on trust, delivered through a single link.
              No app install. No friction. Just intelligence.
            </p>
          </div>

          {/* Stats row */}
          <div className="grid grid-cols-4 gap-3">
            {STATS.map((s, i) => (
              <div key={i} className="flex flex-col items-center py-3 px-2 rounded-xl border border-amber-500/15 bg-amber-500/5">
                <span className="text-lg font-bold text-amber-400" style={{ fontFamily: "Syne, system-ui, sans-serif" }}>{s.value}</span>
                <span className="text-[10px] text-muted-foreground/70 font-mono tracking-wide mt-0.5">{s.label}</span>
              </div>
            ))}
          </div>

          {/* Feature list */}
          <div className="space-y-2.5">
            {FEATURES.map((f, i) => (
              <div key={i} className="group flex items-center gap-3.5 p-3.5 rounded-xl border border-border/40 bg-card/40 hover:bg-card/70 hover:border-amber-500/20 transition-all duration-200 backdrop-blur-sm">
                <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 border border-amber-500/15 group-hover:border-amber-500/30 transition-colors">
                  <f.icon size={15} className="text-amber-400" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{f.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">{f.desc}</p>
                </div>
              </div>
            ))}
            {/* Admin access link */}
            <button type="button" onClick={() => setLocation("/admin")}
              className="group w-full flex items-center gap-3.5 p-3.5 rounded-xl border border-amber-500/15 bg-amber-500/5 hover:bg-amber-500/10 hover:border-amber-500/30 transition-all duration-200 text-left">
              <div className="w-9 h-9 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 border border-amber-500/15 group-hover:border-amber-500/30 transition-colors">
                <KeyRound size={15} className="text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Admin HQ</p>
                <p className="text-xs text-muted-foreground mt-0.5">Restricted — clearance required</p>
              </div>
            </button>
          </div>
        </div>

        {/* ── Right: Falcon + Form ────────────────────────────── */}
        <div className="w-full max-w-md space-y-5">

          {/* Falcon image card */}
          <div className="relative rounded-2xl overflow-hidden border border-amber-500/20 shadow-2xl shadow-amber-900/30"
            style={{ background: "linear-gradient(145deg, #1A0D04 0%, #0D0A06 100%)" }}>
            <img src="/falcon-logo.png" alt="DeepFalcon"
              className="w-full h-48 object-cover object-top opacity-90" />
            {/* Overlay gradient */}
            <div className="absolute inset-0 bg-gradient-to-t from-[#0D0A06] via-transparent to-transparent" />
            {/* Bottom text */}
            <div className="absolute bottom-0 left-0 right-0 px-5 py-4">
              <p className="text-xs font-mono text-amber-400/80 tracking-widest">DEEPFALCON INTELLIGENCE</p>
              <p className="text-sm text-foreground/70 mt-0.5">Eyes on. Always.</p>
            </div>
            {/* Corner badge */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur border border-amber-500/30">
              <Shield size={10} className="text-amber-400" />
              <span className="text-[10px] font-mono text-amber-400 tracking-wider">SECURE</span>
            </div>
          </div>

          {/* Registration form card */}
          <div className="rounded-2xl border border-amber-500/20 overflow-hidden shadow-2xl shadow-black/60 backdrop-blur-sm"
            style={{ background: "linear-gradient(160deg, rgba(26,15,8,0.98) 0%, rgba(13,10,6,0.99) 100%)" }}>
            {/* Gold top bar */}
            <div className="h-[2px] w-full" style={{ background: "linear-gradient(90deg, transparent, #D4891A 30%, #F5C97A 50%, #D4891A 70%, transparent)" }} />

            <div className="p-7">
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-foreground" style={{ fontFamily: "Syne, system-ui, sans-serif", letterSpacing: "-0.02em" }}>Get Started</h2>
                <p className="text-sm text-muted-foreground mt-1.5">Register to access the intelligence platform.</p>
              </div>

              <div className="mb-5 flex flex-col items-center gap-3">
                <GoogleConnectButton onCredential={handleGoogleCredential} />
                <p className="text-[11px] text-muted-foreground/60 text-center">
                  Your Google account keeps your invites and settings recoverable — even after a reinstall.
                </p>
              </div>

              <div className="relative mb-5">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-amber-500/15" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-[#1A0F08] px-3 text-muted-foreground/60 font-mono tracking-wide">or register with your phone number</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="name" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Full Name</Label>
                  <Input id="name" placeholder="Jane Doe" value={name} onChange={e => setName(e.target.value)}
                    className="h-11 bg-black/40 border-amber-500/20 focus-visible:ring-amber-500/40 focus-visible:border-amber-500/40 placeholder:text-muted-foreground/40" />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="phone" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Phone Number</Label>
                  <PhoneInput international defaultCountry="US" value={phone} onChange={val => setPhone(val || "")}
                    className="flex h-11 w-full rounded-md border border-amber-500/20 bg-black/40 text-foreground px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/40 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ '--PhoneInputCountryFlag-borderColor': 'transparent', '--PhoneInput-color--focus': 'hsl(var(--primary))' } as React.CSSProperties} />
                </div>

                {isDeviceTrusted ? (
                  <div className="flex items-center gap-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-3">
                    <CheckCircle className="h-4 w-4 text-amber-400 shrink-0" />
                    <p className="text-xs text-foreground font-medium">Trusted device — access code not required</p>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="access-code" className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      Access Code <span className="text-muted-foreground/50 normal-case">(optional)</span>
                    </Label>
                    <Input id="access-code" type="password" placeholder="Enter access code (optional)" value={code}
                      onChange={e => { setCode(e.target.value); setCodeError(false); }}
                      className={`h-11 bg-black/40 border-amber-500/20 focus-visible:ring-amber-500/40 placeholder:text-muted-foreground/40 ${codeError ? "border-destructive focus-visible:ring-destructive" : ""}`}
                      autoComplete="off" disabled={isLocked} />
                    {isLocked ? (
                      <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2">
                        <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
                        <p className="text-xs text-destructive font-medium">Too many attempts — locked for {countdown}s</p>
                      </div>
                    ) : codeError ? (
                      <p className="text-xs text-destructive">Incorrect code — {MAX_ATTEMPTS - attempts} attempt{MAX_ATTEMPTS - attempts !== 1 ? "s" : ""} remaining.</p>
                    ) : null}
                  </div>
                )}

                <Button type="submit"
                  className="w-full h-12 text-sm font-bold shadow-lg shadow-amber-900/40 transition-all hover:-translate-y-0.5 border-0"
                  style={{ background: "linear-gradient(135deg, #D4891A 0%, #F5C97A 50%, #D4891A 100%)", color: "#1A0F08", letterSpacing: "0.02em" }}
                  disabled={createUser.isPending || isLocked}>
                  {isLocked ? `LOCKED (${countdown}s)` : createUser.isPending ? "INITIALIZING…" : "ENTER PLATFORM"}
                  {!isLocked && <ArrowRight className="ml-2" size={16} />}
                </Button>

                <p className="text-[11px] text-center text-muted-foreground/50">
                  By continuing, you agree to our{" "}
                  <span className="text-amber-500/70 hover:text-amber-400 cursor-pointer transition-colors">terms of service</span>
                  {" "}and{" "}
                  <span className="text-amber-500/70 hover:text-amber-400 cursor-pointer transition-colors">privacy policy</span>.
                </p>
              </form>
            </div>
          </div>

          {/* Trust indicators */}
          <div className="flex items-center justify-center gap-6 text-[10px] text-muted-foreground/50 font-mono tracking-widest">
            <span>END-TO-END ENCRYPTED</span>
            <span className="w-px h-3 bg-muted-foreground/20" />
            <span>NO INSTALL REQUIRED</span>
            <span className="w-px h-3 bg-muted-foreground/20" />
            <span>GDPR COMPLIANT</span>
          </div>
        </div>
      </main>
    </div>
  );
}
