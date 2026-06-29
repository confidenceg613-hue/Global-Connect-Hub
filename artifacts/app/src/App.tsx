import { Switch, Route, Router as WouterRouter, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { useAuth } from "@/hooks/use-auth";
import { useEffect } from "react";

// Pages
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import Permissions from "@/pages/permissions";
import Invites from "@/pages/invites";
import Profile from "@/pages/profile";
import ConsentPage from "@/pages/consent";
import SharedCoordinates from "@/pages/shared-coordinates";
import WorldClock from "@/pages/world-clock";
import DangerZoneMap from "@/pages/danger-zone-map";
import { AppLayout } from "@/components/layout/app-layout";
import { GrantNotifier } from "@/components/grant-notifier";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  const { userId } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!userId) {
      setLocation("/");
    }
  }, [userId, setLocation]);

  if (!userId) return null;

  return (
    <AppLayout>
      <Component />
    </AppLayout>
  );
}

function Router() {
  return (
    <Switch>
      {/* Public routes */}
      <Route path="/" component={Landing} />
      <Route path="/consent/:token" component={ConsentPage} />

      {/* Protected routes */}
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/permissions"><ProtectedRoute component={Permissions} /></Route>
      <Route path="/invites"><ProtectedRoute component={Invites} /></Route>
      <Route path="/shared-coordinates"><ProtectedRoute component={SharedCoordinates} /></Route>
      <Route path="/profile"><ProtectedRoute component={Profile} /></Route>
      <Route path="/world-clock"><ProtectedRoute component={WorldClock} /></Route>
      <Route path="/danger-zones"><ProtectedRoute component={DangerZoneMap} /></Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <GrantNotifier />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
