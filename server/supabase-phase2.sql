-- Phase 2 product data model for Atelier Measure Studio.
-- Local-first UI uses localStorage today; these tables are ready for Supabase persistence.

create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists saved_prompts (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  title text not null,
  prompt text not null,
  negative_prompt text default '',
  type text not null check (type in ('image', 'edit', 'video', 'measure', 'agent')),
  provider_compatibility text[] default '{}',
  favorite boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists prompt_tags (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references saved_prompts(id) on delete cascade,
  tag text not null
);

create table if not exists generation_jobs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  parent_job_id uuid references generation_jobs(id) on delete set null,
  job_type text not null,
  provider text not null,
  model_name text,
  user_prompt text,
  refined_prompt text,
  status text not null default 'queued',
  cost_usd numeric(12, 6) default 0,
  estimated_cost_usd numeric(12, 6) default 0,
  latency_ms integer,
  provider_response jsonb default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists media_assets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  job_id uuid references generation_jobs(id) on delete set null,
  asset_type text not null check (asset_type in ('source', 'generated_image', 'edited_image', 'video', 'analysis')),
  provider text,
  model_name text,
  label text,
  prompt text,
  storage_bucket text,
  storage_path text,
  local_path text,
  public_url text,
  file_size_bytes bigint default 0,
  favorite boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists media_variants (
  id uuid primary key default gen_random_uuid(),
  parent_asset_id uuid references media_assets(id) on delete cascade,
  variant_asset_id uuid references media_assets(id) on delete cascade,
  variant_index integer,
  selected boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists provider_usage_logs (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete set null,
  job_id uuid references generation_jobs(id) on delete set null,
  provider text not null,
  model_name text,
  request_type text not null,
  input_tokens integer default 0,
  output_tokens integer default 0,
  output_count integer default 0,
  actual_cost numeric(12, 6) default 0,
  estimated_cost numeric(12, 6) default 0,
  status text not null default 'completed',
  created_at timestamptz not null default now()
);

create or replace view monthly_project_usage as
select
  date_trunc('month', created_at) as month,
  project_id,
  provider,
  request_type,
  count(*) as request_count,
  sum(actual_cost) as actual_cost,
  sum(estimated_cost) as estimated_cost
from provider_usage_logs
group by 1, 2, 3, 4;

create or replace view project_media_summary as
select
  project_id,
  asset_type,
  count(*) as asset_count,
  sum(file_size_bytes) as storage_bytes,
  max(created_at) as latest_asset_at
from media_assets
group by 1, 2;
