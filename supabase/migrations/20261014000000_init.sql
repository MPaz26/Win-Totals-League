-- NBA draft win-totals league: schema, RLS, and draft RPCs.
--
-- Clients never write tables directly. Every mutation goes through a SECURITY DEFINER
-- function below, which checks the caller (auth.uid()) and locks the league row so
-- concurrent picks can't double-draft a team or skip a turn.

create schema if not exists private;
revoke all on schema private from public;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null check (username ~ '^[A-Za-z0-9_. -]{2,24}$'),
  created_at timestamptz not null default now()
);
create unique index profiles_username_key on public.profiles (lower(username));

-- id is ESPN's team id, so the standings job can match rows without a lookup table.
create table public.nba_teams (
  id               smallint primary key,
  abbr             text not null unique,
  name             text not null,
  conference       text not null check (conference in ('East', 'West')),
  last_season_wins smallint  -- autopick ranking: best available = most wins last season
);

create table public.team_standings (
  team_id    smallint primary key references public.nba_teams (id),
  season     smallint not null,  -- ESPN convention: 2027 = the 2026-27 season
  wins       smallint not null,
  losses     smallint not null,
  updated_at timestamptz not null default now()
);

create table public.team_standings_history (
  snapshot_date date not null,
  team_id       smallint not null references public.nba_teams (id),
  season        smallint not null,
  wins          smallint not null,
  losses        smallint not null,
  primary key (snapshot_date, team_id)
);

create table public.leagues (
  id             uuid primary key default gen_random_uuid(),
  name           text not null check (char_length(name) between 1 and 60),
  commissioner_id uuid not null references public.profiles (id),
  invite_code    text not null unique default substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  status         text not null default 'lobby' check (status in ('lobby', 'drafting', 'complete')),
  snake          boolean not null default true,
  order_mode     text not null default 'random' check (order_mode in ('random', 'manual')),
  pick_seconds   integer not null default 90 check (pick_seconds = 0 or pick_seconds between 10 and 86400),
  current_pick   smallint not null default 0,  -- overall pick on the clock (1-based); 0 = not started
  pick_deadline  timestamptz,                  -- null when there's no timer or no pick on the clock
  created_at     timestamptz not null default now(),
  started_at     timestamptz,
  completed_at   timestamptz
);

create table public.league_members (
  league_id  uuid not null references public.leagues (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  draft_slot smallint not null,
  joined_at  timestamptz not null default now(),
  primary key (league_id, user_id),
  -- deferred so reorders can permute slots in a single UPDATE
  unique (league_id, draft_slot) deferrable initially deferred
);
create index league_members_user_idx on public.league_members (user_id);

create table public.draft_picks (
  league_id   uuid not null references public.leagues (id) on delete cascade,
  pick_number smallint not null check (pick_number between 1 and 30),
  user_id     uuid not null references public.profiles (id),
  team_id     smallint not null references public.nba_teams (id),
  auto        boolean not null default false,
  picked_at   timestamptz not null default now(),
  primary key (league_id, pick_number),
  unique (league_id, team_id)
);
create index draft_picks_user_idx on public.draft_picks (league_id, user_id);

-- ---------------------------------------------------------------------------
-- Seed: the 30 franchises. last_season_wins = 2025-26 final regular-season wins (ESPN).
-- ---------------------------------------------------------------------------

insert into public.nba_teams (id, abbr, name, conference, last_season_wins) values
  (1,  'ATL',  'Atlanta Hawks',          'East', 46),
  (2,  'BOS',  'Boston Celtics',         'East', 56),
  (3,  'NO',   'New Orleans Pelicans',   'West', 26),
  (4,  'CHI',  'Chicago Bulls',          'East', 31),
  (5,  'CLE',  'Cleveland Cavaliers',    'East', 52),
  (6,  'DAL',  'Dallas Mavericks',       'West', 26),
  (7,  'DEN',  'Denver Nuggets',         'West', 54),
  (8,  'DET',  'Detroit Pistons',        'East', 60),
  (9,  'GS',   'Golden State Warriors',  'West', 37),
  (10, 'HOU',  'Houston Rockets',        'West', 52),
  (11, 'IND',  'Indiana Pacers',         'East', 19),
  (12, 'LAC',  'LA Clippers',            'West', 42),
  (13, 'LAL',  'Los Angeles Lakers',     'West', 53),
  (14, 'MIA',  'Miami Heat',             'East', 43),
  (15, 'MIL',  'Milwaukee Bucks',        'East', 32),
  (16, 'MIN',  'Minnesota Timberwolves', 'West', 49),
  (17, 'BKN',  'Brooklyn Nets',          'East', 20),
  (18, 'NY',   'New York Knicks',        'East', 53),
  (19, 'ORL',  'Orlando Magic',          'East', 45),
  (20, 'PHI',  'Philadelphia 76ers',     'East', 45),
  (21, 'PHX',  'Phoenix Suns',           'West', 45),
  (22, 'POR',  'Portland Trail Blazers', 'West', 42),
  (23, 'SAC',  'Sacramento Kings',       'West', 22),
  (24, 'SA',   'San Antonio Spurs',      'West', 62),
  (25, 'OKC',  'Oklahoma City Thunder',  'West', 64),
  (26, 'UTAH', 'Utah Jazz',              'West', 22),
  (27, 'WSH',  'Washington Wizards',     'East', 17),
  (28, 'TOR',  'Toronto Raptors',        'East', 46),
  (29, 'MEM',  'Memphis Grizzlies',      'West', 25),
  (30, 'CHA',  'Charlotte Hornets',      'East', 44);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.is_league_member(p_league uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.league_members where league_id = p_league and user_id = auth.uid()
  );
$$;

-- Which 1-based draft slot owns overall pick p_pick. Snake reverses every other round.
create function public.slot_for_pick(p_pick int, p_members int, p_snake boolean) returns int
language sql immutable set search_path = '' as $$
  select case
    when p_snake and ((p_pick - 1) / p_members) % 2 = 1 then p_members - ((p_pick - 1) % p_members)
    else ((p_pick - 1) % p_members) + 1
  end;
$$;

create function public.server_now() returns timestamptz
language sql stable set search_path = '' as $$ select now(); $$;

create function private.on_clock_user(p_league uuid) returns uuid
language sql stable set search_path = '' as $$
  select m.user_id
  from public.leagues l
  join public.league_members m on m.league_id = l.id
  where l.id = p_league
    and m.draft_slot = public.slot_for_pick(
      l.current_pick,
      (select count(*)::int from public.league_members where league_id = p_league),
      l.snake);
$$;

-- Moves the clock to the next pick, or completes the draft after the last team goes.
create function private.advance_pick(p_league uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_next int;
  v_secs int;
begin
  select current_pick + 1, pick_seconds into v_next, v_secs from public.leagues where id = p_league;
  if v_next > (select count(*) from public.nba_teams) then
    update public.leagues
       set status = 'complete', current_pick = v_next, pick_deadline = null, completed_at = now()
     where id = p_league;
  else
    update public.leagues
       set current_pick = v_next,
           pick_deadline = case when v_secs > 0 then now() + make_interval(secs => v_secs) end
     where id = p_league;
  end if;
end;
$$;

-- Picks the best available team for whoever is on the clock, if their time is up.
-- Returns true if it made a pick. Takes the league row lock itself.
create function private.autopick(p_league uuid) returns boolean
language plpgsql set search_path = '' as $$
declare
  v_league public.leagues;
  v_team   smallint;
begin
  select * into v_league from public.leagues where id = p_league for update;
  if v_league.status is distinct from 'drafting'
     or v_league.pick_deadline is null
     or v_league.pick_deadline > now() then
    return false;
  end if;

  select t.id into v_team
    from public.nba_teams t
   where not exists (select 1 from public.draft_picks p where p.league_id = p_league and p.team_id = t.id)
   order by t.last_season_wins desc nulls last, t.name
   limit 1;

  insert into public.draft_picks (league_id, pick_number, user_id, team_id, auto)
  values (p_league, v_league.current_pick, private.on_clock_user(p_league), v_team, true);
  perform private.advance_pick(p_league);
  return true;
end;
$$;

-- pg_cron backstop (see the cron migration): autopicks for leagues where nobody is online.
create function private.autopick_expired_leagues() returns int
language plpgsql set search_path = '' as $$
declare
  v_id    uuid;
  v_count int := 0;
begin
  for v_id in
    select id from public.leagues where status = 'drafting' and pick_deadline < now()
  loop
    if private.autopick(v_id) then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

create function private.require_commissioner(p_league uuid, p_status text default 'lobby')
returns public.leagues
language plpgsql set search_path = '' as $$
declare
  v_league public.leagues;
begin
  select * into v_league from public.leagues where id = p_league for update;
  if not found or v_league.commissioner_id is distinct from auth.uid() then
    raise exception 'Only the commissioner can do that';
  end if;
  if p_status is not null and v_league.status <> p_status then
    raise exception 'The league is no longer in the lobby';
  end if;
  return v_league;
end;
$$;

create function private.renumber_slots(p_league uuid) returns void
language sql set search_path = '' as $$
  update public.league_members m
     set draft_slot = r.rn
    from (select user_id, row_number() over (order by draft_slot) as rn
            from public.league_members where league_id = p_league) r
   where m.league_id = p_league and m.user_id = r.user_id;
$$;

-- ---------------------------------------------------------------------------
-- RPCs (called from the web app)
-- ---------------------------------------------------------------------------

create function public.create_league(
  p_name text,
  p_snake boolean default true,
  p_order_mode text default 'random',
  p_pick_seconds int default 90
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Set a username before creating a league';
  end if;
  insert into public.leagues (name, commissioner_id, snake, order_mode, pick_seconds)
  values (trim(p_name), auth.uid(), p_snake, p_order_mode, p_pick_seconds)
  returning id into v_id;
  insert into public.league_members (league_id, user_id, draft_slot) values (v_id, auth.uid(), 1);
  return v_id;
end;
$$;

-- Lets the join page show what you're joining before you're a member (RLS hides leagues otherwise).
create function public.league_preview(p_invite_code text)
returns table (id uuid, name text, status text, commissioner text, member_count int, is_member boolean)
language sql stable security definer set search_path = '' as $$
  select l.id, l.name, l.status, p.username,
         (select count(*)::int from public.league_members m where m.league_id = l.id),
         public.is_league_member(l.id)
    from public.leagues l
    join public.profiles p on p.id = l.commissioner_id
   where l.invite_code = p_invite_code;
$$;

create function public.join_league(p_invite_code text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_league public.leagues;
  v_count  int;
begin
  if not exists (select 1 from public.profiles where id = auth.uid()) then
    raise exception 'Set a username before joining a league';
  end if;
  select * into v_league from public.leagues where invite_code = p_invite_code for update;
  if not found then
    raise exception 'Invite link is invalid';
  end if;
  if public.is_league_member(v_league.id) then
    return v_league.id;
  end if;
  if v_league.status <> 'lobby' then
    raise exception 'This league has already started drafting';
  end if;
  select count(*) into v_count from public.league_members where league_id = v_league.id;
  if v_count >= 30 then
    raise exception 'This league is full';
  end if;
  insert into public.league_members (league_id, user_id, draft_slot) values (v_league.id, auth.uid(), v_count + 1);
  return v_league.id;
end;
$$;

-- Leave (yourself) or kick (commissioner). Lobby only; the commissioner can't be removed.
create function public.remove_member(p_league uuid, p_user uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_league public.leagues;
begin
  select * into v_league from public.leagues where id = p_league for update;
  if not found or not public.is_league_member(p_league) then
    raise exception 'League not found';
  end if;
  if auth.uid() is distinct from p_user and auth.uid() is distinct from v_league.commissioner_id then
    raise exception 'Only the commissioner can remove other members';
  end if;
  if p_user = v_league.commissioner_id then
    raise exception 'The commissioner can''t leave the league';
  end if;
  if v_league.status <> 'lobby' then
    raise exception 'Members can''t leave after the draft starts';
  end if;
  delete from public.league_members where league_id = p_league and user_id = p_user;
  perform private.renumber_slots(p_league);
end;
$$;

create function public.update_league_settings(
  p_league uuid,
  p_snake boolean,
  p_order_mode text,
  p_pick_seconds int
) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_commissioner(p_league);
  update public.leagues
     set snake = p_snake, order_mode = p_order_mode, pick_seconds = p_pick_seconds
   where id = p_league;
end;
$$;

-- Manual order: p_order lists every member's user id, first pick first.
create function public.set_draft_order(p_league uuid, p_order uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.require_commissioner(p_league);
  if cardinality(p_order) <> (select count(*) from public.league_members where league_id = p_league)
     or (select count(distinct u) from unnest(p_order) u) <> cardinality(p_order)
     or exists (select 1 from unnest(p_order) u
                 where not exists (select 1 from public.league_members
                                    where league_id = p_league and user_id = u)) then
    raise exception 'The order must list every member exactly once';
  end if;
  update public.league_members m
     set draft_slot = o.slot
    from unnest(p_order) with ordinality as o(user_id, slot)
   where m.league_id = p_league and m.user_id = o.user_id;
end;
$$;

create function public.start_draft(p_league uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_league public.leagues;
begin
  v_league := private.require_commissioner(p_league);
  if (select count(*) from public.league_members where league_id = p_league) < 2 then
    raise exception 'You need at least 2 members to start the draft';
  end if;
  if v_league.order_mode = 'random' then
    update public.league_members m
       set draft_slot = r.rn
      from (select user_id, row_number() over (order by random()) as rn
              from public.league_members where league_id = p_league) r
     where m.league_id = p_league and m.user_id = r.user_id;
  end if;
  update public.leagues
     set status = 'drafting',
         current_pick = 1,
         started_at = now(),
         pick_deadline = case when pick_seconds > 0 then now() + make_interval(secs => pick_seconds) end
   where id = p_league;
end;
$$;

create function public.make_pick(p_league uuid, p_team_id smallint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_league public.leagues;
begin
  select * into v_league from public.leagues where id = p_league for update;
  if not found or not public.is_league_member(p_league) then
    raise exception 'League not found';
  end if;
  if v_league.status <> 'drafting' then
    raise exception 'The draft is not in progress';
  end if;
  if private.on_clock_user(p_league) is distinct from auth.uid() then
    raise exception 'It''s not your turn';
  end if;
  if not exists (select 1 from public.nba_teams where id = p_team_id) then
    raise exception 'Unknown team';
  end if;
  if exists (select 1 from public.draft_picks where league_id = p_league and team_id = p_team_id) then
    raise exception 'That team has already been drafted';
  end if;
  insert into public.draft_picks (league_id, pick_number, user_id, team_id)
  values (p_league, v_league.current_pick, auth.uid(), p_team_id);
  perform private.advance_pick(p_league);
end;
$$;

-- Any member's browser calls this when the countdown hits zero, so autopicks land
-- within seconds instead of waiting for the cron backstop. Safe to call repeatedly.
create function public.autopick_if_expired(p_league uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_league_member(p_league) then
    raise exception 'League not found';
  end if;
  return private.autopick(p_league);
end;
$$;

-- ---------------------------------------------------------------------------
-- Scoreboard
-- ---------------------------------------------------------------------------

-- security_invoker: the caller's RLS applies, so you only see leagues you're in.
-- Ties on wins break on fewer losses.
create view public.league_scoreboard with (security_invoker = true) as
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
       )::int                            as place
  from public.league_members m
  join public.profiles p on p.id = m.user_id
  left join public.draft_picks dp on dp.league_id = m.league_id and dp.user_id = m.user_id
  left join public.team_standings s on s.team_id = dp.team_id
 group by m.league_id, m.user_id, p.username, m.draft_slot;

-- ---------------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------------

alter table public.profiles               enable row level security;
alter table public.nba_teams              enable row level security;
alter table public.team_standings         enable row level security;
alter table public.team_standings_history enable row level security;
alter table public.leagues                enable row level security;
alter table public.league_members         enable row level security;
alter table public.draft_picks            enable row level security;

create policy "profiles readable" on public.profiles for select to authenticated using (true);
create policy "own profile insert" on public.profiles for insert to authenticated with check (id = auth.uid());
create policy "own profile update" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "teams readable" on public.nba_teams for select to anon, authenticated using (true);
create policy "standings readable" on public.team_standings for select to anon, authenticated using (true);
create policy "history readable" on public.team_standings_history for select to anon, authenticated using (true);

create policy "members read league" on public.leagues for select to authenticated
  using (public.is_league_member(id));
create policy "members read members" on public.league_members for select to authenticated
  using (public.is_league_member(league_id));
create policy "members read picks" on public.draft_picks for select to authenticated
  using (public.is_league_member(league_id));

-- No insert/update/delete policies on leagues, members or picks: writes only happen via RPCs.

-- ---------------------------------------------------------------------------
-- Function privileges. Supabase grants EXECUTE on new public functions to anon and
-- authenticated by default; lock everything down, then grant back what the app calls.
-- ---------------------------------------------------------------------------

revoke execute on all functions in schema private from public, anon, authenticated;
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function
  public.is_league_member(uuid),
  public.slot_for_pick(int, int, boolean),
  public.server_now(),
  public.create_league(text, boolean, text, int),
  public.league_preview(text),
  public.join_league(text),
  public.remove_member(uuid, uuid),
  public.update_league_settings(uuid, boolean, text, int),
  public.set_draft_order(uuid, uuid[]),
  public.start_draft(uuid),
  public.make_pick(uuid, smallint),
  public.autopick_if_expired(uuid)
to authenticated;

grant execute on function public.league_preview(text) to anon;

-- ---------------------------------------------------------------------------
-- Realtime: the draft room subscribes to these and refetches on any change.
-- ---------------------------------------------------------------------------

alter publication supabase_realtime add table public.leagues, public.league_members, public.draft_picks;
