-- Live scores and standings. Every 5 minutes (20261024000100_live_scores_cron.sql) the database
-- checks its own schedule and, only when there's something to refresh, asks the update-scores
-- Edge Function to fetch it from ESPN. Off nights and daytime make no ESPN requests at all;
-- a game night is one scoreboard request per run, plus standings as games go final.
-- The daily GitHub job still runs as the safety net, and still writes the history snapshots.

-- When the game went final, so the check below can tell whether standings have caught up.
alter table public.nba_games add column final_at timestamptz;

create function private.stamp_final() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status = 'final' and old.status is distinct from 'final' then
    new.final_at := now();
  end if;
  return new;
end;
$$;

create trigger nba_games_stamp_final
  before update of status on public.nba_games
  for each row execute function private.stamp_final();

-- Asks update-scores to refresh, or does nothing. It refreshes:
--   dates      the (Eastern) days of games that are on, or tip off in the next 10 minutes
--   standings  whether a regular-season game went final in the last 2 hours and one of its
--              teams' standings hasn't changed since. ESPN's standings can trail its scoreboard
--              by a few minutes; update-scores only writes rows that changed, so this keeps
--              asking until they catch up, and gives up after 2 hours (the daily job follows).
-- Uses the same function URL and shared secret as send-push (private.push_config).
-- Returns what it asked for, or null if it asked for nothing.
create function private.refresh_live_scores() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_config    private.push_config;
  v_dates     jsonb;
  v_standings boolean;
  v_body      jsonb;
begin
  select jsonb_agg(distinct game_date order by game_date) into v_dates
    from public.nba_games
   where status in ('scheduled', 'in_progress')
     and tipoff between now() - interval '6 hours' and now() + interval '10 minutes';

  select exists (
    select 1
      from public.nba_games g
      join public.team_standings s on s.team_id in (g.home_team_id, g.away_team_id) and s.season = g.season
     where g.season_type = 2
       and g.final_at > now() - interval '2 hours'
       and g.final_at > s.updated_at
  ) into v_standings;

  if v_dates is null and not v_standings then
    return null;
  end if;
  select * into v_config from private.push_config;
  if not found then
    return null;
  end if;

  v_body := jsonb_build_object(
    'season', (select max(season) from public.nba_games where tipoff between now() - interval '1 day' and now() + interval '1 day'),
    'dates', coalesce(v_dates, '[]'::jsonb),
    'standings', v_standings
  );
  perform net.http_post(
    url := v_config.project_url || '/functions/v1/update-scores',
    body := v_body,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_config.secret),
    timeout_milliseconds := 60000
  );
  return v_body;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;

-- Open pages refresh when scores or standings change (useLiveScoresRealtime).
alter publication supabase_realtime add table public.nba_games, public.team_standings;
