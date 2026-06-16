import { useAuth } from "@/hooks/use-auth";
import { useState, useEffect } from "react";
import { 
  useGetUser,
  useUpdateUser,
  getGetUserQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { UserCircle, Save, LogOut, Phone } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import PhoneInput, { parsePhoneNumber } from "react-phone-number-input";
import "react-phone-number-input/style.css";

export default function Profile() {
  const { userId, logout } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  
  const { data: user, isLoading } = useGetUser(userId!, {
    query: { enabled: !!userId, queryKey: getGetUserQueryKey(userId!) }
  });

  const updateUser = useUpdateUser();

  useEffect(() => {
    if (user) {
      setName(user.name);
      setPhone(user.fullPhone || "");
    }
  }, [user]);

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name || !phone) {
      toast({ title: "Fields cannot be empty", variant: "destructive" });
      return;
    }

    const parsedPhone = parsePhoneNumber(phone);
    if (!parsedPhone) {
      toast({ title: "Invalid phone number", variant: "destructive" });
      return;
    }

    updateUser.mutate({
      id: userId!,
      data: {
        name,
        phoneNumber: parsedPhone.nationalNumber,
        countryCode: `+${parsedPhone.countryCallingCode}`,
        countryIso: parsedPhone.country || "US"
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId!) });
        toast({ title: "Profile updated successfully" });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-2xl mx-auto">
        <div className="h-8 w-64 bg-muted animate-pulse rounded-md"></div>
        <div className="h-[400px] bg-muted animate-pulse rounded-xl"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500 max-w-2xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Profile</h1>
        <p className="text-muted-foreground mt-1">Manage your identity information.</p>
      </div>

      <Card className="border-border/60 shadow-sm">
        <CardHeader className="flex flex-row items-center gap-4 border-b border-border/50 pb-6 mb-6">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center text-primary text-2xl font-bold">
            {user?.name?.charAt(0).toUpperCase()}
          </div>
          <div>
            <CardTitle>{user?.name}</CardTitle>
            <CardDescription className="flex items-center gap-1.5 mt-1">
              <Phone size={14} />
              {user?.fullPhone}
            </CardDescription>
          </div>
        </CardHeader>
        
        <CardContent>
          <form onSubmit={handleSave} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Full Name</Label>
              <Input 
                id="name" 
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">Phone Number</Label>
              <PhoneInput
                international
                defaultCountry="US"
                value={phone}
                onChange={(val) => setPhone(val || "")}
                className="flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              />
            </div>

            <div className="pt-4 flex items-center justify-between">
              <div className="text-xs text-muted-foreground">
                Joined {user?.createdAt ? format(new Date(user.createdAt), 'MMMM d, yyyy') : ''}
              </div>
              <Button type="submit" disabled={updateUser.isPending}>
                {updateUser.isPending ? "Saving..." : (
                  <>
                    <Save className="mr-2" size={16} />
                    Save Changes
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="flex justify-center">
        <Button variant="ghost" className="text-muted-foreground hover:text-destructive" onClick={logout}>
          <LogOut size={16} className="mr-2" />
          Sign Out
        </Button>
      </div>
    </div>
  );
}
