import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";
import { Avatar, Button } from "./ui";

export function Layout({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();
  const name = profile?.username ?? session?.user.email ?? "";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-night/85 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="text-[17px] font-extrabold tracking-tight">
              Win Totals<span className="text-mint">.</span>
            </span>
          </Link>
          {session && (
            <div className="flex items-center gap-2">
              <span className="hidden items-center gap-2 rounded-full bg-panel py-1 pr-3 pl-1 ring-1 ring-line sm:flex">
                <Avatar name={name} className="h-7 w-7 text-[11px]" />
                <span className="text-sm font-semibold">{name}</span>
              </span>
              <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
                Sign out
              </Button>
            </div>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:py-8">{children}</main>
    </div>
  );
}

function Logo() {
  return (
    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-mint to-sky-500 text-night shadow-lg shadow-mint/20">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3v18M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8" />
      </svg>
    </span>
  );
}
