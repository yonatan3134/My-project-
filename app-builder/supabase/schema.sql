-- App builder: the cloud table for projects.
-- Run once in Supabase: SQL Editor → New query → paste → Run.

create table if not exists public.projects (id text not null, owner uuid not null default auth.uid() references auth.users (id) on delete cascade, name text not null default 'New project', mode text not null default 'blocks', blocks jsonb, html text not null default '', messages jsonb not null default '[]'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), primary key (owner, id));

-- Each user can read and change only their own projects.
alter table public.projects enable row level security;
create policy "own projects" on public.projects for all to authenticated using ((select auth.uid()) = owner) with check ((select auth.uid()) = owner);
