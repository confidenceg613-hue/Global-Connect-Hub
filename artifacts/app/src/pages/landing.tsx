import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useGoogleAuth } from "@/hooks/use-google-auth";
import { useCreateUser } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ArrowRight, Lock, CheckCircle, Globe, ShieldAlert, Zap, Eye, KeyRound } from "lucide-react";
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
  { icon: Lock,   label: "Bank-grade consent tracking",    desc: "Every permission is cryptographically logged" },
  { icon: Globe,  label: "International phone registration", desc: "220+ country codes supported" },
  { icon: Zap,    label: "Real-time location updates",      desc: "Sub-second GPS tracking via WhatsApp links" },
  { icon: Eye,    label: "GeoBoard surveillance",           desc: "Auto-capture on consent grant" },
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
      login(user.id);
      toast({
        title: isNewAccount ? `Welcome, ${user.name}!` : `Welcome back, ${user.name}!`,
        description: isNewAccount
          ? "Add your phone number in Settings any time to enable invites."
          : undefined,
      });
      setLocation("/dashboard");
    } catch (err) {
      toast({
        title: "Google sign-in failed",
        description: err instanceof Error ? err.message : undefined,
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (userId) setLocation("/dashboard");
  }, [userId, setLocation]);

  useEffect(() => {
    if (!lockedUntil) return;
    const tick = () => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null); setAttempts(0); setCountdown(0);
        if (timerRef.current) clearInterval(timerRef.current);
      } else setCountdown(remaining);
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
        onSuccess: (user) => {
          login(user.id);
          const isReturning = (user as { isExistingUser?: boolean }).isExistingUser === true;
          toast({ title: isReturning ? `Welcome back, ${user.name}!` : "Account created successfully" });
          setLocation("/dashboard");
        },
        onError: () => toast({ title: "Failed to sign in. Please try again.", variant: "destructive" }),
      }
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="px-6 py-4 flex items-center justify-between border-b border-border/40">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-md">
            <ShieldCheck size={18} className="text-white" />
          </div>
          <span className="font-bold text-lg tracking-tight">PhoneLink</span>
        </div>
        <div className="hidden sm:flex items-center gap-2 text-sm text-muted-foreground">
          <span className="w-2 h-2 rounded-full bg-emerald-400 inline-block animate-pulse" />
          System operational
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row items-center justify-center px-6 py-12 gap-16 max-w-6xl mx-auto w-full">
        {/* Left: Hero */}
        <div className="flex-1 space-y-10 max-w-lg">
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 text-indigo-400 text-xs font-mono font-medium">
              <Zap size={12} />
              Real-time location intelligence
            </div>
            <h1 className="text-4xl lg:text-[52px] font-bold tracking-tight text-foreground leading-[1.08]">
              Trust-first<br />
              <span className="bg-gradient-to-r from-indigo-400 to-indigo-600 bg-clip-text text-transparent">
                safety platform.
              </span>
            </h1>
            <p className="text-base text-muted-foreground leading-relaxed max-w-sm">
              Granular consent, real-time GPS, and surveillance-grade security — delivered through a link. No app install required.
            </p>
          </div>

          <div className="space-y-3">
            {FEATURES.map((f, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-border/50 bg-muted/30 hover:bg-muted/50 transition-colors">
                <div className="w-8 h-8 rounded-lg bg-indigo-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <f.icon size={15} className="text-indigo-400" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{f.label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{f.desc}</p>
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLocation("/admin")}
              className="w-full flex items-start gap-3 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 transition-colors text-left"
            >
              <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <KeyRound size={15} className="text-amber-400" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">Admin HQ</p>
                <p className="text-xs text-muted-foreground mt-0.5">Restricted — password required</p>
              </div>
            </button>
          </div>
        </div>

        {/* Right: Form card */}
        <div className="w-full max-w-md">
          <div className="rounded-2xl border border-border bg-card shadow-2xl overflow-hidden">
            {/* Card top accent */}
            <div className="h-1 w-full bg-gradient-to-r from-indigo-500 via-indigo-400 to-indigo-600" />

            <div className="p-8">
              <div className="mb-7">
                <h2 className="text-2xl font-bold text-foreground">Get Started</h2>
                <p className="text-sm text-muted-foreground mt-1.5">Register your phone to manage identity securely.</p>
              </div>

              <div className="mb-6 flex flex-col items-center gap-3">
                <GoogleConnectButton onCredential={handleGoogleCredential} />
                <p className="text-[11px] text-muted-foreground/70">
                  Your Google account keeps your invites and settings recoverable — even after a reinstall.
                </p>
              </div>

              <div className="relative mb-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border/60" />
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="bg-card px-3 text-muted-foreground">or register with your phone number</span>
                </div>
              </div>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-sm font-medium">Full Name</Label>
                  <Input id="name" placeholder="Jane Doe" value={name}
                    onChange={e => setName(e.target.value)}
                    className="h-11 bg-background/60" />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="phone" className="text-sm font-medium">Phone Number</Label>
                  <PhoneInput international defaultCountry="US" value={phone}
                    onChange={val => setPhone(val || "")}
                    className="flex h-11 w-full rounded-md border border-input bg-background/60 text-foreground px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ '--PhoneInputCountryFlag-borderColor': 'transparent', '--PhoneInput-color--focus': 'hsl(var(--primary))' } as React.CSSProperties}
                  />
                </div>

                {isDeviceTrusted ? (
                  <div className="flex items-center gap-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-4 py-3">
                    <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />
                    <p className="text-xs text-foreground font-medium">Trusted device — access code not required</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="access-code" className="text-sm font-medium">Access Code <span className="text-muted-foreground font-normal">(optional)</span></Label>
                    <Input id="access-code" type="password" placeholder="Enter access code (optional)" value={code}
                      onChange={e => { setCode(e.target.value); setCodeError(false); }}
                      className={`h-11 bg-background/60 ${codeError ? "border-destructive focus-visible:ring-destructive" : ""}`}
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

                <Button type="submit" className="w-full h-11 text-sm font-semibold bg-indigo-600 hover:bg-indigo-500 shadow-lg shadow-indigo-500/25"
                  disabled={createUser.isPending || isLocked}>
                  {isLocked ? `Locked (${countdown}s)` : createUser.isPending ? "Creating account…" : "Continue"}
                  {!isLocked && <ArrowRight className="ml-2" size={16} />}
                </Button>

                <p className="text-xs text-center text-muted-foreground">
                  By continuing, you agree to our{" "}
                  <span className="text-indigo-400 hover:underline cursor-pointer">terms of service</span>
                  {" "}and{" "}
                  <span className="text-indigo-400 hover:underline cursor-pointer">privacy policy</span>.
                </p>
              </form>
            </div>
          </div>

          <p className="text-center text-xs text-muted-foreground/60 mt-4 font-mono">
            End-to-end encrypted · No install required · GDPR compliant
          </p>
        </div>
      </main>
    </div>
  );
}
