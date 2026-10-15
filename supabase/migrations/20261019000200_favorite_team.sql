-- A favorite team: its game is pinned to the top of the League Pass games list. Null means none.
alter table public.lp_settings add column favorite_team_id smallint references public.nba_teams (id);
grant insert (favorite_team_id), update (favorite_team_id) on public.lp_settings to authenticated;
