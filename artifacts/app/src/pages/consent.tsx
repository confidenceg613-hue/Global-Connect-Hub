import { useState } from "react";
import { useParams } from "wouter";
import {
  useGetInviteByToken,
  useGrantLocationConsent,
  getGetInviteByTokenQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Shield, MapPin, CheckCircle, XCircle, Loader2, AlertTriangle } from "lucide-react";

type ConsentState =
  | "idle"
  | "requesting"
  | "granting"
  | "granted"
  | "denied"
  | "error";

export default function ConsentPage() {
  const { token } = useParams<{ token: string }>();
  const [state, setState] = useState<ConsentState>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);

  const { data: invite, isLoading, isError } = useGetInviteByToken(token!, {
    query: {
      enabled: !!token,
      queryKey: getGetInviteByTokenQueryKey(token!),
      retry: false,
    },
  });

  const grant = useGrantLocationConsent();

  const handleGrant = () => {
    if (!navigator.geolocation) {
      setErrorMsg("Your browser does not support location access.");
      setState("error");
      return;
    }

    setState("requesting");

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const latitude = position.coords.latitude;
        const longitude = position.coords.longitude;
        setCoords({ lat: latitude, lng: longitude });
        setState("granting");

        // Attempt reverse geocode via open API (no key needed)
        let address: string | undefined;
        try {
          const r = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`,
            { headers: { "Accept-Language": "en" } },
          );
          if (r.ok) {
            const geo = await r.json();
            address = geo.display_name as string;
          }
        } catch {
          // address stays undefined — that's fine
        }

        grant.mutate(
          {
            token: token!,
            data: { latitude, longitude, address },
          },
          {
            onSuccess: () => setState("granted"),
            onError: (err: any) => {
              const msg = err?.data?.error ?? "Failed to record consent.";
              setErrorMsg(msg);
              setState("error");
            },
          },
        );
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) {
          setState("denied");
        } else {
          setErrorMsg("Unable to retrieve your location. Please try again.");
          setState("error");
        }
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  if (isError || !invite) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <XCircle className="h-14 w-14 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-800 mb-2">
              Invalid Link
            </h2>
            <p className="text-slate-500 text-sm">
              This consent link is invalid or has expired. Please ask the sender
              to resend the invite.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Already granted
  if (invite.status === "accepted" && state !== "granted") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <CheckCircle className="h-14 w-14 text-emerald-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-800 mb-2">
              Already Granted
            </h2>
            <p className="text-slate-500 text-sm">
              You have already granted location access to{" "}
              <span className="font-medium text-slate-700">
                {invite.fromUserName}
              </span>
              .
            </p>
            {invite.grantedLatitude && invite.grantedLongitude && (
              <p className="text-xs text-slate-400 mt-3">
                {invite.grantedLatitude.toFixed(5)},{" "}
                {invite.grantedLongitude.toFixed(5)}
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "granted") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-5">
              <CheckCircle className="h-9 w-9 text-emerald-600" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800 mb-2">
              Location Shared
            </h2>
            <p className="text-slate-500 text-sm mb-6">
              You have successfully granted location access to{" "}
              <span className="font-semibold text-slate-700">
                {invite.fromUserName}
              </span>
              .
            </p>
            {coords && (
              <div className="bg-slate-100 rounded-xl p-4 text-left">
                <div className="flex items-center gap-2 mb-2">
                  <MapPin className="h-4 w-4 text-indigo-500" />
                  <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">
                    Coordinates Shared
                  </span>
                </div>
                <p className="text-sm font-mono text-slate-700">
                  {coords.lat.toFixed(6)}, {coords.lng.toFixed(6)}
                </p>
              </div>
            )}
            <p className="text-xs text-slate-400 mt-4">
              You may close this page.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "denied") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <XCircle className="h-14 w-14 text-amber-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-800 mb-2">
              Location Access Denied
            </h2>
            <p className="text-slate-500 text-sm mb-6">
              You blocked location access in your browser. To try again, allow
              location permission in your browser settings and reload this page.
            </p>
            <Button
              variant="outline"
              onClick={() => {
                setState("idle");
                window.location.reload();
              }}
              data-testid="button-try-again"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Card className="max-w-md w-full shadow-lg">
          <CardContent className="pt-10 pb-10 text-center">
            <AlertTriangle className="h-14 w-14 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-800 mb-2">
              Something Went Wrong
            </h2>
            <p className="text-slate-500 text-sm mb-6">{errorMsg}</p>
            <Button
              variant="outline"
              onClick={() => setState("idle")}
              data-testid="button-try-again"
            >
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const isProcessing = state === "requesting" || state === "granting";

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-slate-50 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 text-indigo-700 font-bold text-lg mb-2">
            <Shield className="h-5 w-5" />
            PhoneLink
          </div>
        </div>

        <Card className="shadow-xl border-0">
          <CardContent className="pt-8 pb-8 px-8">
            {/* Sender identity */}
            <div className="text-center mb-8">
              <div className="w-16 h-16 rounded-full bg-indigo-100 flex items-center justify-center mx-auto mb-4">
                <MapPin className="h-8 w-8 text-indigo-600" />
              </div>
              <h1 className="text-2xl font-bold text-slate-800 mb-2">
                Location Request
              </h1>
              <p className="text-slate-500 text-sm leading-relaxed">
                <span className="font-semibold text-slate-700">
                  {invite.fromUserName}
                </span>{" "}
                is requesting access to your location via PhoneLink.
              </p>
            </div>

            {/* What they'll share */}
            <div className="bg-indigo-50 rounded-xl p-4 mb-6">
              <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2">
                What will be shared
              </p>
              <ul className="space-y-1.5">
                {[
                  "Your current GPS coordinates",
                  "Approximate address (city & region)",
                  "One-time — not continuous tracking",
                ].map((item) => (
                  <li key={item} className="flex items-center gap-2 text-sm text-slate-600">
                    <CheckCircle className="h-3.5 w-3.5 text-indigo-500 flex-shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            {/* Consent notice */}
            <p className="text-xs text-slate-400 text-center mb-6 leading-relaxed">
              By tapping Grant, your browser will ask for location permission.
              Your coordinates are shared only with {invite.fromUserName} and
              stored securely by PhoneLink.
            </p>

            {/* Grant button */}
            <Button
              className="w-full h-12 text-base font-semibold bg-indigo-600 hover:bg-indigo-700 text-white"
              onClick={handleGrant}
              disabled={isProcessing}
              data-testid="button-grant-location"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  {state === "requesting" ? "Requesting permission…" : "Saving…"}
                </>
              ) : (
                <>
                  <MapPin className="h-4 w-4 mr-2" />
                  Grant Location Access
                </>
              )}
            </Button>

            <p className="text-xs text-slate-400 text-center mt-4">
              You can revoke this at any time by contacting {invite.fromUserName}.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
