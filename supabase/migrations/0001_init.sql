-- P0: profiles, projects, env_snapshots + owner-only RLS.
-- Zero-knowledge: `env_snapshots.envelope` holds ciphertext only
-- ({ v, salt, nonce, algo, ciphertext }); `plaintext_sha256` exists for
-- conflict detection only. No plaintext columns, ever.

create extension if not exists "pgcrypto";

-- Profiles mirror auth.users (one row per user, created on first use).
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

-- One row per tracked repo identity, per owner.
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  identity text not null,
  display_name text,
  local_only boolean not null default false,
  created_at timestamptz not null default now(),
  unique (owner_id, identity)
);

-- Encrypted snapshots of a project's env set (ciphertext only).
create table public.env_snapshots (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  envelope jsonb not null,
  plaintext_sha256 text not null,
  device_name text,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.projects enable row level security;
alter table public.env_snapshots enable row level security;

-- Profiles: users read their own row only.
create policy "profiles self-read"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles self-insert"
  on public.profiles for insert
  with check (id = auth.uid());

-- Projects: owner-only for all operations.
create policy "projects owner select"
  on public.projects for select
  using (owner_id = auth.uid());

create policy "projects owner insert"
  on public.projects for insert
  with check (owner_id = auth.uid());

create policy "projects owner update"
  on public.projects for update
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

create policy "projects owner delete"
  on public.projects for delete
  using (owner_id = auth.uid());

-- Snapshots: owner-only for all operations.
create policy "snapshots owner select"
  on public.env_snapshots for select
  using (owner_id = auth.uid());

create policy "snapshots owner insert"
  on public.env_snapshots for insert
  with check (owner_id = auth.uid());

create policy "snapshots owner delete"
  on public.env_snapshots for delete
  using (owner_id = auth.uid());
