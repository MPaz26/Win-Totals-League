-- Wins count from the day after the draft. A league drafted mid-season used to start with every
-- win its teams already had; now a team's record in a league is its season record minus the
-- regular-season games played on or before the draft's (Eastern) calendar day, games that day
-- included. Leagues drafted before the season subtract nothing, so they read exactly as before.
-- Applies to every league, existing ones too, without changing any league data: it is computed
-- from leagues.completed_at and the schedule in nba_games.
--
-- The season record (team_standings) stays the source of truth and only the pre-draft games come
-- from nba_games, so a game missing from the stored schedule can't cost a league a win. A league
-- still drafting counts nothing yet.

-- One row per drafted team: its record since the draft, in that league.
-- security_invoker: the caller's RLS applies, so you only see leagues you're in.
create view public.league_team_records with (security_invoker = true) as
select dp.league_id,
       dp.user_id,
       dp.team_id,
       -- greatest(): for a few minutes on draft night a game can be final on the scoreboard
       -- before ESPN's standings count it.
       greatest(coalesce(s.wins, 0) - pre.wins, 0)::int     as wins,
       greatest(coalesce(s.losses, 0) - pre.losses, 0)::int as losses,
       d.draft_date
  from public.draft_picks dp
  join public.leagues l on l.id = dp.league_id
  cross join lateral (
    select (coalesce(l.completed_at, now()) at time zone 'America/New_York')::date as draft_date
  ) d
  left join public.team_standings s on s.team_id = dp.team_id
  cross join lateral (
    select count(*) filter (where (g.home_team_id = dp.team_id) = (g.home_score > g.away_score)) as wins,
           count(*) filter (where (g.home_team_id = dp.team_id) = (g.home_score < g.away_score)) as losses
      from public.nba_games g
     where g.season = s.season
       and g.season_type = 2
       and g.status = 'final'
       and g.game_date <= d.draft_date
       and dp.team_id in (g.home_team_id, g.away_team_id)
  ) pre;

-- Same columns as before; wins and losses now come from league_team_records.
create or replace view public.league_scoreboard with (security_invoker = true) as
select m.league_id,
       m.user_id,
       p.username,
       m.draft_slot,
       count(r.team_id)::int             as teams,
       coalesce(sum(r.wins), 0)::int     as wins,
       coalesce(sum(r.losses), 0)::int   as losses,
       rank() over (
         partition by m.league_id
         order by coalesce(sum(r.wins), 0) desc, coalesce(sum(r.losses), 0) asc
       )::int                            as place,
       m.team_name
  from public.league_members m
  join public.profiles p on p.id = m.user_id
  left join public.league_team_records r on r.league_id = m.league_id and r.user_id = m.user_id
 group by m.league_id, m.user_id, p.username, m.draft_slot, m.team_name;
