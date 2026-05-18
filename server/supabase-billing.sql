-- Billing and usage intelligence schema for Atelier Measure Studio.
-- Run in Supabase SQL editor. The app can still run locally without Supabase.

create table if not exists public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid null,
  job_type text not null check (job_type in ('measurement','image_generate','image_edit','video_generate','agent','minimal_styling')),
  provider text not null,
  model_name text not null,
  status text not null default 'queued',
  prompt_summary text null,
  user_prompt text null,
  refined_prompt text null,
  provider_response_message text null,
  latency_ms integer null,
  output_count integer not null default 0,
  estimated_cost numeric(12, 6) not null default 0,
  actual_cost numeric(12, 6) null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz null
);

create table if not exists public.usage_events (
  id uuid primary key default gen_random_uuid(),
  job_id uuid null references public.generation_jobs(id) on delete set null,
  user_id uuid null,
  event_type text not null,
  provider text null,
  model_name text null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  estimated_cost numeric(12, 6) not null default 0,
  actual_cost numeric(12, 6) null,
  status text not null default 'completed',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.media_assets (
  id uuid primary key default gen_random_uuid(),
  job_id uuid null references public.generation_jobs(id) on delete set null,
  user_id uuid null,
  asset_type text not null check (asset_type in ('source_upload','generated_image','edited_image','generated_video')),
  provider text null,
  model_name text null,
  storage_bucket text not null,
  storage_path text not null,
  public_url text null,
  file_name text null,
  mime_type text null,
  file_size_bytes bigint not null default 0,
  width integer null,
  height integer null,
  duration_seconds numeric(8, 2) null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create or replace view public.monthly_billing_summary as
select
  date_trunc('month', created_at) as month,
  count(*) as total_jobs,
  count(*) filter (where status in ('completed','succeeded')) as successful_jobs,
  count(*) filter (where status in ('failed','rejected','stopped','blocked')) as failed_jobs,
  coalesce(sum(estimated_cost), 0) as estimated_cost,
  coalesce(sum(actual_cost), sum(estimated_cost), 0) as billable_cost,
  coalesce(avg(nullif(latency_ms, 0)), 0) as avg_latency_ms,
  coalesce(sum(output_count), 0) as output_count
from public.generation_jobs
group by 1;

create or replace view public.monthly_provider_summary as
select
  date_trunc('month', created_at) as month,
  provider,
  model_name,
  job_type,
  count(*) as jobs,
  count(*) filter (where status in ('failed','rejected','stopped','blocked')) as failed_jobs,
  coalesce(sum(estimated_cost), 0) as estimated_cost,
  coalesce(sum(actual_cost), sum(estimated_cost), 0) as billable_cost
from public.generation_jobs
group by 1, 2, 3, 4;

create or replace view public.daily_usage_summary as
select
  date_trunc('day', created_at) as day,
  job_type,
  provider,
  count(*) as jobs,
  coalesce(sum(output_count), 0) as outputs,
  coalesce(sum(actual_cost), sum(estimated_cost), 0) as cost
from public.generation_jobs
group by 1, 2, 3;

create or replace view public.storage_summary as
select
  storage_bucket,
  asset_type,
  count(*) as asset_count,
  coalesce(sum(file_size_bytes), 0) as storage_bytes,
  max(created_at) as latest_asset_at
from public.media_assets
group by 1, 2;

create or replace view public.failed_job_summary as
select
  id,
  created_at,
  job_type,
  provider,
  model_name,
  status,
  provider_response_message,
  estimated_cost,
  actual_cost
from public.generation_jobs
where status in ('failed','rejected','stopped','blocked')
order by created_at desc;
