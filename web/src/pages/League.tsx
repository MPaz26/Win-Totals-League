import { useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { Badge, Card, ErrorMessage, InlineEdit, LeagueMark, PageSpinner, statusBadge } from "../components/ui";
import { useUserId } from "../lib/auth";
import { useLeague, useLeagueRealtime, useMembers, usePicks, useTeams } from "../lib/queries";
import { rpc } from "../lib/supabase";
import type { League as LeagueRow, Member, Pick, Team } from "../lib/types";
import { DraftRoom } from "./league/DraftRoom";
import { Lobby } from "./league/Lobby";
import { Results } from "./league/Results";

export function League() {
  const { id = "" } = useParams();
  const userId = useUserId();
  const queryClient = useQueryClient();
  useLeagueRealtime(id);
  const league = useLeague(id);
  const members = useMembers(id);
  const picks = usePicks(id);
  const teams = useTeams();

  const error = league.error ?? members.error ?? picks.error ?? teams.error;
  if (error) return <ErrorMessage error={error} />;
  if (league.isPending || !members.data || !picks.data || !teams.data) return <PageSpinner />;

  if (!league.data) {
    return (
      <Card className="mx-auto max-w-md text-center">
        <h1 className="text-lg font-extrabold">League not found</h1>
        <p className="mt-1 text-sm text-mute">
          It doesn't exist, or you're not a member. <Link to="/" className="font-semibold text-mint hover:underline">Back to your leagues</Link>
        </p>
      </Card>
    );
  }

  const data: LeagueData = {
    league: league.data,
    members: members.data,
    picks: picks.data,
    teams: new Map(teams.data.map((t) => [t.id, t])),
  };
  const badge = statusBadge[data.league.status];
  const me = data.members.find((m) => m.user_id === userId);

  async function renameLeague(name: string) {
    await rpc("rename_league", { p_league: id, p_name: name });
    queryClient.invalidateQueries({ queryKey: ["league", id] });
    queryClient.invalidateQueries({ queryKey: ["myLeagues"] });
  }

  async function setTeamName(name: string) {
    await rpc("set_team_name", { p_league: id, p_team_name: name });
    queryClient.invalidateQueries({ queryKey: ["members", id] });
    queryClient.invalidateQueries({ queryKey: ["scoreboard", id] });
  }

  return (
    <div className="space-y-4 sm:space-y-6">
      <div className="flex items-center gap-3 sm:gap-4">
        <Link to="/" className="-ml-1 px-1 text-3xl leading-none text-faint hover:text-ink" aria-label="Back to leagues">‹</Link>
        <LeagueMark name={data.league.name} className="h-12 w-12 text-base sm:h-14 sm:w-14 sm:text-lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-extrabold tracking-tight sm:text-2xl">
            {data.league.commissioner_id === userId ? (
              <InlineEdit value={data.league.name} label="league name" maxLength={60}
                validate={(v) => (v ? null : "Give the league a name.")} onSave={renameLeague} />
            ) : (
              <span className="block truncate">{data.league.name}</span>
            )}
          </h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mute">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            <span>{data.members.length} {data.members.length === 1 ? "manager" : "managers"}</span>
            <span aria-hidden>·</span>
            <span>{data.league.snake ? "Snake" : "Linear"} draft</span>
          </div>
        </div>
      </div>
      {me && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-2xl bg-panel px-4 py-3 ring-1 ring-line/70 sm:flex-nowrap sm:px-5">
          <span className="shrink-0 text-[11px] font-extrabold uppercase tracking-[0.14em] text-mute">Your team</span>
          <div className="min-w-0 flex-1 basis-40 font-bold">
            <InlineEdit value={me.team_name ?? ""} label="team name" maxLength={40} placeholder="Name your team" onSave={setTeamName} />
          </div>
        </div>
      )}
      {data.league.status === "lobby" && <Lobby {...data} />}
      {data.league.status === "drafting" && <DraftRoom {...data} />}
      {data.league.status === "complete" && <Results {...data} />}
    </div>
  );
}

export interface LeagueData {
  league: LeagueRow;
  members: Member[];
  picks: Pick[];
  teams: Map<number, Team>;
}
