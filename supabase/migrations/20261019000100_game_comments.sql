-- Game threads: anyone signed in can comment on a game and reply to comments; everyone signed in
-- can read them. Like the rest of League Pass, nothing here is per league.
--
-- Threads are one level deep: a reply to a reply joins the same thread. Deleting a comment that
-- has replies blanks it ("deleted") so the replies keep their context; otherwise the row goes.

create table public.lp_game_comments (
  id         bigint generated always as identity primary key,
  game_id    text not null references public.nba_games (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  parent_id  bigint references public.lp_game_comments (id) on delete cascade,
  body       text check (char_length(body) between 1 and 1000),  -- null once deleted
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  check ((body is null) = (deleted_at is not null))
);
create index lp_game_comments_game_idx on public.lp_game_comments (game_id, created_at);
create index lp_game_comments_parent_idx on public.lp_game_comments (parent_id);
create index lp_game_comments_user_idx on public.lp_game_comments (user_id, created_at);

alter table public.lp_game_comments enable row level security;
create policy "comments readable" on public.lp_game_comments for select to authenticated using (true);
-- Written only through the RPCs below.
revoke insert, update, delete, truncate on public.lp_game_comments from anon, authenticated;
revoke all on public.lp_game_comments from anon;

-- Posts a comment, or a reply when p_parent is set. Returns the new comment's id.
create function public.post_game_comment(p_game text, p_body text, p_parent bigint default null) returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  v_user   uuid := auth.uid();
  v_body   text := btrim(p_body);
  v_parent public.lp_game_comments;
  v_id     bigint;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  if coalesce(v_body, '') = '' then
    raise exception 'Write something first';
  end if;
  if char_length(v_body) > 1000 then
    raise exception 'Keep it under 1,000 characters';
  end if;
  if not exists (select 1 from public.nba_games where id = p_game) then
    raise exception 'Game not found';
  end if;
  if p_parent is not null then
    select * into v_parent from public.lp_game_comments where id = p_parent and game_id = p_game;
    if not found or v_parent.deleted_at is not null then
      raise exception 'That comment was deleted';
    end if;
    -- Replies to a reply join its thread.
    p_parent := coalesce(v_parent.parent_id, v_parent.id);
  end if;
  if (select count(*) from public.lp_game_comments
       where user_id = v_user and created_at > now() - interval '1 minute') >= 5 then
    raise exception 'Slow down a little, then try again';
  end if;

  insert into public.lp_game_comments (game_id, user_id, parent_id, body)
  values (p_game, v_user, p_parent, v_body)
  returning id into v_id;
  return v_id;
end;
$$;

-- Deletes the caller's own comment.
create function public.delete_game_comment(p_id bigint) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_user    uuid := auth.uid();
  v_comment public.lp_game_comments;
begin
  if v_user is null then
    raise exception 'Not signed in';
  end if;
  select * into v_comment from public.lp_game_comments where id = p_id for update;
  if not found or v_comment.deleted_at is not null then
    return;
  end if;
  if v_comment.user_id <> v_user then
    raise exception 'You can only delete your own comments';
  end if;

  if exists (select 1 from public.lp_game_comments where parent_id = p_id) then
    update public.lp_game_comments set body = null, deleted_at = now() where id = p_id;
  else
    delete from public.lp_game_comments where id = p_id;
    -- The last reply under a deleted comment takes the empty thread with it.
    delete from public.lp_game_comments p
     where p.id = v_comment.parent_id and p.deleted_at is not null
       and not exists (select 1 from public.lp_game_comments c where c.parent_id = p.id);
  end if;
end;
$$;

-- Comment counts (deleted ones left out) for every game in a date range of up to a month.
create function public.lp_comment_counts(p_from date, p_to date)
returns table (game_id text, n_comments int)
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_to < p_from or p_to - p_from > 31 then
    raise exception 'Pick a date range of up to a month';
  end if;
  return query
    select c.game_id, count(*)::int
      from public.lp_game_comments c
      join public.nba_games g on g.id = c.game_id
     where g.game_date between p_from and p_to and c.deleted_at is null
     group by c.game_id;
end;
$$;

revoke execute on function
  public.post_game_comment(text, text, bigint),
  public.delete_game_comment(bigint),
  public.lp_comment_counts(date, date)
from public, anon;
grant execute on function
  public.post_game_comment(text, text, bigint),
  public.delete_game_comment(bigint),
  public.lp_comment_counts(date, date)
to authenticated;

-- ---------------------------------------------------------------------------
-- Reply notifications: a new reply notifies whoever started the thread and everyone else who has
-- replied in it, except the poster and anyone who turned them off. People who hide scores don't get
-- the reply's text once the game has started, since it could give the result away.
-- ---------------------------------------------------------------------------

alter table public.lp_settings add column notify_replies boolean not null default true;
grant insert (notify_replies), update (notify_replies) on public.lp_settings to authenticated;

create function private.notify_comment_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_poster   text;
  v_game     record;
  v_started  boolean;
  v_messages jsonb;
begin
  select username into v_poster from public.profiles where id = new.user_id;
  select g.tipoff, g.status, h.abbr as home_abbr, a.abbr as away_abbr into v_game
    from public.nba_games g
    join public.nba_teams h on h.id = g.home_team_id
    join public.nba_teams a on a.id = g.away_team_id
   where g.id = new.game_id;
  v_started := v_game.status in ('in_progress', 'final') or now() > v_game.tipoff;

  select coalesce(jsonb_agg(jsonb_build_object(
           'user_id', r.user_id,
           'title', format('%s replied · %s @ %s', v_poster, v_game.away_abbr, v_game.home_abbr),
           'body', case when v_started and coalesce(st.hide_scores, true)
                        then 'Open the thread to read it (may include the score).'
                        else left(new.body, 140) || case when char_length(new.body) > 140 then '…' else '' end end,
           'url', 'watch/games/' || new.game_id,
           'tag', 'lp-thread-' || new.parent_id,
           'ttl', 24 * 3600
         )), '[]')
    into v_messages
    from (select user_id from public.lp_game_comments
           where (id = new.parent_id or parent_id = new.parent_id) and deleted_at is null
           group by user_id) r
    left join public.lp_settings st on st.user_id = r.user_id
   where r.user_id <> new.user_id
     and coalesce(st.notify_replies, true)
     and exists (select 1 from public.push_subscriptions ps where ps.user_id = r.user_id);

  if jsonb_array_length(v_messages) > 0 then
    perform private.send_push(v_messages);
  end if;
  return null;
end;
$$;
revoke execute on function private.notify_comment_reply() from public, anon, authenticated;

create trigger lp_game_comments_notify_reply
  after insert on public.lp_game_comments
  for each row
  when (new.parent_id is not null)
  execute function private.notify_comment_reply();

-- The thread page subscribes and refetches on any change.
alter publication supabase_realtime add table public.lp_game_comments;
