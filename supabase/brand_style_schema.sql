create table if not exists public.brand_style_config (
  id text primary key,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_brand_style_config_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_brand_style_config_updated_at on public.brand_style_config;

create trigger set_brand_style_config_updated_at
before update on public.brand_style_config
for each row
execute function public.set_brand_style_config_updated_at();

alter table public.brand_style_config enable row level security;

drop policy if exists "service role can manage brand style config" on public.brand_style_config;

create policy "service role can manage brand style config"
on public.brand_style_config
for all
using (auth.role() = 'service_role')
with check (auth.role() = 'service_role');
