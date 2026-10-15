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

// League Pass. Mirrors supabase/migrations/*_league_pass.sql.

export type GameStatus = "scheduled" | "in_progress" | "final" | "postponed" | "canceled";
export type WatchTier = "must" | "good" | "meh";

/** One game from lp_suggestions(), scored for the caller. Parts are 0..1, leans -1..1. */
export interface Suggestion {
  game_id: string;
  game_date: string;
  tipoff: string;
  status: GameStatus;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  /** National broadcasters; those games are blacked out on League Pass. */
  national_tv: string | null;
  watch_score: number;
  tier: WatchTier;
  home_rank: number;
  away_rank: number;
  appeal: number;
  closeness: number;
  my_lean: number;
  community_lean: number;
  quality: number;
  my_stars: number | null;
}

export interface CommunityRank {
  team_id: number;
  /** Null until someone has ranked their teams. */
  avg_rank: number | null;
  n_users: number;
  avg_stars: number | null;
  n_ratings: number;
}

export interface LpSettings {
  hide_scores: boolean;
  notify_daily: boolean;
  notify_must_watch: boolean;
  notify_replies: boolean;
}

// Game threads. Mirrors supabase/migrations/*_game_comments.sql.

/** A row of nba_games, for the thread page's header. */
export interface Game {
  id: string;
  game_date: string;
  tipoff: string;
  status: GameStatus;
  home_team_id: number;
  away_team_id: number;
  home_score: number | null;
  away_score: number | null;
  national_tv: string | null;
}

export interface GameComment {
  id: number;
  user_id: string;
  /** The thread's top comment; null for a top comment itself. */
  parent_id: number | null;
  /** Null once deleted (kept only while it has replies). */
  body: string | null;
  created_at: string;
  author: { username: string };
}
