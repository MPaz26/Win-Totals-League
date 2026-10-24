-- Live scores scenario: when private.refresh_live_scores() asks update-scores for a refresh.
-- Run with `make test-db`, after the other tests in the same database (it clears their games).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

create schema if not exists test;
create or replace function test.check(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAILED: %', p_what; end if;
  raise notice 'ok - %', p_what;
end;
$$;

truncate public.nba_games cascade;
delete from public.team_standings;
insert into public.team_standings (team_id, season, wins, losses, updated_at)
select id, 2027, 1, 1, now() - interval '1 day' from public.nba_teams;
delete from private.push_config;
insert into private.push_config (project_url, secret) values ('https://proj.supabase.co', 'shh');
select (now() at time zone 'America/New_York')::date as today \gset

\set QUIET off
\echo '--- when to refresh'
\set QUIET on

select coalesce(max(id), 0) as before from net.test_requests \gset
select test.check(private.refresh_live_scores() is null, 'no games: asks for nothing');
insert into public.nba_games (id, season, season_type, game_date, tipoff, home_team_id, away_team_id, status) values
  ('soon',  2027, 2, :'today', now() + interval '30 minutes', 1, 2, 'scheduled'),
  ('stale', 2027, 2, :'today', now() - interval '7 hours',    3, 4, 'scheduled');
select test.check(private.refresh_live_scores() is null, 'nothing on yet, and stale games are ignored');
select test.check((select count(*) = 0 from net.test_requests where id > :before), 'so ESPN is never called');

update public.nba_games set tipoff = now() + interval '5 minutes' where id = 'soon';
select test.check(private.refresh_live_scores() = jsonb_build_object('season', 2027, 'dates', jsonb_build_array(:'today'), 'standings', false),
                  'asks for today''s scores just before tipoff');
select test.check((select url = 'https://proj.supabase.co/functions/v1/update-scores' and headers ->> 'x-push-secret' = 'shh'
                     from net.test_requests where id = (select max(id) from net.test_requests)), 'calls update-scores with the secret');

-- A game that started last night (Eastern) and runs past midnight.
insert into public.nba_games (id, season, season_type, game_date, tipoff, home_team_id, away_team_id, status) values
  ('late', 2027, 2, :'today'::date - 1, now() - interval '2 hours', 5, 6, 'in_progress');
select test.check(private.refresh_live_scores() -> 'dates' = jsonb_build_array((:'today'::date - 1)::text, :'today'),
                  'includes yesterday''s date for a game still on');

\set QUIET off
\echo '--- standings after a final'
\set QUIET on

update public.nba_games set tipoff = now() + interval '1 day' where id = 'soon';
update public.nba_games set status = 'final', home_score = 100, away_score = 90 where id = 'late';
select test.check((select final_at > now() - interval '1 minute' from public.nba_games where id = 'late'), 'stamps when a game goes final');
select test.check(private.refresh_live_scores() = jsonb_build_object('season', 2027, 'dates', '[]'::jsonb, 'standings', true),
                  'asks for standings until the teams'' records change');
update public.team_standings set updated_at = now() + interval '1 second' where team_id = 5;
select test.check((private.refresh_live_scores() ->> 'standings')::boolean, 'still asks while one of the two teams is behind');
update public.team_standings set updated_at = now() + interval '1 second' where team_id = 6;
select test.check(private.refresh_live_scores() is null, 'stops once both teams have caught up');

update public.team_standings set updated_at = now() - interval '1 day' where team_id in (5, 6);
update public.nba_games set final_at = now() - interval '3 hours' where id = 'late';
update public.nba_games set status = 'final', home_score = 101 where id = 'late';
select test.check((select final_at < now() - interval '2 hours' from public.nba_games where id = 'late'), 're-saving a final keeps its stamp');
select test.check(private.refresh_live_scores() is null, 'gives up on standings 2 hours after the final');

update public.nba_games set status = 'in_progress', tipoff = now() - interval '1 hour', season_type = 3 where id = 'late';
update public.nba_games set status = 'final' where id = 'late';
select test.check(private.refresh_live_scores() is null, 'playoff finals don''t touch regular-season standings');

update public.nba_games set status = 'in_progress' where id = 'late';
delete from private.push_config;
select coalesce(max(id), 0) as before from net.test_requests \gset
select test.check(private.refresh_live_scores() is null, 'not configured: asks for nothing');
select test.check((select count(*) = 0 from net.test_requests where id > :before), 'and sends nothing');

set role authenticated;
do $$
begin
  perform private.refresh_live_scores();
  raise exception 'members could call refresh_live_scores';
exception when insufficient_privilege then
  null;
end;
$$;
reset role;

\echo 'ALL TESTS PASSED'
