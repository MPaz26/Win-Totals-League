-- End-to-end draft scenario against the real migration. Run with `make test-db`.
-- Each step switches to the `authenticated` role with a JWT `sub`, the same way PostgREST does.
\set ON_ERROR_STOP on
\set QUIET on
\pset tuples_only on

\set a '00000000-0000-0000-0000-00000000000a'
\set b '00000000-0000-0000-0000-00000000000b'
\set c '00000000-0000-0000-0000-00000000000c'
\set d '00000000-0000-0000-0000-00000000000d'

create schema test;
grant usage on schema test to authenticated, anon;

-- Runs p_sql and fails the test unless it raises an error matching p_pattern.
create function test.expect_error(p_sql text, p_pattern text) returns void
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

create function test.check(p_ok boolean, p_what text) returns void
language plpgsql as $$
begin
  if p_ok is distinct from true then raise exception 'FAILED: %', p_what; end if;
  raise notice 'ok - %', p_what;
end;
$$;
grant execute on all functions in schema test to authenticated, anon;

-- Makes a deadline already expired, as if the pick clock ran out.
create function test.expire(p_league uuid) returns void language sql as $$
  update public.leagues set pick_deadline = now() - interval '1 second' where id = p_league;
$$;

insert into auth.users (id, email) values
  (:'a', 'a@x.test'), (:'b', 'b@x.test'), (:'c', 'c@x.test'), (:'d', 'd@x.test');
insert into public.profiles (id, username) values
  (:'a', 'Alice'), (:'b', 'Bob'), (:'c', 'Cara'), (:'d', 'Dan');
-- Lets the on-the-clock trigger queue pushes (into the shim's net.test_requests).
insert into private.push_config (project_url, secret) values ('https://proj.supabase.co', 'shh');

\set QUIET off
\echo '--- lobby'
\set QUIET on

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);
select public.create_league('Test League', true, 'manual', 30) as league \gset
select invite_code from public.leagues where id = :'league' \gset
select test.check((select count(*) = 1 from public.league_members where league_id = :'league'), 'commissioner auto-joins');

select set_config('request.jwt.claims', json_build_object('sub', :'b')::text, false);
select test.check((select count(*) = 0 from public.leagues), 'non-member cannot read the league');
select test.check((select name = 'Test League' and member_count = 1 and not is_member
                     from public.league_preview(:'invite_code')), 'preview works before joining');
select public.join_league(:'invite_code');
select public.join_league(:'invite_code');  -- idempotent
select test.check((select count(*) = 1 from public.leagues), 'member can read the league');
select test.expect_error(format('select public.start_draft(%L)', :'league'), 'Only the commissioner');
select test.expect_error(format('insert into public.draft_picks values (%L, 1, %L, 1)', :'league', :'b'),
                         'row-level security');

select set_config('request.jwt.claims', json_build_object('sub', :'c')::text, false);
select public.join_league(:'invite_code');
select test.expect_error(format('select public.remove_member(%L, %L)', :'league', :'b'), 'Only the commissioner');

select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);
select test.expect_error(format('select public.set_draft_order(%L, array[%L]::uuid[])', :'league', :'a'),
                         'every member exactly once');
select public.set_draft_order(:'league', array[:'c', :'a', :'b']::uuid[]);
select public.start_draft(:'league');

\set QUIET off
\echo '--- draft'
\set QUIET on

select test.check((select status = 'drafting' and current_pick = 1 and pick_deadline > now()
                     from public.leagues where id = :'league'), 'draft started with a deadline');
select test.expect_error(format('select public.make_pick(%L, 25::smallint)', :'league'), 'not your turn');

select set_config('request.jwt.claims', json_build_object('sub', :'d')::text, false);
select test.expect_error(format('select public.join_league(%L)', :'invite_code'), 'already started');
select test.expect_error(format('select public.make_pick(%L, 25::smallint)', :'league'), 'League not found');

select set_config('request.jwt.claims', json_build_object('sub', :'c')::text, false);
select public.make_pick(:'league', 25::smallint);                         -- pick 1: Cara takes OKC

select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);
select test.expect_error(format('select public.make_pick(%L, 25::smallint)', :'league'), 'already been drafted');
select public.make_pick(:'league', 24::smallint);                         -- pick 2: Alice

select set_config('request.jwt.claims', json_build_object('sub', :'b')::text, false);
select public.make_pick(:'league', 8::smallint);                          -- pick 3: Bob
select public.make_pick(:'league', 2::smallint);                          -- pick 4: Bob again (snake)
select test.check((select array_agg(user_id order by pick_number) = array[:'c', :'a', :'b', :'b']::uuid[]
                     from public.draft_picks where league_id = :'league'), 'snake order C,A,B,B');
reset role;
select test.check((select array_agg((body->'messages'->0->>'user_id')::uuid order by id) = array[:'c', :'a', :'b', :'a']::uuid[]
                     from net.test_requests), 'on-the-clock pushes C,A,B,A (none for Bob''s back-to-back turn)');
select test.check((select url = 'https://proj.supabase.co/functions/v1/send-push' and headers->>'x-push-secret' = 'shh'
                          and body->'messages'->0->>'body' = 'Test League: pick 5, round 2. 30 seconds to pick.'
                     from net.test_requests order by id desc limit 1), 'push goes to send-push with the secret and pick details');
set role authenticated;

select test.check(not public.autopick_if_expired(:'league'), 'no autopick before the deadline');
reset role;
select test.expire(:'league');
set role authenticated;
select test.check(public.autopick_if_expired(:'league'), 'autopick after the deadline');
select test.check(not public.autopick_if_expired(:'league'), 'autopick is idempotent');
-- pick 5 belonged to Alice; best remaining by last season = DEN (54).
select test.check((select user_id = :'a' and team_id = 7 and auto
                     from public.draft_picks where league_id = :'league' and pick_number = 5),
                  'autopick took best available for the right user');

-- Let the cron backstop finish the draft.
reset role;
do $$
declare v_league uuid := (select id from public.leagues where name = 'Test League');
begin
  while (select status from public.leagues where id = v_league) = 'drafting' loop
    perform test.expire(v_league);
    perform private.autopick_expired_leagues();
  end loop;
end $$;
set role authenticated;

select test.check((select status = 'complete' and pick_deadline is null from public.leagues where id = :'league'),
                  'draft completes after 30 picks');
reset role;
-- Picks 6 and 7 are both Cara's; pick 6 was an autopick, so she isn't watching and still gets told.
select test.check((select count(*) = 1 from net.test_requests where body->'messages'->0->>'body' like 'Test League: pick 7,%'),
                  'back-to-back turn after an autopick still notifies');
set role authenticated;
select test.check((select count(*) = 30 and count(distinct team_id) = 30
                     from public.draft_picks where league_id = :'league'), 'all 30 teams drafted once');
select test.check((select array_agg(teams order by teams) = array[10, 10, 10]
                     from public.league_scoreboard where league_id = :'league'), '3 members get 10 each');

\set QUIET off
\echo '--- scoreboard'
\set QUIET on

reset role;
insert into public.team_standings (team_id, season, wins, losses)
select id, 2027, id % 5, 1 from public.nba_teams;
set role authenticated;
select test.check((select sum(wins) = (select sum(id % 5) from public.nba_teams)
                     from public.league_scoreboard where league_id = :'league'), 'scoreboard sums wins');
select test.check((select min(place) = 1 from public.league_scoreboard where league_id = :'league'), 'places ranked');
select set_config('request.jwt.claims', json_build_object('sub', :'d')::text, false);
select test.check((select count(*) = 0 from public.league_scoreboard), 'non-member sees no scoreboard');
select test.expect_error('insert into public.team_standings values (1, 2027, 99, 0)', 'row-level security');

\set QUIET off
\echo '--- uneven rosters, linear order, random start'
\set QUIET on

select public.create_league('Four', false, 'random', 0) as four \gset
select invite_code as four_code from public.leagues where id = :'four' \gset
select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);
select public.join_league(:'four_code');
select set_config('request.jwt.claims', json_build_object('sub', :'b')::text, false);
select public.join_league(:'four_code');
select set_config('request.jwt.claims', json_build_object('sub', :'c')::text, false);
select public.join_league(:'four_code');
select public.remove_member(:'four', :'c');                                -- leave
select test.check((select count(*) = 0 from public.leagues where id = :'four'), 'left league is hidden');
select public.join_league(:'four_code');
select set_config('request.jwt.claims', json_build_object('sub', :'d')::text, false);
select public.start_draft(:'four');
select test.check((select pick_deadline is null from public.leagues where id = :'four'), 'no timer when pick_seconds = 0');
select test.check((select array_agg(draft_slot order by draft_slot) = array[1, 2, 3, 4]::smallint[]
                     from public.league_members where league_id = :'four'), 'slots are 1..4 after shuffle');

reset role;
-- Draft it by hand in linear order: each pick goes to whoever is on the clock.
do $$
declare
  v_league uuid := (select id from public.leagues where name = 'Four');
  v_user uuid;
  v_team smallint;
begin
  while (select status from public.leagues where id = v_league) = 'drafting' loop
    v_user := private.on_clock_user(v_league);
    v_team := (select min(id) from public.nba_teams t
                where not exists (select 1 from public.draft_picks p where p.league_id = v_league and p.team_id = t.id));
    perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
    perform public.make_pick(v_league, v_team);
  end loop;
end $$;
select test.check((select array_agg(teams order by teams) = array[7, 7, 8, 8]
                     from public.league_scoreboard where league_id = :'four'), '30 teams / 4 = 8,8,7,7');
select test.check((select array_agg(m.draft_slot order by p.pick_number) = array[1,2,3,4,1,2,3,4]::smallint[]
                     from public.draft_picks p join public.league_members m using (league_id, user_id)
                    where p.league_id = :'four' and p.pick_number <= 8), 'linear order repeats 1..4');

\set QUIET off
\echo '--- privileges'
\set QUIET on

set role anon;
select test.expect_error(format('select public.make_pick(%L, 1::smallint)', :'league'), 'permission denied');
select test.check((select count(*) = 30 from public.nba_teams), 'anon can read teams');
set role authenticated;
select test.expect_error('select private.autopick_expired_leagues()', 'permission denied');
reset role;

\set QUIET off
\echo '--- email preferences'
\set QUIET on

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);
insert into public.email_preferences (user_id, weekly_recap) values (:'a', true)
  on conflict (user_id) do update set user_id = excluded.user_id, weekly_recap = excluded.weekly_recap;
select test.check((select weekly_recap from public.email_preferences), 'user can upsert own prefs');
select test.expect_error(format('insert into public.email_preferences (user_id) values (%L)', :'b'), 'row-level security');
select test.expect_error(format('update public.email_preferences set unsubscribe_token = gen_random_uuid() where user_id = %L', :'a'),
                         'permission denied');
select set_config('request.jwt.claims', json_build_object('sub', :'b')::text, false);
select test.check((select count(*) = 0 from public.email_preferences), 'cannot read another user''s token');
reset role;

select unsubscribe_token as token from public.email_preferences where user_id = :'a' \gset
set role anon;
select test.check(public.unsubscribe_weekly_recap(:'token'), 'signed-out unsubscribe by token');
select test.check(not public.unsubscribe_weekly_recap(gen_random_uuid()), 'unknown token is a no-op');
reset role;
select test.check((select not weekly_recap from public.email_preferences where user_id = :'a'), 'unsubscribe sticks');
set role authenticated;
select test.expect_error('select * from public.recap_sends', 'permission denied');
reset role;

\set QUIET off
\echo '--- editable names'
\set QUIET on

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);
select public.rename_league(:'league', '  Renamed League  ');
select test.check((select name = 'Renamed League' from public.leagues where id = :'league'), 'commissioner renames after the draft, trimmed');
select test.expect_error(format('select public.rename_league(%L, %L)', :'league', '   '), 'check constraint');
select test.expect_error(format('select public.rename_league(%L, %L)', :'league', E'bad\tname'), 'check constraint');
select set_config('request.jwt.claims', json_build_object('sub', :'b')::text, false);
select test.expect_error(format('select public.rename_league(%L, %L)', :'league', 'Hijacked'), 'Only the commissioner');

select public.set_team_name(:'league', '  Bob''s Ballers ');
select test.check((select team_name = 'Bob''s Ballers' from public.league_scoreboard where league_id = :'league' and user_id = :'b'),
                  'member sets own team name, trimmed, on the scoreboard');
select test.check((select team_name is null from public.league_members where league_id = :'league' and user_id = :'a'),
                  'only the caller''s row changes');
select test.expect_error(format('select public.set_team_name(%L, %L)', :'league', repeat('x', 41)), 'check constraint');
select public.set_team_name(:'league', '');
select test.check((select team_name is null from public.league_members where league_id = :'league' and user_id = :'b'), 'blank clears it');
select set_config('request.jwt.claims', json_build_object('sub', :'d')::text, false);
select test.expect_error(format('select public.set_team_name(%L, %L)', :'league', 'Gatecrashers'), 'League not found');

select set_config('request.jwt.claims', json_build_object('sub', :'b')::text, false);
update public.profiles set username = 'Bobby' where id = :'b';
select test.check((select username = 'Bobby' from public.profiles where id = :'b'), 'user renames self');
update public.profiles set username = 'Pwned' where id = :'a';
select test.check((select username = 'Alice' from public.profiles where id = :'a'), 'cannot rename someone else');
select test.expect_error(format('update public.profiles set username = %L where id = %L', 'CARA', :'b'), 'duplicate key');
select test.expect_error(format('update public.profiles set created_at = now() where id = %L', :'b'), 'permission denied');
select test.check((select username = 'Bobby' and teams > 0 from public.league_scoreboard where league_id = :'league' and user_id = :'b'),
                  'renamed user keeps their picks (joined by id, not name)');
reset role;

\set QUIET off
\echo '--- push subscriptions'
\set QUIET on

set role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', :'a')::text, false);
select public.save_push_subscription('https://push.example/1', 'key', 'auth');
select test.check((select count(*) = 1 and min(user_id::text) = :'a' from public.push_subscriptions), 'user saves a device');
select test.expect_error(format('insert into public.push_subscriptions values (%L, %L, %L, %L)', 'https://push.example/2', :'a', 'k', 'x'),
                         'permission denied');
select set_config('request.jwt.claims', json_build_object('sub', :'b')::text, false);
select test.check((select count(*) = 0 from public.push_subscriptions), 'cannot see another user''s devices');
select public.delete_push_subscription('https://push.example/1');
reset role;
select test.check((select count(*) = 1 from public.push_subscriptions), 'cannot delete another user''s device by endpoint');
set role authenticated;
select public.save_push_subscription('https://push.example/1', 'key2', 'auth2');
select test.check((select count(*) = 1 and min(user_id::text) = :'b' and min(p256dh) = 'key2' from public.push_subscriptions),
                  'a device moves to whoever turns notifications on there');
select public.delete_push_subscription('https://push.example/1');
select test.check((select count(*) = 0 from public.push_subscriptions), 'user removes own device');
select test.expect_error($$select private.send_push('[]')$$, 'permission denied');
select test.expect_error('select * from private.push_config', 'permission denied');
reset role;

delete from private.push_config;
select count(*) as queued from net.test_requests \gset
select private.send_push('[{"user_id": "00000000-0000-0000-0000-00000000000a"}]');
select test.check((select count(*) = :queued from net.test_requests), 'nothing is queued until push is configured');

\echo 'ALL TESTS PASSED'
