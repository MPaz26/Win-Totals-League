import { useState } from "react";

// Keyed by ESPN abbreviation (nba_teams.abbr). Based on ESPN's team colors, swapping in the
// alternate where the primary is too dark to read on the dark theme.
const ACCENTS: Record<string, string> = {
  ATL: "#c8102e", BOS: "#00a35c", BKN: "#a0a7b4", CHA: "#00a0c0", CHI: "#ce1141",
  CLE: "#a8174a", DAL: "#0a7bd6", DEN: "#fec524", DET: "#2f63c2", GS: "#fdb927",
  HOU: "#ce0e2d", IND: "#ffd520", LAC: "#c8102e", LAL: "#8a4fd0", MEM: "#5d76a9",
  MIA: "#c4083c", MIL: "#2e8b4e", MIN: "#4f9bd9", NO: "#b4975a", NY: "#f58426",
  OKC: "#007ac1", ORL: "#0a6be0", PHI: "#2f63c2", PHX: "#e56020", POR: "#e03a3e",
  SAC: "#7a4bb0", SA: "#c4ced4", TOR: "#d91244", UTAH: "#8a4fd0", WSH: "#e31837",
};

export const TEAM_ABBRS = Object.keys(ACCENTS);

export function teamColor(abbr: string): string {
  return ACCENTS[abbr] ?? "#56627a";
}

/**
 * ESPN's dark-background logos, copied into web/public/logos at 128px so the app doesn't hotlink
 * ESPN. sw.js serves them cache-first.
 */
export function TeamLogo({ abbr, className = "h-8 w-8" }: { abbr: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className={`inline-flex shrink-0 items-center justify-center text-[10px] font-extrabold text-mute ${className}`}>
        {abbr}
      </span>
    );
  }
  return (
    <img
      src={`${import.meta.env.BASE_URL}logos/${abbr.toLowerCase()}.png`}
      alt=""
      loading="lazy"
      className={`shrink-0 object-contain ${className}`}
      onError={() => setFailed(true)}
    />
  );
}
