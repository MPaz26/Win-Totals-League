-- Editable display names: league names (commissioner), per-league team names (each manager),
-- and usernames (each user). Names are labels only; every reference is by id
-- (leagues.id and profiles.id are uuids, nba_teams.id is ESPN's team id).

-- A manager's team name in one league, e.g. "Max's Ballers". Null shows the username instead.
alter table public.league_members
  add column team_name text
  check (team_name is null or (char_length(team_name) between 1 and 40 and team_name = btrim(team_name)
                               and team_name !~ '[[:cntrl:]]'));

alter table public.leagues
  add constraint leagues_name_clean check (name = btrim(name) and name !~ '[[:cntrl:]]');

-- Commissioner renames the league, in any status.
create function public.rename_league(p_league uuid, p_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_commissioner(p_league, null);
  update public.leagues set name = btrim(p_name) where id = p_league;
end;
$$;

-- Caller sets (or, with null / blank, clears) their own team name in a league.
create function public.set_team_name(p_league uuid, p_team_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.league_members
     set team_name = nullif(btrim(p_team_name), '')
   where league_id = p_league and user_id = auth.uid();
  if not found then
    raise exception 'League not found';
  end if;
end;
$$;

revoke execute on function public.rename_league(uuid, text), public.set_team_name(uuid, text) from public, anon;
grant execute on function public.rename_league(uuid, text), public.set_team_name(uuid, text) to authenticated;

-- Usernames: users update their own row directly (existing RLS policy), but only the username.
revoke update on public.profiles from anon, authenticated;
grant update (username) on public.profiles to authenticated;

-- Scoreboard gains team_name (appended: create or replace can only add columns at the end).
create or replace view public.league_scoreboard with (security_invoker = true) as
select m.league_id,
       m.user_id,
       p.username,
       m.draft_slot,
       count(dp.team_id)::int            as teams,
       coalesce(sum(s.wins), 0)::int     as wins,
       coalesce(sum(s.losses), 0)::int   as losses,
       rank() over (
         partition by m.league_id
         order by coalesce(sum(s.wins), 0) desc, coalesce(sum(s.losses), 0) asc
       )::int                            as place,
       m.team_name
  from public.league_members m
  join public.profiles p on p.id = m.user_id
  left join public.draft_picks dp on dp.league_id = m.league_id and dp.user_id = m.user_id
  left join public.team_standings s on s.team_id = dp.team_id
 group by m.league_id, m.user_id, p.username, m.draft_slot, m.team_name;
