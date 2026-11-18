-- Trades. Run with `make test-db`, right after draft_day_test.sql: it trades in that file's
-- mid-season league (drafted Nov 3; Alice has teams 1 and 2, Bob has team 3).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

\set a '00000000-0000-0000-0000-00000000000a'
\set b '00000000-0000-0000-0000-00000000000b'
\set c '00000000-0000-0000-0000-00000000000c'
\set mid  '00000000-0000-0000-0000-0000000000e2'
\set live '00000000-0000-0000-0000-0000000000e3'

set role authenticated;

\set QUIET off
\echo '--- offers'
\set QUIET on

select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);
select test.expect_error(format('select public.propose_trade(%L, %L, %L, %L)', :'live', :'b', '{1}', '{3}'), 'once the draft is done');
select test.expect_error(format('select public.propose_trade(%L, %L, %L, %L)', :'mid', :'c', '{1}', '{3}'), 'another manager');
select test.expect_error(format('select public.propose_trade(%L, %L, %L, %L)', :'mid', :'a', '{1}', '{2}'), 'another manager');
select test.expect_error(format('select public.propose_trade(%L, %L, %L, %L)', :'mid', :'b', '{1}', '{}'), 'at least one team going each way');
select test.expect_error(format('select public.propose_trade(%L, %L, %L, %L)', :'mid', :'b', '{1,1}', '{3}'), 'only appear once');
select test.expect_error(format('select public.propose_trade(%L, %L, %L, %L)', :'mid', :'b', '{3}', '{1}'), 'no longer belongs to');
select test.expect_error(format('select public.propose_trade(%L, %L, %L, %L)', :'mid', :'b', '{1}', '{2}'), 'no longer belongs to');
select test.expect_error(format('insert into public.trades (league_id, proposer_id, recipient_id) values (%L, %L, %L)', :'mid', :'a', :'b'),
                         'permission denied');

-- Two for one: rosters don't have to stay even.
select public.propose_trade(:'mid', :'b', '{1,2}', '{3}') as two_for_one \gset
select public.propose_trade(:'mid', :'b', '{2}', '{3}') as rival \gset
select test.expect_error(format('select public.respond_to_trade(%L, true)', :'two_for_one'), 'Trade not found');
select set_config('request.jwt.claims', json_build_object('sub', :'c')::text, false);
select test.check((select count(*) = 0 from public.trades where league_id = :'mid'), 'non-members can''t see trades');
select set_config('request.jwt.claims', json_build_object('sub', :'b')::text, false);
select test.check((select count(*) = 2 from public.trades where league_id = :'mid' and status = 'pending'), 'the other manager sees the offers');

\set QUIET off
\echo '--- accepted'
\set QUIET on

select public.respond_to_trade(:'two_for_one', true);
select test.check((select status = 'accepted' and effective_date = (now() at time zone 'America/New_York')::date
                     from public.trades where id = :'two_for_one'), 'accepted today (Eastern)');
select test.check((select status = 'void' from public.trades where id = :'rival'), 'other offers for those teams are void');
select test.expect_error(format('select public.respond_to_trade(%L, true)', :'rival'), 'no longer open');

-- Before the trade (since the Nov 3 draft): Alice 1-0 with team 1, Bob 0-1 with team 3.
-- Today team 2 beat team 6 (draft_day_test's game n0), before ESPN's standings caught up.
-- Trade-day games stay with the old owner, so that win is Alice's, and the new owners start at 0-0.
select test.check((select array_agg(row(team_id, wins, losses, owned)::text order by team_id) = array['(1,1,0,f)', '(2,1,0,f)', '(3,0,0,t)']
                     from public.league_team_records where league_id = :'mid' and user_id = :'a'),
                  'wins earned before the trade stay with the old owner');
select test.check((select array_agg(row(team_id, wins, losses, owned)::text order by team_id) = array['(1,0,0,t)', '(2,0,0,t)', '(3,0,1,f)']
                     from public.league_team_records where league_id = :'mid' and user_id = :'b'),
                  'the new owner starts counting after the trade day');
select test.check((select array_agg(row(teams, wins, losses, place)::text order by user_id) = array['(1,2,0,1)', '(2,0,1,2)']
                     from public.league_scoreboard where league_id = :'mid'), 'scoreboard: current teams, all wins earned');

\set QUIET off
\echo '--- the 7-day limit'
\set QUIET on

select test.expect_error(format('select public.propose_trade(%L, %L, %L, %L)', :'mid', :'a', '{1}', '{3}'), 'traded in the last 7 days');

reset role;
-- A week and a bit later: the trade happened 8 days ago, and team 1 has won a game since.
update public.trades set decided_at = now() - interval '8 days',
                         effective_date = (now() at time zone 'America/New_York')::date - 8
 where id = :'two_for_one';
insert into public.nba_games (id, season, season_type, game_date, tipoff, home_team_id, away_team_id, status, home_score, away_score) values
  ('n5', 2027, 2, (now() at time zone 'America/New_York')::date - 3, now() - interval '3 days', 1, 7, 'final', 101, 99);
update public.team_standings set wins = wins + 1 where team_id = 1;
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'b')::text, false);

select test.check((select wins = 1 and owned from public.league_team_records where league_id = :'mid' and user_id = :'b' and team_id = 1),
                  'the new owner gets wins after the trade');
select public.propose_trade(:'mid', :'a', '{1}', '{3}') as back \gset
select public.propose_trade(:'mid', :'a', '{2}', '{3}') as withdrawn \gset
select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);
select test.expect_error(format('select public.cancel_trade(%L)', :'withdrawn'), 'no longer open');
select set_config('request.jwt.claims', json_build_object('sub', :'b')::text, false);
select public.cancel_trade(:'withdrawn');
select test.check((select status = 'canceled' from public.trades where id = :'withdrawn'), 'the offerer can withdraw an offer');
select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);
select public.respond_to_trade(:'back', false);
select test.check((select status = 'declined' from public.trades where id = :'back'), 'the other manager can decline');
select test.check((select owned from public.league_team_records where league_id = :'mid' and user_id = :'b' and team_id = 1),
                  'a declined trade moves nothing');
reset role;

\echo 'ALL TESTS PASSED'
