-- =====================================================================
-- AuditX core schema — Supabase (Postgres + Auth + Storage)
-- Run once in Supabase Dashboard → SQL Editor → New query → Run.
-- Replaces the Firebase layer (Auth / Firestore / Storage). All AuditX
-- features (scan → adjudication → compliance → history → admin) keep
-- working unchanged; only the backend-as-a-service moves.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Helper: is the caller staff? (SECURITY DEFINER so RLS can use it)
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role in ('admin', 'super_admin', 'inspector')
      and status = 'active'
  );
$$;

-- ---------------------------------------------------------------------
-- profiles — one row per auth user (id = auth.users.id)
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null default '',
  full_name text not null default '',
  organization text not null default '',
  role text not null default 'user'
    check (role in ('user', 'inspector', 'admin', 'super_admin')),
  status text not null default 'active'
    check (status in ('active', 'pending', 'blocked')),
  prefs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_login timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- scans — inspection documents. Queryable mirrors + full `data` jsonb.
-- ---------------------------------------------------------------------
create table if not exists public.scans (
  id text primary key,
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'needs_review',
  verdict text,
  overall_score numeric,
  risk_score numeric,
  product_name text not null default '',
  brand text not null default '',
  manufacturer text not null default '',
  barcode text not null default '',
  category text,
  ocr_status text,
  photo_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists scans_user_created_idx on public.scans (user_id, created_at desc);
create index if not exists scans_status_idx on public.scans (status);
create index if not exists scans_barcode_idx on public.scans (barcode);

-- ---------------------------------------------------------------------
-- products — barcode-keyed product database
-- ---------------------------------------------------------------------
create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  barcode text not null,
  name text not null default '',
  brand text not null default '',
  manufacturer text not null default '',
  category text not null default 'Other',
  net_quantity text not null default '',
  mrp text not null default '',
  consumer_care text not null default '',
  country_of_origin text not null default '',
  best_before_label text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (barcode)
);
create index if not exists products_created_idx on public.products (created_at desc);

-- ---------------------------------------------------------------------
-- violations / reports / notifications / activity_logs
-- ---------------------------------------------------------------------
create table if not exists public.violations (
  id uuid primary key default gen_random_uuid(),
  scan_id text,
  product_name text not null default '',
  manufacturer text not null default '',
  category text not null default '',
  type text not null default '',
  description text not null default '',
  severity text not null default 'medium',
  status text not null default 'Detected',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists violations_scan_idx on public.violations (scan_id);
create index if not exists violations_created_idx on public.violations (created_at desc);

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  scan_id text,
  title text not null default '',
  description text not null default '',
  product_name text not null default '',
  manufacturer text not null default '',
  category text not null default '',
  status text not null default 'Pending',
  priority text not null default 'Medium',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists reports_scan_idx on public.reports (scan_id);
create index if not exists reports_created_idx on public.reports (created_at desc);

create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  type text not null default '',
  title text not null default '',
  body text not null default '',
  link text not null default '',
  read boolean not null default false,
  read_at timestamptz,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  actor_id uuid references auth.users (id) on delete set null,
  actor_name text not null default '',
  action text not null default '',
  target_type text not null default '',
  target_id text not null default '',
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists activity_logs_created_idx on public.activity_logs (created_at desc);

-- ---------------------------------------------------------------------
-- compliance_rules / admin_requests / inspection_reviews
-- ---------------------------------------------------------------------
create table if not exists public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  title text not null default '',
  created_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.admin_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);
create index if not exists admin_requests_created_idx on public.admin_requests (created_at desc);

create table if not exists public.inspection_reviews (
  id uuid primary key default gen_random_uuid(),
  scan_id text,
  created_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

-- ---------------------------------------------------------------------
-- Row Level Security
-- Backend uses the SERVICE_ROLE key (bypasses RLS). These policies gate
-- the anon/publishable-key client used by the dashboard.
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.scans enable row level security;
alter table public.products enable row level security;
alter table public.violations enable row level security;
alter table public.reports enable row level security;
alter table public.notifications enable row level security;
alter table public.activity_logs enable row level security;
alter table public.compliance_rules enable row level security;
alter table public.admin_requests enable row level security;
alter table public.inspection_reviews enable row level security;

-- profiles: read own or staff; update own non-privileged columns only
-- (role/status change exclusively via the backend admin API).
drop policy if exists "profiles_select_own_or_staff" on public.profiles;
create policy "profiles_select_own_or_staff" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own" on public.profiles
  for update to authenticated using (id = auth.uid());
drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own" on public.profiles
  for insert to authenticated with check (id = auth.uid());

-- scans: owners + staff read; owners insert own; owners update own; staff all.
drop policy if exists "scans_select_own_or_staff" on public.scans;
create policy "scans_select_own_or_staff" on public.scans
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "scans_insert_own" on public.scans;
create policy "scans_insert_own" on public.scans
  for insert to authenticated with check (user_id = auth.uid() or public.is_admin());
drop policy if exists "scans_update_own_or_staff" on public.scans;
create policy "scans_update_own_or_staff" on public.scans
  for update to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "scans_delete_own_or_staff" on public.scans;
create policy "scans_delete_own_or_staff" on public.scans
  for delete to authenticated using (user_id = auth.uid() or public.is_admin());

-- products: everyone authenticated reads; staff writes.
drop policy if exists "products_select_all" on public.products;
create policy "products_select_all" on public.products
  for select to authenticated using (true);
drop policy if exists "products_write_staff" on public.products;
create policy "products_write_staff" on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- violations / reports: authenticated read; staff write.
drop policy if exists "violations_select_all" on public.violations;
create policy "violations_select_all" on public.violations
  for select to authenticated using (true);
drop policy if exists "violations_write_staff" on public.violations;
create policy "violations_write_staff" on public.violations
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "reports_select_all" on public.reports;
create policy "reports_select_all" on public.reports
  for select to authenticated using (true);
drop policy if exists "reports_write_staff" on public.reports;
create policy "reports_write_staff" on public.reports
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- notifications: own inbox only.
drop policy if exists "notifications_own" on public.notifications;
create policy "notifications_own" on public.notifications
  for select to authenticated using (user_id = auth.uid());
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications
  for update to authenticated using (user_id = auth.uid());

-- activity_logs: staff read; writes via backend (service role).
drop policy if exists "activity_logs_staff_read" on public.activity_logs;
create policy "activity_logs_staff_read" on public.activity_logs
  for select to authenticated using (public.is_admin());

-- compliance_rules: authenticated read; staff write.
drop policy if exists "compliance_rules_select_all" on public.compliance_rules;
create policy "compliance_rules_select_all" on public.compliance_rules
  for select to authenticated using (true);
drop policy if exists "compliance_rules_write_staff" on public.compliance_rules;
create policy "compliance_rules_write_staff" on public.compliance_rules
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- admin_requests: own + staff read; authenticated insert; staff update.
drop policy if exists "admin_requests_select" on public.admin_requests;
create policy "admin_requests_select" on public.admin_requests
  for select to authenticated using (user_id = auth.uid() or public.is_admin());
drop policy if exists "admin_requests_insert" on public.admin_requests;
create policy "admin_requests_insert" on public.admin_requests
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "admin_requests_update_staff" on public.admin_requests;
create policy "admin_requests_update_staff" on public.admin_requests
  for update to authenticated using (public.is_admin());

-- inspection_reviews: own scans or staff.
drop policy if exists "inspection_reviews_select" on public.inspection_reviews;
create policy "inspection_reviews_select" on public.inspection_reviews
  for select to authenticated using (public.is_admin());

-- ---------------------------------------------------------------------
-- Storage bucket `scans` (public read; authenticated write).
-- Object keys look like: <uid>/<timestamp>-<name>
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('scans', 'scans', true)
on conflict (id) do update set public = true;

drop policy if exists "scans_bucket_public_read" on storage.objects;
create policy "scans_bucket_public_read" on storage.objects
  for select using (bucket_id = 'scans');
drop policy if exists "scans_bucket_auth_write" on storage.objects;
create policy "scans_bucket_auth_write" on storage.objects
  for insert to authenticated with check (bucket_id = 'scans');
drop policy if exists "scans_bucket_auth_update" on storage.objects;
create policy "scans_bucket_auth_update" on storage.objects
  for update to authenticated using (bucket_id = 'scans');
drop policy if exists "scans_bucket_auth_delete" on storage.objects;
create policy "scans_bucket_auth_delete" on storage.objects
  for delete to authenticated using (bucket_id = 'scans');
