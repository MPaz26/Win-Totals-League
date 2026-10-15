import { NavLink } from "react-router-dom";

const TABS = [
  { to: "/watch", label: "Games", end: true },
  { to: "/watch/rankings", label: "My rankings", end: false },
  { to: "/watch/community", label: "Community", end: false },
];

/** Sub-navigation shared by the League Pass pages. */
export function WatchTabs() {
  return (
    <nav aria-label="League Pass" className="mb-4 flex w-fit rounded-full bg-night p-1 ring-1 ring-line sm:mb-6">
      {TABS.map((t) => (
        <NavLink
          key={t.to}
          to={t.to}
          end={t.end}
          className={({ isActive }) =>
            `rounded-full px-3.5 py-1.5 text-xs font-bold transition-colors ${isActive ? "bg-raised text-ink shadow" : "text-mute hover:text-ink"}`
          }
        >
          {t.label}
        </NavLink>
      ))}
    </nav>
  );
}
