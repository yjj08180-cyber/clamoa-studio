-- One private, shared agency workspace. The app's service role performs
-- compare-and-swap updates of the studio data and queue leases together.
create table if not exists public.clamoa_workspace (
  id integer primary key check (id = 1),
  revision bigint not null default 0,
  document jsonb not null
);
create table if not exists public.clamoa_members (
  email text primary key check (email = lower(trim(email))),
  role text not null check (role in ('admin','member')),
  created_at timestamptz not null default now()
);
create table if not exists public.clamoa_assets (
  id uuid primary key,
  name text not null,
  mime text not null,
  created_at timestamptz not null default now()
);
alter table public.clamoa_workspace enable row level security;
alter table public.clamoa_members enable row level security;
alter table public.clamoa_assets enable row level security;
revoke all privileges on table public.clamoa_workspace, public.clamoa_members, public.clamoa_assets from anon, authenticated;
grant select, insert, update, delete on table public.clamoa_workspace, public.clamoa_members, public.clamoa_assets to service_role;
insert into storage.buckets (id,name,public)
values ('clamoa-private','clamoa-private',false)
on conflict (id) do update set public = false;
