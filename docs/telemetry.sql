create table if not exists public.brand_style_telemetry (
  id text primary key,
  event_timestamp timestamptz not null,
  name text not null,
  source text not null,
  category text not null,
  level text not null check (level in ('debug', 'info', 'warn', 'error')),
  session_id text,
  client_session_id text,
  request_id text,
  conversation_id text,
  issue_id text,
  actor_id text,
  task_id text,
  payload jsonb not null,
  created_at timestamptz not null default now()
);

create index if not exists brand_style_telemetry_timestamp_idx
  on public.brand_style_telemetry (event_timestamp desc);
create index if not exists brand_style_telemetry_name_timestamp_idx
  on public.brand_style_telemetry (name, event_timestamp desc);
create index if not exists brand_style_telemetry_source_timestamp_idx
  on public.brand_style_telemetry (source, event_timestamp desc);
create index if not exists brand_style_telemetry_category_timestamp_idx
  on public.brand_style_telemetry (category, event_timestamp desc);
create index if not exists brand_style_telemetry_session_idx
  on public.brand_style_telemetry (session_id)
  where session_id is not null;
create index if not exists brand_style_telemetry_client_session_idx
  on public.brand_style_telemetry (client_session_id)
  where client_session_id is not null;
create index if not exists brand_style_telemetry_request_idx
  on public.brand_style_telemetry (request_id)
  where request_id is not null;
create index if not exists brand_style_telemetry_conversation_idx
  on public.brand_style_telemetry (conversation_id)
  where conversation_id is not null;
create index if not exists brand_style_telemetry_issue_idx
  on public.brand_style_telemetry (issue_id)
  where issue_id is not null;

alter table public.brand_style_telemetry enable row level security;
revoke all on table public.brand_style_telemetry from anon, authenticated;

-- Schedule this with pg_cron when remote retention should mirror the local
-- 30-day default:
-- delete from public.brand_style_telemetry
-- where event_timestamp < now() - interval '30 days';
