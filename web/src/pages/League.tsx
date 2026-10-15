import { Link, useParams } from "react-router-dom";
import { Badge, Card, ErrorMessage, PageSpinner } from "../components/ui";
import { useLeague, useLeagueRealtime, useMembers, usePicks, useTeams } from "../lib/queries";
import type { League as LeagueRow, Member, Pick, Team } from "../lib/types";
import { DraftRoom } from "./league/DraftRoom";
import { Lobby } from "./league/Lobby";
import { Results } from "./league/Results";

export function League() {
  const { id = "" } = useParams();
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
      <Card className="mx-auto max-w-md">
        <h1 className="text-lg font-semibold">League not found</h1>
        <p className="mt-1 text-sm text-zinc-600">
          It doesn't exist, or you're not a member. <Link to="/" className="text-orange-700 underline">Back to your leagues</Link>
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

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">{data.league.name}</h1>
        {data.league.status === "lobby" && <Badge>Lobby</Badge>}
        {data.league.status === "drafting" && <Badge tone="orange">Drafting</Badge>}
        {data.league.status === "complete" && <Badge tone="green">Draft complete</Badge>}
      </div>
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
