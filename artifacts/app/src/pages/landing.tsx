import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { useCreateUser } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { ShieldCheck, ArrowRight, Lock, CheckCircle, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import PhoneInput, { parsePhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";

export default function Landing() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const { login } = useAuth();
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const createUser = useCreateUser();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !phone) {
      toast({ title: "Please fill in all fields", variant: "destructive" });
      return;
    }

    const parsedPhone = parsePhoneNumber(phone);
    if (!parsedPhone) {
      toast({ title: "Invalid phone number", variant: "destructive" });
      return;
    }

    const countryCode = `+${parsedPhone.countryCallingCode}`;
    const countryIso = parsedPhone.country || "US";
    const phoneNumber = parsedPhone.nationalNumber;

    createUser.mutate(
      {
        data: {
          name,
          phoneNumber,
          countryCode,
          countryIso,
        },
      },
      {
        onSuccess: (user) => {
          login(user.id);
          const isReturning = (user as any).isExistingUser === true;
          toast({
            title: isReturning ? `Welcome back, ${user.name}!` : "Account created successfully",
          });
          setLocation("/dashboard");
        },
        onError: () => {
          toast({ title: "Failed to sign in. Please try again.", variant: "destructive" });
        },
      }
    );
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="py-6 px-8 flex items-center justify-between">
        <div className="flex items-center gap-2 text-primary">
          <ShieldCheck size={28} />
          <span className="font-bold text-xl tracking-tight">PhoneLink</span>
        </div>
      </header>

      <main className="flex-1 flex flex-col lg:flex-row items-center justify-center p-8 gap-12 lg:gap-24 max-w-6xl mx-auto w-full">
        <div className="flex-1 space-y-8 max-w-lg">
          <h1 className="text-4xl lg:text-5xl font-bold tracking-tight text-foreground leading-tight">
            Trust-first identity & consent management.
          </h1>
          <p className="text-lg text-muted-foreground leading-relaxed">
            A precise, modern compliance infrastructure that handles permissions with serious care. Fast onboarding, granular consent, and secure WhatsApp invites.
          </p>

          <div className="space-y-4">
            {[
              { icon: Lock, text: "Bank-grade consent tracking" },
              { icon: Globe, text: "International phone registration" },
              { icon: CheckCircle, text: "Granular permission controls" }
            ].map((feature, i) => (
              <div key={i} className="flex items-center gap-3 text-foreground font-medium">
                <div className="bg-primary/10 text-primary p-2 rounded-full">
                  <feature.icon size={20} />
                </div>
                {feature.text}
              </div>
            ))}
          </div>
        </div>

        <Card className="w-full max-w-md shadow-xl border-border/50 bg-white/50 backdrop-blur-sm">
          <CardContent className="p-8">
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-2">Get Started</h2>
              <p className="text-muted-foreground">Register your phone to manage your identity securely.</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="name">Full Name</Label>
                <Input
                  id="name"
                  placeholder="Jane Doe"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="bg-white"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="phone">Phone Number</Label>
                <div className="flex flex-col gap-2">
                  <PhoneInput
                    international
                    defaultCountry="US"
                    value={phone}
                    onChange={(val) => setPhone(val || "")}
                    className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                    style={{ 
                      '--PhoneInputCountryFlag-borderColor': 'transparent',
                      '--PhoneInput-color--focus': 'hsl(var(--primary))'
                    } as React.CSSProperties}
                  />
                </div>
              </div>

              <Button 
                type="submit" 
                className="w-full h-12 text-base font-medium" 
                disabled={createUser.isPending}
              >
                {createUser.isPending ? "Creating account..." : "Continue"}
                <ArrowRight className="ml-2" size={18} />
              </Button>
              
              <p className="text-xs text-center text-muted-foreground mt-4">
                By continuing, you agree to our terms of service and privacy policy.
              </p>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
