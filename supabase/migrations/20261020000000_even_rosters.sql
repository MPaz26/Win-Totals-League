-- Every manager drafts the same number of teams. The draft runs only as many full rounds as fit in
-- the 30 franchises, and the leftovers go undrafted: 4 managers draft 7 each (28 picks) and 2 teams
-- belong to nobody. Until now the draft ran to all 30, so the first managers in the order got an
-- extra team. This ends the draft at the last full round, refuses any pick past it, and removes the
-- extra picks already made.

-- Picks in this league's draft. Members can't leave once the draft starts, so it's fixed by then.
create function private.total_picks(p_league uuid) returns int
language sql stable set search_path = '' as $$
  select ((select count(*) from public.nba_teams) / count(*)) * count(*)
    from public.league_members
   where league_id = p_league;
$$;

create or replace function private.advance_pick(p_league uuid) returns void
language plpgsql set search_path = '' as $$
declare
  v_next int;
  v_secs int;
begin
  select current_pick + 1, pick_seconds into v_next, v_secs from public.leagues where id = p_league;
  if v_next > private.total_picks(p_league) then
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

-- Backstop for every write path (make_pick, autopick, anything added later): the leftover teams
-- can never be drafted. security definer: it fires ahead of RLS for callers who can't use private.
create function private.check_pick_in_draft() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.pick_number > private.total_picks(new.league_id) then
    raise exception 'Every pick in this draft has been made';
  end if;
  return new;
end;
$$;

create trigger draft_picks_in_draft
  before insert or update of pick_number, league_id on public.draft_picks
  for each row execute function private.check_pick_in_draft();

-- Backfill: drops the extra picks from drafts that ran past their last full round, and closes out
-- any draft still running past it. completed_at becomes when the last real pick landed.
-- A function so the draft test can run it against legacy data; safe to run again.
create function private.trim_leftover_picks() returns void
language plpgsql set search_path = '' as $$
begin
  delete from public.draft_picks p
   where p.pick_number > private.total_picks(p.league_id);

  update public.leagues l
     set status = 'complete',
         current_pick = private.total_picks(l.id) + 1,
         pick_deadline = null,
         completed_at = coalesce(
           (select max(picked_at) from public.draft_picks p where p.league_id = l.id),
           l.completed_at, now())
   where l.status <> 'lobby'
     and l.current_pick > private.total_picks(l.id)
     and (l.status = 'drafting' or l.current_pick <> private.total_picks(l.id) + 1);
end;
$$;

select private.trim_leftover_picks();
