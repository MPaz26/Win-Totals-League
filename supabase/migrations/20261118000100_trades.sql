-- Trades. Once a league has drafted, a manager can offer any of their NBA teams for any of
-- another manager's (at least one each way, any number). The other manager accepts or declines;
-- the offerer can withdraw it while it's open.
--
-- Scoring follows ownership:
--   * Wins stay with whoever owned the team when they were earned. Nothing moves on a trade.
--   * The new owner counts the team's games from the day after the trade (Eastern), the same
--     rule as the draft: games on the trade day stay with the old owner, so a trade can't be
--     timed around a game in progress.
--   * A team can be traded at most once in any 7 days (168 hours from the accepted trade).
--
-- Ownership is never stored as a "current roster": it's the draft pick, then each accepted
-- trade of that team in order. league_roster_stints spells that out with a record per stint,
-- and league_team_records / league_scoreboard add them up.

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.trades (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references public.leagues (id) on delete cascade,
  proposer_id    uuid not null references public.profiles (id),
  recipient_id   uuid not null references public.profiles (id),
  -- void: a team in it changed hands in another trade before this one was answered
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'canceled', 'void')),
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  -- Accepted trades: the (Eastern) trade day. Games after it count for the new owners.
  effective_date date,
  check (proposer_id <> recipient_id),
  check ((status = 'accepted') = (effective_date is not null)),
  check ((status = 'pending') = (decided_at is null))
);
create index trades_league_idx on public.trades (league_id, created_at desc);

create table public.trade_teams (
  trade_id     uuid not null references public.trades (id) on delete cascade,
  league_id    uuid not null references public.leagues (id) on delete cascade,
  team_id      smallint not null references public.nba_teams (id),
  from_user_id uuid not null references public.profiles (id),
  to_user_id   uuid not null references public.profiles (id),
  primary key (trade_id, team_id),
  check (from_user_id <> to_user_id)
);
create index trade_teams_team_idx on public.trade_teams (league_id, team_id);

alter table public.trades      enable row level security;
alter table public.trade_teams enable row level security;
create policy "members read trades" on public.trades for select to authenticated
  using (public.is_league_member(league_id));
create policy "members read trade teams" on public.trade_teams for select to authenticated
  using (public.is_league_member(league_id));
-- Writes only through the functions below.
revoke insert, update, delete, truncate on public.trades, public.trade_teams from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Ownership and records
-- ---------------------------------------------------------------------------

-- One row per spell of ownership: the drafter's, then one per accepted trade of the team.
-- A stint counts games after start_date through end_date (null = still owned). The open stint
-- takes ESPN's season record minus the games through start_date, so the standings stay the
-- source of truth for current owners; finished stints count their games from nba_games.
drop view public.league_scoreboard;
drop view public.league_team_records;

create view public.league_roster_stints with (security_invoker = true) as
with changes as (
  select dp.league_id, dp.team_id, dp.user_id,
         (coalesce(l.completed_at, now()) at time zone 'America/New_York')::date as start_date,
         '-infinity'::timestamptz as changed_at,
         null::uuid as trade_id
    from public.draft_picks dp
    join public.leagues l on l.id = dp.league_id
  union all
  select tt.league_id, tt.team_id, tt.to_user_id, t.effective_date, t.decided_at, t.id
    from public.trade_teams tt
    join public.trades t on t.id = tt.trade_id
   where t.status = 'accepted'
),
stints as (
  select c.*,
         lead(c.start_date) over w as end_date,
         lead(c.user_id) over w    as next_user_id
    from changes c
  window w as (partition by c.league_id, c.team_id order by c.changed_at)
)
select st.league_id,
       st.team_id,
       st.user_id,
       st.start_date,
       st.end_date,
       st.trade_id,      -- the trade that started this stint; null for the draft
       st.next_user_id,  -- who it was traded to, for a finished stint
       (case when st.end_date is null then greatest(coalesce(s.wins, 0) - g.pre_wins, 0) else g.wins end)::int     as wins,
       (case when st.end_date is null then greatest(coalesce(s.losses, 0) - g.pre_losses, 0) else g.losses end)::int as losses
  from stints st
  left join public.team_standings s on s.team_id = st.team_id
  cross join lateral (
    select count(*) filter (where r.won and r.game_date <= st.start_date)      as pre_wins,
           count(*) filter (where r.lost and r.game_date <= st.start_date)     as pre_losses,
           count(*) filter (where r.won and r.game_date > st.start_date and r.game_date <= st.end_date)  as wins,
           count(*) filter (where r.lost and r.game_date > st.start_date and r.game_date <= st.end_date) as losses
      from (
        select g.game_date,
               (g.home_team_id = st.team_id) = (g.home_score > g.away_score) as won,
               (g.home_team_id = st.team_id) = (g.home_score < g.away_score) as lost
          from public.nba_games g
         where g.season = s.season
           and g.season_type = 2
           and g.status = 'final'
           and st.team_id in (g.home_team_id, g.away_team_id)
           and g.game_date <= coalesce(st.end_date, st.start_date)
      ) r
  ) g;

-- A manager's record with each team they own or have owned in the league. A team traded away
-- keeps the wins it earned for them.
create view public.league_team_records with (security_invoker = true) as
select st.league_id,
       st.user_id,
       st.team_id,
       sum(st.wins)::int                                             as wins,
       sum(st.losses)::int                                           as losses,
       (coalesce(l.completed_at, now()) at time zone 'America/New_York')::date as draft_date,
       bool_or(st.end_date is null)                                  as owned,
       max(st.start_date) filter (where st.trade_id is not null)     as acquired_on,
       case when bool_or(st.end_date is null) then null else max(st.end_date) end as traded_on
  from public.league_roster_stints st
  join public.leagues l on l.id = st.league_id
 group by st.league_id, st.user_id, st.team_id, l.completed_at;

-- Same columns as before. teams = teams owned now; wins and losses include traded-away teams.
create view public.league_scoreboard with (security_invoker = true) as
select m.league_id,
       m.user_id,
       p.username,
       m.draft_slot,
       (count(r.team_id) filter (where r.owned))::int as teams,
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

-- ---------------------------------------------------------------------------
-- Functions
-- ---------------------------------------------------------------------------

create function private.team_owner(p_league uuid, p_team smallint) returns uuid
language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select tt.to_user_id
       from public.trade_teams tt join public.trades t on t.id = tt.trade_id
      where tt.league_id = p_league and tt.team_id = p_team and t.status = 'accepted'
      order by t.decided_at desc limit 1),
    (select user_id from public.draft_picks where league_id = p_league and team_id = p_team));
$$;

-- The manager's team name, or their username.
create function private.manager_name(p_league uuid, p_user uuid) returns text
language sql stable security definer set search_path = '' as $$
  select coalesce(m.team_name, p.username)
    from public.league_members m join public.profiles p on p.id = m.user_id
   where m.league_id = p_league and m.user_id = p_user;
$$;

-- Raises unless every team in the trade still belongs to its sender and is off the 7-day clock.
create function private.check_trade(p_trade uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_row record;
begin
  for v_row in
    select tt.team_id, tt.from_user_id, t.league_id, nt.abbr,
           (select max(t2.decided_at) from public.trade_teams tt2 join public.trades t2 on t2.id = tt2.trade_id
             where tt2.league_id = t.league_id and tt2.team_id = tt.team_id and t2.status = 'accepted') as last_traded
      from public.trade_teams tt
      join public.trades t on t.id = tt.trade_id
      join public.nba_teams nt on nt.id = tt.team_id
     where tt.trade_id = p_trade
  loop
    if private.team_owner(v_row.league_id, v_row.team_id) is distinct from v_row.from_user_id then
      raise exception '% no longer belongs to %', v_row.abbr, private.manager_name(v_row.league_id, v_row.from_user_id);
    end if;
    if v_row.last_traded > now() - interval '7 days' then
      raise exception '% was traded in the last 7 days. It can be traded again %.', v_row.abbr,
        to_char((v_row.last_traded + interval '7 days') at time zone 'America/New_York', 'Mon FMDD "at" FMHH12:MI AM "ET"');
    end if;
  end loop;
end;
$$;

-- "BOS, LAL" for one side of a trade.
create function private.trade_side(p_trade uuid, p_from uuid) returns text
language sql stable security definer set search_path = '' as $$
  select string_agg(nt.abbr, ', ' order by nt.abbr)
    from public.trade_teams tt join public.nba_teams nt on nt.id = tt.team_id
   where tt.trade_id = p_trade and tt.from_user_id = p_from;
$$;

create function public.propose_trade(p_league uuid, p_to uuid, p_give smallint[], p_get smallint[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_league public.leagues;
  v_trade  uuid;
begin
  select * into v_league from public.leagues where id = p_league for update;
  if not found or not public.is_league_member(p_league) then
    raise exception 'League not found';
  end if;
  if v_league.status <> 'complete' then
    raise exception 'Trades open once the draft is done';
  end if;
  if p_to = auth.uid() or not exists (select 1 from public.league_members where league_id = p_league and user_id = p_to) then
    raise exception 'Pick another manager in this league to trade with';
  end if;
  if coalesce(cardinality(p_give), 0) = 0 or coalesce(cardinality(p_get), 0) = 0 then
    raise exception 'A trade needs at least one team going each way';
  end if;
  if (select count(distinct x) from unnest(p_give || p_get) x) <> cardinality(p_give) + cardinality(p_get) then
    raise exception 'Each team can only appear once in a trade';
  end if;

  insert into public.trades (league_id, proposer_id, recipient_id) values (p_league, auth.uid(), p_to)
  returning id into v_trade;
  insert into public.trade_teams (trade_id, league_id, team_id, from_user_id, to_user_id)
  select v_trade, p_league, x, auth.uid(), p_to from unnest(p_give) x
  union all
  select v_trade, p_league, x, p_to, auth.uid() from unnest(p_get) x;
  perform private.check_trade(v_trade);

  perform private.send_push(jsonb_build_array(jsonb_build_object(
    'user_id', p_to,
    'title', 'Trade offer',
    'body', format('%s: %s offers %s for your %s.', v_league.name, private.manager_name(p_league, auth.uid()),
                   private.trade_side(v_trade, auth.uid()), private.trade_side(v_trade, p_to)),
    'url', 'league/' || p_league,
    'tag', 'trade-' || v_trade
  )));
  return v_trade;
end;
$$;

create function public.respond_to_trade(p_trade uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_league public.leagues;
  v_trade  public.trades;
begin
  select l.* into v_league from public.leagues l join public.trades t on t.league_id = l.id where t.id = p_trade
     for update of l;
  select * into v_trade from public.trades where id = p_trade for update;
  if not found or v_trade.recipient_id is distinct from auth.uid() then
    raise exception 'Trade not found';
  end if;
  if v_trade.status <> 'pending' then
    raise exception 'This trade is no longer open';
  end if;

  if not p_accept then
    update public.trades set status = 'declined', decided_at = now() where id = p_trade;
  else
    perform private.check_trade(p_trade);
    update public.trades
       set status = 'accepted', decided_at = now(), effective_date = (now() at time zone 'America/New_York')::date
     where id = p_trade;
    -- Other open offers for these teams can't go through now.
    update public.trades t
       set status = 'void', decided_at = now()
     where t.league_id = v_trade.league_id
       and t.status = 'pending'
       and exists (
         select 1 from public.trade_teams a join public.trade_teams b on b.team_id = a.team_id
          where a.trade_id = t.id and b.trade_id = p_trade);
  end if;

  perform private.send_push(jsonb_build_array(jsonb_build_object(
    'user_id', v_trade.proposer_id,
    'title', case when p_accept then 'Trade accepted' else 'Trade declined' end,
    'body', format('%s: %s %s your %s for %s.', v_league.name, private.manager_name(v_trade.league_id, auth.uid()),
                   case when p_accept then 'accepted' else 'declined' end,
                   private.trade_side(p_trade, v_trade.proposer_id), private.trade_side(p_trade, auth.uid())),
    'url', 'league/' || v_trade.league_id,
    'tag', 'trade-' || p_trade
  )));
end;
$$;

create function public.cancel_trade(p_trade uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.trades set status = 'canceled', decided_at = now()
   where id = p_trade and proposer_id = auth.uid() and status = 'pending';
  if not found then
    raise exception 'This trade is no longer open';
  end if;
end;
$$;

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on function public.propose_trade(uuid, uuid, smallint[], smallint[]), public.respond_to_trade(uuid, boolean),
  public.cancel_trade(uuid) from public, anon;
grant execute on function public.propose_trade(uuid, uuid, smallint[], smallint[]), public.respond_to_trade(uuid, boolean),
  public.cancel_trade(uuid) to authenticated;

-- League pages refresh when a trade is offered or answered.
alter publication supabase_realtime add table public.trades;
