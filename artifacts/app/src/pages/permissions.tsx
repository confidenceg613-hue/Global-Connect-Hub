import { useAuth } from "@/hooks/use-auth";
import { 
  useListConsents, 
  useCreateConsent, 
  useUpdateConsent,
  getListConsentsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { MapPin, Bell, MessageSquare, ShieldCheck, ShieldAlert, History } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { useState } from "react";

const PERMISSION_TYPES = [
  {
    type: "location",
    title: "Location Tracking",
    icon: MapPin,
    description: "Used to verify your location for regional compliance and security monitoring.",
    color: "text-blue-500",
    bg: "bg-blue-50 dark:bg-blue-950"
  },
  {
    type: "notification",
    title: "Push Notifications",
    icon: Bell,
    description: "Important alerts about your account activity and required compliance actions.",
    color: "text-purple-500",
    bg: "bg-purple-50 dark:bg-purple-950"
  },
  {
    type: "messaging",
    title: "Secure Messaging",
    icon: MessageSquare,
    description: "Allows encrypted communication between you and our support team.",
    color: "text-green-500",
    bg: "bg-green-50 dark:bg-green-950"
  }
] as const;

export default function Permissions() {
  const { userId } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [revokingType, setRevokingType] = useState<string | null>(null);
  
  const { data: consents, isLoading } = useListConsents({ userId: userId! }, {
    query: { enabled: !!userId, queryKey: getListConsentsQueryKey({ userId: userId! }) }
  });

  const createConsent = useCreateConsent();
  const updateConsent = useUpdateConsent();

  const handleToggle = (type: "location" | "notification" | "messaging", isGranted: boolean, existingId?: number) => {
    if (isGranted && !existingId) {
      // Create new consent
      createConsent.mutate({
        data: {
          userId: userId!,
          type,
          status: "granted",
          purpose: `User explicitly granted ${type} permission via dashboard.`
        }
      }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListConsentsQueryKey({ userId: userId! }) });
          toast({ title: "Permission granted successfully" });
        }
      });
    } else if (existingId) {
      if (isGranted) {
        // Update to granted
        updateConsent.mutate({
          id: existingId,
          data: { status: "granted" }
        }, {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getListConsentsQueryKey({ userId: userId! }) });
            toast({ title: "Permission restored" });
          }
        });
      } else {
        // Trigger revoke dialog
        setRevokingType(type);
      }
    }
  };

  const handleConfirmRevoke = (existingId: number) => {
    updateConsent.mutate({
      id: existingId,
      data: { status: "revoked", purpose: "User revoked permission via dashboard." }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListConsentsQueryKey({ userId: userId! }) });
        toast({ title: "Permission revoked" });
        setRevokingType(null);
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="h-8 w-64 bg-muted animate-pulse rounded-md"></div>
        <div className="grid gap-6">
          {[1, 2, 3].map(i => <div key={i} className="h-48 bg-muted animate-pulse rounded-xl"></div>)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Permissions</h1>
        <p className="text-muted-foreground mt-1">Manage your data sharing and communication preferences.</p>
      </div>

      <div className="grid gap-6">
        {PERMISSION_TYPES.map(perm => {
          const existingConsent = consents?.find(c => c.type === perm.type);
          const isGranted = existingConsent?.status === "granted";
          
          return (
            <Card key={perm.type} className={`border-border/60 shadow-sm overflow-hidden transition-all ${isGranted ? 'border-primary/20 bg-primary/5' : ''}`}>
              <CardHeader className="flex flex-row items-start gap-4 pb-4">
                <div className={`${perm.bg} ${perm.color} p-3 rounded-lg mt-1`}>
                  <perm.icon size={24} />
                </div>
                <div className="flex-1 space-y-1">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg font-semibold">{perm.title}</CardTitle>
                    
                    {isGranted && existingConsent?.id ? (
                      <AlertDialog open={revokingType === perm.type} onOpenChange={(open) => !open && setRevokingType(null)}>
                        <AlertDialogTrigger asChild>
                          <Switch 
                            checked={true}
                            onCheckedChange={() => handleToggle(perm.type as any, false, existingConsent?.id)}
                          />
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Revoke {perm.title}?</AlertDialogTitle>
                            <AlertDialogDescription>
                              This may affect your ability to use certain features. Are you sure you want to revoke this permission?
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction 
                              onClick={() => handleConfirmRevoke(existingConsent.id)}
                              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                            >
                              Revoke
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    ) : (
                      <Switch 
                        checked={false}
                        onCheckedChange={() => handleToggle(perm.type as any, true, existingConsent?.id)}
                      />
                    )}
                  </div>
                  <CardDescription className="text-sm">
                    {perm.description}
                  </CardDescription>
                </div>
              </CardHeader>
              
              <CardContent className="pb-4">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-muted-foreground">Current Status:</span>
                  {isGranted ? (
                    <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">
                      <ShieldCheck size={12} className="mr-1" />
                      Active
                    </Badge>
                  ) : existingConsent?.status === "revoked" ? (
                    <Badge variant="outline" className="text-amber-600 border-amber-200 bg-amber-50">
                      <ShieldAlert size={12} className="mr-1" />
                      Revoked
                    </Badge>
                  ) : (
                    <Badge variant="secondary">Not Granted</Badge>
                  )}
                </div>
              </CardContent>

              {existingConsent && (
                <CardFooter className="bg-muted/30 py-3 border-t border-border/50 text-xs text-muted-foreground flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <History size={14} />
                    <span>Last updated: {format(new Date(existingConsent.createdAt), 'MMM d, yyyy h:mm a')}</span>
                  </div>
                  {existingConsent.grantedAt && (
                    <span>Initially granted: {format(new Date(existingConsent.grantedAt), 'MMM d, yyyy')}</span>
                  )}
                </CardFooter>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
