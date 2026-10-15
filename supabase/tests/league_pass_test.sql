-- League Pass scenario against the real migration. Run with `make test-db` (after draft_test.sql,
-- in the same database, so it uses its own users and recreates the helpers it needs).
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

\set e '00000000-0000-0000-0000-00000000000e'
\set f '00000000-0000-0000-0000-00000000000f'
\set g '00000000-0000-0000-0000-000000000010'
\set h '00000000-0000-0000-0000-000000000011'

create schema if not exists test;
grant usage on schema test to authenticated, anon;

create or replace function test.expect_error(p_sql text, p_pattern text) returns void
language plpgsql as $$
begin
  execute p_sql;
  raise exception 'expected error matching "%" from: %', p_pattern, p_sql;
exception when others then
  if sqlerrm like 'expected error matching%' or sqlerrm not ilike '%' || p_pattern || '%' then
    raise;
  end if;
end;
$$;

create or replace function test.check(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAILED: %', p_what; end if;
  raise notice 'ok - %', p_what;
end;
$$;

-- The caller's watch score for one game today.
create or replace function test.score(p_game text) returns int language sql as $$
  select watch_score from public.lp_suggestions((now() at time zone 'America/New_York')::date - 1,
                                                (now() at time zone 'America/New_York')::date + 2)
   where game_id = p_game;
$$;
grant execute on all functions in schema test to authenticated, anon;

insert into auth.users (id, email) values (:'e', 'e@x.test'), (:'f', 'f@x.test'), (:'g', 'g@x.test'), (:'h', 'h@x.test');
insert into public.profiles (id, username) values (:'e', 'Erin'), (:'f', 'Finn'), (:'g', 'Gus'), (:'h', 'Hana');

-- Every team at .500 so records don't move the scores below.
delete from public.team_standings;

select (now() at time zone 'America/New_York')::date as today \gset
-- Today: ATL(1)-BOS(2) tips in 27 minutes; the rest later tonight.
insert into public.nba_games (id, season, season_type, game_date, tipoff, home_team_id, away_team_id, status, home_score, away_score) values
  ('g1', 2027, 2, :'today',     now() + interval '27 minutes', 1,  2,  'scheduled', null, null),
  ('g2', 2027, 2, :'today',     now() + interval '5 hours',    29, 30, 'scheduled', null, null),
  ('g3', 2027, 2, :'today',     now() + interval '5 hours',    5,  6,  'scheduled', null, null),
  ('g4', 2027, 2, :'today',     now() + interval '5 hours',    5,  28, 'scheduled', null, null),
  ('f1', 2027, 2, :'today' ::date + 2, now() + interval '2 days', 3, 20, 'scheduled', null, null),
  ('p1', 2027, 2, :'today' ::date - 1, now() - interval '1 day',   3,  10, 'final', 120, 118),
  ('p2', 2027, 2, :'today',     now() - interval '3 hours',    4,  11, 'scheduled', null, null),
  ('p3', 2027, 2, :'today',     now() - interval '1 hour',     7,  12, 'in_progress', null, null);

\set QUIET off
\echo '--- rankings'
\set QUIET on

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'e')::text, false);
select public.set_lp_rankings(array(select generate_series(1, 30))::smallint[]);
select test.check((select count(*) = 30 and bool_and(rank = team_id) from public.lp_rankings), 'saves all 30 in order');
select test.expect_error('select public.set_lp_rankings(array(select generate_series(1, 29))::smallint[])', 'all 30 teams');
select test.expect_error('select public.set_lp_rankings((array[1] || array(select generate_series(1, 29)))::smallint[])', 'all 30 teams');
select test.expect_error('select public.set_lp_rankings((array[99] || array(select generate_series(2, 30)))::smallint[])', 'all 30 teams');
select test.expect_error('select public.set_lp_rankings((array[null]::int[] || array(select generate_series(2, 30)))::smallint[])', 'all 30 teams');
select test.expect_error(format('insert into public.lp_rankings values (%L, 1, 1)', :'e'), 'permission denied');
select test.check((select count(*) = 30 and bool_and(rank = team_id) from public.lp_rankings), 'a rejected save changes nothing');

select set_config('request.jwt.claims', json_build_object('sub', :'f')::text, false);
select test.check((select count(*) = 0 from public.lp_rankings), 'cannot see another user''s rankings');
select public.set_lp_rankings(array(select generate_series(1, 30))::smallint[]);
select public.set_lp_rankings(array(select generate_series(30, 1, -1))::smallint[]);
select test.check((select rank = 30 from public.lp_rankings where team_id = 1), 're-saving replaces the order');

select set_config('request.jwt.claims', json_build_object('sub', :'g')::text, false);
select public.set_lp_rankings(array(select generate_series(1, 30))::smallint[]);
reset role;

\set QUIET off
\echo '--- suggestions'
\set QUIET on

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'e')::text, false);
select test.check(test.score('g1') > test.score('g2'), 'your #1 vs #2 beats your #29 vs #30');
select test.check(test.score('g3') > test.score('g4'), '#5 vs #6 beats #5 vs #28 (closeness)');
select test.check((select tier = 'must' from public.lp_suggestions(:'today', :'today') where game_id = 'g1'), '#1 vs #2 is must-watch');
select test.check((select tier = 'meh' from public.lp_suggestions(:'today', :'today') where game_id = 'g2'), '#29 vs #30 is not');
select test.check((select tier = 'must' from public.lp_suggestions(:'today', :'today') where game_id = 'g3'), '#5 vs #6 is must-watch too');
select test.check((select game_id = 'g1' from public.lp_suggestions(:'today', :'today') limit 1), 'best game comes first');
select test.check((select count(*) = 6 from public.lp_suggestions(:'today', :'today')), 'only that day''s games');
select test.expect_error(format('select * from public.lp_suggestions(%L, %L::date + 40)', :'today', :'today'), 'up to a month');
select test.score('f1') as f1_before \gset

select set_config('request.jwt.claims', json_build_object('sub', :'f')::text, false);
select test.check(test.score('g2') > test.score('g1'), 'the same games score by each user''s own order');

select set_config('request.jwt.claims', json_build_object('sub', :'h')::text, false);
select test.check(test.score('g1') is not null, 'someone with no rankings still gets scores (community order)');
reset role;

set role anon;
select test.expect_error(format('select * from public.lp_suggestions(%L, %L)', :'today', :'today'), 'permission denied');
reset role;

\set QUIET off
\echo '--- ratings'
\set QUIET on

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'e')::text, false);
select test.expect_error($$select public.rate_game('g1', 4::smallint)$$, 'once it''s over');
select test.expect_error($$select public.rate_game('p3', 4::smallint)$$, 'once it''s over');
select test.expect_error($$select public.rate_game('nope', 4::smallint)$$, 'Game not found');
select test.expect_error($$select public.rate_game('p1', 6::smallint)$$, 'check constraint');
select public.rate_game('p2', 3::smallint);
select test.check((select stars = 3 from public.lp_game_ratings where game_id = 'p2'), 'can rate 2.5 hours after tipoff before it''s marked final');
select public.rate_game('p1', 4::smallint);
select public.rate_game('p1', 5::smallint);
select test.check((select stars = 5 from public.lp_game_ratings where game_id = 'p1'), 're-rating updates');
select public.rate_game('p2', null);
select test.check((select count(*) = 1 from public.lp_game_ratings), 'null clears a rating');
select test.expect_error(format('insert into public.lp_game_ratings values (%L, %L, 5)', :'e', 'p2'), 'permission denied');
select test.check(test.score('f1') > :f1_before, 'loving a team''s game lifts its next one');
select test.check((select my_stars = 5 from public.lp_suggestions(:'today'::date - 1, :'today'::date - 1) where game_id = 'p1'),
                  'suggestions carry your own rating');

select set_config('request.jwt.claims', json_build_object('sub', :'f')::text, false);
select test.check((select count(*) = 0 from public.lp_game_ratings), 'cannot see another user''s ratings');
reset role;

\set QUIET off
\echo '--- community'
\set QUIET on

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'h')::text, false);
-- e and g rank ATL 1st, f ranks it 30th.
select test.check((select avg_rank = 10.7 and n_users = 3 from public.lp_community_rankings() where team_id = 1), 'average rank across users');
select test.check((select avg_stars = 5 and n_ratings = 1 from public.lp_community_rankings() where team_id = 3), 'average rating of a team''s games');
select test.check((select count(*) = 30 from public.lp_community_rankings()), 'all 30 teams listed');
reset role;

\set QUIET off
\echo '--- settings'
\set QUIET on

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'g')::text, false);
insert into public.lp_settings (user_id, notify_daily, notify_must_watch) values (:'g', false, false);
select test.check((select hide_scores from public.lp_settings), 'scores hidden by default');
select test.expect_error(format('insert into public.lp_settings (user_id) values (%L)', :'e'), 'row-level security');
select set_config('request.jwt.claims', json_build_object('sub', :'e')::text, false);
select test.check((select count(*) = 0 from public.lp_settings), 'cannot see another user''s settings');
reset role;

\set QUIET off
\echo '--- pushes'
\set QUIET on

insert into private.push_config (project_url, secret) values ('https://proj.supabase.co', 'shh');
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'e')::text, false);
select public.save_push_subscription('https://push.example/e', 'k', 'a');
select set_config('request.jwt.claims', json_build_object('sub', :'f')::text, false);
select public.save_push_subscription('https://push.example/f', 'k', 'a');
select set_config('request.jwt.claims', json_build_object('sub', :'g')::text, false);
select public.save_push_subscription('https://push.example/g', 'k', 'a');
select set_config('request.jwt.claims', json_build_object('sub', :'h')::text, false);
select public.save_push_subscription('https://push.example/h', 'k', 'a');
select test.expect_error('select private.lp_send_daily_digest()', 'permission denied');
reset role;

select coalesce(max(id), 0) as before from net.test_requests \gset
select test.check(private.lp_send_daily_digest() = 2, 'digest goes to ranked users who haven''t opted out');
select test.check((select count(*) = 1 from net.test_requests where id > :before), 'in one batch');
select test.check((select body -> 'messages' @> jsonb_build_array(jsonb_build_object('user_id', :'e'))
                          and body -> 'messages' @> jsonb_build_array(jsonb_build_object('user_id', :'f'))
                          and not body::text like '%' || :'g' || '%'
                          and not body::text like '%' || :'h' || '%'
                     from net.test_requests where id > :before), 'not to the opted-out or the unranked');
select test.check((select m ->> 'body' like 'Best game: BOS @ ATL, %'
                     from net.test_requests, jsonb_array_elements(body -> 'messages') m
                    where id > :before and m ->> 'user_id' = :'e'), 'names that user''s best game');
select test.check(private.lp_send_daily_digest() = 0, 'only one digest a day');

select test.check(private.lp_send_must_watch_alerts() = 1, 'must-watch alert for the game tipping soon');
select test.check((select m ->> 'user_id' = :'e' and m ->> 'body' like 'BOS @ ATL at %'
                     from net.test_requests, jsonb_array_elements(body -> 'messages') m
                    where id = (select max(id) from net.test_requests)), 'only the user it''s a must-watch for');
select test.check(private.lp_send_must_watch_alerts() = 0, 'only one alert per game');

set role authenticated;
select test.expect_error($$insert into public.nba_games (id, season, season_type, game_date, tipoff, home_team_id, away_team_id)
                           values ('x', 2027, 2, '2027-01-01', now(), 1, 2)$$, 'permission denied');
select test.expect_error($$update public.nba_games set home_score = 1$$, 'permission denied');
reset role;
delete from private.push_config;

\set QUIET off
\echo '--- game comments'
\set QUIET on

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'e')::text, false);
select public.post_game_comment('p1', '  What a finish  ') as c1 \gset
select test.check((select body = 'What a finish' from public.lp_game_comments where id = :c1), 'posts a comment, trimmed');
select test.expect_error($$select public.post_game_comment('p1', '   ')$$, 'Write something');
select test.expect_error($$select public.post_game_comment('p1', repeat('x', 1001))$$, 'under 1,000');
select test.expect_error($$select public.post_game_comment('nope', 'hi')$$, 'Game not found');
select test.expect_error(format('select public.post_game_comment(%L, %L, %s)', 'g1', 'hi', :c1), 'deleted');
select test.expect_error(format('insert into public.lp_game_comments (game_id, user_id, body) values (%L, %L, %L)', 'p1', :'e', 'x'), 'permission denied');

select set_config('request.jwt.claims', json_build_object('sub', :'f')::text, false);
select test.check((select count(*) = 1 from public.lp_game_comments), 'everyone signed in can read comments');
select public.post_game_comment('p1', 'Agreed', :c1) as r1 \gset
select public.post_game_comment('p1', 'Reply to a reply', :r1) as r2 \gset
select test.check((select parent_id = :c1 from public.lp_game_comments where id = :r2), 'a reply to a reply joins the thread');
select test.expect_error(format('select public.delete_game_comment(%s)', :c1), 'your own');
select test.check((select n_comments = 3 from public.lp_comment_counts(:'today'::date - 1, :'today') where game_id = 'p1'), 'counts comments per game');
select public.post_game_comment('p2', 'one');
select public.post_game_comment('p2', 'two');
select public.post_game_comment('p2', 'three');
select test.expect_error($$select public.post_game_comment('p2', 'four')$$, 'Slow down');

select set_config('request.jwt.claims', json_build_object('sub', :'e')::text, false);
select public.delete_game_comment(:c1);
select test.check((select body is null and deleted_at is not null from public.lp_game_comments where id = :c1),
                  'deleting a comment with replies blanks it');
select test.check((select n_comments = 2 from public.lp_comment_counts(:'today'::date - 1, :'today') where game_id = 'p1'), 'deleted comments don''t count');
select test.expect_error(format('select public.post_game_comment(%L, %L, %s)', 'p1', 'hi', :c1), 'deleted');

select set_config('request.jwt.claims', json_build_object('sub', :'f')::text, false);
select public.delete_game_comment(:r1);
select public.delete_game_comment(:r2);
select test.check((select count(*) = 0 from public.lp_game_comments where game_id = 'p1'), 'the last reply takes the deleted thread with it');
reset role;

\set QUIET off
\echo '--- reply notifications'
\set QUIET on

insert into private.push_config (project_url, secret) values ('https://proj.supabase.co', 'shh');
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'e')::text, false);
select public.post_game_comment('p1', 'Who saw that dunk?') as c2 \gset
select public.post_game_comment('g1', 'Big one tonight') as c3 \gset
reset role;
select coalesce(max(id), 0) as before from net.test_requests \gset
select test.check((select count(*) = 0 from net.test_requests where id > :before), 'a new thread notifies no one');

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'f')::text, false);
select public.post_game_comment('p1', 'It decided the game', :c2);
reset role;
select test.check((select count(*) = 1 from net.test_requests r, jsonb_array_elements(r.body -> 'messages') m
                    where r.id > :before and m ->> 'user_id' = :'e' and m ->> 'url' = 'watch/games/p1'), 'a reply notifies the thread starter');
select test.check((select not body::text like '%decided%' from net.test_requests where id > :before),
                  'no reply text for someone hiding scores once the game has started');
select test.check((select not body::text like '%' || :'f' || '%' from net.test_requests where id > :before), 'not the poster');

select coalesce(max(id), 0) as before from net.test_requests \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'h')::text, false);
select public.post_game_comment('g1', 'Can''t wait', :c3);
reset role;
select test.check((select m ->> 'body' = 'Can''t wait' and m ->> 'title' like 'Hana replied%'
                     from net.test_requests r, jsonb_array_elements(r.body -> 'messages') m
                    where r.id > :before), 'shows the reply before tipoff');

select coalesce(max(id), 0) as before from net.test_requests \gset
set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'e')::text, false);
insert into public.lp_settings (user_id, notify_replies) values (:'e', false);
select set_config('request.jwt.claims', json_build_object('sub', :'h')::text, false);
select public.post_game_comment('g1', 'Seriously', :c3);
reset role;
select test.check((select count(*) = 0 from net.test_requests where id > :before), 'respects turning reply notifications off');
delete from private.push_config;

set role anon;
select test.expect_error('select count(*) from public.lp_game_comments', 'permission denied');
reset role;

\echo 'ALL TESTS PASSED'
