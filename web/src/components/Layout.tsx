import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { InstallButton } from "./InstallGuide";
import { Avatar } from "./ui";

export function Layout({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();
  const name = profile?.username ?? session?.user.email ?? "";

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-night/85 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <Link to="/" className="flex items-center gap-2.5" aria-label="Win Totals home">
              <Logo />
              <span className="hidden text-[17px] font-extrabold tracking-tight sm:inline">
                Win Totals<span className="text-mint">.</span>
              </span>
            </Link>
            {session && (
              <nav aria-label="Main" className="flex gap-1">
                <NavItem to="/" end>Leagues</NavItem>
                <NavItem to="/watch">League Pass</NavItem>
              </nav>
            )}
          </div>
          <div className="flex items-center gap-2">
            <InstallButton variant="ghost" />
            {session && (
              <Link
                to="/profile"
                aria-label="Profile and settings"
                className="flex items-center gap-2 rounded-full bg-panel p-1 ring-1 ring-line transition-colors hover:bg-raised sm:pr-3"
              >
                <Avatar name={name} className="h-7 w-7 text-[11px]" />
                <span className="hidden text-sm font-semibold sm:inline">{name}</span>
              </Link>
            )}
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:py-8">{children}</main>
    </div>
  );
}

function NavItem({ to, end, children }: { to: string; end?: boolean; children: ReactNode }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-bold transition-colors ${isActive ? "bg-raised text-ink" : "text-mute hover:text-ink"}`
      }
    >
      {children}
    </NavLink>
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
