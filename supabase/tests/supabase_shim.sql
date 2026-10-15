-- Minimal stand-ins for what a Supabase database provides, so the migrations and
-- draft_test.sql can run against plain Postgres (`make test-db`). Not used in production.

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

create schema auth;
grant usage on schema auth to anon, authenticated;
create table auth.users (id uuid primary key, email text);

create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid;
$$;

create publication supabase_realtime;

-- pg_net stand-in: records requests instead of sending them, so tests can inspect them.
create schema net;
create table net.test_requests (id bigserial primary key, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}',
                              headers jsonb default '{}', timeout_milliseconds int default 5000)
returns bigint language sql as $$
  insert into net.test_requests (url, body, headers) values (url, body, headers) returning id;
$$;
