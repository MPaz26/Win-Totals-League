import type { ReactNode } from "react";
import { Link, NavLink } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useLiveScoresRealtime } from "../lib/queries";
import { InstallButton } from "./InstallGuide";
import { NotificationPrompt } from "./NotificationPrompt";
import { Avatar } from "./ui";

const TABS = [
  { to: "/", label: "Home", end: true, icon: HomeIcon },
  { to: "/leagues", label: "Leagues", end: false, icon: TrophyIcon },
  { to: "/watch", label: "League Pass", end: false, icon: TvIcon },
];

export function Layout({ children }: { children: ReactNode }) {
  const { session, profile } = useAuth();
  const name = profile?.username ?? session?.user.email ?? "";
  // Phones get a bottom tab bar once signed in. Pages with their own bottom bar (draft pick,
  // rankings save) stack it on top, using --tab-bar from index.css.
  const tabBar = Boolean(session && profile);
  useLiveScoresRealtime(Boolean(session));

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-40 border-b border-line/70 bg-night/85 pt-[env(safe-area-inset-top)] backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-3 sm:gap-5">
            <Link to="/" className="flex items-center gap-2.5" aria-label="Win Totals home">
              <Logo />
              <span className="text-[17px] font-extrabold tracking-tight">
                Win Totals<span className="text-mint">.</span>
              </span>
            </Link>
            {session && (
              <nav aria-label="Main" className="hidden gap-1 sm:flex">
                {TABS.map((t) => (
                  <NavItem key={t.to} to={t.to} end={t.end}>{t.label}</NavItem>
                ))}
              </nav>
            )}
          </div>
          <div className="flex items-center gap-2">
            <InstallButton variant="ghost" />
            {session && (
              <Link
                to="/profile"
                aria-label="Profile and settings"
                className={`items-center gap-2 rounded-full bg-panel p-1 ring-1 ring-line transition-colors hover:bg-raised sm:flex sm:pr-3 ${tabBar ? "hidden" : "flex"}`}
              >
                <Avatar name={name} className="h-7 w-7 text-[11px]" />
                <span className="hidden text-sm font-semibold sm:inline">{name}</span>
              </Link>
            )}
          </div>
        </div>
      </header>
      <main
        className={`mx-auto max-w-6xl px-4 pt-4 sm:py-8 ${
          tabBar ? "pb-[calc(var(--tab-bar)+1.5rem)]" : "pb-[max(1.5rem,env(safe-area-inset-bottom))]"
        }`}
      >
        <NotificationPrompt />
        {children}
      </main>
      {tabBar && <TabBar name={name} />}
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

function TabBar({ name }: { name: string }) {
  const tab = ({ isActive }: { isActive: boolean }) =>
    `flex flex-1 flex-col items-center gap-1 pt-2 pb-1.5 text-[10px] font-bold transition-colors ${isActive ? "text-mint" : "text-mute"}`;
  return (
    <nav
      aria-label="Main"
      className="fixed inset-x-0 bottom-0 z-40 flex h-[var(--tab-bar)] border-t border-line/70 bg-night/90 pb-[env(safe-area-inset-bottom)] backdrop-blur sm:hidden"
    >
      {TABS.map(({ to, label, end, icon: Icon }) => (
        <NavLink key={to} to={to} end={end} className={tab}>
          <Icon className="h-6 w-6" />
          {label}
        </NavLink>
      ))}
      <NavLink to="/profile" className={tab}>
        <Avatar name={name} className="h-6 w-6 text-[10px]" />
        Profile
      </NavLink>
    </nav>
  );
}

function HomeIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round" aria-hidden>
      <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
    </svg>
  );
}

function TrophyIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M7.5 4h9v5a4.5 4.5 0 0 1-9 0zM7.5 6H4.5v1.5A3 3 0 0 0 7.5 10.5M16.5 6h3v1.5a3 3 0 0 1-3 3M12 13.5V17M8.5 20h7M9.5 17h5" />
    </svg>
  );
}

function TvIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="6" width="18" height="12.5" rx="2" />
      <path d="M8.5 2.5 12 6l3.5-3.5M8 21.5h8" />
    </svg>
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
