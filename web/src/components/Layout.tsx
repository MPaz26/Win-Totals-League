import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { Button } from "./ui";

export function Layout({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();

  return (
    <div className="min-h-screen">
      <header className="border-b border-zinc-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span aria-hidden>🏀</span> Win Totals League
          </Link>
          {session && (
            <div className="flex items-center gap-3 text-sm">
              <span className="hidden text-zinc-600 sm:inline">{profile?.username ?? session.user.email}</span>
              <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
