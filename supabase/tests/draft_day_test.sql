-- Wins count from the day after the draft. Run with `make test-db`, after draft_test.sql
-- (it reuses that file's users and test helpers, and clears games and standings).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

\set a '00000000-0000-0000-0000-00000000000a'
\set b '00000000-0000-0000-0000-00000000000b'
\set c '00000000-0000-0000-0000-00000000000c'
\set pre  '00000000-0000-0000-0000-0000000000e1'
\set mid  '00000000-0000-0000-0000-0000000000e2'
\set live '00000000-0000-0000-0000-0000000000e3'

truncate public.nba_games cascade;
delete from public.team_standings;

-- Teams 1 and 2 (Alice) and 3 (Bob). Season so far, Nov 1 to Nov 4 (Eastern):
--   Nov 1  1 beats 2      Nov 3  2 beats 1 (the mid-season draft day)
--   Nov 2  3 beats 1      Nov 4  1 beats 3
-- Plus a playoff-type game and a postponed one before the draft, which never count.
insert into public.nba_games (id, season, season_type, game_date, tipoff, home_team_id, away_team_id, status, home_score, away_score) values
  ('n1', 2027, 2, '2026-11-01', '2026-11-01 23:30Z', 1, 2, 'final', 110, 100),
  ('n2', 2027, 2, '2026-11-02', '2026-11-02 23:30Z', 1, 3, 'final', 99, 105),
  ('n3', 2027, 2, '2026-11-03', '2026-11-04 02:00Z', 2, 1, 'final', 120, 101),
  ('n4', 2027, 2, '2026-11-04', '2026-11-04 23:30Z', 3, 1, 'final', 90, 95),
  ('px', 2027, 3, '2026-11-02', '2026-11-02 23:30Z', 2, 3, 'final', 100, 90),
  ('pp', 2027, 2, '2026-11-02', '2026-11-02 23:30Z', 2, 3, 'postponed', null, null);
-- ESPN's season records, which include every game above.
insert into public.team_standings (team_id, season, wins, losses)
select id, 2027,
       case id when 1 then 2 when 2 then 1 when 3 then 1 else 0 end,
       case id when 1 then 2 when 2 then 1 when 3 then 1 else 0 end
  from public.nba_teams;

-- Three leagues, written directly: drafted before the season, mid-season on Nov 3 just before
-- midnight Eastern (already Nov 4 in UTC), and one still drafting.
insert into public.leagues (id, name, commissioner_id, status, started_at, completed_at) values
  (:'pre',  'Preseason', :'a', 'complete', '2026-10-01Z', '2026-10-01 01:00Z'),
  (:'mid',  'Mid',       :'a', 'complete', '2026-11-04 03:30Z', '2026-11-04 03:55Z'),
  (:'live', 'Drafting',  :'a', 'drafting', now(), null);
insert into public.league_members (league_id, user_id, draft_slot)
select l, u, s from (values (:'pre'::uuid), (:'mid'::uuid), (:'live'::uuid)) ls (l),
                    (values (:'a'::uuid, 1), (:'b'::uuid, 2)) us (u, s);
insert into public.draft_picks (league_id, pick_number, user_id, team_id)
select l, p, u, t from (values (:'pre'::uuid), (:'mid'::uuid), (:'live'::uuid)) ls (l),
                       (values (1, :'a'::uuid, 1), (2, :'b'::uuid, 3), (3, :'a'::uuid, 2)) ps (p, u, t);

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'c')::text, false);
select test.check((select count(*) = 0 from public.league_team_records where league_id in (:'pre', :'mid', :'live')),
                  'non-member sees no team records');
select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);

\set QUIET off
\echo '--- drafted before the season'
\set QUIET on

select test.check((select array_agg(row(team_id, wins, losses)::text order by team_id) = array['(1,2,2)', '(2,1,1)', '(3,1,1)']
                     from public.league_team_records where league_id = :'pre'), 'every game counts, same as the season record');
select test.check((select array_agg(row(wins, losses, place)::text order by user_id) = array['(3,3,1)', '(1,1,2)']
                     from public.league_scoreboard where league_id = :'pre'), 'scoreboard unchanged');

\set QUIET off
\echo '--- drafted mid-season'
\set QUIET on

select test.check((select draft_date = '2026-11-03' from public.league_team_records where league_id = :'mid' limit 1),
                  'draft day is the Eastern calendar day');
select test.check((select array_agg(row(team_id, wins, losses)::text order by team_id) = array['(1,1,0)', '(2,0,0)', '(3,0,1)']
                     from public.league_team_records where league_id = :'mid'), 'only games after draft day count, not draft-day games');
select test.check((select array_agg(row(wins, losses, place)::text order by user_id) = array['(1,0,1)', '(0,1,2)']
                     from public.league_scoreboard where league_id = :'mid'), 'scoreboard sums post-draft records');

reset role;
-- Draft night: a game is final on the scoreboard before ESPN's standings count it.
insert into public.nba_games (id, season, season_type, game_date, tipoff, home_team_id, away_team_id, status, home_score, away_score) values
  ('n0', 2027, 2, (now() at time zone 'America/New_York')::date, now() - interval '3 hours', 2, 6, 'final', 100, 90);
set role authenticated;

\set QUIET off
\echo '--- still drafting'
\set QUIET on

select test.check((select bool_and(wins = 0 and losses = 0) from public.league_team_records where league_id = :'live'),
                  'a league still drafting counts nothing yet');
select test.check((select count(*) = 0 from public.league_team_records where wins < 0 or losses < 0),
                  'never negative while standings catch up');
reset role;

\echo 'ALL TESTS PASSED'
