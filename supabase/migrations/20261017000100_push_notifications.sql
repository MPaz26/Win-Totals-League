-- Web Push notifications: "you're on the clock" during a draft, and the weekly recap.
--
-- Each browser or installed app that turns notifications on stores one subscription here.
-- Everything is sent by the send-push Edge Function (supabase/functions/send-push), which
-- also deletes subscriptions the push service reports as gone.

create table public.push_subscriptions (
  endpoint   text primary key check (endpoint ~ '^https://'),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;
create policy "own push subscriptions read" on public.push_subscriptions for select to authenticated
  using (user_id = auth.uid());
revoke all on public.push_subscriptions from anon, authenticated;
grant select on public.push_subscriptions to authenticated;

-- Writes go through these, so a device that signs in as someone else moves to the new
-- user instead of failing the old user's RLS check. The endpoint is an unguessable URL
-- issued to that device, so knowing it is what proves you're on it.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text) returns void
language sql security definer set search_path = '' as $$
  insert into public.push_subscriptions (endpoint, user_id, p256dh, auth)
  values (p_endpoint, auth.uid(), p_p256dh, p_auth)
  on conflict (endpoint) do update
    set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, created_at = now();
$$;

create function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = '' as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid();
$$;

revoke execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text)
  from public, anon;
grant execute on function public.save_push_subscription(text, text, text), public.delete_push_subscription(text)
  to authenticated;

-- Where the Edge Function lives and the secret it expects. One row, written by the
-- "Push notifications" workflow; until then nothing is sent.
create table private.push_config (
  id          boolean primary key default true check (id),
  project_url text not null,
  secret      text not null
);

-- Queues a send-push call. Never raises: a notification must never stop a pick.
create function private.send_push(p_messages jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_config private.push_config;
begin
  select * into v_config from private.push_config;
  if not found then
    return;
  end if;
  perform net.http_post(
    url := v_config.project_url || '/functions/v1/send-push',
    body := jsonb_build_object('messages', p_messages),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', v_config.secret),
    timeout_milliseconds := 10000
  );
exception when others then
  raise warning 'push not queued: %', sqlerrm;
end;
$$;

-- Tells whoever just went on the clock. Skips the second of back-to-back snake turns,
-- since that manager just made the pick before it and is looking at the board.
create function private.notify_on_clock() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_user    uuid := private.on_clock_user(new.id);
  v_members int;
  v_timer   text;
begin
  if v_user is null or exists (
    select 1 from public.draft_picks
     where league_id = new.id and pick_number = new.current_pick - 1 and user_id = v_user and not auto
  ) then
    return null;
  end if;
  select count(*) into v_members from public.league_members where league_id = new.id;
  v_timer := case
    when new.pick_seconds = 0 then 'No pick timer'
    when new.pick_seconds < 120 then new.pick_seconds || ' seconds to pick'
    when new.pick_seconds < 7200 then new.pick_seconds / 60 || ' minutes to pick'
    else new.pick_seconds / 3600 || ' hours to pick'
  end;
  perform private.send_push(jsonb_build_array(jsonb_build_object(
    'user_id', v_user,
    'title', 'You''re on the clock',
    'body', format('%s: pick %s, round %s. %s.', new.name, new.current_pick, (new.current_pick - 1) / v_members + 1, v_timer),
    'url', 'league/' || new.id,
    'tag', 'on-clock-' || new.id,
    -- A stale "on the clock" is worse than none; with no timer it stays relevant for a day.
    'ttl', case when new.pick_seconds > 0 then new.pick_seconds else 86400 end
  )));
  return null;
end;
$$;

create trigger leagues_notify_on_clock
  after update of current_pick on public.leagues
  for each row
  when (new.status = 'drafting' and new.current_pick is distinct from old.current_pick)
  execute function private.notify_on_clock();

revoke execute on all functions in schema private from public, anon, authenticated;
