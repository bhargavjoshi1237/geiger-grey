-- Delivery runtime — MCP request logs + Postgres rate limiting
--
-- From backend spec sections 12.1, 12.5 and 15 (item 5).
--   * grey.request_logs: the inline channel check (live name verified in
--     pg_constraint: request_logs_channel_check) gains 'mcp'.
--   * grey.rate_limit_windows: UNLOGGED fixed one-minute windows, one row per
--     (bucket, window). Losing it on a crash only resets counters.
--   * grey.rate_limit_hit(bucket, limit, window_seconds): atomic upsert of the
--     current window, returns { allowed, hits, remaining, reset_at }; ~1% of
--     calls delete a batch of expired windows. Correct across serverless
--     instances without a new vendor.
-- Both the table and the function are service_role only (API / MCP / widget
-- routes run under the service role after authenticating the caller).

-- @up

alter table grey.request_logs drop constraint if exists request_logs_channel_check;
alter table grey.request_logs add constraint request_logs_channel_check
  check (channel in ('playground', 'widget', 'api', 'mcp'));

create unlogged table if not exists grey.rate_limit_windows (
  bucket text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  expires_at timestamptz not null,
  primary key (bucket, window_start)
);
create index if not exists rate_limit_windows_expires_idx on grey.rate_limit_windows(expires_at);

-- Default privileges in schema grey grant tables to authenticated; take them back.
alter table grey.rate_limit_windows enable row level security;
revoke all on table grey.rate_limit_windows from public, anon, authenticated;
grant select, insert, update, delete on table grey.rate_limit_windows to service_role;

create or replace function grey.rate_limit_hit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer default 60
)
returns table (allowed boolean, hits integer, remaining integer, reset_at timestamptz)
language plpgsql
volatile
set search_path = grey, public
as $$
#variable_conflict use_column
declare
  v_window integer := greatest(coalesce(p_window_seconds, 60), 1);
  v_limit integer := greatest(coalesce(p_limit, 1), 1);
  v_start timestamptz;
  v_hits integer;
begin
  if p_bucket is null or p_bucket = '' or length(p_bucket) > 200 then
    raise exception 'BAD_BUCKET';
  end if;
  v_start := to_timestamp((floor(extract(epoch from now()) / v_window) * v_window)::double precision);

  insert into grey.rate_limit_windows as w (bucket, window_start, hits, expires_at)
  values (p_bucket, v_start, 1, v_start + make_interval(secs => v_window))
  on conflict (bucket, window_start) do update set hits = w.hits + 1
  returning w.hits into v_hits;

  -- Opportunistic cleanup, bounded so no single call does much work.
  if random() < 0.01 then
    delete from grey.rate_limit_windows
     where ctid in (
       select ctid from grey.rate_limit_windows where expires_at < now() limit 500
     );
  end if;

  return query select v_hits <= v_limit, v_hits, greatest(v_limit - v_hits, 0),
    v_start + make_interval(secs => v_window);
end;
$$;

revoke all on function grey.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function grey.rate_limit_hit(text, integer, integer) to service_role;

-- @down
drop function if exists grey.rate_limit_hit(text, integer, integer);
drop table if exists grey.rate_limit_windows;

-- MCP rows would violate the old check: keep them as API rows, remembering the origin.
update grey.request_logs
   set channel = 'api', metadata = metadata || jsonb_build_object('originalChannel', 'mcp')
 where channel = 'mcp';
alter table grey.request_logs drop constraint if exists request_logs_channel_check;
alter table grey.request_logs add constraint request_logs_channel_check
  check (channel in ('playground', 'widget', 'api'));
