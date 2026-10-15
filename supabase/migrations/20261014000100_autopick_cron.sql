-- Backstop for the draft timer: autopick in leagues where nobody's browser is open
-- to trigger autopick_if_expired(). Sub-minute schedules need pg_cron >= 1.5 (Supabase ships 1.6).
create extension if not exists pg_cron;

select cron.schedule(
  'draft-autopick',
  '15 seconds',
  $$select private.autopick_expired_leagues()$$
);
