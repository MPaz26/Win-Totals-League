-- League Pass push notifications. The senders live in 20261018000000_league_pass.sql, where
-- league_pass_test.sql calls them directly; this file only schedules them (and is skipped by
-- `make test-db`, since plain Postgres has no pg_cron). pg_cron runs in UTC.

-- 21:00 UTC = 5pm EDT / 4pm EST, before the first tipoffs of a normal night.
select cron.schedule('lp-daily-digest', '0 21 * * *', $$select private.lp_send_daily_digest()$$);

select cron.schedule('lp-must-watch-alerts', '*/10 * * * *', $$select private.lp_send_must_watch_alerts()$$);
