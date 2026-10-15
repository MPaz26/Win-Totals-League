// Row shapes as the app selects them. Mirrors supabase/migrations/*_init.sql.

export type LeagueStatus = "lobby" | "drafting" | "complete";
export type OrderMode = "random" | "manual";

export interface Profile {
  id: string;
  username: string;
}

export interface Team {
  id: number;
  abbr: string;
  name: string;
  conference: "East" | "West";
  last_season_wins: number | null;
}

export interface Standing {
  team_id: number;
  season: number;
  wins: number;
  losses: number;
  updated_at: string;
}

export interface League {
  id: string;
  name: string;
  commissioner_id: string;
  invite_code: string;
  status: LeagueStatus;
  snake: boolean;
  order_mode: OrderMode;
  pick_seconds: number;
  current_pick: number;
  pick_deadline: string | null;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
}

export interface Member {
  user_id: string;
  draft_slot: number;
  joined_at: string;
  /** The manager's own name for their team in this league; null shows the username. */
  team_name: string | null;
  profile: { username: string };
}

export interface Pick {
  pick_number: number;
  user_id: string;
  team_id: number;
  auto: boolean;
  picked_at: string;
}

export interface ScoreRow {
  league_id: string;
  user_id: string;
  username: string;
  draft_slot: number;
  teams: number;
  wins: number;
  losses: number;
  place: number;
  team_name: string | null;
}

export interface LeaguePreview {
  id: string;
  name: string;
  status: LeagueStatus;
  commissioner: string;
  member_count: number;
  is_member: boolean;
}
