import { useState } from "react";
import { useLocation } from "wouter";
import { useAccess } from "@/hooks/use-access";
import { 
  ShieldCheck, 
  Copy, 
  CheckCircle2, 
  MessageCircle, 
  ArrowRight, 
  Loader2, 
  Lock, 
  Unlock, 
  KeyRound,
  Zap
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { format } from "date-fns";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export default function Subscription() {
  const [, setLocation] = useLocation();
  const { status, payment, loading, redeem } = useAccess();
  const { toast } = useToast();
  
  const [code, setCode] = useState("");
  const [isRedeeming, setIsRedeeming] = useState(false);
  const [copied, setCopied] = useState(false);
  const [successState, setSuccessState] = useState(false);

  const handleCopy = () => {
    if (!payment) return;
    navigator.clipboard.writeText(payment.accountNumber);
    setCopied(true);
    toast({
      title: "Copied to clipboard",
      description: "Account number copied successfully.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRedeem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setIsRedeeming(true);
    const result = await redeem(code.trim().toUpperCase());
    setIsRedeeming(false);
    
    if (result.success) {
      setSuccessState(true);
      setTimeout(() => {
        setLocation("/dashboard");
      }, 1500);
    } else {
      toast({ 
        title: "Activation failed", 
        description: result.message, 
        variant: "destructive" 
      });
    }
  };

  const waUrl = "https://wa.link/qt6lk4";

  const renderContent = () => {
    if (loading) {
      return (
        <div className="flex flex-col items-center justify-center py-16">
          <Loader2 size={32} className="text-amber-400 animate-spin mb-4" />
          <p className="text-sm text-muted-foreground font-mono tracking-wider">Connecting to command node...</p>
        </div>
      );
    }

    if (!status) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mb-4 ring-1 ring-red-500/30">
            <Lock size={24} className="text-red-500" />
          </div>
          <p className="text-muted-foreground mb-6">Unable to verify access status.</p>
          <Button variant="outline" className="bg-transparent border-white/10 hover:bg-white/5" onClick={() => window.location.reload()}>
            Retry Connection
          </Button>
        </div>
      );
    }

    if (successState) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center animate-in fade-in zoom-in duration-500">
          <div className="w-20 h-20 rounded-full bg-amber-500/20 flex items-center justify-center mb-6 ring-4 ring-amber-500/20">
            <CheckCircle2 size={40} className="text-amber-500" />
          </div>
          <h2 className="text-2xl font-bold mb-2 tracking-tight">Access Granted</h2>
          <p className="text-muted-foreground mb-8 font-mono text-sm">System override successful.</p>
          <Loader2 size={24} className="text-amber-500 animate-spin mx-auto" />
        </div>
      );
    }

    if (status.status === "unlimited") {
      return (
        <div className="flex flex-col items-center text-center py-4">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-6 ring-1 ring-amber-500/30">
            <Zap size={28} className="text-amber-500" />
          </div>
          <h2 className="text-xl font-bold mb-2 tracking-tight">Unlimited Access</h2>
          <p className="text-muted-foreground mb-8 text-sm">
            Your clearance level grants unrestricted access to all PhoneLink features.
          </p>
          <Button className="w-full bg-amber-600 hover:bg-amber-500 text-white border-0 shadow-lg shadow-amber-900/20 transition-all hover:-translate-y-0.5" onClick={() => setLocation("/dashboard")}>
            Enter Console <ArrowRight className="ml-2" size={16} />
          </Button>
        </div>
      );
    }

    if (status.status === "free") {
      return (
        <div className="flex flex-col items-center text-center py-4">
          <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-6 ring-1 ring-amber-500/30">
            <Unlock size={28} className="text-amber-400" />
          </div>
          <h2 className="text-xl font-bold mb-2 tracking-tight">Free Access Active</h2>
          <p className="text-muted-foreground mb-6 text-sm">
            You have <span className="text-foreground font-bold">{status.freeAccessesRemaining}</span> free {status.freeAccessesRemaining === 1 ? 'use' : 'uses'} remaining.
          </p>
          <div className="w-full bg-black/30 border border-white/5 rounded-lg p-4 mb-8">
            <p className="text-xs text-muted-foreground font-mono leading-relaxed">{status.message}</p>
          </div>
          <Button className="w-full bg-amber-600 hover:bg-amber-500 text-white border-0 shadow-lg shadow-amber-900/20 transition-all hover:-translate-y-0.5" onClick={() => setLocation("/dashboard")}>
            Continue to Console <ArrowRight className="ml-2" size={16} />
          </Button>
        </div>
      );
    }

    if (status.status === "subscribed") {
      return (
        <div className="flex flex-col items-center text-center py-4">
          <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mb-6 ring-1 ring-emerald-500/30">
            <CheckCircle2 size={28} className="text-emerald-500" />
          </div>
          <h2 className="text-xl font-bold mb-2 tracking-tight">Access Active</h2>
          <p className="text-muted-foreground mb-8 text-sm">
            Your access pass is valid until <span className="text-foreground font-medium">{status.accessExpiresAt ? format(new Date(status.accessExpiresAt), "MMM d, yyyy") : "a future date"}</span>.
          </p>
          <Button className="w-full bg-emerald-600 hover:bg-emerald-500 text-white border-0 shadow-lg shadow-emerald-900/20 transition-all hover:-translate-y-0.5" onClick={() => setLocation("/dashboard")}>
            Return to Console <ArrowRight className="ml-2" size={16} />
          </Button>
        </div>
      );
    }

    // Locked or Expired states
    return (
      <div className="flex flex-col animate-in fade-in duration-500">
        <div className="text-center mb-6">
          <div className="w-16 h-16 mx-auto rounded-full bg-amber-500/10 flex items-center justify-center mb-4 ring-1 ring-amber-500/30">
            <Lock size={28} className="text-amber-500" />
          </div>
          <h2 className="text-xl font-bold mb-2 tracking-tight">
            {status.status === "expired" ? "Access Expired" : "Secure Access Required"}
          </h2>
          <p className="text-muted-foreground text-sm">
            {status.status === "expired" 
              ? "Your previous access pass has expired. Activate a new 7-day pass to continue." 
              : "You've used all your free sessions. Activate a 7-day pass to continue."}
          </p>
        </div>

        {/* Payment Card */}
        {payment ? (
          <div className="bg-black/40 border border-white/10 rounded-xl p-5 mb-6 relative overflow-hidden group">
            {/* Subtle glow effect */}
            <div className="absolute top-0 right-0 -mr-8 -mt-8 w-32 h-32 bg-emerald-500/10 blur-[40px] rounded-full pointer-events-none transition-opacity duration-500 group-hover:opacity-100 opacity-50" />
            
            <div className="flex items-center justify-between mb-5 pb-5 border-b border-white/5 relative z-10">
              <span className="text-sm font-medium text-muted-foreground">Amount Due</span>
              <span className="text-3xl font-bold font-data text-emerald-400 tracking-tight drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]">
                ₦{payment.amountNaira.toLocaleString()}
              </span>
            </div>

            <div className="space-y-4 relative z-10">
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Bank Name</span>
                <p className="font-medium mt-1 text-sm">{payment.bankName}</p>
              </div>
              
              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Account Number</span>
                <div className="flex items-center gap-3 mt-1">
                  <p className="text-xl font-data tracking-widest text-foreground/90">{payment.accountNumber}</p>
                  <Button 
                    variant="ghost" 
                    size="icon" 
                    className={cn(
                      "h-8 w-8 transition-all duration-300 rounded-md",
                      copied ? "bg-emerald-500/20 text-emerald-400 scale-110" : "bg-white/5 text-muted-foreground hover:bg-white/10 hover:text-foreground"
                    )}
                    onClick={handleCopy}
                  >
                    {copied ? <CheckCircle2 size={16} className="animate-in zoom-in spin-in-12 duration-300" /> : <Copy size={14} className="animate-in zoom-in duration-300" />}
                  </Button>
                </div>
              </div>

              <div>
                <span className="text-[10px] text-muted-foreground uppercase tracking-widest font-semibold">Account Name</span>
                <p className="font-medium mt-1 text-sm">{payment.accountName}</p>
              </div>
            </div>

            <div className="mt-6 pt-5 border-t border-white/5 relative z-10">
              <Button 
                className="w-full bg-[#25D366] hover:bg-[#20bd5a] text-white border-0 shadow-[0_0_15px_rgba(37,211,102,0.2)] transition-all hover:-translate-y-0.5"
                onClick={() => window.open(waUrl, "_blank")}
              >
                <MessageCircle size={18} className="mr-2" />
                Send Payment Proof
              </Button>
              <p className="text-[11px] text-center text-muted-foreground mt-3 font-medium">
                Send proof of transfer on WhatsApp to receive your code.
              </p>
            </div>
          </div>
        ) : (
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 text-center mb-6">
            <p className="text-amber-500/90 text-sm">Payment details are temporarily unavailable. Please try again later.</p>
          </div>
        )}

        {/* Redeem Section */}
        <div className="bg-black/30 border border-white/5 rounded-xl p-5 shadow-inner">
          <h3 className="text-sm font-medium mb-3 flex items-center gap-2 text-foreground/90">
            <KeyRound size={16} className="text-indigo-400" />
            Have an activation code?
          </h3>
          <form onSubmit={handleRedeem} className="flex gap-2">
            <Input 
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="ENTER CODE" 
              className="font-data tracking-widest bg-black/40 border-white/10 text-center uppercase placeholder:text-muted-foreground/30 focus-visible:ring-indigo-500/50"
              disabled={isRedeeming}
              maxLength={12}
            />
            <Button 
              type="submit" 
              disabled={!code.trim() || isRedeeming}
              className="shrink-0 bg-indigo-600 hover:bg-indigo-500 text-white min-w-[100px] border-0"
            >
              {isRedeeming ? <Loader2 size={16} className="animate-spin" /> : "Activate"}
            </Button>
          </form>
        </div>
      </div>
    );
  };

  return (
    <div className="dark min-h-[100dvh] w-full flex flex-col items-center justify-center p-4 md:p-8 relative bg-background text-foreground overflow-hidden">
      {/* Tech grid background manually applied to override any light mode body defaults */}
      <div className="absolute inset-0 pointer-events-none opacity-[0.03]" style={{
        backgroundImage: 'radial-gradient(circle at 1px 1px, #ffffff 1px, transparent 0)',
        backgroundSize: '28px 28px'
      }} />
      
      {/* Background glowing effects for dark mode console feel */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-indigo-500/5 rounded-full blur-[100px] pointer-events-none" />
      <div className="absolute top-0 right-0 w-[400px] h-[400px] bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none" />

      <div className="w-full max-w-md z-10 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-700 flex items-center justify-center shadow-[0_0_30px_rgba(99,102,241,0.3)] mb-4 ring-1 ring-white/10">
            <ShieldCheck size={28} className="text-white" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">PhoneLink Console</h1>
          <p className="text-muted-foreground text-xs uppercase tracking-widest mt-2 font-mono">Access Checkpoint</p>
        </div>

        <div className="pl-command-bar p-6 relative overflow-hidden min-h-[300px] flex flex-col justify-center border-white/10 shadow-2xl">
          {renderContent()}
        </div>
        
        <div className="mt-8 text-center">
          <p className="text-[10px] text-muted-foreground/50 font-mono uppercase tracking-widest">
            Secure Encrypted Connection • Node Active
          </p>
        </div>
      </div>
    </div>
  );
}