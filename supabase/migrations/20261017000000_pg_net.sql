-- pg_net lets the database make HTTP calls; the on-the-clock trigger uses it to reach the
-- send-push Edge Function. Requests are queued and sent after the transaction commits.
-- Kept in its own file because plain Postgres doesn't ship pg_net: `make test-db` skips this
-- one and stubs net.http_post in supabase_shim.sql instead.
create extension if not exists pg_net;
