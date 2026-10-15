import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { Layout } from "./components/Layout";
import { PageSpinner } from "./components/ui";
import { useAuth } from "./lib/auth";
import { Home } from "./pages/Home";
import { Join } from "./pages/Join";
import { League } from "./pages/League";
import { ProfileSetup } from "./pages/ProfileSetup";
import { SignIn } from "./pages/SignIn";
import { Unsubscribe } from "./pages/Unsubscribe";

export function App() {
  return (
    <Layout>
      <Routes>
        {/* The invite page handles sign-in and username setup itself, so it can show the league first. */}
        <Route path="/join/:code" element={<Join />} />
        <Route path="/unsubscribe/:token" element={<Unsubscribe />} />
        <Route path="/" element={<Gate><Home /></Gate>} />
        <Route path="/league/:id" element={<Gate><League /></Gate>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}

/** Renders children only for a signed-in user with a username. */
function Gate({ children }: { children: ReactNode }) {
  const { session, loading, profile, profileLoading } = useAuth();
  if (loading || profileLoading) return <PageSpinner />;
  if (!session) return <SignIn />;
  if (!profile) return <ProfileSetup />;
  return <>{children}</>;
}
