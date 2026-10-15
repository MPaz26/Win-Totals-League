-- League Pass: each user ranks all 30 teams by how much they want to watch them, the app
-- scores every game on the schedule for that user, and they rate games once they're over.
-- Separate from draft leagues: nothing here is per league.
--
-- The schedule lives in nba_games, loaded once per season by the update-games job and then
-- kept current by its daily run. The app only ever reads it from here, never from ESPN.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.nba_games (
  id           text primary key,  -- ESPN event id
  season       smallint not null, -- ESPN convention: 2027 = the 2026-27 season
  season_type  smallint not null check (season_type in (2, 3)),  -- 2 regular season, 3 playoffs
  game_date    date not null,     -- the NBA's (Eastern) calendar day
  tipoff       timestamptz not null,
  home_team_id smallint not null references public.nba_teams (id),
  away_team_id smallint not null references public.nba_teams (id),
  home_score   smallint,
  away_score   smallint,
  status       text not null default 'scheduled'
               check (status in ('scheduled', 'in_progress', 'final', 'postponed', 'canceled')),
  national_tv  text,              -- national broadcasters, e.g. 'ESPN'; these are blacked out on League Pass
  updated_at   timestamptz not null default now(),
  check (home_team_id <> away_team_id)
);
create index nba_games_date_idx on public.nba_games (game_date);
create index nba_games_tipoff_idx on public.nba_games (tipoff);

-- A user's order, 1 = most want to watch. Always all 30 teams or none (set_lp_rankings).
create table public.lp_rankings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  team_id smallint not null references public.nba_teams (id),
  rank    smallint not null check (rank between 1 and 30),
  primary key (user_id, team_id),
  unique (user_id, rank)
);
create index lp_rankings_team_idx on public.lp_rankings (team_id);

create table public.lp_game_ratings (
  user_id  uuid not null references public.profiles (id) on delete cascade,
  game_id  text not null references public.nba_games (id) on delete cascade,
  stars    smallint not null check (stars between 1 and 5),
  rated_at timestamptz not null default now(),
  primary key (user_id, game_id)
);
create index lp_game_ratings_game_idx on public.lp_game_ratings (game_id);

-- No row means the defaults. Written directly by the app (column grants below), like email_preferences.
create table public.lp_settings (
  user_id           uuid primary key references public.profiles (id) on delete cascade,
  hide_scores       boolean not null default true,
  notify_daily      boolean not null default true,
  notify_must_watch boolean not null default true,
  updated_at        timestamptz not null default now()
);

-- One row per push sent ('digest:<user>:<date>', 'must:<user>:<game>'), so nothing goes out twice.
create table private.lp_push_sends (
  key     text primary key,
  sent_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.nba_games       enable row level security;
alter table public.lp_rankings     enable row level security;
alter table public.lp_game_ratings enable row level security;
alter table public.lp_settings     enable row level security;

create policy "games readable" on public.nba_games for select to anon, authenticated using (true);
create policy "own rankings read" on public.lp_rankings for select to authenticated using (user_id = auth.uid());
create policy "own ratings read" on public.lp_game_ratings for select to authenticated using (user_id = auth.uid());
create policy "own lp settings read" on public.lp_settings for select to authenticated
  using (user_id = auth.uid());
create policy "own lp settings insert" on public.lp_settings for insert to authenticated
  with check (user_id = auth.uid());
create policy "own lp settings update" on public.lp_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Games, rankings and ratings are only written by the jobs (service role) and the RPCs below.
revoke insert, update, delete, truncate on public.nba_games, public.lp_rankings, public.lp_game_ratings
  from anon, authenticated;
revoke all on public.lp_settings from anon;
revoke insert, update, delete, truncate on public.lp_settings from authenticated;
-- user_id is updatable only because PostgREST upserts write it back; the policy pins it to the caller.
grant insert (user_id, hide_scores, notify_daily, notify_must_watch, updated_at),
      update (user_id, hide_scores, notify_daily, notify_must_watch, updated_at)
  on public.lp_settings to authenticated;

-- ---------------------------------------------------------------------------
-- Rankings and ratings
-- ---------------------------------------------------------------------------

-- p_order lists all 30 team ids, favorite first.
create function public.set_lp_rankings(p_order smallint[]) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(cardinality(p_order), 0) <> 30
     or (select count(distinct t) from unnest(p_order) t) <> 30
     or exists (select 1 from unnest(p_order) t where not exists (select 1 from public.nba_teams where id = t)) then
    raise exception 'Rankings must list all 30 teams exactly once';
  end if;
  delete from public.lp_rankings where user_id = v_user;
  insert into public.lp_rankings (user_id, team_id, rank)
  select v_user, u.team_id, u.pos
    from unnest(p_order) with ordinality as u (team_id, pos);
end;
$$;

-- Rate a game 1-5, or clear the rating with null. Allowed once the game is final, or 2.5
-- hours after tipoff so people can rate the same night, before the morning load marks it final.
create function public.rate_game(p_game text, p_stars smallint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user uuid := auth.uid();
  v_game public.nba_games;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if p_stars is null then
    delete from public.lp_game_ratings where user_id = v_user and game_id = p_game;
    return;
  end if;
  select * into v_game from public.nba_games where id = p_game;
  if not found then
    raise exception 'Game not found';
  end if;
  if not (v_game.status = 'final'
          or (v_game.status in ('scheduled', 'in_progress') and now() > v_game.tipoff + interval '2 hours 30 minutes')) then
    raise exception 'You can rate a game once it''s over';
  end if;
  insert into public.lp_game_ratings (user_id, game_id, stars)
  values (v_user, p_game, p_stars)
  on conflict (user_id, game_id) do update set stars = excluded.stars, rated_at = now();
end;
$$;

-- Everyone's average rank for each team (rankings themselves are private), plus how
-- everyone has rated that team's games.
create function public.lp_community_rankings()
returns table (team_id smallint, avg_rank numeric, n_users int, avg_stars numeric, n_ratings int)
language sql stable security definer set search_path = '' as $$
  select t.id,
         (select round(avg(r.rank), 1) from public.lp_rankings r where r.team_id = t.id),
         (select count(*)::int from public.lp_rankings r where r.team_id = t.id),
         round(avg(gr.stars), 1),
         count(gr.stars)::int
    from public.nba_teams t
    left join public.nba_games g on t.id in (g.home_team_id, g.away_team_id)
    left join public.lp_game_ratings gr on gr.game_id = g.id
   group by t.id;
$$;

-- ---------------------------------------------------------------------------
-- Watch score: how much p_user should want to watch each game from p_from to p_to (ET dates).
-- Used by the app and by the push senders, so they always agree.
--
-- Per team, from the user's point of view:
--   R  = (31 - rank) / 30: 1.0 for your #1, 0.03 for your #30. No rankings yet? The
--        community order stands in, then last season's wins.
--   my lean / community lean = sum(stars - 3) / (n + k) / 2 over ratings of the team's games
--        in the last 60 days, so roughly -1..1. k (3 for you, 10 for everyone) keeps a single
--        rating from swinging it.
-- Per game, each component 0..1, weighted (weights sum to 1) and scaled to 0..100:
--   appeal      0.65 * best R + 0.35 * other R. Your #1 is worth watching against anyone;
--               two favorites is best.
--   closeness   1 - |rank gap| / 29. Teams you rank close together make a better matchup.
--   my lean     average of both teams, mapped to 0..1.
--   community   the same over everyone's ratings.
--   quality     current records: half "both teams are good", half "records are close". Win%
--               is shrunk toward .500 by 5 games each way so a 2-0 start isn't a juggernaut.
-- ---------------------------------------------------------------------------

create function private.lp_scores(p_user uuid, p_from date, p_to date)
returns table (
  game_id        text,
  game_date      date,
  tipoff         timestamptz,
  status         text,
  home_team_id   smallint,
  away_team_id   smallint,
  home_score     smallint,
  away_score     smallint,
  national_tv    text,
  watch_score    int,
  tier           text,
  home_rank      int,
  away_rank      int,
  appeal         numeric,
  closeness      numeric,
  my_lean        numeric,
  community_lean numeric,
  quality        numeric
)
language sql stable security definer set search_path = '' as $$
  with w as (
    select 0.45 as appeal, 0.10 as closeness, 0.20 as mine, 0.10 as community, 0.15 as quality,
           80 as must, 60 as good
  ),
  community_order as (
    select t.id as team_id,
           row_number() over (order by avg(r.rank) nulls last, t.last_season_wins desc nulls last, t.id)::int as rank
      from public.nba_teams t
      left join public.lp_rankings r on r.team_id = t.id
     group by t.id, t.last_season_wins
  ),
  ranks as (
    select c.team_id, coalesce(r.rank, c.rank)::int as rank
      from community_order c
      left join public.lp_rankings r on r.team_id = c.team_id and r.user_id = p_user
  ),
  team_ratings as (
    select g.home_team_id as team_id, gr.user_id, gr.stars
      from public.lp_game_ratings gr join public.nba_games g on g.id = gr.game_id
     where g.tipoff > now() - interval '60 days'
    union all
    select g.away_team_id, gr.user_id, gr.stars
      from public.lp_game_ratings gr join public.nba_games g on g.id = gr.game_id
     where g.tipoff > now() - interval '60 days'
  ),
  leans as (
    select t.id as team_id,
           coalesce(sum(tr.stars - 3) filter (where tr.user_id = p_user)::numeric
                    / (count(*) filter (where tr.user_id = p_user) + 3) / 2, 0) as mine,
           coalesce(sum(tr.stars - 3)::numeric / (count(tr.stars) + 10) / 2, 0) as community
      from public.nba_teams t
      left join team_ratings tr on tr.team_id = t.id
     group by t.id
  ),
  win_pct as (
    select t.id as team_id,
           (coalesce(s.wins, 0) + 5)::numeric / (coalesce(s.wins, 0) + coalesce(s.losses, 0) + 10) as pct
      from public.nba_teams t
      left join public.team_standings s on s.team_id = t.id
  ),
  parts as (
    select g.*,
           hr.rank as h_rank, ar.rank as a_rank,
           0.65 * greatest(31 - hr.rank, 31 - ar.rank) / 30.0
             + 0.35 * least(31 - hr.rank, 31 - ar.rank) / 30.0 as p_appeal,
           1 - abs(hr.rank - ar.rank) / 29.0 as p_closeness,
           (hl.mine + al.mine) / 2 as p_mine,
           (hl.community + al.community) / 2 as p_community,
           0.5 * (hp.pct + ap.pct) / 2 + 0.5 * (1 - abs(hp.pct - ap.pct)) as p_quality
      from public.nba_games g
      join ranks hr on hr.team_id = g.home_team_id
      join ranks ar on ar.team_id = g.away_team_id
      join leans hl on hl.team_id = g.home_team_id
      join leans al on al.team_id = g.away_team_id
      join win_pct hp on hp.team_id = g.home_team_id
      join win_pct ap on ap.team_id = g.away_team_id
     where g.game_date between p_from and p_to
  ),
  scored as (
    select p.*,
           round(100 * (w.appeal * p.p_appeal
                        + w.closeness * p.p_closeness
                        + w.mine * (p.p_mine + 1) / 2
                        + w.community * (p.p_community + 1) / 2
                        + w.quality * p.p_quality))::int as score
      from parts p cross join w
  )
  select s.id, s.game_date, s.tipoff, s.status, s.home_team_id, s.away_team_id, s.home_score, s.away_score,
         s.national_tv, s.score,
         case when s.score >= w.must then 'must' when s.score >= w.good then 'good' else 'meh' end,
         s.h_rank, s.a_rank,
         round(s.p_appeal, 3), round(s.p_closeness, 3), round(s.p_mine, 3), round(s.p_community, 3), round(s.p_quality, 3)
    from scored s cross join w;
$$;

-- The caller's scored games for a date range (at most a month), best first, with their own rating.
create function public.lp_suggestions(p_from date, p_to date)
returns table (
  game_id        text,
  game_date      date,
  tipoff         timestamptz,
  status         text,
  home_team_id   smallint,
  away_team_id   smallint,
  home_score     smallint,
  away_score     smallint,
  national_tv    text,
  watch_score    int,
  tier           text,
  home_rank      int,
  away_rank      int,
  appeal         numeric,
  closeness      numeric,
  my_lean        numeric,
  community_lean numeric,
  quality        numeric,
  my_stars       smallint
)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null then
    raise exception 'Not signed in';
  end if;
  if p_to < p_from or p_to - p_from > 31 then
    raise exception 'Pick a date range of up to a month';
  end if;
  return query
    select s.*, gr.stars
      from private.lp_scores(auth.uid(), p_from, p_to) s
      left join public.lp_game_ratings gr on gr.game_id = s.game_id and gr.user_id = auth.uid()
     order by s.watch_score desc, s.tipoff, s.game_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Push notifications (scheduled by 20261018000100_league_pass_cron.sql). Only users who have
-- ranked their teams get them, so turning on draft notifications doesn't sign you up.
-- ---------------------------------------------------------------------------

-- "Tonight's best" for each opted-in user with games on today's (ET) slate. Returns how many it queued.
create function private.lp_send_daily_digest() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_today    date := (now() at time zone 'America/New_York')::date;
  v_user     uuid;
  v_best     record;
  v_more     int;
  v_messages jsonb := '[]';
begin
  for v_user in
    select distinct ps.user_id
      from public.push_subscriptions ps
      left join public.lp_settings st on st.user_id = ps.user_id
     where coalesce(st.notify_daily, true)
       and exists (select 1 from public.lp_rankings r where r.user_id = ps.user_id)
  loop
    select s.*, h.abbr as home_abbr, a.abbr as away_abbr into v_best
      from private.lp_scores(v_user, v_today, v_today) s
      join public.nba_teams h on h.id = s.home_team_id
      join public.nba_teams a on a.id = s.away_team_id
     where s.status = 'scheduled' and s.tipoff > now()
     order by s.watch_score desc, s.tipoff
     limit 1;
    continue when not found;

    insert into private.lp_push_sends (key) values (format('digest:%s:%s', v_user, v_today)) on conflict do nothing;
    continue when not found;

    select count(*) - (case when v_best.tier = 'must' then 1 else 0 end) into v_more
      from private.lp_scores(v_user, v_today, v_today) s
     where s.status = 'scheduled' and s.tipoff > now() and s.tier = 'must';

    v_messages := v_messages || jsonb_build_object(
      'user_id', v_user,
      'title', 'Tonight on League Pass',
      'body', format('Best game: %s @ %s, %s ET (%s)%s',
                     v_best.away_abbr, v_best.home_abbr,
                     to_char(v_best.tipoff at time zone 'America/New_York', 'FMHH12:MI AM'),
                     v_best.watch_score,
                     case when v_more > 0 then format(' · +%s more must-watch', v_more) else '' end),
      'url', 'watch',
      'tag', 'lp-digest',
      'ttl', 6 * 3600
    );
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform private.send_push(v_messages);
  end if;
  return jsonb_array_length(v_messages);
end;
$$;

-- Must-watch games (score >= 80 for that user) tipping off in 20-35 minutes. Runs every 10
-- minutes, so the window overlaps and the send log keeps it to one alert per game.
create function private.lp_send_must_watch_alerts() returns int
language plpgsql security definer set search_path = '' as $$
declare
  v_from     date;
  v_to       date;
  v_user     uuid;
  v_game     record;
  v_messages jsonb := '[]';
begin
  select min(game_date), max(game_date) into v_from, v_to
    from public.nba_games
   where status = 'scheduled' and tipoff between now() + interval '20 minutes' and now() + interval '35 minutes';
  if v_from is null then
    return 0;
  end if;

  for v_user in
    select distinct ps.user_id
      from public.push_subscriptions ps
      left join public.lp_settings st on st.user_id = ps.user_id
     where coalesce(st.notify_must_watch, true)
       and exists (select 1 from public.lp_rankings r where r.user_id = ps.user_id)
  loop
    for v_game in
      select s.*, h.abbr as home_abbr, a.abbr as away_abbr
        from private.lp_scores(v_user, v_from, v_to) s
        join public.nba_teams h on h.id = s.home_team_id
        join public.nba_teams a on a.id = s.away_team_id
       where s.status = 'scheduled' and s.tier = 'must'
         and s.tipoff between now() + interval '20 minutes' and now() + interval '35 minutes'
    loop
      insert into private.lp_push_sends (key) values (format('must:%s:%s', v_user, v_game.game_id)) on conflict do nothing;
      continue when not found;
      v_messages := v_messages || jsonb_build_object(
        'user_id', v_user,
        'title', 'Must-watch tips soon',
        'body', format('%s @ %s at %s ET (%s)%s', v_game.away_abbr, v_game.home_abbr,
                       to_char(v_game.tipoff at time zone 'America/New_York', 'FMHH12:MI AM'),
                       v_game.watch_score,
                       case when v_game.national_tv is not null then format(' · on %s', v_game.national_tv) else '' end),
        'url', 'watch',
        'tag', 'lp-must-' || v_game.game_id,
        'ttl', 2 * 3600
      );
    end loop;
  end loop;

  if jsonb_array_length(v_messages) > 0 then
    perform private.send_push(v_messages);
  end if;
  return jsonb_array_length(v_messages);
end;
$$;

-- ---------------------------------------------------------------------------
-- Function privileges (see init.sql: lock down, then grant back what the app calls).
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function
  public.set_lp_rankings(smallint[]),
  public.rate_game(text, smallint),
  public.lp_community_rankings(),
  public.lp_suggestions(date, date)
from public, anon;
grant execute on function
  public.set_lp_rankings(smallint[]),
  public.rate_game(text, smallint),
  public.lp_community_rankings(),
  public.lp_suggestions(date, date)
to authenticated;
