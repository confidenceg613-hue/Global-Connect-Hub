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
import { AppLayout } from "@/components/layout/app-layout";

const queryClient = new QueryClient();

function ProtectedRoute({ component: Component }: { component: any }) {
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
      <Route path="/" component={Landing} />
      <Route path="/dashboard"><ProtectedRoute component={Dashboard} /></Route>
      <Route path="/permissions"><ProtectedRoute component={Permissions} /></Route>
      <Route path="/invites"><ProtectedRoute component={Invites} /></Route>
      <Route path="/profile"><ProtectedRoute component={Profile} /></Route>
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
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
