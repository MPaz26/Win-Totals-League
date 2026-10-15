-- Watch score leans harder on the user's own rankings. Before, rankings were 45% and the two
-- rating leans each gave half credit to every game nobody had rated yet, so scores bunched in the
-- middle and two teams you rank near the top (#3 vs #5) fell short of must-watch.
--
-- Now the base score is rankings, closeness and records only, and ratings nudge it up or down:
--   appeal      0.75 * (0.65 * best R + 0.35 * other R)
--   closeness   0.10 * (1 - |rank gap| / 29)
--   quality     0.15 * records, as before
--   my lean     +/- 0.10 * lean (-1..1): no ratings yet means no change
--   community   +/- 0.05 * lean
-- clamped to 0..100. The rating swing is the same as before; it just no longer pads every game.

create or replace function private.lp_scores(p_user uuid, p_from date, p_to date)
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
    select 0.75 as appeal, 0.10 as closeness, 0.10 as mine, 0.05 as community, 0.15 as quality,
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
           greatest(0, least(100, round(100 * (w.appeal * p.p_appeal
                                                + w.closeness * p.p_closeness
                                                + w.quality * p.p_quality
                                                + w.mine * p.p_mine
                                                + w.community * p.p_community))))::int as score
      from parts p cross join w
  )
  select s.id, s.game_date, s.tipoff, s.status, s.home_team_id, s.away_team_id, s.home_score, s.away_score,
         s.national_tv, s.score,
         case when s.score >= w.must then 'must' when s.score >= w.good then 'good' else 'meh' end,
         s.h_rank, s.a_rank,
         round(s.p_appeal, 3), round(s.p_closeness, 3), round(s.p_mine, 3), round(s.p_community, 3), round(s.p_quality, 3)
    from scored s cross join w;
$$;
