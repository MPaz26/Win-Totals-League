-- Live scores: the check lives in 20261024000000_live_scores.sql, where live_scores_test.sql
-- calls it directly; this file only schedules it (and is skipped by `make test-db`).
select cron.schedule('live-scores', '*/5 * * * *', $$select private.refresh_live_scores()$$);
